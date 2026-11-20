#!/usr/bin/env bash
#
# liorvix 生产部署脚本（在服务器上执行）
#
# 用法：
#   sudo /usr/local/bin/liorvix-deploy                 # 部署 DEPLOY_BRANCH 的最新提交
#   sudo /usr/local/bin/liorvix-deploy <commit|tag>    # 部署指定版本
#
# 行为：
#   1. 前置检查（仓库、分支、磁盘）
#   2. 备份当前构建产物到 releases/<sha>/
#   3. git fetch + reset --hard 到目标版本
#   4. 依赖有变化才 pnpm install
#   5. 构建（失败即回滚）
#   6. 重启服务
#   7. 冒烟验收（失败即回滚）
#
# 环境变量：
#   APP_DIR           默认 /opt/liorvix
#   DEPLOY_BRANCH     默认 codex/ui-overlay-from-ui-change
#   KEEP_RELEASES     默认 3（保留几份历史构建）
#   SKIP_SMOKE=1      跳过验收（不建议）
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/liorvix}"
BRANCH="${DEPLOY_BRANCH:-codex/ui-overlay-from-ui-change}"
KEEP_RELEASES="${KEEP_RELEASES:-3}"
SERVICE="liorvix.service"
SITE="http://127.0.0.1:5000"
RELEASES="$APP_DIR/releases"
LOG_DIR=/var/log/liorvix-deploy
TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$LOG_DIR/$TS.log"

log()  { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
fail() { printf '\n[FAILED] %s\n' "$*" >&2; printf '日志: %s\n' "$LOG" >&2; exit 1; }

mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG") 2>&1

log "deploy start  app=$APP_DIR  branch=$BRANCH"

# ---------- 1. 前置检查 ----------
[ -d "$APP_DIR/.git" ] || fail "$APP_DIR 不是 git 仓库；先完成一次性改造（见 docs/deployment.md 第 3 节）"
cd "$APP_DIR"

DISK_FREE_GB=$(df -Pk "$APP_DIR" | awk 'NR==2 {printf "%d", $4/1024/1024}')
[ "$DISK_FREE_GB" -ge 5 ] || fail "磁盘剩余 ${DISK_FREE_GB}G，低于 5G，先清理"

DIRTY=$(git status --porcelain --untracked-files=no | head -20 || true)
[ -z "$DIRTY" ] || fail "工作区有未提交改动，先处理：
$DIRTY"

PREV_SHA=$(git rev-parse HEAD)
PREV_DIR="$RELEASES/$PREV_SHA"
log "previous release: $PREV_SHA"

# ---------- 2. 备份当前构建产物 ----------
if [ -d .next ] && [ -d dist ]; then
  mkdir -p "$PREV_DIR"
  rsync -a --delete .next/ "$PREV_DIR/.next/" 2>/dev/null || cp -a .next "$PREV_DIR/.next"
  cp -a dist "$PREV_DIR/dist"
  log "snapshot saved: $PREV_DIR"
fi

# ---------- 3. 更新代码 ----------
TARGET="${1:-origin/$BRANCH}"
log "fetching origin"
git fetch --prune origin || fail "git fetch 失败（检查服务器到 GitHub 的网络）"
git rev-parse --verify "$TARGET^{commit}" >/dev/null 2>&1 || fail "目标版本不存在: $TARGET"
NEW_SHA=$(git rev-parse "$TARGET^{commit}")
log "target: $TARGET -> $NEW_SHA"

git reset --hard "$NEW_SHA" || fail "git reset 失败"

# ---------- 4. 依赖 ----------
if git diff --quiet "$PREV_SHA" "$NEW_SHA" -- pnpm-lock.yaml 2>/dev/null; then
  log "lockfile unchanged, skip pnpm install"
else
  log "lockfile changed, running pnpm install"
  pnpm install --frozen-lockfile || fail "pnpm install 失败"
fi

# ---------- 5. 构建 ----------
log "building (this takes a few minutes)"
if ! pnpm run build; then
  log "build failed, rolling back to $PREV_SHA"
  git reset --hard "$PREV_SHA" || true
  fail "构建失败，代码已回退到 $PREV_SHA（构建产物未改动，服务仍是旧版本）"
fi

# ---------- 6. 重启 ----------
log "restarting $SERVICE"
systemctl restart "$SERVICE"
sleep 6
systemctl is-active --quiet "$SERVICE" || fail "服务未能启动"

# ---------- 7. 验收 ----------
if [ "${SKIP_SMOKE:-0}" != "1" ]; then
  HEALTH=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SITE/api/health" || echo 000)
  LOGIN_FORM=$(curl -s --max-time 20 "$SITE/admin/login" | grep -c '运营后台登录' || true)
  ADMIN_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SITE/admin" || echo 000)
  AUTH_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SITE/api/admin/analytics?range=7d" || echo 000)
  log "smoke: health=$HEALTH login_form=$LOGIN_FORM admin=$ADMIN_CODE analytics_unauth=$AUTH_CODE"

  [ "$HEALTH" = "200" ]      || fail "健康检查失败 (health=$HEALTH)"
  [ "$LOGIN_FORM" -ge 1 ]    || fail "登录页没有服务端渲染的表单（login_form=$LOGIN_FORM）"
  [ "$ADMIN_CODE" = "307" ]  || fail "未登录 /admin 应 307，实际 $ADMIN_CODE"
  [ "$AUTH_CODE" = "401" ]   || fail "未登录统计接口应 401，实际 $AUTH_CODE"

  ERRORS=$(journalctl -u "$SERVICE" --since '1 minute ago' --no-pager 2>/dev/null | grep -Ei 'unhandled|uncaught|Cannot find module' | head -5 || true)
  [ -z "$ERRORS" ] || fail "启动后出现未捕获异常：
$ERRORS"
fi

# ---------- 8. 清理 ----------
mkdir -p "$RELEASES"
NEW_DIR="$RELEASES/$NEW_SHA"
if [ ! -d "$NEW_DIR" ]; then
  mkdir -p "$NEW_DIR"
  cp -a dist "$NEW_DIR/dist"
  cp -a .next "$NEW_DIR/.next"
fi
ls -1dt "$RELEASES"/* 2>/dev/null | tail -n +$((KEEP_RELEASES + 1)) | xargs -r rm -rf

log "OK  $PREV_SHA -> $NEW_SHA"
log "rollback: sudo liorvix-rollback $PREV_SHA"