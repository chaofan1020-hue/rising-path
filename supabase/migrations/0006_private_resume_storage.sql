begin;

-- Original resume files are private and are addressed by resumes.file_key.
-- The application server reads/writes them with the service role key.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('risingpath-resumes', 'risingpath-resumes', false)
    on conflict (id) do update set public = false;
  end if;
end;
$$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists risingpath_resumes_select on storage.objects;
    drop policy if exists risingpath_resumes_insert on storage.objects;
    drop policy if exists risingpath_resumes_update on storage.objects;
    drop policy if exists risingpath_resumes_delete on storage.objects;

    create policy risingpath_resumes_select
      on storage.objects for select to authenticated
      using (
        bucket_id = 'risingpath-resumes'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
      );

    create policy risingpath_resumes_insert
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'risingpath-resumes'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
      );

    create policy risingpath_resumes_update
      on storage.objects for update to authenticated
      using (
        bucket_id = 'risingpath-resumes'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
      )
      with check (
        bucket_id = 'risingpath-resumes'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
      );

    create policy risingpath_resumes_delete
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'risingpath-resumes'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
      );
  end if;
end;
$$;

commit;
