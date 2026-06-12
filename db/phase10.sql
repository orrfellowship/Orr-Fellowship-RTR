-- ============================================================================
-- Orr RTR — Phase 10: track who added each candidate
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- created_by is the profile who manually added/imported the candidate. JazzHR-
-- synced candidates leave it null (source = 'jazzhr'), so the UI shows them as
-- "JazzHR sync". Older manually-added rows are also null (unknown) until re-touched.
-- ============================================================================

alter table public.candidates add column if not exists created_by uuid references public.profiles(id) on delete set null;

notify pgrst, 'reload schema';
