-- ============================================================================
-- Orr RTR — Phase 4 schema
-- Run in the Supabase SQL editor. Idempotent.
-- Adds the ability to TAG a person on a warm intro (anyone, any school).
-- ============================================================================

alter table public.connections
  add column if not exists tagged_profile_id uuid references public.profiles(id) on delete set null;

create index if not exists connections_tagged_idx on public.connections (tagged_profile_id);
