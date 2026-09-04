begin;

-- List-feed/hidden ATS metadata deadlines are not candidate-visible evidence.
-- Keep only dates backed by explicit official-detail wording.
update public.jobs
set valid_through = null,
    deadline_source = null,
    updated_at = now()
where source_system = 'collector_feed'
  and valid_through is not null
  and coalesce(deadline_source, '') not in ('official_description', 'official_link_description');

notify pgrst, 'reload schema';

commit;
