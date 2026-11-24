#!/usr/bin/env bash
# 自托管栈健康巡检：一次性检查容器 / HTTP / 磁盘 / 数据库 / 备份新鲜度。
#
#   bash scripts/migrate/healthcheck.sh            # 人读输出，异常退出 1
#   bash scripts/migrate/healthcheck.sh --quiet    # 只在异常时输出（给 timer 用）
#   ALERT_WEBHOOK_URL=https://... bash ...         # 异常时 POST 一条 JSON
#
# 设计：不依赖 docker inspect 的 exit code（版本差异大），只解析 `docker ps` 的 Status 文本；
# 任何一项失败都继续跑完，最后统一汇总，避免"第一个错就停"掩盖其它问题。
set -uo pipefail

QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1

SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase}"
COMPOSE="docker compose -f ${SUPABASE_DIR}/docker-compose.yml --env-file ${SUPABASE_DIR}/.env"
BACKUP_DIR="${BACKUP_DIR:-/opt/liorvix-backups}"
APP_HEALTH_URL="${APP_HEALTH_URL:-http://127.0.0.1:5000/api/health}"
DISK_THRESHOLD="${DISK_THRESHOLD:-85}"
BACKUP_MAX_AGE_H="${BACKUP_MAX_AGE_H:-36}"

FAIL=0
declare -a ISSUES=()

note() { [ "$QUIET" = "1" ] || printf '%s\n' "$*"; }
bad()  { FAIL=$((FAIL+1)); ISSUES+=("$*"); printf '[FAIL] %s\n' "$*" >&2; }
good() { note "  [ok] $*"; }

http_code() { curl -sS -o /dev/null -m 8 -w '%{http_code}' "$1" 2>/dev/null || echo 000; }

note "=== Liorvix 自托管健康巡检 $(date '+%F %T') ==="

note "[1] 容器"
STATUS="$(docker ps -a --filter 'name=liorvix-supabase' --format '{{.Names}}\t{{.Status}}' 2>/dev/null)"
if [ -z "$STATUS" ]; then
  bad "docker 里找不到 liorvix-supabase-* 容器"
else
  while IFS=$'\t' read -r name status; do
    case "$status" in
      *unhealthy*|*Restarting*|*Exited*|*Dead*) bad "容器 ${name}: ${status}" ;;
      *healthy*) good "${name}: healthy" ;;
      *"Up "*)   good "${name}: ${status}" ;;
      *)         bad "容器 ${name}: ${status}" ;;
    esac
  done <<< "$STATUS"
  COUNT=$(printf '%s\n' "$STATUS" | wc -l | tr -d ' ')
  [ "$COUNT" -ge 5 ] || bad "容器数量 ${COUNT} < 5（db/auth/rest/storage/imgproxy）"
fi

note "[2] HTTP 端点"
for spec in "http://127.0.0.1:9999/health|auth" "http://127.0.0.1:3000/|rest" "http://127.0.0.1:5100/status|storage" "${APP_HEALTH_URL}|app"; do
  url="${spec%%|*}"; label="${spec##*|}"
  code="$(http_code "$url")"
  [ "$code" = "200" ] && good "${label} ${url} -> 200" || bad "${label} ${url} -> ${code}"
done

note "[3] 磁盘"
while read -r pct mount; do
  pct="${pct%\%}"
  if [ "${pct:-0}" -ge "$DISK_THRESHOLD" ]; then
    bad "磁盘 ${mount} 使用率 ${pct}%（阈值 ${DISK_THRESHOLD}%）"
  else
    good "磁盘 ${mount} ${pct}%"
  fi
done < <(df -P / /opt 2>/dev/null | awk 'NR>1 {print $5, $6}' | sort -u)

note "[4] 数据库"
DB_Q=$($COMPOSE exec -T db psql -U supabase_admin -h 127.0.0.1 -d postgres -tAc "
  select 'conns=' || (select count(*) from pg_stat_activity where datname='postgres')
      || ' maxconn=' || (select setting from pg_settings where name='max_connections')
      || ' longxact=' || (select count(*) from pg_stat_activity
                           where state='active' and now()-xact_start > interval '5 minutes')
      || ' size=' || pg_size_pretty(pg_database_size('postgres'))" 2>/dev/null)
if [ -z "$DB_Q" ]; then
  bad "连不上数据库（docker compose exec db psql 失败）"
else
  good "$DB_Q"
  LONG=$(printf '%s' "$DB_Q" | sed -n 's/.*longxact=\([0-9]*\).*/\1/p')
  CONNS=$(printf '%s' "$DB_Q" | sed -n 's/.*conns=\([0-9]*\).*/\1/p')
  MAXC=$(printf '%s' "$DB_Q" | sed -n 's/.*maxconn=\([0-9]*\).*/\1/p')
  [ "${LONG:-0}" -eq 0 ] || bad "有 ${LONG} 个超过 5 分钟的活动事务"
  if [ -n "${CONNS:-}" ] && [ -n "${MAXC:-}" ] && [ "$MAXC" -gt 0 ]; then
    PCT=$(( CONNS * 100 / MAXC ))
    [ "$PCT" -ge 80 ] && bad "连接数 ${CONNS}/${MAXC}（${PCT}%）" || good "连接数 ${CONNS}/${MAXC}"
  fi
fi

note "[5] 备份新鲜度"
NEWEST=$(ls -1t "${BACKUP_DIR}"/liorvix-*.dump 2>/dev/null | head -1)
if [ -z "$NEWEST" ]; then
  bad "${BACKUP_DIR} 里没有 liorvix-*.dump"
else
  AGE_H=$(( ( $(date +%s) - $(stat -c %Y "$NEWEST") ) / 3600 ))
  if [ "$AGE_H" -gt "$BACKUP_MAX_AGE_H" ]; then
    bad "最近备份已 ${AGE_H} 小时（阈值 ${BACKUP_MAX_AGE_H}h）：$(basename "$NEWEST")"
  else
    good "最近备份 ${AGE_H} 小时前：$(basename "$NEWEST") $(du -h "$NEWEST" | cut -f1)"
  fi
fi

if [ "$FAIL" -gt 0 ]; then
  MSG="Liorvix 健康巡检 ${FAIL} 项异常：$(printf '%s; ' "${ISSUES[@]}")"
  printf '%s\n' "$MSG"
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    # 尽量通用：Telegram Bot API 用 {text}，Slack/自建 webhook 也用 text 字段
    curl -sS -m 10 -X POST "$ALERT_WEBHOOK_URL" -H 'content-type: application/json' \
      -d "$(printf '{"text":"%s"}' "$(printf '%s' "$MSG" | sed 's/"/\\"/g')")" >/dev/null 2>&1 || true
  fi
  exit 1
fi
note "=== 全部正常 ==="