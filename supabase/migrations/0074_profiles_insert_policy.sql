-- Profile updates use an upsert so accounts created before the profile trigger
-- migration can still repair/create their own profile row. Keep ownership strict.
alter table public.profiles enable row level security;

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = auth.uid());
