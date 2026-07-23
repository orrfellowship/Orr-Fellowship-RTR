-- ============================================================================
-- PHASE 19 — Aggregate RPCs for the read-heavy views
-- Idempotent: safe to re-run.
--
-- Standings / Overview / Schools and the admin Weekly Snapshot only need
-- per-school, per-stage COUNTS — not every candidate row. These functions let
-- the app fetch one small grouped result instead of paging the whole
-- candidates table 1000 rows at a time on every request.
--
-- Both functions are called with the service-role key from trusted server
-- code only, so EXECUTE is revoked from the public-facing roles.
-- ============================================================================

-- Per (school, raw university text, stage, not_interested) counts.
--   * university_raw is included so the Overview tab can split satellite/bonus
--     groups into their specific schools (routing logic stays in JS).
--   * not_interested is included so the snapshot's misrouted count can look at
--     interested candidates only, while standings keeps its "all rows" view.
create or replace function public.candidate_stage_counts()
returns table (school_id uuid, university_raw text, stage text, not_interested boolean, n bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select c.school_id, c.university_raw, c.stage, c.not_interested, count(*)::bigint as n
  from public.candidates c
  group by 1, 2, 3, 4
$$;

revoke execute on function public.candidate_stage_counts() from public, anon, authenticated;
grant execute on function public.candidate_stage_counts() to service_role;

-- Number of duplicate groups among interested candidates — the SQL twin of
-- findDuplicateGroups() in src/lib/duplicates.ts (the Weekly Snapshot only
-- shows the COUNT, so the grouping happens here instead of loading every row):
--   * email groups: 2+ candidates sharing a normalized (trimmed, lowercased)
--     non-empty email.
--   * name groups: 2+ candidates sharing a normalized name at the SAME school,
--     except groups already fully covered by one email group (every member has
--     an email and they all normalize to the same one).
create or replace function public.candidate_dup_group_count()
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  with email_groups as (
    select lower(btrim(email)) as k
    from public.candidates
    where not_interested = false
      and btrim(coalesce(email, '')) <> ''
    group by 1
    having count(*) > 1
  ),
  name_groups as (
    select lower(btrim(name)) as nk, coalesce(school_id::text, '') as sk
    from public.candidates
    where not_interested = false
      and btrim(coalesce(name, '')) <> ''
    group by 1, 2
    having count(*) > 1
       and not (
         -- all members have a (JS-truthy) email…
         count(*) filter (where email is null or email = '') = 0
         -- …and they all normalize to a single address
         and count(distinct lower(btrim(email))) filter (where btrim(coalesce(email, '')) <> '') = 1
       )
  )
  select (select count(*) from email_groups)::int + (select count(*) from name_groups)::int
$$;

revoke execute on function public.candidate_dup_group_count() from public, anon, authenticated;
grant execute on function public.candidate_dup_group_count() to service_role;
