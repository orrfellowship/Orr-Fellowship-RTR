-- ============================================================================
-- Orr RTR — Phase 15: Gmail outreach (mail-merge replacement) schema
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Two permanent email lanes:
--   • System mail (invites, digests, notifications) → Resend (src/lib/email.ts).
--   • Human outreach → the fellow's own Gmail via per-fellow OAuth (this work).
-- This file adds the outreach lane's tables. All writes happen through
-- server-side route handlers / actions using the service role (RLS bypassed);
-- RLS here governs direct client reads only.
--
-- Business rules enforced in the send path (documented here, enforced in code):
--   • Sender identity comes from the session — never from the request body.
--   • A sender may only email candidates assigned to them (point_person_id).
--   • do_not_contact is fellowship-wide and re-checked per recipient at send.
--   • Max 2 outreach emails per candidate per rolling 7 days (all senders).
--   • Hard cap of 300 sends per sender per rolling 24 hours.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) GMAIL CREDENTIALS — one row per connected fellow. SERVICE-ROLE ONLY:
--    RLS is enabled with NO grants and NO policies, so no authenticated
--    client can read or write this table under any circumstance. The refresh
--    token is encrypted at rest (AES-256-GCM, key from TOKEN_ENCRYPTION_KEY;
--    see src/lib/crypto.ts) — the column never holds plaintext.
-- ---------------------------------------------------------------------------
create table if not exists public.gmail_credentials (
  user_id            uuid primary key references public.profiles(id) on delete cascade,
  google_email       text not null,
  refresh_token_enc  text not null,            -- "v1:<iv>:<tag>:<ciphertext>" (base64 parts)
  scopes             text not null,            -- space-separated granted scopes
  connected_at       timestamptz not null default now(),
  last_refreshed_at  timestamptz,
  last_error         text                      -- most recent refresh/send failure (drives re-auth prompt)
);

alter table public.gmail_credentials enable row level security;
-- Deliberately: no GRANT, no policies. anon/authenticated cannot touch it.
revoke all on public.gmail_credentials from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) EMAIL TEMPLATES — {{first_name}}-style tokens, plain string substitution.
--    Read: shared templates or your own. Writes go through server actions.
-- ---------------------------------------------------------------------------
create table if not exists public.email_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  subject     text not null,
  body        text not null,
  created_by  uuid references public.profiles(id) on delete set null,
  is_shared   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.email_templates enable row level security;
grant select on public.email_templates to authenticated;

drop policy if exists email_templates_select on public.email_templates;
create policy email_templates_select on public.email_templates
  for select to authenticated using (is_shared or created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- 3) OUTREACH CAMPAIGNS — one row per composed batch (including dry runs).
--    NB: distinct from the pre-existing `outreach_log` table, which is the
--    manual contact-notes drawer. Read: your own campaigns; admins see all.
-- ---------------------------------------------------------------------------
create table if not exists public.outreach_campaigns (
  id              uuid primary key default gen_random_uuid(),
  created_by      uuid not null references public.profiles(id) on delete cascade,
  template_id     uuid references public.email_templates(id) on delete set null,
  status          text not null default 'draft'
                  check (status in ('draft','dry_run','sending','sent','partial','failed')),
  dry_run         boolean not null default false,
  recipient_count integer not null default 0,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);

alter table public.outreach_campaigns enable row level security;
grant select on public.outreach_campaigns to authenticated;

drop policy if exists outreach_campaigns_select on public.outreach_campaigns;
create policy outreach_campaigns_select on public.outreach_campaigns
  for select to authenticated
  using (
    created_by = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','super_admin'))
  );

-- ---------------------------------------------------------------------------
-- 4) OUTREACH SENDS — one row per candidate per attempt, including failures
--    and do-not-contact skips. to_email snapshots the address actually used
--    (the candidate row's email can change later). Read: your own sends;
--    admins see all.
-- ---------------------------------------------------------------------------
create table if not exists public.outreach_sends (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references public.outreach_campaigns(id) on delete cascade,
  candidate_id      uuid references public.candidates(id) on delete set null,
  sender_user_id    uuid not null references public.profiles(id) on delete cascade,
  to_email          text not null,
  status            text not null default 'queued'
                    check (status in ('queued','sent','draft_created','failed','skipped_dnc','skipped_quota')),
  gmail_message_id  text,
  gmail_thread_id   text,
  error             text,
  created_at        timestamptz not null default now(),
  sent_at           timestamptz,
  replied_at        timestamptz,
  bounced_at        timestamptz
);

alter table public.outreach_sends enable row level security;
grant select on public.outreach_sends to authenticated;

drop policy if exists outreach_sends_select on public.outreach_sends;
create policy outreach_sends_select on public.outreach_sends
  for select to authenticated
  using (
    sender_user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','super_admin'))
  );

-- Quota checks in the send path: per-candidate 2/week and per-sender 300/day.
create index if not exists outreach_sends_candidate_sent_idx
  on public.outreach_sends (candidate_id, sent_at) where sent_at is not null;
create index if not exists outreach_sends_sender_sent_idx
  on public.outreach_sends (sender_user_id, sent_at) where sent_at is not null;
-- Reply-detection cron sweep: open threads with no reply stamped yet.
create index if not exists outreach_sends_reply_sweep_idx
  on public.outreach_sends (gmail_thread_id) where gmail_thread_id is not null and replied_at is null;
create index if not exists outreach_sends_campaign_idx
  on public.outreach_sends (campaign_id);

-- ---------------------------------------------------------------------------
-- 5) DO NOT CONTACT — fellowship-wide opt-out on the candidate record. Once
--    set, NO fellow can email this candidate again; the send path re-checks
--    it server-side per recipient (the UI exclusion is a courtesy, not the
--    enforcement).
-- ---------------------------------------------------------------------------
alter table public.candidates
  add column if not exists do_not_contact boolean not null default false;

create index if not exists candidates_do_not_contact_idx
  on public.candidates (do_not_contact) where do_not_contact = true;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Diagnostics (optional, run by hand): candidate email quality snapshot.
-- select
--   count(*)                                                   as total,
--   count(*) filter (where email is null or email = '')        as missing_email,
--   count(*) filter (where email is not null and email <> ''
--                    and email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') as malformed_email
-- from public.candidates;
-- ---------------------------------------------------------------------------
