-- ============================================================================
-- PHASE 25 — Per-send outreach attachments (sender-uploaded)
-- Idempotent: safe to re-run.
--
-- Fellows/leads/admins may attach their own files to a campaign in addition to
-- the admin template's attachments. Unlike template attachments (admin-managed),
-- these belong to the SENDER. To keep the send path from ever trusting a raw
-- client-supplied storage path, an upload creates a row here owned by the user;
-- the send references row ids, and the server loads them scoped to the sender
-- before snapshotting them onto the campaign.
--
-- Files live in the same private `outreach-attachments` bucket, under a
-- `campaign-uploads/<user_id>/…` prefix. All reads/writes go through the service
-- role in server actions/cron (same pattern as template attachments).
-- ============================================================================

create table if not exists public.outreach_campaign_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  storage_path text not null,        -- object key in the outreach-attachments bucket
  created_at timestamptz not null default now()
);

create index if not exists outreach_campaign_uploads_user_idx
  on public.outreach_campaign_uploads (user_id, created_at desc);

alter table public.outreach_campaign_uploads enable row level security;
-- No anon/authenticated policies: every read/write is service-role only, from
-- sender-scoped server actions. (Same posture as outreach_template_attachments.)
