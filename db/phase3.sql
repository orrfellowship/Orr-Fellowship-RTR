-- ============================================================================
-- Orr RTR — Phase 3 schema: notifications, calendar events, RSVPs
-- Run in the Supabase SQL editor. Idempotent.
-- Writes happen through server actions using the service role (RLS bypassed);
-- RLS here just governs direct reads.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) NOTIFICATIONS  (in-app bell + queued email)
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  type         text not null,
  title        text not null,
  body         text,
  link         text,
  candidate_id uuid references public.candidates(id) on delete cascade,
  read         boolean not null default false,
  send_after   timestamptz not null default now(),
  emailed_at   timestamptz,
  superseded   boolean not null default false,
  dedupe_key   text,
  created_at   timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.notifications (recipient_id, read);
create index if not exists notifications_due_idx on public.notifications (send_after) where emailed_at is null and superseded = false;

alter table public.notifications enable row level security;
grant select, update on public.notifications to authenticated;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated using (recipient_id = auth.uid());

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2) EVENTS  (recruiting calendar; null school_id = org-wide)
-- ---------------------------------------------------------------------------
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid references public.schools(id) on delete cascade,
  title       text not null,
  description text,
  event_date  date not null,
  event_type  text not null check (event_type in ('attend','info','deadline')),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists events_date_idx on public.events (event_date);

alter table public.events enable row level security;
grant select on public.events to authenticated;

drop policy if exists events_select on public.events;
create policy events_select on public.events
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 3) EVENT RSVPS
-- ---------------------------------------------------------------------------
create table if not exists public.event_rsvps (
  event_id   uuid not null references public.events(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status     text not null check (status in ('going','not_going')),
  updated_at timestamptz not null default now(),
  primary key (event_id, profile_id)
);

alter table public.event_rsvps enable row level security;
grant select on public.event_rsvps to authenticated;

drop policy if exists event_rsvps_select on public.event_rsvps;
create policy event_rsvps_select on public.event_rsvps
  for select to authenticated using (true);

-- ============================================================================
-- 4) SCHEDULER — pg_cron + pg_net call the /api/cron route
--    Requires the `pg_cron` and `pg_net` extensions (enable in Dashboard →
--    Database → Extensions). Replace BOTH placeholders below, then run.
-- ============================================================================
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- -- Flush due notifications every 5 minutes (drives the 30-min claim delay):
-- select cron.schedule('orr-flush', '*/5 * * * *', $$
--   select net.http_post(
--     url     := 'https://YOUR_SITE_URL/api/cron?job=flush',
--     headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET')
--   );
-- $$);
--
-- -- Build + send the daily grouped digests at 13:00 UTC (~8am ET):
-- select cron.schedule('orr-digest', '0 13 * * *', $$
--   select net.http_post(
--     url     := 'https://YOUR_SITE_URL/api/cron?job=digest',
--     headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET')
--   );
-- $$);
--
-- -- To change/remove later: select cron.unschedule('orr-flush');
