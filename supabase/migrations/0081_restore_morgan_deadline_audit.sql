begin;

-- The first scoped Morgan Stanley sync correctly left the deadline empty, but
-- its fresh empty-evidence object replaced the legacy quarantine annotation.
-- Restore the audit trail; neither availability nor the public field value is
-- changed by this correction.
update public.jobs
set
  field_evidence = jsonb_set(
    jsonb_set(coalesce(field_evidence, '{}'::jsonb), '{fields}', coalesce(field_evidence -> 'fields', '{}'::jsonb), true),
    '{fields,deadline}',
    jsonb_build_object(
      'status', 'rejected_legacy', 'source', null, 'evidence_url', coalesce(source_url, job_url),
      'evidence_kind', 'legacy', 'verified_at', null, 'rejected_reason', 'outside_recruiting_window',
      'legacy_value', '2001-10-13T16:00:00+00:00', 'quarantined_at', now(), 'last_rechecked_at', now()
    ),
    true
  ),
  updated_at = now()
where company = 'Morgan Stanley'
  and title in (
    '2027 Institutional Equity Strats Summer Associate Program (New York)',
    '2027 Fixed Income Strats Summer Associate Program (New York)'
  )
  and source_system = 'collector_feed';

notify pgrst, 'reload schema';

commit;
