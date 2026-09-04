begin;

-- Re-run after deploying the feed guard so values written by an older worker
-- process are removed once and cannot be reintroduced by future syncs.
update public.jobs
set valid_through = null,
    deadline_source = null,
    updated_at = now()
where source_system = 'collector_feed'
  and valid_through is not null
  and coalesce(deadline_source, '') not in ('official_description', 'official_link_description');

notify pgrst, 'reload schema';

commit;
