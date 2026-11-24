#!/usr/bin/env bash
# 在 storage-api 首次启动、建好 storage schema 之后，重建简历桶的 4 条 RLS 策略。
#
# 为什么需要单独一步：`pg_dump --schema=public --schema=auth` 不含 storage schema
# （storage-api 自带 schema 迁移，混着恢复会版本冲突），所以 storage.objects 上的
# 策略不会随 dump 过来；不补的话，"用户用自己的 token 下载自己的简历"会被 RLS 拒绝。
#
# 直接复用仓库里的迁移文件 0008（幂等：先 drop policy if exists，且有 to_regclass 保护）。
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

COMPOSE_FILE="${COMPOSE_FILE:-deploy/supabase/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-deploy/supabase/.env}"
SQL_FILE="${SQL_FILE:-supabase/migrations/0008_private_resume_storage.sql}"
EXPECTED_POLICIES="${EXPECTED_POLICIES:-4}"
# storage.objects 的属主是 supabase_storage_admin，而 supabase/postgres 镜像里的 `postgres`
# 不是超级用户 —— 用 postgres 建策略会报 `must be owner of table objects`（VPS 实测）。
PSQL_USER="${PSQL_USER:-supabase_admin}"

[ -f "${SQL_FILE}" ] || { echo "missing ${SQL_FILE}" >&2; exit 1; }
[ -f "${ENV_FILE}" ] || { echo "missing ${ENV_FILE}" >&2; exit 1; }

compose() { docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" "$@"; }

# storage schema 必须先存在（storage-api 启动即建；没起会报 storage.objects 不存在）
if ! compose exec -T db psql -U "${PSQL_USER}" -d postgres -tAc \
  "select to_regclass('storage.objects') is not null" | grep -q '^t$'; then
  echo "storage.objects not found: start storage first (docker compose up -d storage) and retry" >&2
  exit 1
fi

compose exec -T db psql -U "${PSQL_USER}" -d postgres -v ON_ERROR_STOP=1 \
  -f - < "${SQL_FILE}"

COUNT="$(compose exec -T db psql -U "${PSQL_USER}" -d postgres -tAc \
  "select count(*) from pg_policies where schemaname='storage' and tablename='objects'" | tr -d ' ')"

echo "storage policies on storage.objects: ${COUNT} (expected ${EXPECTED_POLICIES})"
if [ "${COUNT}" != "${EXPECTED_POLICIES}" ]; then
  compose exec -T db psql -U "${PSQL_USER}" -d postgres -c \
    "select policyname, cmd, roles from pg_policies where schemaname='storage' order by policyname" || true
  echo "policy count mismatch" >&2
  exit 1
fi

compose exec -T db psql -U "${PSQL_USER}" -d postgres -tAc \
  "select 'buckets=' || count(*) from storage.buckets"
echo "storage policies ready"