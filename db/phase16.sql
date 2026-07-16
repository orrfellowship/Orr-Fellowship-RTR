-- ============================================================================
-- Orr RTR — Phase 16: outreach campaigns (durable send queue)
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- The composer ENQUEUES a campaign: it writes the campaign + one row per
-- recipient with status 'queued', then returns immediately so the fellow can
-- walk away — nothing is required of them after clicking Send. A background
-- worker (the /api/cron?job=outreach drainer, added in the engine phase) sends
-- the queued rows in time-budgeted chunks, spaced 1–2s apart, and marks each
-- one. The send request also pokes the drainer once so the first emails leave
-- within seconds instead of waiting for the next scheduled tick.
--
-- Why a queue and not a long request: a web request can't run for the ~minutes
-- a large batch needs, and a serverless function stops the instant it responds.
-- The queue lives in the database, so a crash just leaves rows 'queued' for the
-- next tick and already-sent rows are never rolled back (partial failure is
-- safe — those emails already left).
--
-- Enforced in the send/drain path (documented here, enforced in code):
--   • Sender identity comes from the session — never the request body.
--   • A sender may only email candidates assigned to them (point_person_id).
--   • do_not_contact is fellowship-wide, re-checked per recipient at drain time.
--   • Max 2 sends per candidate per rolling 7 days (all senders combined).
--   • Hard cap of 300 sends per sender per rolling 24 hours.
--
-- Sending is the fellow's own Gmail (per-user OAuth, gmail_connections from
-- phase15) — a permanently separate lane from Resend system mail.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) DO NOT CONTACT — fellowship-wide opt-out on the candidate record. Once
--    set, NO fellow can email this candidate again; the drain path re-checks it
--    per recipient (the composer's UI exclusion is a courtesy, not the guard).
-- ---------------------------------------------------------------------------
alter table public.candidates
  add column if not exists do_not_contact boolean not null default false;

create index if not exists candidates_do_not_contact_idx
  on public.candidates (do_not_contact) where do_not_contact = true;

-- ---------------------------------------------------------------------------
-- 2) OUTREACH CAMPAIGNS — one row per composed batch. Holds the template that
--    was previewed; the per-recipient rendered copy is snapshotted on the send
--    rows below. status is a rollup the drainer maintains as the queue empties.
--    NB: distinct from the pre-existing `outreach_log` (manual contact notes).
--    Read: your own campaigns; admins see all. Writes via the service role.
-- ---------------------------------------------------------------------------
create table if not exists public.outreach_campaigns (
  id              uuid primary key default gen_random_uuid(),
  created_by      uuid not null references public.profiles(id) on delete cascade,
  name            text not null,
  subject         text not null,
  body            text not null,
  status          text not null default 'queued'
                  check (status in ('queued','sending','sent','partial','failed','canceled')),
  total_count     integer not null default 0,   -- rows enqueued (incl. skips)
  idempotency_key text,                          -- guards double-submit (per creator)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz
);

-- A creator's idempotency key maps to at most one campaign, so a double-click
-- (or a retried request) re-uses the first campaign instead of sending twice.
alter table public.outreach_campaigns
  add column if not exists idempotency_key text;
create unique index if not exists outreach_campaigns_idempotency_idx
  on public.outreach_campaigns (created_by, idempotency_key)
  where idempotency_key is not null;

alter table public.outreach_campaigns enable row level security;
grant select on public.outreach_campaigns to authenticated;

drop policy if exists outreach_campaigns_select on public.outreach_campaigns;
create policy outreach_campaigns_select on public.outreach_campaigns
  for select to authenticated
  using (
    created_by = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','super_admin'))
  );

create index if not exists outreach_campaigns_creator_idx
  on public.outreach_campaigns (created_by, created_at desc);
-- Campaigns still draining — lets the worker find live work cheaply.
create index if not exists outreach_campaigns_active_idx
  on public.outreach_campaigns (status) where status in ('queued','sending');

-- ---------------------------------------------------------------------------
-- 3) OUTREACH SENDS — one row per candidate per campaign, the queue itself.
--    rendered_subject/body snapshot exactly what the fellow previewed, so the
--    drainer just sends stored content (no rendering in the time-critical path)
--    and a candidate edit mid-flight can't change what goes out. to_email also
--    snapshots the address used (the candidate's email can change later).
--    Read: your own sends; admins see all. Writes via the service role.
-- ---------------------------------------------------------------------------
create table if not exists public.outreach_sends (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references public.outreach_campaigns(id) on delete cascade,
  candidate_id      uuid references public.candidates(id) on delete set null,
  sender_user_id    uuid not null references public.profiles(id) on delete cascade,
  to_email          text not null,
  rendered_subject  text not null,
  rendered_body     text not null,
  status            text not null default 'queued'
                    check (status in ('queued','sent','failed','skipped_dnc','skipped_quota','canceled')),
  attempts          integer not null default 0,          -- retry counter (backoff cap)
  next_attempt_at   timestamptz not null default now(),  -- drainer picks queued rows due now
  gmail_message_id  text,
  gmail_thread_id   text,
  error             text,
  created_at        timestamptz not null default now(),
  sent_at           timestamptz,
  replied_at        timestamptz,
  bounced_at        timestamptz
);

alter table public.outreach_sends enable row level security;
grant select on public.outreach_sends to authenticated;

drop policy if exists outreach_sends_select on public.outreach_sends;
create policy outreach_sends_select on public.outreach_sends
  for select to authenticated
  using (
    sender_user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','super_admin'))
  );

-- Drain pick: due, still-queued rows, oldest first (FIFO within the budget).
create index if not exists outreach_sends_drain_idx
  on public.outreach_sends (next_attempt_at) where status = 'queued';
-- Per-campaign progress rollup + the live "sending X of N" counts.
create index if not exists outreach_sends_campaign_idx
  on public.outreach_sends (campaign_id, status);
-- Quota guards: 2/candidate/7d and 300/sender/24h (count actual sends).
create index if not exists outreach_sends_candidate_sent_idx
  on public.outreach_sends (candidate_id, sent_at) where sent_at is not null;
create index if not exists outreach_sends_sender_sent_idx
  on public.outreach_sends (sender_user_id, sent_at) where sent_at is not null;
-- Reply/bounce sweep (phase 6): sent threads not yet resolved.
create index if not exists outreach_sends_reply_sweep_idx
  on public.outreach_sends (gmail_thread_id) where gmail_thread_id is not null and replied_at is null;

-- Atomically claim a drain batch. SELECT + UPDATE in application code allows
-- overlapping cron/after() workers to select the same rows and send duplicate
-- messages. Row locks plus SKIP LOCKED ensure each queued row is leased by at
-- most one worker.
create or replace function public.claim_outreach_sends(
  p_limit integer,
  p_now timestamptz,
  p_lease_until timestamptz
)
returns table (
  id uuid,
  campaign_id uuid,
  candidate_id uuid,
  sender_user_id uuid,
  to_email text,
  rendered_subject text,
  rendered_body text,
  attempts integer
)
language sql
security invoker
set search_path = ''
as $$
  with picked as (
    select s.id
    from public.outreach_sends s
    where s.status = 'queued'
      and s.next_attempt_at <= p_now
    order by s.next_attempt_at, s.created_at
    for update skip locked
    limit greatest(least(p_limit, 100), 0)
  ), leased as (
    update public.outreach_sends s
    set next_attempt_at = p_lease_until
    from picked p
    where s.id = p.id
      and s.status = 'queued'
      and s.next_attempt_at <= p_now
    returning
      s.id,
      s.campaign_id,
      s.candidate_id,
      s.sender_user_id,
      s.to_email,
      s.rendered_subject,
      s.rendered_body,
      s.attempts
  )
  select * from leased;
$$;

revoke all on function public.claim_outreach_sends(integer, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_outreach_sends(integer, timestamptz, timestamptz)
  to service_role;

notify pgrst, 'reload schema';

-- ============================================================================
-- 4) SCHEDULER — drain the queue every minute so batches keep flowing after
--    the fellow walks away. Requires pg_cron + pg_net (already used in phase3).
--    Replace BOTH placeholders, then run. The send request also triggers a
--    drain immediately, so this is the steady-state/backstop cadence.
-- ============================================================================
-- select cron.schedule('orr-outreach', '* * * * *', $$
--   select net.http_post(
--     url     := 'https://YOUR_SITE_URL/api/cron?job=outreach',
--     headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET')
--   );
-- $$);
-- ============================================================================
