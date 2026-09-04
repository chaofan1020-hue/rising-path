begin;

-- Public deadline labels require explicit, visible official-detail wording.
-- Discard hidden metadata/list-feed values and keep the role lifecycle intact.
update public.jobs
set valid_through = null,
    deadline_source = null,
    field_evidence = jsonb_set(
      jsonb_set(coalesce(field_evidence, '{}'::jsonb), '{fields}', coalesce(field_evidence -> 'fields', '{}'::jsonb), true),
      '{fields,deadline}',
      jsonb_build_object(
        'status', 'pending_recheck',
        'source', null,
        'evidence_url', null,
        'evidence_kind', null,
        'verified_at', null,
        'rejected_reason', '截止日期未在当前官网详情正文中明确展示'
      ),
      true
    ),
    updated_at = now()
where valid_through is not null
  and coalesce(deadline_source, '') not in ('official_description', 'official_link_description');

notify pgrst, 'reload schema';

commit;
