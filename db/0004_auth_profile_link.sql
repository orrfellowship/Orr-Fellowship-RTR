-- ============================================================================
-- ORR FELLOWSHIP RECRUITING — AUTH → PROFILE LINK  (migration 0004)
-- Run in the Supabase SQL editor, AFTER 0003. Idempotent (create or replace).
-- ----------------------------------------------------------------------------
-- When a user signs up via Supabase Auth, automatically create their profile.
-- Without this, an authenticated user has no profile row, getCurrentProfile()
-- returns null, and they bounce back to /login. This is the missing link.
--
-- Bootstrap: the FIRST super-admin(s) are matched by email so they get full
-- access on first login. Everyone else defaults to 'fellow' (unscoped) and a
-- super-admin assigns their real role + school via User Management.
-- ============================================================================

-- Set the bootstrap super-admin email(s) here.
create or replace function handle_new_user() returns trigger as $$
declare
  super_emails text[] := array[
    'markstolte02@gmail.com'
   , 'jesse@orrfellowship.org'
  ];
  assigned_role app_role;
begin
  if new.email = any(super_emails) then
    assigned_role := 'super_admin';
  else
    assigned_role := 'fellow';
  end if;

  insert into public.profiles (id, full_name, email, role, school_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    assigned_role,
    null
  )
  on conflict (id) do nothing;

  return new;
end;
$$ language plpgsql security definer;

-- fire after a new auth user is created
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
