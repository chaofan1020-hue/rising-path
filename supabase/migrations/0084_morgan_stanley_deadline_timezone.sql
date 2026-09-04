begin;

alter table public.jobs
  add column if not exists deadline_time_zone varchar(64);

-- The two official pages specify 11:59pm Eastern Time, not UTC. Preserve the
-- true cut-off for lifecycle calculations while allowing the public UI to
-- continue showing only the employer's local calendar date.
update public.jobs as job
set
  valid_through = '2026-10-15T03:59:59.999Z'::timestamptz,
  deadline_time_zone = 'America/New_York',
  field_evidence = jsonb_set(
    jsonb_set(coalesce(job.field_evidence, '{}'::jsonb), '{fields}', coalesce(job.field_evidence -> 'fields', '{}'::jsonb), true),
    '{fields,deadline}',
    coalesce(job.field_evidence #> '{fields,deadline}', '{}'::jsonb)
      || jsonb_build_object('deadline_at', '2026-10-14T23:59:59.999-04:00', 'deadline_time_zone', 'America/New_York', 'verified_at', now()),
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
