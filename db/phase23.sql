-- ============================================================================
-- PHASE 23 — Outreach templates (admin-curated) + email attachments
-- Idempotent: safe to re-run.
--
-- Two product rules land here:
--   1. Fellows/team leads can only send outreach from templates that an
--      admin/super-admin created — the send routes load the template
--      server-side and ignore any client-supplied subject/body for non-admins.
--   2. Attachments are managed on templates by admins (never uploaded by
--      fellows) and are snapshotted onto the campaign at enqueue time, so an
--      in-flight campaign is unaffected by later template edits.
--
-- Storage: files live in the private `outreach-attachments` bucket. All reads
-- and writes go through the service role in server actions/cron (same pattern
-- as the budget receipts bucket); no anon/authenticated storage policies.
-- ============================================================================

-- ---- templates -------------------------------------------------------------
create table if not exists public.outreach_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  body text not null,
  created_by uuid references public.profiles(id) on delete set null,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists outreach_templates_active_idx
  on public.outreach_templates (is_archived, updated_at desc);

alter table public.outreach_templates enable row level security;
-- Everyone signed in may READ templates (the composer lists them); writes go
-- through the service role in admin-checked server actions only.
drop policy if exists outreach_templates_read on public.outreach_templates;
create policy outreach_templates_read on public.outreach_templates
  for select using (auth.uid() is not null);

-- ---- template attachments --------------------------------------------------
create table if not exists public.outreach_template_attachments (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.outreach_templates(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  storage_path text not null,        -- object key in the outreach-attachments bucket
  created_at timestamptz not null default now()
);

create index if not exists outreach_template_attachments_tpl_idx
  on public.outreach_template_attachments (template_id);

alter table public.outreach_template_attachments enable row level security;
drop policy if exists outreach_template_attachments_read on public.outreach_template_attachments;
create policy outreach_template_attachments_read on public.outreach_template_attachments
  for select using (auth.uid() is not null);

-- ---- campaign columns --------------------------------------------------------
-- template_id: which template the campaign was sent from (audit; null = admin
-- free-compose). attachments: the point-in-time snapshot the drainer sends —
-- [{storage_path, file_name, mime_type, size_bytes}, …].
alter table public.outreach_campaigns
  add column if not exists template_id uuid references public.outreach_templates(id) on delete set null;
alter table public.outreach_campaigns
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- ---- storage bucket ----------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('outreach-attachments', 'outreach-attachments', false)
on conflict (id) do nothing;
