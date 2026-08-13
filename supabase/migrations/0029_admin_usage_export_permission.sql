begin;

-- Keep the database permission catalogue aligned with the application-level
-- export restriction. Existing 0026 deployments must not be replayed.
insert into public.admin_permissions (key, description) values
  ('admin.usage.export', '导出脱敏 AI 用量数据')
on conflict (key) do update set description = excluded.description;

insert into public.admin_role_permissions (role_key, permission_key)
values
  ('super_admin', 'admin.usage.export'),
  ('legacy_super_admin', 'admin.usage.export')
on conflict (role_key, permission_key) do nothing;

commit;
