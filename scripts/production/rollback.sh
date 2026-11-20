#!/usr/bin/env bash
#
# liorvix 生产回滚脚本（在服务器上执行）
#
# 用法：
#   sudo /usr/local/bin/liorvix-rollback <commit|tag>
#   sudo /usr/local/bin/liorvix-rollback --list      # 查看可回滚的构建快照
#
# 优先使用 releases/<sha>/ 里的构建产物（秒级回滚）；
# 找不到快照时才重新构建。
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/liorvix}"
SERVICE="liorvix.service"
SITE="http://127.0.0.1:5000"
RELEASES="$APP_DIR/releases"

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

if [ "${1:-}" = "--list" ]; then
  echo "可回滚快照（$RELEASES）："
  ls -1dt "$RELEASES"/* 2>/dev/null || echo "  (无)"
  exit 0
fi

TARGET="${1:-}"
[ -n "$TARGET" ] || { echo "用法: liorvix-rollback <commit|tag> | --list" >&2; exit 2; }

cd "$APP_DIR"
[ -d .git ] || { echo "$APP_DIR 不是 git 仓库" >&2; exit 1; }

git rev-parse --verify "$TARGET^{commit}" >/dev/null 2>&1 || {
  echo "目标版本不存在: $TARGET" >&2
  exit 1
}
SHA=$(git rev-parse "$TARGET^{commit}")
log "rolling back to $SHA"

git reset --hard "$SHA"

SNAP="$RELEASES/$SHA"
if [ -d "$SNAP/.next" ] && [ -d "$SNAP/dist" ]; then
  log "using snapshot $SNAP (no rebuild)"
  rm -rf .next dist
  cp -a "$SNAP/.next" .next
  cp -a "$SNAP/dist" dist
else
  log "no snapshot, rebuilding"
  pnpm run build
fi

systemctl restart "$SERVICE"
sleep 6
systemctl is-active --quiet "$SERVICE" || { echo "服务未能启动" >&2; exit 1; }

HEALTH=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SITE/api/health" || echo 000)
log "health=$HEALTH"
[ "$HEALTH" = "200" ] || { echo "回滚后健康检查失败" >&2; exit 1; }
log "rollback OK -> $SHA"