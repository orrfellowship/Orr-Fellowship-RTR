-- ============================================================================
-- Orr RTR — Phase 18: safe weekly transactional assignment digests
--
-- Apply before deploying the Phase 18 application code. This migration is
-- intentionally safe-by-default: it removes the legacy transactional schedules
-- and creates the replacement worker in a hard-paused, disabled state.
-- Gmail outreach tables, functions, and schedules are not referenced here.
-- ============================================================================

-- Stop both legacy Resend workers before adding any replacement send path.
do $$
declare
  legacy_job record;
begin
  if to_regclass('cron.job') is not null then
    for legacy_job in
      select jobid from cron.job where jobname in ('orr-flush', 'orr-digest')
    loop
      perform cron.unschedule(legacy_job.jobid);
    end loop;
  end if;
end $$;

-- Future notification inserts must deduplicate atomically while they are due.
-- Historical sent/superseded duplicates remain untouched as incident evidence.
create unique index if not exists notifications_pending_dedupe_idx
  on public.notifications (recipient_id, dedupe_key)
  where dedupe_key is not null and emailed_at is null and superseded = false;

-- Monotonic per-candidate assignment version. It advances only when the owner
-- actually changes, so assigning X -> Y -> X creates three distinct versions.
alter table public.candidates
  add column if not exists assignment_version bigint not null default 0;

create table if not exists public.assignment_change_events (
  id                  uuid primary key default gen_random_uuid(),
  event_key           text not null unique,
  candidate_id        uuid not null,
  candidate_name      text not null,
  previous_owner_id   uuid,
  new_owner_id        uuid not null,
  assignment_version  bigint not null,
  changed_by          uuid,
  school_id           uuid,
  school_name         text,
  university_raw      text,
  changed_at          timestamptz not null default now(),
  status              text not null default 'pending'
                      check (status in ('pending','claimed','processed','superseded','failed')),
  retry_count         integer not null default 0 check (retry_count between 0 and 3),
  failure_reason      text,
  digest_job_id       uuid,
  claimed_at          timestamptz,
  processed_at        timestamptz,
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  unique (candidate_id, assignment_version)
);

create index if not exists assignment_events_pending_idx
  on public.assignment_change_events (changed_at, new_owner_id)
  where status = 'pending';
create index if not exists assignment_events_job_idx
  on public.assignment_change_events (digest_job_id)
  where digest_job_id is not null;

alter table public.assignment_change_events enable row level security;
revoke all on public.assignment_change_events from anon, authenticated;

create table if not exists public.transactional_digest_jobs (
  id                          uuid primary key default gen_random_uuid(),
  job_type                    text not null default 'assignment_weekly'
                              check (job_type in ('assignment_weekly','admin_alert','generic_notification')),
  recipient_id                uuid not null,
  recipient_email             text not null,
  recipient_name              text,
  period_start                timestamptz not null,
  period_end                  timestamptz not null,
  status                      text not null default 'pending'
                              check (status in ('pending','claimed','sending','retry','sent','exhausted','blocked')),
  event_count                 integer not null default 0 check (event_count >= 0),
  attempt_count               integer not null default 0 check (attempt_count between 0 and 3),
  idempotency_key             text not null unique check (char_length(idempotency_key) between 1 and 256),
  payload_fingerprint         text not null,
  alert_subject               text,
  alert_body                  text,
  alert_heading               text,
  alert_cta_label             text,
  alert_cta_url               text,
  provider_message_id         text,
  provider_attempt_started_at timestamptz,
  provider_accepted_at        timestamptz,
  last_attempt_at             timestamptz,
  next_attempt_at             timestamptz not null default now(),
  last_error_category         text,
  last_error                  text,
  claim_token                 uuid,
  claimed_at                  timestamptz,
  lease_expires_at            timestamptz,
  accepted_at                 timestamptz,
  sent_at                     timestamptz,
  exhausted_at                timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (job_type, recipient_id, period_start, period_end),
  check (period_end > period_start)
);

create index if not exists transactional_jobs_claim_idx
  on public.transactional_digest_jobs (next_attempt_at, created_at)
  where status in ('pending','retry');
create index if not exists transactional_jobs_lease_idx
  on public.transactional_digest_jobs (lease_expires_at)
  where status in ('claimed','sending');
create index if not exists transactional_jobs_recipient_sent_idx
  on public.transactional_digest_jobs (recipient_id, provider_accepted_at)
  where provider_accepted_at is not null;

alter table public.transactional_digest_jobs enable row level security;
revoke all on public.transactional_digest_jobs from anon, authenticated;

alter table public.assignment_change_events
  drop constraint if exists assignment_change_events_digest_job_id_fkey;
alter table public.assignment_change_events
  add constraint assignment_change_events_digest_job_id_fkey
  foreign key (digest_job_id) references public.transactional_digest_jobs(id) on delete restrict;

create table if not exists public.transactional_email_attempts (
  id                    uuid primary key default gen_random_uuid(),
  job_id                uuid not null references public.transactional_digest_jobs(id) on delete restrict,
  attempt_number        integer not null check (attempt_number between 1 and 3),
  result                text not null check (result in ('accepted','retriable_failure','permanent_failure','persistence_failure','cap_blocked')),
  error_category        text,
  error_summary         text,
  provider_message_id   text,
  idempotency_fingerprint text not null,
  attempted_at          timestamptz not null default now(),
  unique (job_id, attempt_number)
);
create index if not exists transactional_attempts_job_idx
  on public.transactional_email_attempts (job_id, attempted_at desc);
alter table public.transactional_email_attempts enable row level security;
revoke all on public.transactional_email_attempts from anon, authenticated;

-- One reservation per logical email. Reserving before the provider call makes
-- the 10-email Eastern-day cap concurrency safe and deliberately conservative.
create table if not exists public.transactional_send_reservations (
  job_id             uuid primary key references public.transactional_digest_jobs(id) on delete restrict,
  recipient_id       uuid not null,
  recipient_local_day date not null,
  reserved_at        timestamptz not null default now()
);
create index if not exists transactional_reservations_cap_idx
  on public.transactional_send_reservations (recipient_id, recipient_local_day);
alter table public.transactional_send_reservations enable row level security;
revoke all on public.transactional_send_reservations from anon, authenticated;

create table if not exists public.transactional_worker_control (
  worker_name                  text primary key,
  enabled                      boolean not null default false,
  hard_paused                  boolean not null default true,
  pause_reason                 text,
  paused_at                    timestamptz,
  max_jobs_per_run             integer not null default 25 check (max_jobs_per_run between 1 and 100),
  max_recipients_per_run       integer not null default 25 check (max_recipients_per_run between 1 and 100),
  max_events_per_recipient     integer not null default 200 check (max_events_per_recipient between 1 and 1000),
  max_pending_jobs             integer not null default 50 check (max_pending_jobs between 1 and 500),
  consecutive_provider_failures integer not null default 0,
  consecutive_finalize_failures integer not null default 0,
  updated_at                   timestamptz not null default now(),
  updated_by                   uuid
);
insert into public.transactional_worker_control
  (worker_name, enabled, hard_paused, pause_reason, paused_at)
values
  ('weekly-assignment-digest', false, true, 'Phase 18 containment: explicit production enablement required', now())
on conflict (worker_name) do nothing;
alter table public.transactional_worker_control enable row level security;
revoke all on public.transactional_worker_control from anon, authenticated;

create table if not exists public.transactional_incidents (
  id                  uuid primary key default gen_random_uuid(),
  dedupe_key          text not null unique,
  category            text not null,
  worker_name         text not null,
  job_id              uuid references public.transactional_digest_jobs(id) on delete restrict,
  recipient_id        uuid,
  attempt_count       integer not null default 0,
  error_summary       text not null,
  sending_paused      boolean not null default false,
  recommended_action text not null,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  occurrence_count    integer not null default 1,
  in_app_alerted_at   timestamptz,
  email_alert_queued_at timestamptz,
  resolved_at         timestamptz
);
create index if not exists transactional_incidents_open_idx
  on public.transactional_incidents (last_seen_at desc) where resolved_at is null;
alter table public.transactional_incidents enable row level security;
revoke all on public.transactional_incidents from anon, authenticated;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
drop function if exists public.capture_assignment_change();

-- Record owner transitions at the database boundary. Repeated saves of the
-- same owner do nothing; concurrent updates serialize on the candidate row.
create or replace function private.capture_assignment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  school_label text;
begin
  if tg_op = 'INSERT' then
    if new.point_person_id is null then
      return new;
    end if;
    new.assignment_version := greatest(coalesce(new.assignment_version, 0), 0) + 1;
    select s.name into school_label from public.schools s where s.id = new.school_id;
    insert into public.assignment_change_events (
      event_key, candidate_id, candidate_name, previous_owner_id, new_owner_id,
      assignment_version, changed_by, school_id, school_name, university_raw, changed_at
    ) values (
      'assignment/' || new.id::text || '/' || new.assignment_version::text,
      new.id, new.name, null, new.point_person_id, new.assignment_version,
      coalesce(actor_id, new.created_by), new.school_id, school_label, new.university_raw, now()
    );
    return new;
  end if;

  if old.point_person_id is not distinct from new.point_person_id then
    new.assignment_version := old.assignment_version;
    return new;
  end if;

  new.assignment_version := old.assignment_version + 1;
  if new.point_person_id is not null then
    select s.name into school_label from public.schools s where s.id = new.school_id;
    insert into public.assignment_change_events (
      event_key, candidate_id, candidate_name, previous_owner_id, new_owner_id,
      assignment_version, changed_by, school_id, school_name, university_raw, changed_at
    ) values (
      'assignment/' || new.id::text || '/' || new.assignment_version::text,
      new.id, new.name, old.point_person_id, new.point_person_id,
      new.assignment_version, actor_id, new.school_id, school_label, new.university_raw, now()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists candidates_capture_assignment_change on public.candidates;
create trigger candidates_capture_assignment_change
before insert or update of point_person_id on public.candidates
for each row execute function private.capture_assignment_change();
revoke all on function private.capture_assignment_change() from public, anon, authenticated;

create or replace function public.assign_candidate_point_person(
  p_candidate_id uuid,
  p_owner_id uuid,
  p_actor_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_version bigint;
begin
  if not exists (select 1 from public.profiles where id = p_actor_id and is_active = true) then
    return false;
  end if;
  update public.candidates
  set point_person_id = p_owner_id
  where id = p_candidate_id
  returning assignment_version into new_version;
  if new_version is null then return false; end if;
  update public.assignment_change_events
  set changed_by = p_actor_id
  where candidate_id = p_candidate_id and assignment_version = new_version and changed_by is null;
  return true;
end;
$$;
revoke all on function public.assign_candidate_point_person(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.assign_candidate_point_person(uuid,uuid,uuid) to service_role;

-- Create one immutable weekly job per active recipient and attach only events
-- for candidates they still own at the cutoff. Reassignments away are retained
-- as superseded audit events and never leak into the former owner's digest.
create or replace function public.prepare_weekly_assignment_digests(
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_run_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  control public.transactional_worker_control%rowtype;
  recipient_total integer;
  event_total integer;
  largest_recipient integer;
  jobs_created integer := 0;
  rec record;
  new_job_id uuid;
begin
  select * into control from public.transactional_worker_control
  where worker_name = 'weekly-assignment-digest' for update;

  if control.enabled is not true or control.hard_paused is true then
    return jsonb_build_object('ok', false, 'paused', true, 'reason', control.pause_reason);
  end if;

  update public.assignment_change_events e
  set status = 'superseded', processed_at = now()
  where e.status = 'pending'
    and e.changed_at < p_period_end
    and not exists (
      select 1 from public.candidates c
      where c.id = e.candidate_id and c.point_person_id = e.new_owner_id
    );

  select count(*), coalesce(sum(x.event_count), 0), coalesce(max(x.event_count), 0)
  into recipient_total, event_total, largest_recipient
  from (
    select e.new_owner_id, count(*)::integer as event_count
    from public.assignment_change_events e
    join public.profiles p on p.id = e.new_owner_id and p.is_active = true and p.email is not null
    where e.status = 'pending' and e.changed_at < p_period_end
    group by e.new_owner_id
  ) x;

  if recipient_total > control.max_recipients_per_run
     or largest_recipient > control.max_events_per_recipient
     or event_total > control.max_recipients_per_run * control.max_events_per_recipient then
    update public.transactional_worker_control
      set hard_paused = true,
          pause_reason = format('circuit_breaker recipients=%s events=%s largest_recipient=%s run=%s', recipient_total, event_total, largest_recipient, p_run_id),
          paused_at = now(), updated_at = now()
      where worker_name = 'weekly-assignment-digest';
    return jsonb_build_object('ok', false, 'paused', true, 'circuitBreaker', true,
      'recipients', recipient_total, 'events', event_total, 'largestRecipient', largest_recipient);
  end if;

  for rec in
    select e.new_owner_id as recipient_id, p.email, p.full_name, count(*)::integer as event_count,
           coalesce(
             (select max(j.period_end) from public.transactional_digest_jobs j
              where j.job_type = 'assignment_weekly' and j.recipient_id = e.new_owner_id and j.status = 'sent'),
             least(p_period_start, min(e.changed_at))
           ) as digest_start
    from public.assignment_change_events e
    join public.profiles p on p.id = e.new_owner_id and p.is_active = true and p.email is not null
    where e.status = 'pending' and e.changed_at < p_period_end
    group by e.new_owner_id, p.email, p.full_name
    order by e.new_owner_id
  loop
    new_job_id := gen_random_uuid();
    insert into public.transactional_digest_jobs (
      id, recipient_id, recipient_email, recipient_name, period_start, period_end,
      event_count, idempotency_key, payload_fingerprint
    ) values (
      new_job_id, rec.recipient_id, rec.email, rec.full_name, rec.digest_start, p_period_end,
      rec.event_count, 'assignment-digest/' || new_job_id::text,
      encode(extensions.digest(rec.recipient_id::text || '|' || rec.digest_start::text || '|' || p_period_end::text || '|' || rec.event_count::text, 'sha256'), 'hex')
    ) on conflict (job_type, recipient_id, period_start, period_end) do nothing
    returning id into new_job_id;

    if new_job_id is not null then
      update public.assignment_change_events
      set status = 'claimed', digest_job_id = new_job_id, claimed_at = now()
      where status = 'pending' and new_owner_id = rec.recipient_id
        and changed_at >= rec.digest_start and changed_at < p_period_end;
      jobs_created := jobs_created + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'paused', false, 'recipients', recipient_total,
    'events', event_total, 'jobsCreated', jobs_created);
end;
$$;

create or replace function public.claim_transactional_digest_jobs(
  p_limit integer,
  p_claim_token uuid,
  p_lease_until timestamptz
) returns setof public.transactional_digest_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed integer;
  pending_total integer;
  worker_paused boolean;
begin
  select least(p_limit, max_jobs_per_run), hard_paused,
         (select count(*) from public.transactional_digest_jobs where status in ('pending','retry','claimed','sending'))
    into allowed, worker_paused, pending_total
  from public.transactional_worker_control
  where worker_name = 'weekly-assignment-digest' and enabled = true
  for update;
  if allowed is null then return; end if;
  if exists (
    select 1 from public.transactional_digest_jobs
    where status = 'sending' and lease_expires_at < now()
      and provider_attempt_started_at <= now() - interval '23 hours'
  ) then
    update public.transactional_worker_control
    set hard_paused = true,
        pause_reason = 'accepted_outcome_uncertain_beyond_resend_idempotency_window',
        paused_at = now(), updated_at = now()
    where worker_name = 'weekly-assignment-digest';
    return;
  end if;
  if not worker_paused and pending_total > (select max_pending_jobs from public.transactional_worker_control where worker_name = 'weekly-assignment-digest') then
    update public.transactional_worker_control
    set hard_paused = true, pause_reason = 'circuit_breaker pending_jobs=' || pending_total::text,
        paused_at = now(), updated_at = now()
    where worker_name = 'weekly-assignment-digest';
    return;
  end if;

  return query
  with claimable as (
    select j.id
    from public.transactional_digest_jobs j
    where j.attempt_count < 3 and (not worker_paused or j.job_type = 'admin_alert') and (
      (j.status in ('pending','retry') and j.next_attempt_at <= now())
      or (j.status = 'claimed' and j.lease_expires_at < now())
      or (j.status = 'sending' and j.lease_expires_at < now()
          and j.provider_attempt_started_at > now() - interval '23 hours')
    )
    order by j.created_at
    limit least(greatest(allowed, 0), 100)
    for update skip locked
  )
  update public.transactional_digest_jobs j
  set status = 'claimed', claim_token = p_claim_token, claimed_at = now(),
      lease_expires_at = p_lease_until, updated_at = now()
  from claimable c where j.id = c.id
  returning j.*;
end;
$$;

create or replace function public.reserve_transactional_send(
  p_job_id uuid,
  p_claim_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.transactional_digest_jobs%rowtype;
  local_day date := (now() at time zone 'America/New_York')::date;
  used integer;
begin
  select * into j from public.transactional_digest_jobs
  where id = p_job_id for update;
  if j.id is null or j.claim_token is distinct from p_claim_token or j.status <> 'claimed' then
    return jsonb_build_object('ok', false, 'reason', 'claim_mismatch');
  end if;

  if exists (select 1 from public.transactional_send_reservations where job_id = p_job_id) then
    update public.transactional_digest_jobs set status = 'sending', updated_at = now() where id = p_job_id;
    return jsonb_build_object('ok', true, 'reused', true, 'localDay', local_day);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(j.recipient_id::text || '|' || local_day::text, 0)
  );
  select count(*) into used from public.transactional_send_reservations
  where recipient_id = j.recipient_id and recipient_local_day = local_day;
  if used >= 10 then
    update public.transactional_digest_jobs
      set status = 'blocked', last_error_category = 'daily_cap',
          last_error = '10-email Eastern-day transactional cap reached', updated_at = now()
      where id = p_job_id;
    return jsonb_build_object('ok', false, 'reason', 'daily_cap', 'used', used);
  end if;

  insert into public.transactional_send_reservations (job_id, recipient_id, recipient_local_day)
  values (p_job_id, j.recipient_id, local_day);
  update public.transactional_digest_jobs
    set status = 'sending', provider_attempt_started_at = coalesce(provider_attempt_started_at, now()),
        last_attempt_at = now(), updated_at = now()
    where id = p_job_id;
  return jsonb_build_object('ok', true, 'reused', false, 'localDay', local_day, 'used', used + 1);
end;
$$;

create or replace function public.finalize_transactional_send(
  p_job_id uuid,
  p_claim_token uuid,
  p_provider_message_id text,
  p_idempotency_fingerprint text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare next_attempt integer;
begin
  update public.transactional_digest_jobs
    set status = 'sent', provider_message_id = p_provider_message_id,
        provider_accepted_at = now(), accepted_at = now(), sent_at = now(),
        attempt_count = attempt_count + 1, lease_expires_at = null, updated_at = now()
    where id = p_job_id and claim_token = p_claim_token and status = 'sending'
    returning attempt_count into next_attempt;
  if next_attempt is null then return false; end if;

  insert into public.transactional_email_attempts
    (job_id, attempt_number, result, provider_message_id, idempotency_fingerprint)
  values (p_job_id, next_attempt, 'accepted', p_provider_message_id, p_idempotency_fingerprint)
  on conflict (job_id, attempt_number) do nothing;

  update public.assignment_change_events
    set status = 'processed', processed_at = now(), sent_at = now()
    where digest_job_id = p_job_id and status = 'claimed';
  insert into public.notifications (
    recipient_id, type, title, body, link, send_after, emailed_at, dedupe_key
  )
  select recipient_id, 'assignment_weekly', 'Your weekly assignment digest',
         event_count::text || ' candidate' || case when event_count = 1 then ' was' else 's were' end || ' newly assigned to you.',
         '/workspace', now(), now(), 'assignment-digest:' || id::text
  from public.transactional_digest_jobs
  where id = p_job_id and job_type = 'assignment_weekly';
  return true;
end;
$$;

create or replace function public.fail_transactional_send(
  p_job_id uuid,
  p_claim_token uuid,
  p_error_category text,
  p_error_summary text,
  p_retriable boolean,
  p_idempotency_fingerprint text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
  final_status text;
begin
  select attempt_count + 1 into n from public.transactional_digest_jobs
  where id = p_job_id and claim_token = p_claim_token and status in ('claimed','sending') for update;
  if n is null then return 'claim_mismatch'; end if;
  final_status := case when p_retriable and n < 3 then 'retry' else 'exhausted' end;

  update public.transactional_digest_jobs
    set status = final_status, attempt_count = n,
        last_error_category = left(p_error_category, 100), last_error = left(p_error_summary, 1000),
        next_attempt_at = now() + case n when 1 then interval '5 minutes' else interval '15 minutes' end,
        exhausted_at = case when final_status = 'exhausted' then now() else null end,
        lease_expires_at = null, updated_at = now()
    where id = p_job_id;

  insert into public.transactional_email_attempts
    (job_id, attempt_number, result, error_category, error_summary, idempotency_fingerprint)
  values (p_job_id, n, case when final_status = 'retry' then 'retriable_failure' else 'permanent_failure' end,
          left(p_error_category, 100), left(p_error_summary, 1000), p_idempotency_fingerprint)
  on conflict (job_id, attempt_number) do nothing;
  update public.assignment_change_events
  set retry_count = n, failure_reason = left(p_error_summary, 1000),
      status = case when final_status = 'exhausted' then 'failed' else status end
  where digest_job_id = p_job_id;
  return final_status;
end;
$$;

create or replace function public.pause_transactional_worker(p_reason text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.transactional_worker_control
  set hard_paused = true, pause_reason = left(p_reason, 1000), paused_at = now(), updated_at = now()
  where worker_name = 'weekly-assignment-digest'
  returning true;
$$;

-- Service-role-only queue primitives. SECURITY DEFINER is required because the
-- worker tables are intentionally inaccessible through the public Data API.
revoke all on function public.prepare_weekly_assignment_digests(timestamptz,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.claim_transactional_digest_jobs(integer,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.reserve_transactional_send(uuid,uuid) from public, anon, authenticated;
revoke all on function public.finalize_transactional_send(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.fail_transactional_send(uuid,uuid,text,text,boolean,text) from public, anon, authenticated;
revoke all on function public.pause_transactional_worker(text) from public, anon, authenticated;
grant execute on function public.prepare_weekly_assignment_digests(timestamptz,timestamptz,uuid) to service_role;
grant execute on function public.claim_transactional_digest_jobs(integer,uuid,timestamptz) to service_role;
grant execute on function public.reserve_transactional_send(uuid,uuid) to service_role;
grant execute on function public.finalize_transactional_send(uuid,uuid,text,text) to service_role;
grant execute on function public.fail_transactional_send(uuid,uuid,text,text,boolean,text) to service_role;
grant execute on function public.pause_transactional_worker(text) to service_role;

notify pgrst, 'reload schema';

-- DO NOT ENABLE UNTIL THE PHASE 18 checklist is complete.
-- Invoke the protected worker every five minutes so short retries and critical
-- admin alerts can run promptly. The route creates new weekly jobs only during
-- Monday's 08:00 America/New_York hour, so DST never depends on a UTC offset:
--
-- select cron.schedule('orr-weekly-assignment-digest', '*/5 * * * *', $$
--   select net.http_post(
--     url := 'https://YOUR_SITE_URL/api/cron/transactional',
--     headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET')
--   );
-- $$);
--
-- Then explicitly enable only after review:
-- update public.transactional_worker_control
-- set enabled = true, hard_paused = false, pause_reason = null, paused_at = null,
--     updated_at = now()
-- where worker_name = 'weekly-assignment-digest';
