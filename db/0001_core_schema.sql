-- ============================================================================
-- ORR FELLOWSHIP RECRUITING — CORE SCHEMA  (migration 0001)
-- Run in the Supabase SQL editor. This is the base schema — run it FIRST,
-- before any phase file. Not idempotent (creates types/tables outright); run
-- once on a fresh database.
-- ----------------------------------------------------------------------------
-- Design notes baked into this schema:
--  * Five-tier role model lives on `profiles.role`; school scoping lives on
--    `profiles.school_id`. RLS reads BOTH (a fellow is role+school; an admin
--    is role with school_id NULL = unscoped).
--  * AI résumé signal is in its OWN table (`candidate_ai`) so that
--    "super-admin only" is STRUCTURAL — non-super-admins simply cannot SELECT
--    the table at all, rather than us hoping a hidden UI column stays hidden.
--  * `candidates.jazz_id` is UNIQUE — it's the upsert key the weekly JazzHR
--    re-sync relies on, so the constraint prevents duplicate candidates.
--  * Goals live per-school-per-cycle so the scoreboard is data-driven, not
--    hardcoded, and so a sourcing goal of 0 is representable (UI guards the
--    divide).
-- ============================================================================

-- ---------- ENUMS ----------
create type app_role as enum ('super_admin', 'admin', 'team_lead', 'fellow');
create type school_tier as enum ('core', 'satellite', 'bonus');
create type candidate_source as enum ('jazzhr', 'user_created');

-- ---------- SCHOOLS ----------
create table schools (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  tier        school_tier not null default 'core',
  -- branding (logos/colors slot in later; nullable now)
  logo_url    text,
  color_primary text,
  created_at  timestamptz not null default now()
);

-- ---------- PROFILES (one row per auth user) ----------
-- role + school together define what a user can see/do.
-- school_id is NULL for admin/super_admin (unscoped, org-wide).
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  email       text not null unique,
  role        app_role not null default 'fellow',
  school_id   uuid references schools(id) on delete set null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index profiles_school_idx on profiles(school_id);
create index profiles_role_idx on profiles(role);

-- ---------- CANDIDATES (the core pipeline record) ----------
-- Mirrors the Base44 Candidate entity, minus the AI fields (those move to
-- candidate_ai). jazz_id is the sync upsert key and is UNIQUE.
create table candidates (
  id              uuid primary key default gen_random_uuid(),
  jazz_id         text unique,                       -- UNIQUE: prevents dup on re-sync
  school_id       uuid references schools(id) on delete set null,
  name            text not null,
  email           text,
  phone           text,
  apply_date      date,
  grad_date       text,                              -- kept text: JazzHR free-form
  stage           text,                              -- source of truth for pipeline status
  university_raw  text,                              -- raw JazzHR string, pre-normalization
  job_title       text,
  linkedin        text,
  resume_link     text,
  gpa             text,                              -- text: JazzHR returns "3.8", "3.8/4.0", etc.
  area_of_study   text,
  point_person_id uuid references profiles(id) on delete set null,  -- the owner; NULL = unassigned
  source          candidate_source not null default 'user_created',
  not_interested  boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index candidates_school_idx on candidates(school_id);
create index candidates_stage_idx on candidates(stage);
create index candidates_owner_idx on candidates(point_person_id);

-- ---------- CANDIDATE AI SIGNAL (super-admin only) ----------
-- Separate table = structural gating. RLS lets ONLY super_admin select.
create table candidate_ai (
  candidate_id  uuid primary key references candidates(id) on delete cascade,
  resume_score  numeric(4,1),                        -- 0–20 scale
  summary       text,
  flags         jsonb default '[]'::jsonb,           -- [{text, kind:'standout'|'concern'|'info'}]
  analyzed_at   timestamptz
);

-- ---------- FAVORITES (per-user bookmark) ----------
create table favorites (
  user_id       uuid not null references profiles(id) on delete cascade,
  candidate_id  uuid not null references candidates(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, candidate_id)
);

-- ---------- OUTREACH LOG (notes / quick-log entries) ----------
-- Private to the candidate's school. Feeds "last touch" + the This Week engine.
create table outreach_log (
  id            uuid primary key default gen_random_uuid(),
  candidate_id  uuid not null references candidates(id) on delete cascade,
  author_id     uuid references profiles(id) on delete set null,
  body          text not null,
  created_at    timestamptz not null default now()
);
create index outreach_candidate_idx on outreach_log(candidate_id);

-- ---------- CONNECTIONS (warm-intro finder, manual list) ----------
-- A fellow flags "I know this person" — pairs with logged-outreach matching.
create table connections (
  id            uuid primary key default gen_random_uuid(),
  fellow_id     uuid not null references profiles(id) on delete cascade,
  candidate_id  uuid not null references candidates(id) on delete cascade,
  relationship  text,                                -- e.g. "robotics team", "same major"
  created_at    timestamptz not null default now(),
  unique (fellow_id, candidate_id)
);

-- ---------- PLAYBOOK (phases + tasks with assignee & due date) ----------
create table playbook_phases (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools(id) on delete cascade,
  label       text not null,                         -- e.g. "August"
  title       text not null,                         -- e.g. "Set the table"
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create table playbook_tasks (
  id          uuid primary key default gen_random_uuid(),
  phase_id    uuid not null references playbook_phases(id) on delete cascade,
  text        text not null,
  assignee_id uuid references profiles(id) on delete set null,  -- NULL = unassigned
  due_date    date,
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index playbook_tasks_phase_idx on playbook_tasks(phase_id);
create index playbook_tasks_assignee_idx on playbook_tasks(assignee_id);

-- ---------- GOALS (per school, per cycle — drives the scoreboard) ----------
create table school_goals (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references schools(id) on delete cascade,
  cycle         text not null,                       -- e.g. "CL27"
  goal_sourced  int not null default 0,
  goal_contacted int not null default 0,
  goal_applied  int not null default 0,
  unique (school_id, cycle)
);

-- ---------- EMAIL TEMPLATES (ports Base44 EmailTemplate; future mail-merge) ----------
create table email_templates (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid references schools(id) on delete cascade,  -- NULL = org-wide template
  name        text not null,
  subject     text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);

-- ---------- SYNC META (JazzHR sync bookkeeping; key NOT stored here) ----------
-- NB: the JazzHR API key lives in a server-side env var, NOT in the DB.
-- This table only tracks sync run metadata.
create table sync_meta (
  id          int primary key default 1,
  last_sync   timestamptz,
  total_cached int,
  last_status text,
  check (id = 1)                                     -- singleton row
);

-- ---------- APP SETTINGS (theme; ports Base44 AppSettings) ----------
create table app_settings (
  id          int primary key default 1,
  nav_color   text,
  accent_color text,
  header_color text,
  check (id = 1)
);

-- ---------- updated_at trigger for candidates ----------
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;
create trigger candidates_touch before update on candidates
  for each row execute function touch_updated_at();
