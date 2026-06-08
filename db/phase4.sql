-- ============================================================================
-- Orr RTR — Phase 4 schema
-- Run in the Supabase SQL editor. Idempotent.
-- Adds the ability to TAG a person on a warm intro (anyone, any school).
-- ============================================================================

alter table public.connections
  add column if not exists tagged_profile_id uuid references public.profiles(id) on delete set null;

create index if not exists connections_tagged_idx on public.connections (tagged_profile_id);

-- The original table allowed only ONE warm intro per (fellow, candidate), which
-- blocks tagging several different people for the same candidate. Replace it with
-- a per-(fellow, candidate, tagged person) uniqueness so multiple tags are allowed
-- but exact duplicates still aren't. COALESCE folds the "no tag = yourself" case to
-- a fixed sentinel so you can't double-log your own intro either.
alter table public.connections drop constraint if exists connections_fellow_id_candidate_id_key;
create unique index if not exists connections_fellow_cand_tag_idx
  on public.connections (fellow_id, candidate_id, coalesce(tagged_profile_id, '00000000-0000-0000-0000-000000000000'::uuid));
