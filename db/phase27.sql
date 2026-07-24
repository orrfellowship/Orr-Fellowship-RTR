-- ============================================================================
-- PHASE 27 — Merge duplicate candidates
-- Idempotent: safe to re-run.
--
-- merge_candidates(keep, lose) moves everything tracked on the duplicate
-- (`lose`) onto the record you're keeping (`keep`) — warm intros, logged
-- outreach, campaign sends, candidate notifications, favorites, the AI row —
-- and fills any blank field on the keeper from the duplicate (never overwriting
-- a value). Then it deletes the duplicate. Runs in one transaction so a merge
-- never half-applies. Called from the admin-gated mergeCandidates() server
-- action via the service role.
-- ============================================================================

create or replace function public.merge_candidates(p_keep uuid, p_lose uuid)
returns void
language plpgsql
as $$
declare
  l_jazz text;
begin
  if p_keep is null or p_lose is null or p_keep = p_lose then return; end if;

  -- Move tracked activity from the duplicate onto the keeper.
  update public.connections    set candidate_id = p_keep where candidate_id = p_lose;
  update public.outreach_log   set candidate_id = p_keep where candidate_id = p_lose;
  update public.outreach_sends set candidate_id = p_keep where candidate_id = p_lose;
  update public.notifications  set candidate_id = p_keep where candidate_id = p_lose;

  -- Favorites: move only for users who haven't already favorited the keeper.
  update public.favorites f set candidate_id = p_keep
    where f.candidate_id = p_lose
      and not exists (select 1 from public.favorites k where k.candidate_id = p_keep and k.user_id = f.user_id);

  -- AI row: keep the keeper's if it has one, otherwise adopt the duplicate's.
  update public.candidate_ai a set candidate_id = p_keep
    where a.candidate_id = p_lose
      and not exists (select 1 from public.candidate_ai k where k.candidate_id = p_keep);

  -- Fill the keeper's blank fields from the duplicate. jazz_id is unique, so
  -- free it on the loser before coalescing it onto the keeper.
  select jazz_id into l_jazz from public.candidates where id = p_lose;
  update public.candidates set jazz_id = null where id = p_lose;
  update public.candidates k set
    email           = coalesce(k.email, l.email),
    phone           = coalesce(k.phone, l.phone),
    school_id       = coalesce(k.school_id, l.school_id),
    university_raw  = coalesce(k.university_raw, l.university_raw),
    gpa             = coalesce(k.gpa, l.gpa),
    area_of_study   = coalesce(k.area_of_study, l.area_of_study),
    grad_date       = coalesce(k.grad_date, l.grad_date),
    linkedin        = coalesce(k.linkedin, l.linkedin),
    resume_link     = coalesce(k.resume_link, l.resume_link),
    race            = coalesce(k.race, l.race),
    point_person_id = coalesce(k.point_person_id, l.point_person_id),
    jazz_id         = coalesce(k.jazz_id, l_jazz)
  from public.candidates l
  where k.id = p_keep and l.id = p_lose;

  -- Drop the duplicate's transient review-queue rows, then the duplicate.
  delete from public.jazz_match_review   where candidate_id = p_lose;
  delete from public.school_match_review where candidate_id = p_lose;
  delete from public.candidates where id = p_lose;
end;
$$;
