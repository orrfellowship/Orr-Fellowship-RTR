-- ============================================================================
-- Orr RTR — Phase 24: active-account enforcement and profile-field hardening
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
-- ============================================================================

-- No current product workflow needs direct self-service profile writes. The old
-- row-only policy unintentionally allowed a signed-in user to change protected
-- columns such as role, school_id, and is_active through the Data API.
drop policy if exists profiles_self_update on public.profiles;

-- Admin user-management writes use the trusted service client. Super-admin
-- direct database management remains covered by profiles_super_manage.

notify pgrst, 'reload schema';
