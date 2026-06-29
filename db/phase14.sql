-- ============================================================================
-- Orr RTR — Phase 14: "Direct Placement Potential" flag
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
--  • Team leads can flag a candidate as a Direct Placement Potential. The flag
--    drives the Super Admin Weekly Snapshot action queue (and an immediate
--    email + in-app notification). Writes happen through the service role in
--    server actions, so no new RLS policies are needed here.
-- ============================================================================

alter table public.candidates
  add column if not exists direct_placement boolean not null default false;
alter table public.candidates
  add column if not exists direct_placement_by uuid references public.profiles(id) on delete set null;
alter table public.candidates
  add column if not exists direct_placement_at timestamptz;

-- Super Admin snapshot scans for flagged candidates; keep that lookup cheap.
create index if not exists candidates_direct_placement_idx
  on public.candidates (direct_placement) where direct_placement = true;

notify pgrst, 'reload schema';
