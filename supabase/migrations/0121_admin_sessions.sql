begin;

create table if not exists public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.admin_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  ip_hash text,
  user_agent text
);

create index if not exists admin_sessions_active_user_idx
  on public.admin_sessions (admin_user_id, expires_at desc)
  where revoked_at is null;

alter table public.admin_sessions enable row level security;
revoke all on table public.admin_sessions from anon, authenticated;
grant select, insert, update, delete on table public.admin_sessions to service_role;

create or replace function public.find_auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = auth, public
as $$
  select id
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1;
$$;

create or replace function public.list_admin_accounts()
returns table (
  id uuid,
  auth_user_id uuid,
  email text,
  role_key text,
  status text,
  last_login_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = auth, public
as $$
  select
    admin_users.id,
    admin_users.auth_user_id,
    auth_users.email,
    admin_users.role_key,
    admin_users.status,
    admin_users.last_login_at,
    admin_users.created_at,
    admin_users.updated_at
  from public.admin_users
  left join auth.users auth_users on auth_users.id = admin_users.auth_user_id
  order by admin_users.created_at desc;
$$;

revoke all on function public.find_auth_user_id_by_email(text) from public, anon, authenticated;
revoke all on function public.list_admin_accounts() from public, anon, authenticated;
grant execute on function public.find_auth_user_id_by_email(text) to service_role;
grant execute on function public.list_admin_accounts() to service_role;

commit;
