-- ============================================================================
-- Orr RTR — Phase 11: split info and deadline calendar event types
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
-- ============================================================================

alter table public.events
  drop constraint if exists events_event_type_check;

alter table public.events
  add constraint events_event_type_check
  check (event_type in ('attend','info','deadline'));

notify pgrst, 'reload schema';
