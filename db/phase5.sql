-- ============================================================================
-- Orr RTR — Phase 5 schema: richer calendar events + Notre Dame rename
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
-- ============================================================================

-- 1) Calendar events carry a free-text address/location.
alter table public.events add column if not exists address text;

-- 2) Notre Dame now represents the combined campus.
update public.schools set name = 'Notre Dame & Saint Marys' where name = 'Notre Dame';

-- 3) Refresh PostgREST's schema cache so the new column is visible immediately
--    (fixes "Could not find the 'address' column of 'events' in the schema cache").
notify pgrst, 'reload schema';
