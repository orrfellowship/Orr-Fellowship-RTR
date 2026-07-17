-- ============================================================================
-- Orr RTR — Phase 2: task pending-review flag (+ bootstrap role fix)
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Reconstructed from the original shared snippet. The `pending_review` column
-- lets a fellow submit a playbook task for a team lead to confirm (later
-- superseded by the per-assignee completion table in phase1's completions).
--
-- The profiles UPDATE below is a ONE-TIME bootstrap data fix that made a
-- specific account a Wabash team lead on first setup. It is NOT schema and is
-- kept only for historical completeness — safe to skip on a fresh install.
-- ============================================================================

alter table playbook_tasks
  add column if not exists pending_review boolean not null default false;

-- One-time bootstrap: promote the seed account to a Wabash team lead.
update profiles
set role = 'team_lead',
    school_id = (select id from schools where name = 'Wabash')
where email = 'mark.stolte@orrfellowship.org';
