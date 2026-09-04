begin;

-- Keep collector jobs active, but remove deadline values that have no current
-- official-detail evidence. The public API already hides these values; this
-- cleanup also prevents stale dates from leaking to admin exports or future
-- sync code paths.
update public.jobs
set valid_through = null,
    deadline_source = null,
    updated_at = now()
where source_system = 'collector_feed'
  and valid_through is not null
  and coalesce(deadline_source, '') not in ('official_description', 'official_link_description');

notify pgrst, 'reload schema';

commit;
