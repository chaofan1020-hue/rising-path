begin;

-- The team database was created from the legacy schema before 0002 ran.
-- Keep harmless legacy profile fields for compatibility, but add the field
-- used by the current admin analytics API.
alter table if exists public.profiles
  add column if not exists display_name varchar(120);

update public.profiles as profile
set display_name = nullif(
  left(
    coalesce(
      display_name,
      to_jsonb(profile) ->> 'full_name',
      to_jsonb(profile) ->> 'email',
      ''
    ),
    120
  ),
  ''
)
where display_name is null;

commit;
