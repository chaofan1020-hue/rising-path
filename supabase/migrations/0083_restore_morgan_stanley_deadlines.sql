begin;

-- Morgan Stanley's official Talent Gateway detail pages state:
-- "Deadline to Apply: Wednesday, October 14 at 11:59pm ET". The page omits
-- the year; these 2027 program listings were published in the 2026 cycle.
-- Store the confirmed deadline day at end-of-day because the public product
-- intentionally displays days, not hours. Keep the exact official wording
-- as field evidence for future audit/recheck.
update public.jobs as job
set
  valid_through = '2026-10-14T23:59:59.999Z'::timestamptz,
  deadline_source = 'official_description',
  field_evidence = jsonb_set(
    jsonb_set(coalesce(job.field_evidence, '{}'::jsonb), '{fields}', coalesce(job.field_evidence -> 'fields', '{}'::jsonb), true),
    '{fields,deadline}',
    jsonb_build_object(
      'status', 'verified',
      'source', 'official_description',
      'evidence_url', coalesce(job.source_url, job.job_url),
      'evidence_kind', 'official_detail_page',
      'evidence_excerpt', 'Deadline to Apply: Wednesday, October 14 at 11:59pm ET',
      'verified_at', now(),
      'deadline_day_timezone', 'America/New_York'
    ),
    true
  ),
  updated_at = now()
where job.company = 'Morgan Stanley'
  and job.title in (
    '2027 Institutional Equity Strats Summer Associate Program (New York)',
    '2027 Fixed Income Strats Summer Associate Program (New York)'
  )
  and job.source_system = 'collector_feed';

notify pgrst, 'reload schema';

commit;
