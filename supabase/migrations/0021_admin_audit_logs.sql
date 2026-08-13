begin;

create table if not exists public.admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_type text not null default 'admin_session',
  actor_fingerprint text,
  action text not null,
  resource_type text not null,
  resource_id text,
  subject_user_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  before_data jsonb,
  after_data jsonb,
  success boolean not null default true,
  error_code text,
  error_message text,
  request_id uuid not null default gen_random_uuid(),
  request_ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_at_idx
  on public.admin_audit_logs(created_at desc);
create index if not exists admin_audit_logs_resource_idx
  on public.admin_audit_logs(resource_type, resource_id, created_at desc);
create index if not exists admin_audit_logs_subject_user_idx
  on public.admin_audit_logs(subject_user_id, created_at desc)
  where subject_user_id is not null;
create index if not exists admin_audit_logs_action_idx
  on public.admin_audit_logs(action, created_at desc);

alter table public.admin_audit_logs enable row level security;
revoke all on table public.admin_audit_logs from anon, authenticated;
grant select, insert on table public.admin_audit_logs to service_role;
grant usage, select on sequence public.admin_audit_logs_id_seq to service_role;

commit;
