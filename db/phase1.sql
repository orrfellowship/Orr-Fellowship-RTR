-- ============================================================================
-- Orr RTR — Phase 1 schema
-- Run this in the Supabase SQL editor. Safe to re-run (idempotent).
-- Adds: resources, multi-assignee tasks, per-assignee completion tracking.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) RESOURCES  (read: any signed-in user · write: admin / super_admin)
-- ---------------------------------------------------------------------------
create table if not exists public.resources (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  link        text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.resources enable row level security;
grant select, insert, update, delete on public.resources to authenticated;

drop policy if exists resources_select on public.resources;
create policy resources_select on public.resources
  for select to authenticated using (true);

drop policy if exists resources_write on public.resources;
create policy resources_write on public.resources
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','super_admin')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','super_admin')));

-- ---------------------------------------------------------------------------
-- 2) MULTI-ASSIGNEE TASKS
--    Writes happen through server actions using the service role (RLS bypassed),
--    so we only need a permissive SELECT for direct reads.
-- ---------------------------------------------------------------------------
create table if not exists public.playbook_task_assignees (
  task_id    uuid not null references public.playbook_tasks(id) on delete cascade,
  profile_id uuid not null references public.profiles(id)      on delete cascade,
  primary key (task_id, profile_id)
);

alter table public.playbook_task_assignees enable row level security;
grant select on public.playbook_task_assignees to authenticated;

drop policy if exists pta_select on public.playbook_task_assignees;
create policy pta_select on public.playbook_task_assignees
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 3) PER-ASSIGNEE COMPLETION
--    state: 'pending_review' (fellow submitted) → 'confirmed' (lead approved)
-- ---------------------------------------------------------------------------
create table if not exists public.playbook_task_completions (
  task_id    uuid not null references public.playbook_tasks(id) on delete cascade,
  profile_id uuid not null references public.profiles(id)      on delete cascade,
  state      text not null check (state in ('pending_review','confirmed')),
  updated_at timestamptz not null default now(),
  primary key (task_id, profile_id)
);

alter table public.playbook_task_completions enable row level security;
grant select on public.playbook_task_completions to authenticated;

drop policy if exists ptc_select on public.playbook_task_completions;
create policy ptc_select on public.playbook_task_completions
  for select to authenticated using (true);
