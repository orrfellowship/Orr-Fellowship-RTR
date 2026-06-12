-- ============================================================================
-- Orr RTR — Phase 9: budget rework (receipts + allocation guidance)
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
--  • Expenses carry a receipt image (stored in the private "receipts" bucket;
--    we keep the storage PATH here and hand out short-lived signed URLs).
--  • budget_guidance holds the admin's recommended % split by category.
--  • A private Storage bucket "receipts" (uploads/reads happen via the service
--    role inside server actions, so no extra storage RLS policies are needed).
-- ============================================================================

alter table public.budget_entries add column if not exists receipt_url text;

create table if not exists public.budget_guidance (
  id          uuid primary key default gen_random_uuid(),
  category    text not null,
  pct         numeric(5,2) not null default 0,
  sort_order  int not null default 0,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.budget_guidance enable row level security;
grant select, insert, update, delete on public.budget_guidance to authenticated;
drop policy if exists budget_guidance_select on public.budget_guidance;
create policy budget_guidance_select on public.budget_guidance
  for select to authenticated using (true);

-- Private bucket for receipt/transaction images.
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
