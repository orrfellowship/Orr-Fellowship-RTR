-- ============================================================================
-- PHASE 20 — School matching: aliases, fuzzy matching, review queue
-- Idempotent: safe to re-run.
--
-- Fixes two intake problems:
--   * satellite campuses ("IU Kokomo") mis-mapped to their parent feeder
--     school ("Indiana University" flagship), and
--   * misspelled school names silently defaulting to the Bonus group.
--
-- How matching works (public.match_school):
--   1. Normalize the raw string: lowercase, strip punctuation, expand
--      abbreviations from school_abbreviations (a table, so admins can add
--      more without a migration).
--   2. Exact match against normalized aliases, scoped to the entrant's group
--      (tier) when one is given.
--   3. Fall back to trigram similarity() within the group: auto-assign at
--      >= 0.60, otherwise unresolved.
--   4. Tripwire: if the input scores >= 0.85 against a school in a DIFFERENT
--      group, nothing is assigned — the record is flagged with that
--      cross-group match noted so a reviewer decides.
--   Unresolved and tripwire records land in school_match_review; resolving one
--   stores the raw input as a new alias so it exact-matches forever after.
--
-- Group vocabulary: "Feeder" == the existing schools.tier value 'core';
-- Satellite and Bonus map to 'satellite' / 'bonus'. The entrant's group is
-- their profile's school tier (admins pass NULL = unscoped, no tripwire).
--
-- NB: aliases are normalized at insert time (trigger). If you change
-- school_abbreviations later, re-save existing aliases to re-normalize them:
--   update school_aliases set alias = alias;
-- ============================================================================

create extension if not exists pg_trgm with schema extensions;

-- ---- abbreviation map (config, not hardcoded) ------------------------------
create table if not exists public.school_abbreviations (
  id uuid primary key default gen_random_uuid(),
  abbr text not null unique,      -- matched as a whole word, lowercase
  expansion text not null,        -- fully-spelled replacement (no abbreviations!)
  created_at timestamptz not null default now()
);

alter table public.school_abbreviations enable row level security;
drop policy if exists school_abbr_read on public.school_abbreviations;
create policy school_abbr_read on public.school_abbreviations for select using (auth.uid() is not null);
drop policy if exists school_abbr_write on public.school_abbreviations;
create policy school_abbr_write on public.school_abbreviations for all using (is_super()) with check (is_super());

-- ---- aliases ---------------------------------------------------------------
create table if not exists public.school_aliases (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  alias text not null,            -- as typed / resolved
  alias_norm text not null,       -- normalize_school_name(alias); set by trigger
  created_at timestamptz not null default now()
);
-- one normalized alias points at exactly one school (exact match is unambiguous)
create unique index if not exists school_aliases_norm_key on public.school_aliases (alias_norm);
create index if not exists school_aliases_norm_trgm on public.school_aliases using gin (alias_norm extensions.gin_trgm_ops);
create index if not exists school_aliases_school_idx on public.school_aliases (school_id);

alter table public.school_aliases enable row level security;
drop policy if exists school_aliases_read on public.school_aliases;
create policy school_aliases_read on public.school_aliases for select using (auth.uid() is not null);
drop policy if exists school_aliases_write on public.school_aliases;
create policy school_aliases_write on public.school_aliases for all using (is_super()) with check (is_super());

-- ---- normalization ---------------------------------------------------------
create or replace function public.normalize_school_name(p_raw text)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  s text;
  r record;
begin
  s := lower(coalesce(p_raw, ''));
  s := regexp_replace(s, '[[:punct:]]+', ' ', 'g');   -- punctuation → space
  s := btrim(regexp_replace(s, '\s+', ' ', 'g'));
  if s = '' then return s; end if;
  -- whole-word abbreviation expansion; expansions contain no abbreviations, so
  -- a single pass in any order converges
  for r in select abbr, expansion from public.school_abbreviations order by length(abbr) desc, abbr loop
    s := regexp_replace(s, '\m' || r.abbr || '\M', lower(r.expansion), 'g');
  end loop;
  return btrim(regexp_replace(s, '\s+', ' ', 'g'));
end
$$;

-- Keep alias_norm in sync with alias.
create or replace function public.school_aliases_set_norm()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.alias := btrim(new.alias);
  new.alias_norm := public.normalize_school_name(new.alias);
  return new;
end
$$;

drop trigger if exists school_aliases_norm on public.school_aliases;
create trigger school_aliases_norm
  before insert or update of alias on public.school_aliases
  for each row execute function public.school_aliases_set_norm();

-- ---- the matcher -----------------------------------------------------------
-- p_entrant_tier: 'core' (Feeder) | 'satellite' | 'bonus' | null (unscoped —
-- admins; exact/fuzzy across every group, no tripwire).
-- method: 'alias' (exact), 'fuzzy' (auto-assigned >= 0.60), 'unresolved',
-- 'tripwire' (>= 0.85 against another group; nothing assigned).
-- suggestion_* always carries the best in-group candidate for the review UI.
create or replace function public.match_school(p_raw text, p_entrant_tier text default null)
returns table (
  matched_school_id uuid,
  method text,
  suggestion_school_id uuid,
  suggestion_score real,
  cross_school_id uuid,
  cross_score real
)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_norm  text;
  v_exact uuid;
  v_in_id uuid; v_in_sim real;
  v_x_id  uuid; v_x_sim  real;
begin
  v_norm := public.normalize_school_name(p_raw);
  if v_norm = '' then
    return query select null::uuid, 'unresolved'::text, null::uuid, null::real, null::uuid, null::real;
    return;
  end if;

  -- 1. exact alias match, scoped to the entrant's group when one is given
  select a.school_id into v_exact
  from public.school_aliases a
  join public.schools s on s.id = a.school_id
  where a.alias_norm = v_norm
    and (p_entrant_tier is null or s.tier::text = p_entrant_tier)
  limit 1;
  if v_exact is not null then
    return query select v_exact, 'alias'::text, v_exact, 1.0::real, null::uuid, null::real;
    return;
  end if;

  -- 2. best trigram match inside the group
  select t.school_id, t.sim into v_in_id, v_in_sim
  from (
    select a.school_id, max(similarity(a.alias_norm, v_norm)) as sim
    from public.school_aliases a
    join public.schools s on s.id = a.school_id
    where p_entrant_tier is null or s.tier::text = p_entrant_tier
    group by a.school_id
  ) t
  order by t.sim desc
  limit 1;

  -- 3. tripwire: a strong match in a DIFFERENT group blocks auto-assignment
  if p_entrant_tier is not null then
    select t.school_id, t.sim into v_x_id, v_x_sim
    from (
      select a.school_id, max(similarity(a.alias_norm, v_norm)) as sim
      from public.school_aliases a
      join public.schools s on s.id = a.school_id
      where s.tier::text <> p_entrant_tier
      group by a.school_id
    ) t
    order by t.sim desc
    limit 1;
    if v_x_sim >= 0.85 then
      return query select null::uuid, 'tripwire'::text, v_in_id, v_in_sim, v_x_id, v_x_sim;
      return;
    end if;
  end if;

  -- 4. in-group auto-assign / unresolved
  if v_in_sim >= 0.60 then
    return query select v_in_id, 'fuzzy'::text, v_in_id, v_in_sim, null::uuid, null::real;
    return;
  end if;
  return query select null::uuid, 'unresolved'::text, v_in_id, v_in_sim, null::uuid, null::real;
end
$$;

-- Server-only surface: the app calls these with the service key.
revoke execute on function public.match_school(text, text) from public, anon, authenticated;
grant execute on function public.match_school(text, text) to service_role;
revoke execute on function public.normalize_school_name(text) from public, anon;
grant execute on function public.normalize_school_name(text) to authenticated, service_role;

-- ---- review queue ----------------------------------------------------------
create table if not exists public.school_match_review (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  raw_input text not null,
  entrant_tier text,                          -- group scope used at match time (null = unscoped)
  suggested_school_id uuid references public.schools(id) on delete set null,
  suggested_score real,
  cross_school_id uuid references public.schools(id) on delete set null,  -- tripwire hit
  cross_score real,
  reason text not null check (reason in ('unresolved', 'tripwire')),
  status text not null default 'pending' check (status in ('pending', 'resolved', 'dismissed')),
  resolved_school_id uuid references public.schools(id) on delete set null,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists smr_one_pending_per_candidate
  on public.school_match_review (candidate_id) where status = 'pending';
create index if not exists smr_status_idx on public.school_match_review (status, created_at desc);

-- Reads for admin+ (mirrors the other review surfaces); writes go through the
-- service role in server actions, like jazz_match_review.
alter table public.school_match_review enable row level security;
drop policy if exists smr_admin_read on public.school_match_review;
create policy smr_admin_read on public.school_match_review for select using (is_admin_plus());

-- ============================================================================
-- SEEDS
-- ============================================================================

-- ---- satellite campuses missing from the schools table ---------------------
-- All IU and Purdue regional campuses live under Satellite, never under the
-- core flagships. (Existing rows: IU East, IU Indy, IU Northwest,
-- IU South Bend, IU Southeast, Purdue Indy, Purdue Northwest.)
insert into public.schools (name, tier)
select v.name, 'satellite'::school_tier
from (values ('IU Kokomo'), ('IU Fort Wayne'), ('IU Columbus'), ('Purdue Fort Wayne')) v(name)
where not exists (select 1 from public.schools s where s.name = v.name);

-- ---- abbreviations ---------------------------------------------------------
-- Expansions must be fully spelled out (no abbreviation tokens) so one
-- expansion pass converges regardless of order. "st" is deliberately absent:
-- it is ambiguous between Saint and State — those variants are aliases instead.
insert into public.school_abbreviations (abbr, expansion) values
  ('iu',    'indiana university'),
  ('pu',    'purdue university'),
  ('iub',   'indiana university bloomington'),
  ('iui',   'indiana university indianapolis'),
  ('iupui', 'indiana university indianapolis'),
  ('iupuc', 'indiana university columbus'),
  ('iue',   'indiana university east'),
  ('iuk',   'indiana university kokomo'),
  ('iun',   'indiana university northwest'),
  ('iusb',  'indiana university south bend'),
  ('ius',   'indiana university southeast'),
  ('iufw',  'indiana university fort wayne'),
  ('pfw',   'purdue university fort wayne'),
  ('ipfw',  'purdue university fort wayne'),
  ('pnw',   'purdue university northwest'),
  ('bsu',   'ball state university'),
  ('isu',   'indiana state university'),
  ('usi',   'university of southern indiana'),
  ('uindy', 'university of indianapolis'),
  ('iwu',   'indiana wesleyan university'),
  ('rhit',  'rose hulman institute of technology'),
  ('valpo', 'valparaiso'),
  ('indy',  'indianapolis'),
  ('ft',    'fort'),
  ('univ',  'university'),
  ('u',     'university')
on conflict (abbr) do nothing;

-- ---- aliases ---------------------------------------------------------------
-- Every school's own name is an alias…
insert into public.school_aliases (school_id, alias)
select id, name from public.schools
on conflict (alias_norm) do nothing;

-- …plus the known variants. Normalization + abbreviation expansion collapse
-- most spellings; on conflict keeps the first (canonical) claim on a
-- normalized form.
with pairs(school_name, alias) as (values
  -- Feeder (tier 'core')
  ('Purdue', 'Purdue University'),
  ('Purdue', 'Purdue West Lafayette'),
  ('Purdue', 'Purdue University West Lafayette'),
  ('IU', 'Indiana University'),
  ('IU', 'IU Bloomington'),
  ('IU', 'Indiana University Bloomington'),
  ('Ball State', 'Ball State University'),
  ('Ball State', 'Ball St'),
  ('Indiana State', 'Indiana State University'),
  ('Indiana State', 'Indiana St'),
  ('Butler', 'Butler University'),
  ('DePauw', 'DePauw University'),
  ('Marian', 'Marian University'),
  ('Taylor', 'Taylor University'),
  ('Wabash', 'Wabash College'),
  ('IWU', 'Indiana Wesleyan'),
  ('IWU', 'Indiana Wesleyan University'),
  ('Miami of Ohio', 'Miami University'),
  ('Miami of Ohio', 'Miami University Ohio'),
  ('Miami of Ohio', 'Miami OH'),
  ('Miami of Ohio', 'Miami Ohio'),
  ('Notre Dame & Saint Marys', 'Notre Dame'),
  ('Notre Dame & Saint Marys', 'University of Notre Dame'),
  ('Notre Dame & Saint Marys', 'Saint Marys'),
  ('Notre Dame & Saint Marys', 'Saint Marys College'),
  ('Notre Dame & Saint Marys', 'St Marys'),
  -- Satellite
  ('IU Indy', 'IU Indianapolis'),
  ('IU Indy', 'Indiana University Indianapolis'),
  ('IU Indy', 'IUPUI'),
  ('IU Indy', 'Indiana University Purdue University Indianapolis'),
  ('IU East', 'Indiana University East'),
  ('IU Kokomo', 'Indiana University Kokomo'),
  ('IU Northwest', 'Indiana University Northwest'),
  ('IU South Bend', 'Indiana University South Bend'),
  ('IU Southeast', 'Indiana University Southeast'),
  ('IU Southeast', 'IU New Albany'),
  ('IU Fort Wayne', 'Indiana University Fort Wayne'),
  ('IU Columbus', 'Indiana University Columbus'),
  ('Purdue Indy', 'Purdue Indianapolis'),
  ('Purdue Indy', 'Purdue in Indianapolis'),
  ('Purdue Indy', 'Purdue University in Indianapolis'),
  ('Purdue Indy', 'Purdue University Indianapolis'),
  ('Purdue Northwest', 'Purdue University Northwest'),
  ('Purdue Northwest', 'Purdue Calumet'),
  ('Purdue Fort Wayne', 'Purdue University Fort Wayne'),
  -- Bonus
  ('Anderson', 'Anderson University'),
  ('Denison', 'Denison University'),
  ('Earlham', 'Earlham College'),
  ('Franklin', 'Franklin College'),
  ('Franklin', 'Franklin College of Indiana'),
  ('Hanover', 'Hanover College'),
  ('Ivy Tech', 'Ivy Tech Community College'),
  ('Manchester U', 'Manchester University'),
  ('Manchester U', 'Manchester College'),
  ('Rose-Hulman', 'Rose Hulman'),
  ('Rose-Hulman', 'Rose Hulman Institute of Technology'),
  ('Trine', 'Trine University'),
  ('UIndy', 'University of Indianapolis'),
  ('USI', 'University of Southern Indiana'),
  ('USI', 'Southern Indiana'),
  ('Valparaiso', 'Valparaiso University')
)
insert into public.school_aliases (school_id, alias)
select s.id, p.alias
from pairs p
join public.schools s on s.name = p.school_name
on conflict (alias_norm) do nothing;
