begin;

-- The collector currently contains tens of thousands of historical rows.
-- Supabase's pooler defaults each SQL statement to 120 seconds, while this
-- one-time quarantine update must inspect the complete feed. Keep the change
-- atomic but explicitly allow this migration enough time to finish.
set local statement_timeout = '15min';

-- Legacy collector rows predate field-level provenance. Quarantine values
-- instead of using them as a lifecycle signal: users will not see an
-- unverified deadline/salary/location, while the original value remains in
-- field_evidence for company-by-company rechecking.
with quarantine as (
  select
    id,
    field_evidence,
    valid_through,
    salary_range,
    region,
    case
      when valid_through is null then null
      when deadline_source is null or deadline_source not in ('official_payload', 'official_description', 'official_link_valid_through', 'official_link_application_deadline', 'official_link_structured_field', 'official_link_description') then 'missing_trusted_source'
      when valid_through < '2024-01-01'::timestamptz then 'outside_recruiting_window'
      when valid_through < created_at - interval '1 day' then 'before_job_created'
      when valid_through < now() then 'expired_requires_recheck'
      else null
    end as deadline_reason,
    case
      when salary_range is not null and (salary_source is null or salary_source not in ('official_payload', 'official_description')) then 'missing_trusted_source'
      else null
    end as salary_reason,
    case
      when region is not null and region <> '' and (location_source is null or location_source not in ('official_payload', 'official_description', 'official_link_valid_through', 'official_link_application_deadline', 'official_link_structured_field', 'official_link_description')) then 'missing_trusted_source'
      else null
    end as location_reason
  from public.jobs
  where source_system = 'collector_feed'
)
update public.jobs as job
set
  valid_through = case when quarantine.deadline_reason is not null then null else job.valid_through end,
  deadline_source = case when quarantine.deadline_reason is not null then null else job.deadline_source end,
  salary_range = case when quarantine.salary_reason is not null then null else job.salary_range end,
  salary_source = case when quarantine.salary_reason is not null then null else job.salary_source end,
  location_source = case when quarantine.location_reason is not null then 'rejected_legacy' else job.location_source end,
  field_evidence = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(coalesce(job.field_evidence, '{}'::jsonb), '{version}', '1'::jsonb, true),
          '{fields}', coalesce(job.field_evidence -> 'fields', '{}'::jsonb), true
        ),
        '{fields,deadline}',
        case when quarantine.deadline_reason is not null then jsonb_build_object(
          'status', 'rejected_legacy', 'source', job.deadline_source, 'evidence_url', coalesce(job.source_url, job.job_url),
          'evidence_kind', 'legacy', 'verified_at', null, 'rejected_reason', quarantine.deadline_reason,
          'legacy_value', quarantine.valid_through, 'quarantined_at', now()
        ) else coalesce(job.field_evidence #> '{fields,deadline}', 'null'::jsonb) end,
        true
      ),
      '{fields,salary}',
      case when quarantine.salary_reason is not null then jsonb_build_object(
        'status', 'rejected_legacy', 'source', job.salary_source, 'evidence_url', coalesce(job.source_url, job.job_url),
        'evidence_kind', 'legacy', 'verified_at', null, 'rejected_reason', quarantine.salary_reason,
        'legacy_value', quarantine.salary_range, 'quarantined_at', now()
      ) else coalesce(job.field_evidence #> '{fields,salary}', 'null'::jsonb) end,
      true
    ),
    '{fields,location}',
    case when quarantine.location_reason is not null then jsonb_build_object(
      'status', 'rejected_legacy', 'source', job.location_source, 'evidence_url', coalesce(job.source_url, job.job_url),
      'evidence_kind', 'legacy', 'verified_at', null, 'rejected_reason', quarantine.location_reason,
      'legacy_value', quarantine.region, 'quarantined_at', now()
    ) else coalesce(job.field_evidence #> '{fields,location}', 'null'::jsonb) end,
    true
  ),
  updated_at = now()
from quarantine
where job.id = quarantine.id
  and (quarantine.deadline_reason is not null or quarantine.salary_reason is not null or quarantine.location_reason is not null);

-- This index supports the company quality dashboard without changing job
-- availability or any existing region filters.
create index if not exists jobs_feed_company_active_idx
  on public.jobs (company, is_active)
  where source_system = 'collector_feed';

notify pgrst, 'reload schema';

commit;
