#!/usr/bin/env bash
# 一键切换：把"最后一次导出 → 恢复 → 对象增量 → URL 改写 → 对账 → 换 env → 起服务 → 冒烟"
# 串成一条链，任一步失败自动回滚到"应用仍指向 Cloud"的状态（此时还没放开流量，回滚零代价）。
#
#   bash scripts/migrate/run-cutover.sh              # 全流程（会先跑 preflight，任何一条 FAIL 直接停）
#   bash scripts/migrate/run-cutover.sh --yes        # 跳过二次确认（给自动化/无人值守用）
#   bash scripts/migrate/run-cutover.sh --resume-from=restore   # 从某一步重跑（见 STEPS）
#
# 前置（必须全部满足，脚本会检查）：
#   * scripts/migrate/preflight-cutover.sh 全绿（DNS / 证书 / CORS / OAuth / SMTP）
#   * /root/.cloud-db-url 存在（Cloud 5432 会话模式连接串）
#   * 已告知用户进入维护窗口
#
# 设计原则：
#   * 幂等：重复跑同一段不会写坏数据（恢复用 --clean，对象复制会跳过已存在，URL 改写幂等）
#   * 失败即回滚：`cutover-app-env.sh --rollback` + 重启 liorvix；旧 Cloud 一直不动
#   * 只读检查先做：preflight 全绿才允许开始，避免"跑到一半才发现证书没签"
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="${REPO_ROOT}/scripts/migrate"
CLOUD_URL_FILE="${CLOUD_URL_FILE:-/root/.cloud-db-url}"
BACKUP_DIR="${BACKUP_DIR:-/opt/liorvix-backups}"
APP_ENV="${APP_ENV:-/opt/liorvix/.env.local}"
SB_ENV="${SB_ENV:-/opt/supabase/.env}"
WORK_DIR="${WORK_DIR:-/opt/liorvix-cutover}"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="${WORK_DIR}/cutover-${STAMP}.log"

STEPS=(preflight dump restore storage urls verify env app smoke)
RESUME_FROM=""
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    --resume-from=*) RESUME_FROM="${arg#*=}" ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

mkdir -p "$WORK_DIR"
umask 077
exec > >(tee -a "$LOG") 2>&1

step_no() { local i=1; for s in "${STEPS[@]}"; do [ "$s" = "$1" ] && { echo "$i"; return; }; i=$((i+1)); done; echo 99; }
STOP_AT=0
log() { printf '\n[cutover %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '\n[cutover %s] ERROR: %s\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }

ROLLBACK_ARMED=0
on_error() {
  local code=$?
  printf '\n[cutover %s] 失败（exit=%s）\n' "$(date +%H:%M:%S)" "$code" >&2
  if [ "$ROLLBACK_ARMED" = "1" ]; then
    printf '[cutover] 正在回滚应用配置 → Cloud\n' >&2
    bash "$MIG/cutover-app-env.sh" --rollback >/dev/null 2>&1 || true
    systemctl restart liorvix >/dev/null 2>&1 || true
    printf '[cutover] 已回滚；应用仍指向 Cloud，旧库未动，数据零丢失\n' >&2
  else
    printf '[cutover] 尚未改动应用配置，无需回滚\n' >&2
  fi
  exit "$code"
}
trap on_error ERR

log "切换开始 stamp=${STAMP} log=${LOG}"
log "步骤链：${STEPS[*]}"

# ---------- preflight ----------
CUR="$(step_no preflight)"
if [ -n "$RESUME_FROM" ] && [ "$CUR" -lt "$(step_no "$RESUME_FROM")" ]; then
  log "[1/9] preflight 跳过（--resume-from）"
else
  log "[1/9] 前置检查（DNS/证书/CORS/OAuth/SMTP/栈健康）"
  bash "$MIG/preflight-cutover.sh" | sed 's/^/    /' || die "前置检查未通过；修好后重跑本脚本"
fi

if [ "$ASSUME_YES" != "1" ]; then
  printf '\n即将开始：停应用 → 最终导出 → 恢复 → 对象增量 → URL 改写 → 对账 → 换 env → 起服务 → 冒烟。\n'
  printf '期间站点不可用（预计 8–12 分钟）。输入 YES 继续：'
  read -r answer
  [ "$answer" = "YES" ] || die "已取消"
fi

# ---------- dump ----------
if [ -n "$RESUME_FROM" ] && [ "$(step_no dump)" -lt "$(step_no "$RESUME_FROM")" ]; then
  log "[2/9] dump 跳过"
else
  [ -f "$CLOUD_URL_FILE" ] || die "缺少 ${CLOUD_URL_FILE}（Cloud 5432 会话连接串）"
  # 这个文件被手工编辑过，出现过 `CLOUD_DB_URL='postgresql://…'` 这种带变量名和引号的写法
  # （psql 会报 invalid connection option "CLOUD_DB_URL"）。这里统一抽出裸 URL，
  # 否则会在切换窗口里"导出第一步就失败"，白白停机一次。
  CLOUD_DB_URL="$(sed -nE "s/.*(postgres(ql)?:\/\/[^'\"[:space:]]+).*/\1/p" "$CLOUD_URL_FILE" | head -1)"
  [ -n "$CLOUD_DB_URL" ] || die "${CLOUD_URL_FILE} 里找不到 postgresql:// 连接串"
  log "[2/9] 停应用 + 最终导出"
  systemctl stop liorvix 2>/dev/null || true
  pkill -f 'backfill-official-job-details' 2>/dev/null || true
  sleep 2
  CLOUD_DB_URL="$CLOUD_DB_URL" STAMP="$STAMP" OUT_DIR="$BACKUP_DIR" \
    bash "$MIG/dump-from-cloud.sh" || die "Cloud 导出失败（应用仍是停的；可 systemctl start liorvix 恢复服务后重试）"
  DUMP_FILE="${BACKUP_DIR}/liorvix-${STAMP}.dump"
  [ -f "$DUMP_FILE" ] || die "找不到导出文件 $DUMP_FILE"
  echo "$DUMP_FILE" > "${WORK_DIR}/last-dump.txt"
fi
DUMP_FILE="${DUMP_FILE:-$(cat "${WORK_DIR}/last-dump.txt" 2>/dev/null || true)}"
[ -n "$DUMP_FILE" ] || die "无法确定 dump 文件"

# ---------- restore ----------
if [ -n "$RESUME_FROM" ] && [ "$(step_no restore)" -lt "$(step_no "$RESUME_FROM")" ]; then
  log "[3/9] restore 跳过"
else
  log "[3/9] 恢复到自托管栈：$(basename "$DUMP_FILE")"
  COMPOSE_FILE=/opt/supabase/docker-compose.yml ENV_FILE="$SB_ENV" DUMP_FILE="$DUMP_FILE" \
    bash "$MIG/restore-into-selfhost.sh" | sed 's/^/    /' || die "恢复失败（应用仍是停的；可回滚后排除）"
fi

# ---------- storage ----------
if [ -n "$RESUME_FROM" ] && [ "$(step_no storage)" -lt "$(step_no "$RESUME_FROM")" ]; then
  log "[4/9] storage 跳过"
else
  log "[4/9] 存储对象增量同步 + 策略"
  # 源（Cloud）配置：/root/.cloud-storage.env 里历史上写的是 SUPABASE_* 变量名，而迁移脚本
  # 要的是 SOURCE_*；两种都接受，再兜底用仍指向 Cloud 的 .env.local（2026-11-23 第一次
  # 真实切流就是在这里报 "SOURCE_SUPABASE_URL ... are required" 卡住的）。
  src_env() { grep -E "^$1=" /root/.cloud-storage.env 2>/dev/null | head -1 | cut -d= -f2-; }
  SRC_URL="${SOURCE_SUPABASE_URL:-$(src_env SUPABASE_URL)}"
  SRC_KEY="${SOURCE_SERVICE_ROLE_KEY:-$(src_env SUPABASE_SERVICE_ROLE_KEY)}"
  [ -n "$SRC_URL" ] || SRC_URL="$(grep -E '^SUPABASE_URL=' "$APP_ENV" | cut -d= -f2-)"
  [ -n "$SRC_KEY" ] || SRC_KEY="$(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' "$APP_ENV" | cut -d= -f2-)"
  [ -n "$SRC_URL" ] && [ -n "$SRC_KEY" ] \
    || die "找不到 Cloud 存储源配置（/root/.cloud-storage.env 或 ${APP_ENV}）"
  SOURCE_SUPABASE_URL="$SRC_URL" SOURCE_SERVICE_ROLE_KEY="$SRC_KEY" \
  TARGET_SERVICE_ROLE_KEY="$(grep -E '^SERVICE_ROLE_KEY=' "$SB_ENV" | cut -d= -f2-)" \
  TARGET_SUPABASE_URL="https://supabase.liorvix.com" \
    node "${REPO_ROOT}/scripts/migrate/migrate-storage-objects.mjs" --apply | tail -6 | sed 's/^/    /'
  COMPOSE_FILE=/opt/supabase/docker-compose.yml ENV_FILE="$SB_ENV" PSQL_USER=supabase_admin \
    bash "$MIG/apply-storage-policies.sh" | tail -3 | sed 's/^/    /'
fi

# ---------- urls ----------
if [ -n "$RESUME_FROM" ] && [ "$(step_no urls)" -lt "$(step_no "$RESUME_FROM")" ]; then
  log "[5/9] urls 跳过"
else
  log "[5/9] 旧域名 URL 改写"
  PW="$(grep -E '^POSTGRES_PASSWORD=' "$SB_ENV" | cut -d= -f2-)"
  SUPABASE_DB_URL="postgresql://supabase_admin:${PW}@127.0.0.1:5432/postgres" \
  OLD_BASE="https://weqvdtdjdzmqflhwobec.supabase.co" \
  NEW_BASE="https://supabase.liorvix.com" \
    node "${REPO_ROOT}/scripts/migrate/rewrite-storage-urls.mjs" --apply | tail -6 | sed 's/^/    /'
fi

# ---------- verify ----------
if [ -n "$RESUME_FROM" ] && [ "$(step_no verify)" -lt "$(step_no "$RESUME_FROM")" ]; then
  log "[6/9] verify 跳过"
else
  log "[6/9] 数据对账（基线 diff）"
  # verify-data.sh 需要一份"指向自托管栈"的 env（URL/密钥/DB URL），默认的 .env.local 此刻
  # 还指向 Cloud，不能直接拿来用（2026-11-23 第一次真实切流就是缺 SUPABASE_DB_URL 卡住的）。
  VERIFY_ENV="${WORK_DIR}/verify-env.${STAMP}"
  umask 077
  {
    echo "SUPABASE_URL=https://supabase.liorvix.com"
    echo "SUPABASE_ANON_KEY=$(grep -E '^ANON_KEY=' "$SB_ENV" | cut -d= -f2-)"
    echo "SUPABASE_SERVICE_ROLE_KEY=$(grep -E '^SERVICE_ROLE_KEY=' "$SB_ENV" | cut -d= -f2-)"
    echo "SUPABASE_DB_URL=postgresql://supabase_admin:$(grep -E '^POSTGRES_PASSWORD=' "$SB_ENV" | cut -d= -f2-)@127.0.0.1:5432/postgres"
  } > "$VERIFY_ENV"
  ENV_FILE="$VERIFY_ENV" bash "$MIG/verify-data.sh" | tail -12 | sed 's/^/    /' \
    || die "对账失败：数据有缺失/结构变化，**不要切换**（应用仍是停的；可回滚后排查）"
fi

# ---------- env ----------
log "[7/9] 换应用配置（备份 .env.local）"
ROLLBACK_ARMED=1
bash "$MIG/cutover-app-env.sh" --apply | sed 's/^/    /'

# ---------- app ----------
log "[8/9] 启动应用"
# Cloud 侧应用在停掉前可能正持有 job_sync_state 租约（TTL 15 分钟）。租约是"谁在同步"的
# 分布式锁，残留会让新栈 worker 前 15 分钟一直报"另一个岗位同步任务正在运行"而空转。
log "      释放残留岗位同步租约"
docker exec liorvix-supabase-db psql -U supabase_admin -h 127.0.0.1 -d postgres -qtAc \
  "update public.job_sync_state set lease_owner=null, lease_expires_at=null where lease_owner is not null" \
  >/dev/null 2>&1 && log "      ✓ 已释放" || log "      ⚠ 释放失败（worker 会在 15 分钟内自愈，不阻塞）"
systemctl start liorvix
for i in $(seq 1 30); do
  code="$(curl -sS -o /dev/null -m 3 -w '%{http_code}' http://127.0.0.1:5000/api/health 2>/dev/null || echo 000)"
  [ "$code" = "200" ] && break
  sleep 2
done
[ "$code" = "200" ] || die "/api/health 仍不是 200（${code}）"

# ---------- smoke ----------
log "[9/9] 冒烟测试"
ANON="$(grep -E '^ANON_KEY=' "$SB_ENV" | cut -d= -f2-)"
SR="$(grep -E '^SERVICE_ROLE_KEY=' "$SB_ENV" | cut -d= -f2-)"
APP_URL="https://liorvix.com" SUPABASE_URL="https://supabase.liorvix.com" \
ANON_KEY="$ANON" SERVICE_ROLE_KEY="$SR" \
  bash "$MIG/smoke-test.sh" | sed 's/^/    /' || die "冒烟未通过（应用已指向新栈；按输出逐项修）"

ROLLBACK_ARMED=0
trap - ERR
log "切换完成 ✅"
log "  用时：见日志 ${LOG}"
log "  应用现在指向：$(grep -E '^SUPABASE_URL=' "$APP_ENV" | cut -d= -f2-)"
log "  下一步：Cloudflare 清 /api/auth/config 缓存；观察 15 分钟 5xx 与 AI 选岗日志"
log "  如需回退：bash ${MIG}/cutover-app-env.sh --rollback && systemctl restart liorvix"
