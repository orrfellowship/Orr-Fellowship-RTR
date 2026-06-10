-- ============================================================================
-- Orr RTR — Phase 6: drop the unused school_goals.cycle column
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- The app stores one goal row per school and never used `cycle`; its NOT NULL
-- constraint was rejecting every goal save ("null value in column 'cycle' …").
-- Dropping the column also removes any PK/unique that referenced it; the app
-- keeps one row per school via its delete-then-insert on save.
-- ============================================================================

alter table public.school_goals drop column if exists cycle;

-- Refresh PostgREST's schema cache so the change is visible immediately.
notify pgrst, 'reload schema';
