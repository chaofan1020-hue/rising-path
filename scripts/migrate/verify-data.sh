#!/usr/bin/env bash
# 数据对账：拿「迁移前基线」和「当前库」逐项 diff（P4 验收必跑）。
#
#   # 对自托管栈（读 /opt/supabase/.env 指向的库）
#   ENV_FILE=/opt/liorvix/.env.local \
#   DOTENV_CONFIG_PATH=/opt/liorvix/.env.local \
#     bash scripts/migrate/verify-data.sh
#
#   BASELINE=docs/baseline/prod-before-2026-11-20.json   # 默认值
#
# 判定：
#   * 行数 / 表数 / 函数数 / 策略数 / auth 用户 / refresh token 必须与基线一致
#     （迁移窗口内若有新写入，允许 after ≥ before，脚本会标 INCREASED 而不是 FAIL）
#   * 任何 DECREASED 都算失败（说明丢数据）
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

BASELINE="${BASELINE:-docs/baseline/prod-before-2026-11-20.json}"
AFTER="${AFTER:-docs/baseline/after-$(date +%Y%m%d-%H%M%S).json}"
ENV_FILE="${ENV_FILE:-.env.production.local}"

[ -f "${BASELINE}" ] || { echo "baseline not found: ${BASELINE}" >&2; exit 1; }
[ -f "${ENV_FILE}" ] || { echo "env file not found: ${ENV_FILE}" >&2; exit 1; }

echo "baseline: ${BASELINE}"
echo "env:      ${ENV_FILE}"
echo "target:   $(grep -E '^SUPABASE_URL=' "${ENV_FILE}" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '\r')"
echo

TSX="${TSX:-./node_modules/.bin/tsx}"
[ -e "${TSX}" ] || { echo "tsx not found at ${TSX}; run pnpm install first" >&2; exit 1; }

DOTENV_CONFIG_PATH="${ENV_FILE}" ENV_FILE="${ENV_FILE}" \
  "${TSX}" scripts/snapshot-db-baseline.ts \
  --compare="${BASELINE}" --out="${AFTER}"

echo
echo "分级判定（FAIL 会以非 0 退出）："
STATUS=0
node scripts/migrate/compare-baseline.mjs --baseline="${BASELINE}" --after="${AFTER}" || STATUS=$?

echo
echo "after snapshot: ${AFTER}"
if [ "${STATUS}" -ne 0 ]; then
  echo "存在 FAIL 项：**不要切换**，先查清原因。"
  exit 1
fi
echo "数据对账通过。"