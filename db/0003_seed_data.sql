-- ============================================================================
-- ORR FELLOWSHIP RECRUITING — SEED DATA  (migration 0003)
-- Run in the Supabase SQL editor, AFTER 0002. Idempotent (on conflict do nothing).
-- ----------------------------------------------------------------------------
-- The real Orr school list, tiered. Profiles/users are created through the
-- app's auth flow + Super-Admin user management, NOT seeded here.
--
-- NB: tier assignments here are the ORIGINAL seed. Later phase files adjust a
-- few (e.g. phase11 moves UIndy satellite -> bonus; phase5 renames Notre Dame).
-- Run the phases in order after this and the tiers/names end up correct.
-- ============================================================================

-- Core schools
insert into schools (name, tier) values
  ('Purdue','core'), ('IU','core'), ('Ball State','core'),
  ('Indiana State','core'), ('Butler','core'), ('Marian','core'),
  ('Wabash','core'), ('DePauw','core'), ('Taylor','core'),
  ('Notre Dame','core'), ('Miami of Ohio','core'), ('IWU','core')
on conflict (name) do nothing;

-- Satellite (IU/Purdue regional campuses)
insert into schools (name, tier) values
  ('IU Indy','satellite'), ('IU Northwest','satellite'), ('IU East','satellite'),
  ('IU South Bend','satellite'), ('IU Southeast','satellite'),
  ('Purdue Northwest','satellite'), ('Purdue Indy','satellite')
on conflict (name) do nothing;

-- Bonus schools
insert into schools (name, tier) values
  ('USI','bonus'), ('UIndy','bonus'), ('Ivy Tech','bonus'), ('Hanover','bonus'),
  ('Franklin','bonus'), ('Earlham','bonus'), ('Manchester U','bonus'),
  ('Anderson','bonus'), ('Rose-Hulman','bonus'), ('Valparaiso','bonus'),
  ('Trine','bonus'), ('Denison','bonus')
on conflict (name) do nothing;

-- singleton bookkeeping rows
insert into sync_meta (id, last_status) values (1, 'never run') on conflict (id) do nothing;
insert into app_settings (id, nav_color, accent_color, header_color)
  values (1, '#11123E', '#DD5434', '#11123E') on conflict (id) do nothing;
