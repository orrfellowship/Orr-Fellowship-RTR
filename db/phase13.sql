-- ============================================================================
-- Orr RTR — Phase 13: school-scoped budget guidance
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
--  • budget_guidance can now be organization-wide (school_id null) or scoped to
--    one school, so admins can set recommended category budgets per school.
-- ============================================================================

alter table public.budget_guidance
  add column if not exists school_id uuid references public.schools(id) on delete cascade;

create index if not exists budget_guidance_school_idx
  on public.budget_guidance (school_id);

notify pgrst, 'reload schema';
