-- ============================================================================
-- PHASE 26 — Candidate race/ethnicity (from JazzHR) + per-school DEI counts
-- Idempotent: safe to re-run.
--
-- Race is sensitive: it is NEVER exposed to fellows (only Team Leads / Admin /
-- Super Admin), enforced in the app's candidate projections + the DEI rollup.
-- The DEI Rating is % diverse of ALL candidates at a school, where "diverse" =
-- any race that is present and not exactly "White" (and not a decline/blank).
-- ============================================================================

alter table public.candidates
  add column if not exists race text;

-- Per-school totals + diverse counts for the Standings DEI check. Aggregated in
-- SQL and read via the service role (same pattern as candidate_stage_counts).
create or replace function public.school_dei_counts()
returns table(school_id uuid, total bigint, diverse bigint)
language sql
stable
as $$
  select
    school_id,
    count(*) as total,
    count(*) filter (
      where race is not null
        and btrim(race) <> ''
        and lower(btrim(race)) <> 'white'
        and lower(race) not like '%decline%'
        and lower(race) not like '%prefer not%'
        and lower(race) not like '%not to say%'
        and lower(race) not like '%no answer%'
    ) as diverse
  from public.candidates
  where school_id is not null
  group by school_id
$$;
