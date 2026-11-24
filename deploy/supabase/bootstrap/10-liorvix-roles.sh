#!/usr/bin/env bash
# 角色 / schema / 扩展引导脚本。**显式执行一次**（不是 initdb 自动跑）：
#   docker compose exec -T db bash /opt/liorvix/bootstrap/10-liorvix-roles.sh
# 由 scripts/migrate/bootstrap-roles.sh 和 restore-into-selfhost.sh 调用。
#
# 说明：不要把本目录挂到 /docker-entrypoint-initdb.d —— 那会整目录覆盖镜像自带的
# 初始化脚本（schema/角色/pgsodium 等），属于自找的坑。本脚本幂等，可以在已有数据
# 目录上反复执行。
#
# 作用：补齐官方 compose 里由 api-gw 暴露、但数据库层面必须存在的角色：
#   anon / authenticated / service_role        —— RLS 与 PostgREST 的切换目标
#   authenticator                             —— PostgREST 的连接用户（可 set role）
#   supabase_auth_admin / supabase_storage_admin —— GoTrue 与 storage-api 的迁移用户
set -Eeuo pipefail

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

# supabase/postgres 镜像里 `postgres` **不是**超级用户（supabase_admin 才是）。
# 建角色/`create role ... superuser` 需要超级用户，所以在 postgres 权限不够时切到
# supabase_admin（容器内 socket 是 trust，无需密码；VPS 实测）。
PSQL_DB="${POSTGRES_DB:-postgres}"
PSQL_USER="${POSTGRES_USER:-postgres}"
if [ "$(psql -U "${PSQL_USER}" -d "${PSQL_DB}" -tAc 'select rolsuper' 2>/dev/null || true)" != "t" ]; then
  if psql -U supabase_admin -d "${PSQL_DB}" -tAc 'select 1' >/dev/null 2>&1; then
    PSQL_USER=supabase_admin
  fi
fi

psql -v ON_ERROR_STOP=1 \
  -v pw="${POSTGRES_PASSWORD}" \
  --username "${PSQL_USER}" \
  --dbname "${PSQL_DB}" <<'SQL'
-- 无登录权限的角色：只作为 JWT 的 role claim 存在
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- 连接用户：authenticator 不应拥有任何权限，只能 set role
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin login noinherit createrole;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin login noinherit createrole;
  end if;
end
$$;

-- Cloud 专有角色：dump 里会出现 `ALTER SCHEMA auth OWNER TO supabase_admin` 和大量
-- `GRANT ... TO dashboard_user` / `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin`，
-- 角色不存在时这些语句会报错（本机演练实测 39 处）。supabase/postgres 镜像会自建它们，
-- 但这里显式补上，保证"镜像升级/换实现"也不会让恢复脚本失败。
-- 权限对齐官方镜像：supabase_admin 是超级用户，dashboard_user 只读+建对象。
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin login superuser createrole createdb bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'dashboard_user') then
    create role dashboard_user login createrole;
  end if;
end
$$;

alter role authenticator password :'pw';
alter role supabase_auth_admin password :'pw';
alter role supabase_storage_admin password :'pw';
alter role supabase_admin password :'pw';
alter role dashboard_user password :'pw';

grant anon, authenticated, service_role to authenticator;

-- GoTrue / storage-api 需要新建各自的 schema
grant create on database postgres to supabase_auth_admin;
grant create on database postgres to supabase_storage_admin;

-- PostgREST 需要对 public 的读取入口；**表级授权由 dump 里自带的 GRANT 决定**，
-- 这里不要写 default privileges：那会给恢复出来的、Cloud 里本来没授权给 anon 的表
-- 额外开 select，属于自找的权限漂移。
grant usage on schema public to anon, authenticated, service_role;

-- 预建 schema 并交给各自的迁移用户（GoTrue/storage 的迁移本身可建，但显式预建可以
-- 避免"首次启动用 postgres 建了 schema、后续迁移用户无 ownership"的坑）
create schema if not exists auth authorization supabase_auth_admin;
create schema if not exists storage authorization supabase_storage_admin;

-- 镜像初始化时这两个 schema 已由 supabase_admin 建好，上面的 if not exists 是 no-op，
-- 于是迁移用户对它们没有 CREATE 权限；GoTrue / storage-api 启动时要建表/迁移，必须先授权。
-- （Cloud 上 auth schema 的属主同样是 supabase_admin，恢复 dump 里的
--   `ALTER SCHEMA auth OWNER TO supabase_admin` 也会把它改回去，所以这里只补 GRANT。）
grant all on schema auth to supabase_auth_admin;
grant all on schema storage to supabase_storage_admin;

-- 镜像把扩展装在 extensions；先确保 schema 存在（已存在则 no-op）
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- pg_trgm：Cloud 把它装在 public，supabase/postgres 镜像装在 extensions。
-- dump 里的 trgm 索引是**带 schema 前缀**的（实测：`USING gin (title public.gin_trgm_ops)`），
-- 若不重定位，恢复直接报 `operator class "public.gin_trgm_ops" does not exist`。
-- 只在"不在 public"时才重定位：恢复过的库上已有 trgm 索引依赖它，此时 drop 会失败
-- （本机演练实测 `cannot drop extension pg_trgm because other objects depend on it`），
-- 而这个分支本来就是幂等的 no-op。
do $$
declare
  -- 变量名不能用 current_schema：PL/pgSQL 会把它解析成内置函数 current_schema()，
  -- 于是 SELECT INTO 静默拿到 'public'，分支永远走"已在 public"，扩展根本不会创建
  -- （本机演练实测：bootstrap 声称成功但 pg_trgm 仍缺失）。
  trgm_schema text;
begin
  select n.nspname into trgm_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';

  if trgm_schema is null then
    create extension if not exists pg_trgm with schema public;
  elsif trgm_schema <> 'public' then
    drop extension pg_trgm;
    create extension pg_trgm with schema public;
  end if;
end
$$;

-- 其余扩展：dump 里没有 CREATE EXTENSION（被 --schema 过滤掉了），镜像若没预装就必须补，
-- 否则依赖它们的默认值/函数会在恢复后的第一次写入时报错。已存在时是 no-op。
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_stat_statements with schema extensions;
-- citext 是 GoTrue 历史迁移的依赖；版本一致时不会用到，但预装成本为零。
create extension if not exists citext with schema extensions;
SQL

echo "liorvix bootstrap: roles and schemas ready"