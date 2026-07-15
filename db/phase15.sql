-- ============================================================================
-- Orr RTR — Phase 15: per-user Gmail OAuth connection
-- Run in the Supabase SQL editor. Idempotent and safe to re-run.
--
-- OAuth credentials are only accessed by authenticated server routes through
-- the service role. Browser roles receive no table privileges or RLS policies,
-- so encrypted credential material cannot be selected through the Data API.
-- ============================================================================

create table if not exists public.gmail_connections (
  user_id                    uuid primary key references public.profiles(id) on delete cascade,
  google_email               text not null check (google_email ~ '^[^@[:space:]]+@orrfellowship\.org$'),
  refresh_token_ciphertext   text not null,
  refresh_token_iv           text not null,
  refresh_token_auth_tag     text not null,
  granted_scopes             text[] not null default '{}',
  access_token_expires_at    timestamptz,
  refresh_token_expires_at   timestamptz,
  connected_at               timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

alter table public.gmail_connections enable row level security;
revoke all on table public.gmail_connections from anon, authenticated;

comment on table public.gmail_connections is
  'Server-only encrypted Gmail OAuth refresh tokens, one connection per RTR profile.';
comment on column public.gmail_connections.refresh_token_ciphertext is
  'AES-256-GCM ciphertext encoded as base64; never return through browser APIs.';

notify pgrst, 'reload schema';
