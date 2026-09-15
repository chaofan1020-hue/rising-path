begin;

insert into public.admin_permissions (key, description) values
  ('admin.users.write', '删除学员账号')
on conflict (key) do update set description = excluded.description;

insert into public.admin_role_permissions (role_key, permission_key)
select roles.key, 'admin.users.write'
from public.admin_roles as roles
where roles.key in ('super_admin', 'legacy_super_admin', 'support_admin')
on conflict (role_key, permission_key) do nothing;

commit;
