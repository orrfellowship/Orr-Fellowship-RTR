-- ============================================================================
-- Orr RTR — Phase 17: reply & bounce tracking scheduler
-- Run in the Supabase SQL editor. Adds polling cursors/dedupe metadata and
-- schedules the poller.
--
-- The /api/cron?job=gmail-sync route reads Gmail metadata (headers/labels only,
-- via the gmail.metadata scope) to stamp replied_at / bounced_at on sent
-- outreach and notify the point person. Every ~15 minutes is plenty — replies
-- and bounces aren't time-critical, and this keeps Gmail API usage modest.
--
-- Requires pg_cron + pg_net (already used by the flush/digest/outreach jobs).
-- Replace BOTH placeholders, then run.
-- ============================================================================

-- Rotate checks across campaigns larger than one polling batch instead of
-- repeatedly inspecting the same newest rows. The Gmail bounce message id
-- prevents one old inbox bounce from being applied to multiple sends.
alter table public.outreach_sends
  add column if not exists reply_checked_at timestamptz,
  add column if not exists gmail_bounce_message_id text;

create index if not exists outreach_sends_reply_poll_idx
  on public.outreach_sends (reply_checked_at nulls first, sent_at)
  where status = 'sent' and gmail_thread_id is not null and replied_at is null and bounced_at is null;

create unique index if not exists outreach_sends_bounce_message_idx
  on public.outreach_sends (gmail_bounce_message_id)
  where gmail_bounce_message_id is not null;

-- select cron.schedule('orr-gmail-sync', '*/15 * * * *', $$
--   select net.http_post(
--     url     := 'https://YOUR_SITE_URL/api/cron?job=gmail-sync',
--     headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET')
--   );
-- $$);
-- ============================================================================
