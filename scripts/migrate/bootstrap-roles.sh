#!/usr/bin/env bash
# 在**已有数据目录**的 db 容器上补齐角色/schema（initdb 脚本只在空目录时自动跑）。
# 演练/切换时先跑这个，再 restore。
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

COMPOSE_FILE="${COMPOSE_FILE:-deploy/supabase/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-deploy/supabase/.env}"

if [ ! -f "${ENV_FILE}" ]; then
  echo "missing ${ENV_FILE}; copy deploy/supabase/.env.example and fill it first" >&2
  exit 1
fi

docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T db \
  bash /opt/liorvix/bootstrap/10-liorvix-roles.sh