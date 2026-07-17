-- ============================================================================
-- ORR FELLOWSHIP RECRUITING — ROW LEVEL SECURITY  (migration 0002)
-- Run in the Supabase SQL editor, AFTER 0001. Run once on a fresh database.
-- ----------------------------------------------------------------------------
-- This file is the real security model. The UI hides things for UX; THIS makes
-- them actually inaccessible. Principles:
--   * Everyone authenticated can READ all candidates (the transparency rule:
--     fellows can view any school, including names/email/resume/GPA/stage).
--   * WRITES on a candidate are limited to that candidate's school (fellows &
--     leads), or anyone admin+.
--   * candidate_ai is SELECTable by super_admin ONLY — structural gating.
--   * Reassigning point_person is a team-lead+ power (enforced via a trigger,
--     since RLS can't easily diff a single column on UPDATE).
--   * Sync + user management = super_admin only (user mgmt is on profiles).
--   * Other schools' outreach notes stay private to that school.
-- ============================================================================

-- ---------- HELPER FUNCTIONS (SECURITY DEFINER, read current user's profile) ----------
create or replace function auth_role() returns app_role as $$
  select role from profiles where id = auth.uid();
$$ language sql stable security definer;

create or replace function auth_school() returns uuid as $$
  select school_id from profiles where id = auth.uid();
$$ language sql stable security definer;

create or replace function is_admin_plus() returns boolean as $$
  select coalesce(auth_role() in ('admin','super_admin'), false);
$$ language sql stable security definer;

create or replace function is_super() returns boolean as $$
  select coalesce(auth_role() = 'super_admin', false);
$$ language sql stable security definer;

-- can the current user WRITE to a given candidate? (own school, or admin+)
create or replace function can_write_candidate(c_school uuid) returns boolean as $$
  select is_admin_plus() or (auth_school() is not null and auth_school() = c_school);
$$ language sql stable security definer;

-- ---------- ENABLE RLS ----------
alter table schools          enable row level security;
alter table profiles         enable row level security;
alter table candidates       enable row level security;
alter table candidate_ai     enable row level security;
alter table favorites        enable row level security;
alter table outreach_log     enable row level security;
alter table connections      enable row level security;
alter table playbook_phases  enable row level security;
alter table playbook_tasks   enable row level security;
alter table school_goals     enable row level security;
alter table email_templates  enable row level security;
alter table sync_meta        enable row level security;
alter table app_settings     enable row level security;

-- ============================ SCHOOLS ============================
create policy schools_read on schools for select using (auth.uid() is not null);
create policy schools_write on schools for all using (is_super()) with check (is_super());

-- ============================ PROFILES ============================
-- everyone can read profiles (needed to render owner names, assignees, etc.)
create policy profiles_read on profiles for select using (auth.uid() is not null);
-- a user can update their OWN basic profile row...
create policy profiles_self_update on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
-- ...but role/school changes & add/remove = super_admin only (user management)
create policy profiles_super_manage on profiles for all
  using (is_super()) with check (is_super());

-- ============================ CANDIDATES ============================
-- READ: any authenticated user (transparency — view any school).
create policy candidates_read on candidates for select using (auth.uid() is not null);
-- INSERT: into your own school, or admin+ anywhere.
create policy candidates_insert on candidates for insert
  with check (can_write_candidate(school_id));
-- UPDATE: own school or admin+. (point_person change guarded by trigger below.)
create policy candidates_update on candidates for update
  using (can_write_candidate(school_id))
  with check (can_write_candidate(school_id));
-- DELETE: nobody below admin deletes; fellows/leads can't delete at all.
create policy candidates_delete on candidates for delete using (is_admin_plus());

-- ============================ CANDIDATE_AI (super-admin only) ============================
-- The whole point: only super_admin can even SELECT this table.
create policy ai_super_read on candidate_ai for select using (is_super());
create policy ai_super_write on candidate_ai for all using (is_super()) with check (is_super());

-- ============================ FAVORITES (per user) ============================
create policy fav_own on favorites for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================ OUTREACH LOG ============================
-- READ: only within the candidate's school, or admin+. (Other schools' notes private.)
create policy outreach_read on outreach_log for select using (
  is_admin_plus() or exists (
    select 1 from candidates c
    where c.id = outreach_log.candidate_id and c.school_id = auth_school()
  )
);
-- WRITE: same scope; author must be the current user.
create policy outreach_insert on outreach_log for insert with check (
  author_id = auth.uid() and (
    is_admin_plus() or exists (
      select 1 from candidates c
      where c.id = outreach_log.candidate_id and c.school_id = auth_school()
    )
  )
);

-- ============================ CONNECTIONS (warm-intro) ============================
create policy conn_read on connections for select using (auth.uid() is not null);
create policy conn_own on connections for all
  using (fellow_id = auth.uid()) with check (fellow_id = auth.uid());

-- ============================ PLAYBOOK ============================
-- READ phases/tasks: anyone (fellows see their lead's plan).
create policy phases_read on playbook_phases for select using (auth.uid() is not null);
create policy tasks_read on playbook_tasks for select using (auth.uid() is not null);
-- WRITE phases/tasks: team_lead of that school, or admin+.
create policy phases_write on playbook_phases for all using (
  is_admin_plus() or (auth_role() = 'team_lead' and school_id = auth_school())
) with check (
  is_admin_plus() or (auth_role() = 'team_lead' and school_id = auth_school())
);
create policy tasks_write on playbook_tasks for all using (
  is_admin_plus() or exists (
    select 1 from playbook_phases p
    where p.id = playbook_tasks.phase_id
      and (auth_role() = 'team_lead' and p.school_id = auth_school())
  )
) with check (
  is_admin_plus() or exists (
    select 1 from playbook_phases p
    where p.id = playbook_tasks.phase_id
      and (auth_role() = 'team_lead' and p.school_id = auth_school())
  )
);

-- ============================ GOALS ============================
create policy goals_read on school_goals for select using (auth.uid() is not null);
create policy goals_write on school_goals for all using (is_admin_plus()) with check (is_admin_plus());

-- ============================ EMAIL TEMPLATES ============================
create policy tmpl_read on email_templates for select using (auth.uid() is not null);
create policy tmpl_write on email_templates for all using (
  is_admin_plus() or (auth_role() = 'team_lead' and school_id = auth_school())
) with check (
  is_admin_plus() or (auth_role() = 'team_lead' and school_id = auth_school())
);

-- ============================ SYNC META / APP SETTINGS ============================
create policy sync_read on sync_meta for select using (auth.uid() is not null);
create policy sync_super on sync_meta for all using (is_super()) with check (is_super());
create policy settings_read on app_settings for select using (auth.uid() is not null);
create policy settings_super on app_settings for all using (is_super()) with check (is_super());

-- ============================================================================
-- POINT-PERSON REASSIGNMENT GUARD
-- ----------------------------------------------------------------------------
-- A fellow may UPDATE a candidate in their school (notes, favorite, flags) but
-- must NOT change point_person_id — that's a team-lead+ power. RLS treats the
-- whole row as one UPDATE, so we enforce the single-column rule with a trigger.
-- ============================================================================
create or replace function guard_point_person() returns trigger as $$
begin
  if new.point_person_id is distinct from old.point_person_id then
    if not (is_admin_plus() or auth_role() = 'team_lead') then
      raise exception 'Only a team lead or admin can reassign the point person';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger candidates_guard_owner before update on candidates
  for each row execute function guard_point_person();
