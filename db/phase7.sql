-- ============================================================================
-- Orr RTR — Phase 7: budgets
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- A budget is a list of entries per school (school_id null = organization-wide).
--   kind = 'allocation'  → money budgeted (adds to the budget)
--   kind = 'expense'     → money spent (subtracts)
-- Remaining = sum(allocations) - sum(expenses). Admins/super manage entries;
-- team leads view their school's budget. Writes go through server actions
-- (service role); the RLS policy below just governs direct reads.
-- ============================================================================

create table if not exists public.budget_entries (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid references public.schools(id) on delete cascade,  -- null = org-wide
  kind        text not null check (kind in ('allocation','expense')),
  label       text not null,
  amount      numeric(12,2) not null default 0,
  category    text,
  entry_date  date,
  notes       text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists budget_entries_school_idx on public.budget_entries (school_id);

alter table public.budget_entries enable row level security;
grant select, insert, update, delete on public.budget_entries to authenticated;

drop policy if exists budget_entries_select on public.budget_entries;
create policy budget_entries_select on public.budget_entries
  for select to authenticated using (true);

notify pgrst, 'reload schema';
