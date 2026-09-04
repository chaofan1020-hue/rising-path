begin;

-- Deadline values without a retained official source cannot be shown to
-- candidates. Remove old feed values and two Morgan Stanley dates that were
-- inferred from a month/day phrase with no year. This does not affect job
-- lifecycle state.
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
        'rejected_reason', '缺少当前可复核的官网明确截止日期'
      ),
      true
    ),
    updated_at = now()
where valid_through is not null
  and (
    deadline_source is null
    or (
      company = 'Morgan Stanley'
      and title in (
        '2027 Institutional Equity Strats Summer Associate Program (New York)',
        '2027 Fixed Income Strats Summer Associate Program (New York)'
      )
      and deadline_source = 'official_description'
    )
  );

notify pgrst, 'reload schema';

commit;
