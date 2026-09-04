begin;

-- Older collector syncs used source_evidence as a description fallback. Move
-- only those recognizable evidence objects out of the candidate-facing field;
-- lifecycle state and the forensic field_evidence column remain untouched.
update public.jobs
set description = null,
    updated_at = now()
where source_system = 'collector_feed'
  and description ~ '^\s*\{'
  and description ~ '\}\s*$'
  and (
    description ilike '%"structured_field_sources"%'
    or description ilike '%"source_type"%'
    or description ilike '%"raw_payload"%'
    or description ilike '%"field_evidence"%'
    or description ilike '%"source_evidence"%'
  );

notify pgrst, 'reload schema';

commit;
