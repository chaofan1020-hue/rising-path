#!/usr/bin/env bash
# 把 dump 恢复到自托管栈（deploy/supabase/docker-compose.yml）的 postgres 库。
#
# 用法：
#   DUMP_FILE=/opt/liorvix-backups/liorvix-20261120-0300.dump bash scripts/migrate/restore-into-selfhost.sh
#   DUMP_FILE=... ALLOW_PARTIAL=1 bash ...   # 只记录差异、不因非白名单错误退出（演练用）
#
# 设计取舍：
#   * 用容器内的 pg_restore（与服务端同主版本），dump 先 `docker compose cp` 进去。
#   * `--disable-triggers`：否则 11 万行 jobs 插入会触发 scope/AI 检索维护触发器，
#     恢复时间从 1–2 分钟涨到半小时以上。恢复后触发器自动重新启用。
#   * `--clean --if-exists`：演练反复跑。配合下面的清单过滤后，**空库首次恢复与重复恢复
#     都实测 0 error**（本机 PG17 演练各跑一遍，见计划 §5.2）。重复恢复的前提是**先摘掉
#     引用 auth.* 的 RLS 策略**（见下面的 DROP POLICY 段），否则 --clean 的 DROP auth
#     schema 会被依赖挡住 —— 2026-11-23 第一次真实切流就是栽在这里。
#   * **用 pg_restore -L 过滤两类条目**：
#     1) `SCHEMA - public`：Cloud 的 public schema 属主是 `pg_database_owner`，pg_dump 会导出
#        `CREATE SCHEMA public`；而 bootstrap 已把 pg_trgm 装进 public，`--clean` 的
#        `DROP SCHEMA public` 必然因依赖失败、随后的 CREATE 又必然"already exists"。
#        剔掉这一条后 public schema 保持数据库默认属主（与 Cloud 一致），ACL/COMMENT 照常执行。
#     2) `DEFAULT ACL`：Cloud 的默认权限会给 anon/authenticated/service_role 授 ALL；恢复时
#        若先于 CREATE 生效，anon 会拿到 Cloud 上本来没有的权限（演练实测 RPC 出现 anon
#        EXECUTE，属权限放大）。对象的真实权限已由 dump 的显式 ACL 条目覆盖，跳过默认权限是保真的。
#   * **单线程恢复（不传 --jobs）**：--clean 与 --jobs 并行会让"drop"和"create"交错执行，
#     演练中实测出现过 pg_trgm 被后置 drop、函数数量 101→70 的间歇性损坏。数据量 4.3 GB、
#     触发器已禁用，单线程耗时仍在可接受范围（计划 §9.1 给出预算）。
#   * 不用 `--exit-on-error`：脚本按白名单过滤后判定，**任何非白名单错误都会让脚本失败**
#     （除非 ALLOW_PARTIAL=1）。
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

: "${DUMP_FILE:?DUMP_FILE is required}"
[ -f "${DUMP_FILE}" ] || { echo "dump not found: ${DUMP_FILE}" >&2; exit 1; }

COMPOSE_FILE="${COMPOSE_FILE:-deploy/supabase/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-deploy/supabase/.env}"
SCHEMAS_TO_VERIFY="${SCHEMAS_TO_VERIFY:-public auth}"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK_DIR="${WORK_DIR:-/tmp/liorvix-restore-${STAMP}}"
ALLOW_PARTIAL="${ALLOW_PARTIAL:-0}"
# 恢复必须用**超级用户**：supabase/postgres 镜像里 `postgres` 不是 superuser，auth 表属主是
# `supabase_auth_admin`，`--clean` 的 DROP 会报 `must be owner of table sessions`（VPS 实测
# 24 处）；`--disable-triggers` 同样需要超级用户。镜像自带的 `supabase_admin` 是 superuser。
RESTORE_SUPERUSER="${RESTORE_SUPERUSER:-supabase_admin}"

log() { printf '[restore %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '[restore %s] ERROR: %s\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }

compose() { docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" "$@"; }

mkdir -p "${WORK_DIR}"

log "checking database container"
compose up -d db
for _ in $(seq 1 60); do
  if compose exec -T db pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; then break; fi
  sleep 2
done
compose exec -T db pg_isready -U postgres -h 127.0.0.1 >/dev/null || die "db is not ready"

log "roles/schemas (idempotent bootstrap)"
compose exec -T db bash /opt/liorvix/bootstrap/10-liorvix-roles.sh >/dev/null \
  || die "bootstrap roles failed"

log "copying dump into container"
compose cp "${DUMP_FILE}" db:/tmp/restore.dump >/dev/null || die "docker compose cp failed"

log "building restore list (drop public-schema entry + Cloud default ACLs)"
compose exec -T db pg_restore -l /tmp/restore.dump > "${WORK_DIR}/restore.list" || die "pg_restore -l failed"
grep -vE '^[0-9]+; [0-9]+ [0-9]+ (SCHEMA - public |DEFAULT ACL)' "${WORK_DIR}/restore.list" \
  > "${WORK_DIR}/restore.filtered.list" || die "could not filter the list"
[ "$(grep -cE '^[0-9]+;' "${WORK_DIR}/restore.filtered.list")" -gt 100 ] || die "filtered list looks empty"
compose cp "${WORK_DIR}/restore.filtered.list" db:/tmp/restore.filtered.list >/dev/null || die "docker compose cp failed"

# 恢复前必须先摘掉"引用 auth.* 的 RLS 策略"。
# pg_restore --clean 的第一步会 DROP auth schema 里的函数/schema，而 public 与 storage 上
# 的策略全都在引用 auth.uid()（VPS 实测 64 条 policy 依赖它）。依赖没摘掉就会在恢复最开头报
#   ERROR: cannot drop function auth.uid() because other objects depend on it
#   ERROR: cannot drop schema auth because other objects depend on it
# 2026-11-23 16:13 的真实切流就是在这里挂掉的（第一次空库恢复不会失败，所以两次演练都是绿的）。
# public 的策略会由 dump 原样重建，storage 的 4 条由 apply-storage-policies.sh 重建，
# 因此先全部 DROP 是安全的；此时应用要么已停（切流）要么还指向 Cloud（演练），没有越权窗口。
log "dropping RLS policies that reference auth.* (dump / storage step recreate them)"
compose exec -T db psql -U "${RESTORE_SUPERUSER}" -d postgres -v ON_ERROR_STOP=1 <<'SQL' \
  || die "could not drop dependent RLS policies"
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end
$$;
SQL

# 只过滤 dump 里的 DEFAULT ACL 还不够：镜像初始化时**自己**就在 public 上装了默认权限
# （postgres / supabase_admin → anon,authenticated,postgres,service_role EXECUTE），
# 于是 pg_restore 建函数的瞬间 anon 就拿到了 EXECUTE；dump 的显式 ACL 只写
# `REVOKE ALL ... FROM PUBLIC` + `GRANT ... TO authenticated/service_role`，**不会**撤掉
# anon（VPS 实测：101 个函数全部出现 anon EXECUTE，Cloud 只有 75 个）。
# 所以恢复前先把这些默认权限清空，让 dump 的显式 ACL 成为唯一来源。
log "clearing image default ACLs so dump ACLs are authoritative"
compose exec -T db psql -U "${RESTORE_SUPERUSER}" -d postgres -v ON_ERROR_STOP=1 <<'SQL' \
  || die "could not clear default privileges"
do $$
declare r text;
begin
  foreach r in array array['postgres', 'supabase_admin'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'alter default privileges for role %I in schema public revoke all on functions from anon, authenticated, service_role, postgres',
        r);
    end if;
  end loop;
end
$$;
SQL

# 必须显式 -U：`docker compose exec` 默认以 root 进容器，不指定用户时会用 OS 用户 root
# 连库，直接 FATAL: role "root" does not exist（VPS 实测）。
log "restoring (single-threaded, deterministic; superuser=${RESTORE_SUPERUSER})"
START=$(date +%s)
set +e
compose exec -T db pg_restore \
  -U "${RESTORE_SUPERUSER}" \
  --clean --if-exists \
  --disable-triggers \
  --dbname=postgres \
  -L /tmp/restore.filtered.list \
  --verbose /tmp/restore.dump \
  > "${WORK_DIR}/restore.log.out" 2> "${WORK_DIR}/restore.log.err"
RESTORE_STATUS=$?
set -e
DURATION=$(( $(date +%s) - START ))

# Cloud dump 中必然出现的无害错误（顺序恢复时会重复建 schema / 扩展已预装）
BENIGN_FILE="${BENIGN_FILE:-${SCRIPT_DIR}/restore-benign-errors.txt}"
if [ ! -f "${BENIGN_FILE}" ]; then
  BENIGN_FILE="${WORK_DIR}/benign.txt"
  cat > "${BENIGN_FILE}" <<'PATTERNS'
already exists
does not exist, skipping
extension "pg_trgm"
schema "public" already exists
schema "auth" already exists
schema "storage" already exists
PATTERNS
fi

grep -E 'pg_restore: error' "${WORK_DIR}/restore.log.err" > "${WORK_DIR}/errors.txt" 2>/dev/null || true
if [ -s "${WORK_DIR}/errors.txt" ]; then
  grep -vFf "${BENIGN_FILE}" "${WORK_DIR}/errors.txt" > "${WORK_DIR}/unexpected.txt" 2>/dev/null || cp "${WORK_DIR}/errors.txt" "${WORK_DIR}/unexpected.txt"
else
  : > "${WORK_DIR}/unexpected.txt"
fi

log "restore finished in ${DURATION}s (pg_restore exit=${RESTORE_STATUS}), errors: $(wc -l < "${WORK_DIR}/errors.txt" | tr -d ' ') total / $(wc -l < "${WORK_DIR}/unexpected.txt" | tr -d ' ') unexpected"

if [ -s "${WORK_DIR}/unexpected.txt" ]; then
  head -20 "${WORK_DIR}/unexpected.txt" >&2
  if [ "${ALLOW_PARTIAL}" != "1" ]; then
    die "unexpected restore errors; see ${WORK_DIR}/unexpected.txt (set ALLOW_PARTIAL=1 to continue as a drill)"
  fi
  log "WARN: continuing because ALLOW_PARTIAL=1"
fi
[ "${RESTORE_STATUS}" -eq 0 ] || log "WARN: pg_restore exited ${RESTORE_STATUS} (mostly benign 'already exists')"

# 恢复后把默认权限装回去，但**不给 anon**：Cloud 的默认 ACL 会给 anon 授 EXECUTE，
# 那意味着以后任何新建函数默认对未登录用户可执行。项目自己的迁移（0139）已经明确
# `revoke ... from anon`，这里顺着这个方向收窄，属于刻意的、写进文档的偏离。
log "reinstalling default privileges (authenticated/service_role only, no anon)"
compose exec -T db psql -U "${RESTORE_SUPERUSER}" -d postgres -v ON_ERROR_STOP=1 <<'SQL' \
  || log "WARN: could not reinstall default privileges (non-fatal)"
do $$
declare r text;
begin
  foreach r in array array['postgres', 'supabase_admin'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'alter default privileges for role %I in schema public grant all on functions to authenticated, postgres, service_role',
        r);
    end if;
  end loop;
end
$$;
SQL

log "analyzing (this makes the first queries fast)"
# 注意：带 option 的 VACUUM 只能作用于**单张表**，写成一串会整条失败（VPS 实测 analyze 静默失败）。
ANALYZE_OK=1
for t in jobs ai_matches resumes applications profiles; do
  if [ "$t" = "jobs" ]; then
    stmt="vacuum (analyze, parallel 4) public.jobs"
  else
    stmt="vacuum (analyze) public.${t}"
  fi
  compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$stmt" \
    >>"${WORK_DIR}/analyze.log" 2>&1 || ANALYZE_OK=0
done
[ "${ANALYZE_OK}" = "1" ] || log "WARN: analyze partly failed; see ${WORK_DIR}/analyze.log"

log "verifying counts"
compose exec -T db psql -U postgres -d postgres -tA <<'SQL' | tee "${WORK_DIR}/counts.txt"
select 'jobs_active=' || count(*) from public.jobs where is_active;
select 'jobs_closed=' || count(*) from public.jobs where not is_active;
select 'profiles=' || count(*) from public.profiles;
select 'resumes=' || count(*) from public.resumes;
select 'ai_matches=' || count(*) from public.ai_matches;
select 'auth_users=' || count(*) from auth.users;
select 'auth_sessions=' || count(*) from auth.sessions;
select 'auth_refresh_tokens=' || count(*) from auth.refresh_tokens;
select 'auth_identities=' || count(*) from auth.identities;
select 'storage_schema_tables=' || count(*) from information_schema.tables where table_schema = 'storage';
select 'auth_schema_version=' || max(version) from auth.schema_migrations;
SQL
# storage 的对象数据不在 dump 里：storage-api 首次启动会自建 storage schema，
# 对象清单按计划 §7 用增量复制脚本迁移。

log "checking the function the app actually calls"
compose exec -T db psql -U postgres -d postgres -tA -c \
  "select 'search_ai_match_candidates_v7=' || (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='search_ai_match_candidates_v7') then 'present' else 'MISSING' end)"

# 这几条是"恢复是否保真"的硬断言：演练中每个坑都真实出现过（pg_trgm 被并行 clean 弄丢、
# Cloud 默认权限把 EXECUTE 灌给 anon、auth schema 属主被改成非 GoTrue 角色）。
log "asserting restore fidelity (extension, ACL, RLS, ownership)"
# 用 aclexplode(pg_proc.proacl) 而不是 information_schema：后者对函数权限的呈现会
# 跟随当前会话角色变化，容易出现"看着有/没有"的误判。
compose exec -T db psql -U postgres -d postgres -tA <<'SQL' | tee "${WORK_DIR}/checks.txt"
select 'pg_trgm_in_public|' || (case when exists (
  select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm' and n.nspname = 'public') then 'ok' else 'FAIL' end);
select 'rpc_v7_no_anon_grant|' || (case when exists (
  select 1 from pg_proc p
   cross join lateral aclexplode(p.proacl) a
   join pg_roles r on r.oid = a.grantee
   join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'search_ai_match_candidates_v7'
    and r.rolname = 'anon'
    and a.privilege_type = 'EXECUTE') then 'FAIL' else 'ok' end);
select 'jobs_rls_enabled|' || (case when (
  select relrowsecurity from pg_class where oid = 'public.jobs'::regclass) then 'ok' else 'FAIL' end);
select 'auth_users_owner|' || (case when (
  select tableowner from pg_tables where schemaname = 'auth' and tablename = 'users'
) = 'supabase_auth_admin' then 'ok' else 'FAIL' end);
select 'auth_users_rows|' || count(*) from auth.users;
select 'public_functions_anon_exec|' || count(distinct p.oid)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(p.proacl) a
  join pg_roles r on r.oid = a.grantee
 where n.nspname = 'public' and p.prokind = 'f'
   and r.rolname = 'anon' and a.privilege_type = 'EXECUTE';
SQL
if grep -q '|FAIL' "${WORK_DIR}/checks.txt"; then
  die "restore fidelity checks failed; see ${WORK_DIR}/checks.txt"
fi
# 校验"函数级 anon 授权数量"是否与 Cloud 一致（Cloud 基线 75/101）。不一致不是致命错误，
# 但必须显式打出来，避免权限放大被静默带进生产。
ANON_FN_EXPECTED="${ANON_FN_EXPECTED:-75}"
ANON_FN_ACTUAL="$(grep '^public_functions_anon_exec|' "${WORK_DIR}/checks.txt" | cut -d'|' -f2)"
if [ -n "${ANON_FN_ACTUAL}" ] && [ "${ANON_FN_ACTUAL}" != "${ANON_FN_EXPECTED}" ]; then
  log "WARN: anon-executable public functions = ${ANON_FN_ACTUAL}, Cloud baseline = ${ANON_FN_EXPECTED}"
else
  log "anon-executable public functions = ${ANON_FN_ACTUAL} (matches Cloud baseline)"
fi

log "done; artifacts in ${WORK_DIR}"