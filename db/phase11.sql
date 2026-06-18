-- ============================================================================
-- Orr RTR — Phase 11: misc data fixes
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
--  • UIndy moves from the Satellite tier to the Bonus tier.
--  • budget_guidance now records a recommended DOLLAR amount per category
--    instead of a percentage, so widen the (formerly numeric(5,2)) `pct`
--    column — its name is kept, but the value is now a dollar figure.
-- ============================================================================

-- 1) UIndy → Bonus
update public.schools set tier = 'bonus' where name = 'UIndy';

-- 2) Budget guidance stores dollars, not percentages — widen the column so it
--    can hold real budget figures (numeric(5,2) topped out at 999.99).
alter table public.budget_guidance alter column pct type numeric(12,2);

notify pgrst, 'reload schema';
