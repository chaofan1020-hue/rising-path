begin;

create table if not exists public.platform_settings (
  setting_key text primary key,
  setting_value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint platform_settings_key_check check (setting_key ~ '^[a-z][a-z0-9_]{1,99}$')
);

insert into public.platform_settings (setting_key, setting_value, updated_by)
values ('credits_enforced', '{"enabled": false}'::jsonb, 'migration')
on conflict (setting_key) do nothing;

alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;
grant select, insert, update, delete on public.platform_settings to service_role;

commit;
