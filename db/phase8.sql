-- ============================================================================
-- Orr RTR — Phase 8: per-school notes on calendar events
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Admins attach a note to an event targeted at a single school; that school's
-- team lead (and admins) see it. It does NOT broadcast to the whole org like the
-- event's own description does. Writes go through server actions (service role);
-- the RLS policy below just governs direct reads.
-- ============================================================================

create table if not exists public.event_notes (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  school_id   uuid not null references public.schools(id) on delete cascade,
  body        text not null,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists event_notes_event_idx on public.event_notes (event_id);
create index if not exists event_notes_school_idx on public.event_notes (school_id);

alter table public.event_notes enable row level security;
grant select, insert, update, delete on public.event_notes to authenticated;

drop policy if exists event_notes_select on public.event_notes;
create policy event_notes_select on public.event_notes
  for select to authenticated using (true);

notify pgrst, 'reload schema';
