-- Fellowship year is independent of application role: a team lead can still
-- be a first- or second-year fellow. Staff/admin profiles remain unclassified.
alter table public.profiles
  add column if not exists fellowship_year smallint;

alter table public.profiles
  drop constraint if exists profiles_fellowship_year_check;

alter table public.profiles
  add constraint profiles_fellowship_year_check
  check (fellowship_year is null or fellowship_year in (1, 2));

create index if not exists profiles_active_fellowship_year_idx
  on public.profiles (fellowship_year, full_name)
  where is_active = true;

-- Start from a conservative state: only active fellow/team-lead profiles are
-- classified. This explicitly leaves every admin/super-admin untouched.
update public.profiles
set fellowship_year = null
where role not in ('fellow', 'team_lead') or not is_active;

update public.profiles
set fellowship_year = 2
where is_active
  and role in ('fellow', 'team_lead');

-- Confirmed first-year roster. Names use the canonical profile spelling after
-- matching shortened/preferred names supplied by the recruiting team.
update public.profiles
set fellowship_year = 1
where is_active
  and role in ('fellow', 'team_lead')
  and full_name = any (array[
    'Addison Clark',
    'Addison Owens',
    'Aidan Luttrell',
    'Alexis Sutton',
    'Allie Michael',
    'Alvaro Arranz',
    'Amber Cruser',
    'Anna Garofalo',
    'Antonio Santana',
    'Ava Hunt',
    'Avery Toole',
    'Isabelle Westerfeld',
    'Ben Gomez',
    'Benjamin Greiwe',
    'Blake Schnackenberg',
    'Bri Wilmouth',
    'Brooklyn Cornelius',
    'Calla Giallombardo',
    'Carter Wittendorf',
    'Chris Combs',
    'Christopher Royal',
    'Colin Vance',
    'Damon Gregory',
    'Daniel Seng',
    'Daphne Murray',
    'David Voss',
    'Drew Rathbun',
    'Dylan Fall',
    'Dylan Haslett',
    'Eli Johnson',
    'Eli Mercer',
    'Ellie Kate Skelton',
    'Emi Robinson',
    'Emma Peyton',
    'Evan Myers',
    'Faith Bluel',
    'Garrett Koch',
    'Greg Gottlieb',
    'Hannah Natschke',
    'Harrison Stomps',
    'Henry Cotter',
    'Isabelle Lucas',
    'Jackson Minix',
    'Jenna Burd',
    'Joey Best',
    'John Wrachford',
    'Joshua Cartwright',
    'Josh MacKinnon',
    'Josiah Linnemann',
    'Julia Fales',
    'Joshua Kale Helms',
    'Kara Simison',
    'Landrie Flack',
    'Leah Burks',
    'Lexie Bordenkecher',
    'Magwire Graybill',
    'Markevious Keys',
    'Mason Hedges',
    'Matthew Fritton',
    'Matthew Roxas',
    'Max Rosa',
    'Maya Murthy',
    'Michael Hoover',
    'Mitch Gunn',
    'Nathan Reynolds',
    'Norah Aalsma',
    'Paige Zurcher',
    'Peter Pizarro',
    'Piper Watkins',
    'Prosper Kpotufe',
    'Quinn Sholar',
    'Riley Ross',
    'Ryan Saroian',
    'Samuel Brumley',
    'Sophia Lattimer',
    'Will Cromer',
    'Will Medendorp',
    'Wodsander Maxime'
  ]::text[]);

-- Refuse a partial roster application instead of silently misclassifying a
-- missing or renamed profile.
do $$
declare
  first_year_count integer;
begin
  select count(*)
    into first_year_count
  from public.profiles
  where is_active
    and role in ('fellow', 'team_lead')
    and fellowship_year = 1;

  if first_year_count <> 78 then
    raise exception 'Expected 78 active first-year fellow profiles, found %', first_year_count;
  end if;
end
$$;

notify pgrst, 'reload schema';
