begin;

-- A previous detail backfill captured an ATS application's serialized theme
-- configuration along with the page shell. Remove only those contaminated
-- candidate-facing fields; do not change lifecycle state or the source URL.
update public.jobs
set description = null,
    requirements = null,
    experience_min_years = null,
    experience_max_years = null,
    experience_text = null,
    updated_at = now()
where source_system = 'collector_feed'
  and (
    description ilike '%themeOptions%'
    or description ilike '%customTheme%'
    or description ilike '%varTheme%'
    or description ilike '%pcsjoblevel%'
    or description ilike '%position_profile_locations%'
    or requirements ilike '%themeOptions%'
    or requirements ilike '%customTheme%'
    or requirements ilike '%varTheme%'
    or requirements ilike '%pcsjoblevel%'
  );

notify pgrst, 'reload schema';

commit;
