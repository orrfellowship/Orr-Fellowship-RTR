-- ============================================================================
-- Orr RTR — Phase 5 schema: richer calendar events
-- Run in the Supabase SQL editor. Idempotent.
-- Adds a free-text address/location to events so they carry more than a title.
-- ============================================================================

alter table public.events add column if not exists address text;
