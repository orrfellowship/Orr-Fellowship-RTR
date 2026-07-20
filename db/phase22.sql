-- ============================================================================
-- PHASE 22 — Fix: fellows/leads could not claim or reassign candidates
-- Idempotent: safe to re-run.
--
-- Symptom: clicking "Claim" (or reassigning a point person) failed for every
-- fellow and team lead — not one school. Error surfaced from the RPC as
-- "function is_admin_plus() does not exist".
--
-- Cause: the phase18 RPC assign_candidate_point_person runs with
-- `search_path = ''` (correct hardening). Its UPDATE on candidates fires the
-- guard_point_person() trigger, whose auth helpers (is_admin_plus / auth_role)
-- were defined WITHOUT a fixed search_path — they relied on the caller's
-- search_path containing `public`. Under the RPC's empty search_path the
-- unqualified helper lookups failed, aborting the assignment.
--
-- Fix: pin `search_path = public` on the whole SECURITY DEFINER auth-helper
-- chain and the guard trigger, so they resolve their own objects regardless of
-- who calls them. Behaviour is unchanged: a fellow's direct (browser/RLS)
-- update is still blocked by the guard, while the server-side RPC — which does
-- its own actor + school-scope checks — is still the sanctioned bypass. This
-- also clears the `function_search_path_mutable` advisor warnings for these
-- functions.
-- ============================================================================

create or replace function public.auth_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function public.auth_school() returns uuid
language sql stable security definer set search_path = public as $$
  select school_id from profiles where id = auth.uid();
$$;

create or replace function public.is_admin_plus() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role() in ('admin','super_admin'), false);
$$;

create or replace function public.is_super() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role() = 'super_admin', false);
$$;

create or replace function public.guard_point_person() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.point_person_id is distinct from old.point_person_id then
    if not (is_admin_plus() or auth_role() = 'team_lead') then
      raise exception 'Only a team lead or admin can reassign the point person';
    end if;
  end if;
  return new;
end;
$$;
