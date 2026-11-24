#!/usr/bin/env bash
# 从 Supabase Cloud 导出 public + auth（不含 storage 数据、不含其它 schema）。
#
# 用法（在 VPS 上执行，输出到 /opt/liorvix-backups/）：
#   CLOUD_DB_URL='postgresql://postgres:...@aws-0-us-west-1.pooler.supabase.com:5432/postgres' \
#     OUT_DIR=/opt/liorvix-backups bash scripts/migrate/dump-from-cloud.sh
#
# 关键点：
#   * 必须用 **5432 会话模式**（6543 事务池模式不支持 pg_dump 需要的会话级特性，
#     且 Cloud 对 authenticated 有 8 秒 statement_timeout；postgres 角色为 90 秒）。
#   * 客户端 pg_dump 主版本必须 >= 服务端（17）。
#   * 只导 public + auth：storage 的对象走 §7 的增量复制，realtime/graphql 不用。
#   * `pg_trgm` 在 Cloud 装在 public，自托管镜像装在 extensions；bootstrap 会把它
#     重定位到 public，否则 gin_trgm_ops 索引恢复会失败（见 deploy/supabase/bootstrap）。
set -Eeuo pipefail

: "${CLOUD_DB_URL:?CLOUD_DB_URL is required (use the 5432 session-mode pooler or the direct host)}"
# 容错：有人会把整行 `CLOUD_DB_URL='postgresql://…'` 直接 export/读文件传进来，
# psql 会报 invalid connection option "CLOUD_DB_URL"（VPS 上真实踩过，切换窗口里
# 这一步失败就等于白停机一次）。这里统一抽出裸 URL。
CLOUD_DB_URL="$(printf '%s' "$CLOUD_DB_URL" | sed -nE "s/.*(postgres(ql)?:\/\/[^'\"[:space:]]+).*/\1/p" | head -1)"
[ -n "$CLOUD_DB_URL" ] || { echo "ERROR: CLOUD_DB_URL 里找不到 postgresql:// 连接串" >&2; exit 2; }
OUT_DIR="${OUT_DIR:-/opt/liorvix-backups}"
STAMP="${STAMP:-$(date +%Y%m%d-%H%M%S)}"
DUMP_FILE="${OUT_DIR}/liorvix-${STAMP}.dump"

log() { printf '[dump %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '[dump %s] ERROR: %s\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }

command -v pg_dump >/dev/null || die "pg_dump not found; apt install postgresql-client-17 (PGDG repo)"
PG_DUMP_MAJOR="$(pg_dump --version | sed -E 's/.* ([0-9]+).*/\1/')"
[[ "${PG_DUMP_MAJOR}" =~ ^[0-9]+$ ]] || die "cannot parse pg_dump version"
[ "${PG_DUMP_MAJOR}" -ge 17 ] || die "pg_dump ${PG_DUMP_MAJOR} < server major 17; install postgresql-client-17"

SERVER_MAJOR="$(psql "${CLOUD_DB_URL}" -tAc 'show server_version_num' 2>/dev/null | cut -c1-2 || true)"
[ "${SERVER_MAJOR}" = "17" ] || log "WARN: server_version_num prefix=${SERVER_MAJOR:-unknown}, expected 17"

mkdir -p "${OUT_DIR}"
log "target: ${DUMP_FILE}"
log "server: $(psql "${CLOUD_DB_URL}" -tAc 'select version()' | cut -c1-60)"

# 记录基线（与 docs/baseline 的脚本同源，失败不影响 dump）
log "capturing row counts"
psql "${CLOUD_DB_URL}" -v ON_ERROR_STOP=1 -tA <<'SQL' > "${OUT_DIR}/counts-${STAMP}.txt" || log "WARN: count capture failed"
select 'jobs_active=' || count(*) from public.jobs where is_active;
select 'jobs_closed=' || count(*) from public.jobs where not is_active;
select 'auth_users=' || count(*) from auth.users;
select 'auth_sessions=' || count(*) from auth.sessions;
select 'auth_refresh_tokens=' || count(*) from auth.refresh_tokens;
select 'auth_identities=' || count(*) from auth.identities;
select 'storage_objects=' || count(*) from storage.objects;
SQL

log "dumping public + auth (custom format, compression 6)"
START=$(date +%s)
pg_dump "${CLOUD_DB_URL}" \
  --format=custom \
  --compress=6 \
  --schema=public \
  --schema=auth \
  --no-publications \
  --no-subscriptions \
  --file="${DUMP_FILE}" \
  --verbose 2> "${OUT_DIR}/dump-${STAMP}.log" || die "pg_dump failed; see ${OUT_DIR}/dump-${STAMP}.log"
DURATION=$(( $(date +%s) - START ))

SIZE="$(du -h "${DUMP_FILE}" | cut -f1)"
log "done in ${DURATION}s, ${SIZE} -> ${DUMP_FILE}"
log "row-count baseline -> ${OUT_DIR}/counts-${STAMP}.txt"
log "verify: pg_restore --list '${DUMP_FILE}' | head"