-- ============================================================================
-- PHASE 21 — Backfill phase20 school matching over EXISTING candidates
-- Idempotent: re-running only touches rows that still qualify.
--
-- Policy (deliberately more conservative than intake, since this rewrites
-- historical data with no entrant to ask):
--   * Satellite/Bonus-group candidates whose raw university text EXACTLY
--     matches an alias in their tier move to that specific school row —
--     e.g. the "IU Kokomo" candidates lumped on the representative satellite
--     row land on the real IU Kokomo. Ownership/standings are unchanged
--     (satellite/bonus already roll up by tier everywhere).
--   * Fuzzy matches are NOT auto-applied here (bare "Indianapolis" scores
--     0.65 against Purdue Indy but could as easily be IU Indy) — they are
--     queued in school_match_review for a human call. Resolving one also
--     teaches the alias, so the same text never queues again.
--   * Unrouted candidates with raw text: exact-alias assign, otherwise queue.
--   * Candidates already on a core row are left alone (dry run: zero of them
--     exact-match a different school; the legacy routing review covers them).
--   * Bonus-group candidates whose text matches nothing (out-of-state
--     schools) stay in the Bonus group — that is the deliberate catch-all
--     for existing data, and their raw text still displays.
-- ============================================================================

-- 0. RLS: share write access across a satellite/bonus GROUP.
--    Until now every satellite/bonus candidate sat on the tier's single
--    representative row, and every satellite/bonus user's profile points at
--    that same row — so exact `auth_school() = school_id` checks worked by
--    accident. With candidates now on their real campus rows, the policies
--    must encode what the app has always meant: satellite/bonus tiers are one
--    team. Core schools keep exact-row scoping.
create or replace function public.same_school_group(a uuid, b uuid) returns boolean as $$
  select a is not null and b is not null and (
    a = b or exists (
      select 1
      from public.schools sa
      join public.schools sb on sb.tier = sa.tier
      where sa.id = a and sb.id = b and sa.tier in ('satellite', 'bonus')
    )
  );
$$ language sql stable security definer set search_path = public;
-- authenticated keeps EXECUTE (RLS policies evaluate this as the querying role)
revoke execute on function public.same_school_group(uuid, uuid) from anon;

create or replace function public.can_write_candidate(c_school uuid) returns boolean as $$
  select is_admin_plus() or same_school_group(auth_school(), c_school);
$$ language sql stable security definer set search_path = public;

drop policy if exists outreach_read on public.outreach_log;
create policy outreach_read on public.outreach_log for select using (
  is_admin_plus() or exists (
    select 1 from public.candidates c
    where c.id = outreach_log.candidate_id and same_school_group(auth_school(), c.school_id)
  )
);
drop policy if exists outreach_insert on public.outreach_log;
create policy outreach_insert on public.outreach_log for insert with check (
  author_id = auth.uid() and (
    is_admin_plus() or exists (
      select 1 from public.candidates c
      where c.id = outreach_log.candidate_id and same_school_group(auth_school(), c.school_id)
    )
  )
);

drop policy if exists phases_write on public.playbook_phases;
create policy phases_write on public.playbook_phases for all using (
  is_admin_plus() or (auth_role() = 'team_lead' and same_school_group(auth_school(), school_id))
) with check (
  is_admin_plus() or (auth_role() = 'team_lead' and same_school_group(auth_school(), school_id))
);
drop policy if exists tasks_write on public.playbook_tasks;
create policy tasks_write on public.playbook_tasks for all using (
  is_admin_plus() or exists (
    select 1 from public.playbook_phases p
    where p.id = playbook_tasks.phase_id
      and (auth_role() = 'team_lead' and same_school_group(auth_school(), p.school_id))
  )
) with check (
  is_admin_plus() or exists (
    select 1 from public.playbook_phases p
    where p.id = playbook_tasks.phase_id
      and (auth_role() = 'team_lead' and same_school_group(auth_school(), p.school_id))
  )
);

drop policy if exists tmpl_write on public.email_templates;
create policy tmpl_write on public.email_templates for all using (
  is_admin_plus() or (auth_role() = 'team_lead' and same_school_group(auth_school(), school_id))
) with check (
  is_admin_plus() or (auth_role() = 'team_lead' and same_school_group(auth_school(), school_id))
);

-- 1. Exact-alias moves within the satellite/bonus groups.
with cands as (
  select c.id, c.school_id, btrim(c.university_raw) as raw, s.tier::text as tier
  from public.candidates c
  join public.schools s on s.id = c.school_id
  where s.tier in ('satellite', 'bonus')
    and btrim(coalesce(c.university_raw, '')) <> ''
),
moves as (
  select c.id, m.matched_school_id
  from cands c
  cross join lateral public.match_school(c.raw, c.tier) m
  where m.method = 'alias'
    and m.matched_school_id is distinct from c.school_id
)
update public.candidates cd
set school_id = moves.matched_school_id
from moves
where cd.id = moves.id;

-- 2. Exact-alias assignment for unrouted candidates with raw text (unscoped).
with un as (
  select c.id, btrim(c.university_raw) as raw
  from public.candidates c
  where c.school_id is null
    and btrim(coalesce(c.university_raw, '')) <> ''
),
moves as (
  select un.id, m.matched_school_id
  from un
  cross join lateral public.match_school(un.raw, null) m
  where m.method = 'alias'
)
update public.candidates cd
set school_id = moves.matched_school_id
from moves
where cd.id = moves.id;

-- 3. Queue what's left for review: in-group fuzzy suggestions on
--    satellite/bonus rows, and unrouted text with no exact match.
--    (on conflict: the partial unique index allows one pending row per
--    candidate — re-runs and already-queued rows are skipped.)
with cands as (
  select c.id, c.school_id, btrim(c.university_raw) as raw, s.tier::text as tier
  from public.candidates c
  join public.schools s on s.id = c.school_id
  where s.tier in ('satellite', 'bonus')
    and btrim(coalesce(c.university_raw, '')) <> ''
),
fuzzy as (
  select c.id, c.raw, c.tier, m.suggestion_school_id, m.suggestion_score, m.cross_school_id, m.cross_score
  from cands c
  cross join lateral public.match_school(c.raw, c.tier) m
  where m.method = 'fuzzy'
    and m.matched_school_id is distinct from c.school_id
),
unrouted as (
  select c.id, btrim(c.university_raw) as raw, null::text as tier,
         m.suggestion_school_id, m.suggestion_score, m.cross_school_id, m.cross_score
  from public.candidates c
  cross join lateral public.match_school(btrim(c.university_raw), null) m
  where c.school_id is null
    and btrim(coalesce(c.university_raw, '')) <> ''
    and m.method <> 'alias'
)
insert into public.school_match_review
  (candidate_id, raw_input, entrant_tier, suggested_school_id, suggested_score, cross_school_id, cross_score, reason)
select id, raw, tier, suggestion_school_id, suggestion_score, cross_school_id, cross_score, 'unresolved'
from (select * from fuzzy union all select * from unrouted) q
on conflict do nothing;
