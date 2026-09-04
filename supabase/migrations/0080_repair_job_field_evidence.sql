begin;

-- 0079 ran before the nested `fields` object existed on legacy rows. PostgreSQL
-- does not create missing intermediate JSON paths, so repair the audit shape
-- without changing availability or restoring any unverified public field.
update public.jobs as job
set
  field_evidence = jsonb_set(
    jsonb_set(coalesce(job.field_evidence, '{}'::jsonb), '{version}', '1'::jsonb, true),
    '{fields}',
    coalesce(job.field_evidence -> 'fields', '{}'::jsonb) || jsonb_build_object(
      'deadline', case
        when job.company = 'Morgan Stanley' and job.title in (
          '2027 Institutional Equity Strats Summer Associate Program (New York)',
          '2027 Fixed Income Strats Summer Associate Program (New York)'
        ) then jsonb_build_object(
          'status', 'rejected_legacy', 'source', null, 'evidence_url', coalesce(job.source_url, job.job_url),
          'evidence_kind', 'legacy', 'verified_at', null, 'rejected_reason', 'outside_recruiting_window',
          'legacy_value', '2001-10-13T16:00:00+00:00', 'quarantined_at', now()
        )
        else jsonb_build_object('status', 'pending_recheck', 'source', job.deadline_source, 'evidence_url', coalesce(job.source_url, job.job_url), 'evidence_kind', null, 'verified_at', null)
      end,
      'salary', jsonb_build_object('status', case when job.salary_source in ('official_payload', 'official_description') then 'verified' else 'pending_recheck' end, 'source', job.salary_source, 'evidence_url', coalesce(job.source_url, job.job_url), 'evidence_kind', case when job.salary_source in ('official_payload', 'official_description') then 'official_payload' else null end, 'verified_at', null),
      'location', jsonb_build_object('status', case when job.location_source in ('official_payload', 'official_description') then 'verified' else 'rejected_legacy' end, 'source', job.location_source, 'evidence_url', coalesce(job.source_url, job.job_url), 'evidence_kind', case when job.location_source in ('official_payload', 'official_description') then 'official_payload' else 'legacy' end, 'verified_at', null, 'rejected_reason', case when job.location_source in ('official_payload', 'official_description') then null else 'missing_trusted_source' end)
    ),
    true
  ),
  updated_at = now()
where job.source_system = 'collector_feed'
  and coalesce(job.field_evidence -> 'fields', '{}'::jsonb) = '{}'::jsonb;

notify pgrst, 'reload schema';

commit;
