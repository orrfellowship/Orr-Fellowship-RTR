\set ON_ERROR_STOP on

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists dblink;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create table public.profiles (
  id uuid primary key,
  is_active boolean not null default true,
  email text,
  full_name text,
  role text
);
create table public.schools (id uuid primary key, name text not null);
create table public.candidates (
  id uuid primary key,
  name text not null,
  point_person_id uuid,
  created_by uuid,
  school_id uuid,
  university_raw text
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null,
  type text not null,
  title text not null,
  body text not null,
  link text,
  send_after timestamptz,
  emailed_at timestamptz,
  dedupe_key text,
  superseded boolean not null default false,
  created_at timestamptz not null default now()
);

\ir ../db/phase18.sql

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'assertion failed: %', message; end if;
end $$;

insert into public.profiles (id, email, full_name, role) values
  ('10000000-0000-0000-0000-000000000001', 'owner1@example.test', 'Owner One', 'Fellow'),
  ('10000000-0000-0000-0000-000000000002', 'owner2@example.test', 'Owner Two', 'Fellow'),
  ('10000000-0000-0000-0000-000000000003', 'admin@example.test', 'Admin Test', 'Super_Admin');
insert into public.schools (id, name)
values ('20000000-0000-0000-0000-000000000001', 'Test School');

-- Assignment idempotency and legitimate X -> Y -> X reassignment.
insert into public.candidates (id, name, point_person_id, created_by, school_id, university_raw)
values (
  '30000000-0000-0000-0000-000000000001', 'Candidate One',
  '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000001', 'Test University'
);
update public.candidates set point_person_id = '10000000-0000-0000-0000-000000000001'
where id = '30000000-0000-0000-0000-000000000001';
select pg_temp.assert_true(
  (select count(*) = 1 and max(assignment_version) = 1 from public.assignment_change_events),
  'saving the same owner must not create another event'
);
update public.candidates set point_person_id = '10000000-0000-0000-0000-000000000002'
where id = '30000000-0000-0000-0000-000000000001';
update public.candidates set point_person_id = '10000000-0000-0000-0000-000000000002'
where id = '30000000-0000-0000-0000-000000000001';
update public.candidates set point_person_id = '10000000-0000-0000-0000-000000000001'
where id = '30000000-0000-0000-0000-000000000001';
select pg_temp.assert_true(
  (select count(*) = 3 and max(assignment_version) = 3 from public.assignment_change_events),
  'X -> Y -> X must create exactly three monotonic versions'
);

update public.transactional_worker_control
set enabled = true, hard_paused = false, pause_reason = null, paused_at = null
where worker_name = 'weekly-assignment-digest';

select pg_temp.assert_true(
  (public.prepare_weekly_assignment_digests(
    '2026-07-13T12:00:00Z', '2026-07-20T12:00:00Z',
    '40000000-0000-0000-0000-000000000001'
  )->>'jobsCreated')::integer = 1,
  'preparation must create one combined recipient digest'
);
select pg_temp.assert_true(
  (select count(*) = 2 from public.assignment_change_events where status = 'claimed'),
  'only events for the current owner must be claimed'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.assignment_change_events where status = 'superseded'),
  'event for the former owner must be superseded'
);

create temporary table first_claim as
select * from public.claim_transactional_digest_jobs(
  25, '50000000-0000-0000-0000-000000000001', now() + interval '5 minutes'
);
select pg_temp.assert_true((select count(*) = 1 from first_claim), 'first worker must claim the digest');
select pg_temp.assert_true(
  (select count(*) = 0 from public.claim_transactional_digest_jobs(
    25, '50000000-0000-0000-0000-000000000002', now() + interval '5 minutes'
  )),
  'an active lease must not be stolen'
);
select pg_temp.assert_true(
  (public.reserve_transactional_send(
    (select id from first_claim), '50000000-0000-0000-0000-000000000001'
  )->>'ok')::boolean,
  'claimed digest must reserve its daily-cap slot'
);
select pg_temp.assert_true(
  public.finalize_transactional_send(
    (select id from first_claim), '50000000-0000-0000-0000-000000000001',
    'provider-test-1', 'fingerprint-1'
  ),
  'accepted digest must finalize'
);
select pg_temp.assert_true(
  (select status = 'sent' and attempt_count = 1 and provider_message_id = 'provider-test-1'
   from public.transactional_digest_jobs where id = (select id from first_claim)),
  'finalization must persist provider evidence'
);
select pg_temp.assert_true(
  (select count(*) = 2 from public.assignment_change_events where status = 'processed'),
  'finalization must consume the digest events'
);

-- Eleven logical emails for a fresh recipient: exactly ten reservations may pass.
insert into public.transactional_digest_jobs (
  job_type, recipient_id, recipient_email, period_start, period_end,
  idempotency_key, payload_fingerprint
)
select
  'generic_notification', '10000000-0000-0000-0000-000000000002', 'owner2@example.test',
  '2026-06-01T12:00:00Z'::timestamptz + make_interval(days => i),
  '2026-06-02T12:00:00Z'::timestamptz + make_interval(days => i),
  'cap-test/' || i, 'cap-fingerprint-' || i
from generate_series(1, 11) i;
create temporary table cap_claims as
select * from public.claim_transactional_digest_jobs(
  25, '50000000-0000-0000-0000-000000000003', now() + interval '5 minutes'
);
select pg_temp.assert_true((select count(*) = 11 from cap_claims), 'all cap test jobs must be claimed');
do $$
declare rec record; result jsonb; n integer := 0;
begin
  for rec in select id from cap_claims order by created_at, id loop
    n := n + 1;
    result := public.reserve_transactional_send(rec.id, '50000000-0000-0000-0000-000000000003');
    if n <= 10 and (result->>'ok')::boolean is not true then
      raise exception 'cap reservation % should pass: %', n, result;
    end if;
    if n = 11 and (result->>'reason') is distinct from 'daily_cap' then
      raise exception 'reservation 11 should hit daily cap: %', result;
    end if;
  end loop;
end $$;
select pg_temp.assert_true(
  (select count(*) = 10 from public.transactional_send_reservations
   where recipient_id = '10000000-0000-0000-0000-000000000002'),
  'daily cap must stop at ten reservations'
);

-- A retriable job exhausts on attempt three and can never receive a fourth claim.
insert into public.transactional_digest_jobs (
  id, job_type, recipient_id, recipient_email, period_start, period_end,
  idempotency_key, payload_fingerprint
) values (
  '60000000-0000-0000-0000-000000000001', 'generic_notification',
  '10000000-0000-0000-0000-000000000003', 'admin@example.test',
  '2026-05-01T12:00:00Z', '2026-05-02T12:00:00Z', 'retry-test', 'retry-fingerprint'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.claim_transactional_digest_jobs(
    1, '50000000-0000-0000-0000-000000000004', now() + interval '5 minutes'
  ) where id = '60000000-0000-0000-0000-000000000001'),
  'retry test must receive first claim'
);
select pg_temp.assert_true(
  public.fail_transactional_send(
    '60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000004',
    'network', 'attempt one', true, 'retry-fingerprint'
  ) = 'retry', 'attempt one must retry'
);
update public.transactional_digest_jobs set next_attempt_at = now()
where id = '60000000-0000-0000-0000-000000000001';
select count(*) from public.claim_transactional_digest_jobs(
  1, '50000000-0000-0000-0000-000000000005', now() + interval '5 minutes'
) where id = '60000000-0000-0000-0000-000000000001';
select pg_temp.assert_true(
  public.fail_transactional_send(
    '60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000005',
    'network', 'attempt two', true, 'retry-fingerprint'
  ) = 'retry', 'attempt two must retry'
);
update public.transactional_digest_jobs set next_attempt_at = now()
where id = '60000000-0000-0000-0000-000000000001';
select count(*) from public.claim_transactional_digest_jobs(
  1, '50000000-0000-0000-0000-000000000006', now() + interval '5 minutes'
) where id = '60000000-0000-0000-0000-000000000001';
select pg_temp.assert_true(
  public.fail_transactional_send(
    '60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000006',
    'network', 'attempt three', true, 'retry-fingerprint'
  ) = 'exhausted', 'attempt three must exhaust'
);
select pg_temp.assert_true(
  (select attempt_count = 3 and status = 'exhausted'
   from public.transactional_digest_jobs where id = '60000000-0000-0000-0000-000000000001'),
  'exhausted job must preserve three attempts'
);

-- A locked row is skipped, then claimable when the competing transaction ends.
insert into public.transactional_digest_jobs (
  id, job_type, recipient_id, recipient_email, period_start, period_end,
  idempotency_key, payload_fingerprint
) values (
  '60000000-0000-0000-0000-000000000002', 'generic_notification',
  '10000000-0000-0000-0000-000000000003', 'admin@example.test',
  '2026-04-01T12:00:00Z', '2026-04-02T12:00:00Z', 'lock-test', 'lock-fingerprint'
);
select dblink_connect('locker', 'dbname=' || current_database());
select dblink_exec('locker', 'begin');
select * from dblink(
  'locker',
  $$select id from public.transactional_digest_jobs
    where id = '60000000-0000-0000-0000-000000000002' for update$$
) as locked(id uuid);
select pg_temp.assert_true(
  (select count(*) = 0 from public.claim_transactional_digest_jobs(
    1, '50000000-0000-0000-0000-000000000007', now() + interval '5 minutes'
  ) where id = '60000000-0000-0000-0000-000000000002'),
  'SKIP LOCKED must not wait for or steal a concurrently locked job'
);
select dblink_exec('locker', 'rollback');
select dblink_disconnect('locker');
select pg_temp.assert_true(
  (select count(*) = 1 from public.claim_transactional_digest_jobs(
    1, '50000000-0000-0000-0000-000000000008', now() + interval '5 minutes'
  ) where id = '60000000-0000-0000-0000-000000000002'),
  'job must become claimable after the competing lock ends'
);

-- An abandoned claim recovers only after its lease expires.
insert into public.transactional_digest_jobs (
  id, job_type, recipient_id, recipient_email, period_start, period_end, status,
  idempotency_key, payload_fingerprint, claim_token, claimed_at, lease_expires_at
) values (
  '60000000-0000-0000-0000-000000000004', 'generic_notification',
  '10000000-0000-0000-0000-000000000003', 'admin@example.test',
  '2026-02-01T12:00:00Z', '2026-02-02T12:00:00Z', 'claimed',
  'lease-test', 'lease-fingerprint', '50000000-0000-0000-0000-000000000010',
  now() - interval '10 minutes', now() - interval '5 minutes'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.claim_transactional_digest_jobs(
    1, '50000000-0000-0000-0000-000000000011', now() + interval '5 minutes'
  ) where id = '60000000-0000-0000-0000-000000000004'
    and claim_token = '50000000-0000-0000-0000-000000000011'),
  'an expired lease must be reclaimed with a new token'
);

-- Accepted-outcome uncertainty beyond Resend's idempotency window hard-pauses.
insert into public.transactional_digest_jobs (
  id, job_type, recipient_id, recipient_email, period_start, period_end, status,
  idempotency_key, payload_fingerprint, provider_attempt_started_at, lease_expires_at
) values (
  '60000000-0000-0000-0000-000000000003', 'generic_notification',
  '10000000-0000-0000-0000-000000000003', 'admin@example.test',
  '2026-03-01T12:00:00Z', '2026-03-02T12:00:00Z', 'sending',
  'uncertain-test', 'uncertain-fingerprint', now() - interval '24 hours', now() - interval '1 minute'
);
select count(*) from public.claim_transactional_digest_jobs(
  25, '50000000-0000-0000-0000-000000000009', now() + interval '5 minutes'
);
select pg_temp.assert_true(
  (select hard_paused and pause_reason = 'accepted_outcome_uncertain_beyond_resend_idempotency_window'
   from public.transactional_worker_control where worker_name = 'weekly-assignment-digest'),
  'uncertain accepted outcome beyond 23 hours must hard-pause the worker'
);

select pg_temp.assert_true(
  not has_function_privilege('authenticated', 'public.claim_transactional_digest_jobs(integer,uuid,timestamptz)', 'EXECUTE'),
  'authenticated users must not execute queue-claim functions'
);

select 'transactional PostgreSQL integration tests passed' as result;
