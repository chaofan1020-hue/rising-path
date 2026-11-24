#!/usr/bin/env bash
# Liorvix 全栈巡检 + 邮件告警。
#
# 与 scripts/migrate/healthcheck.sh 的分工：
#   * healthcheck.sh  = 基础设施体检（容器 / 端口 / 磁盘 / 连接数 / 备份新鲜度），只返回退出码，
#                       没人盯着看就等于没有；
#   * health-alert.sh = 在它之上补"用户可见"的指标（公网可达、岗位同步是否还在动、5xx 比例、
#                       证书剩余天数、恢复演练报告是否过期），并把异常真的发到邮箱。
#
# 防轰炸：状态写在 /var/lib/liorvix-monitor/state.json。
#   * 正常 → 异常：立刻发告警；
#   * 持续异常：每 ALERT_REMINDER_SEC（默认 3600 秒）提醒一次；
#   * 异常 → 正常：发恢复通知（附持续时长）。
#
# 用法：
#   bash scripts/monitor/health-alert.sh              # 人读输出
#   bash scripts/monitor/health-alert.sh --quiet      # 给 systemd timer 用（只打异常 + 一行小结）
#   bash scripts/monitor/health-alert.sh --dry-run    # 只检查、不发信（改阈值/调通道时用）
#   bash scripts/monitor/health-alert.sh --force-mail # 立即发一封"当前状态"邮件（验证通道）
set -uo pipefail

QUIET=0
DRY_RUN=0
FORCE_MAIL=0
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --force-mail) FORCE_MAIL=1 ;;
    --help|-h) sed -n '2,20p' "$0"; exit 0 ;;
    *) printf 'unknown argument: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

REPO_ROOT="${REPO_ROOT:-/opt/liorvix}"
BACKUP_DIR="${BACKUP_DIR:-/opt/liorvix-backups}"
DRILL_DIR="${DRILL_DIR:-${BACKUP_DIR}/drills}"
STATE_DIR="${STATE_DIR:-/var/lib/liorvix-monitor}"
STATE_FILE="${STATE_FILE:-${STATE_DIR}/state.json}"
MAILER="${MAILER:-${REPO_ROOT}/scripts/monitor/send-mail.py}"
BASE_HEALTHCHECK="${BASE_HEALTHCHECK:-${REPO_ROOT}/scripts/migrate/healthcheck.sh}"

DB_CONTAINER="${DB_CONTAINER:-liorvix-supabase-db}"
DB_USER="${DB_USER:-supabase_admin}"
APP_PUBLIC_HEALTH="${APP_PUBLIC_HEALTH:-https://liorvix.com/api/health}"
AUTH_PUBLIC_HEALTH="${AUTH_PUBLIC_HEALTH:-https://supabase.liorvix.com/auth/v1/health}"

WORKER_MAX_MIN="${WORKER_MAX_MIN:-45}"     # 同步进程多久没跑就算死
WORKER_WARN_MIN="${WORKER_WARN_MIN:-20}"
WRITE_MAX_MIN="${WRITE_MAX_MIN:-180}"      # 岗位数据多久没被写入就算停更
WRITE_WARN_MIN="${WRITE_WARN_MIN:-90}"
TLS_FAIL_DAYS="${TLS_FAIL_DAYS:-14}"
TLS_WARN_DAYS="${TLS_WARN_DAYS:-30}"
DRILL_MAX_DAYS="${DRILL_MAX_DAYS:-120}"
DRILL_WARN_DAYS="${DRILL_WARN_DAYS:-60}"
ALERT_REMINDER_SEC="${ALERT_REMINDER_SEC:-3600}"

APP_ACCESS_LOG="${APP_ACCESS_LOG:-/var/log/nginx/access.log}"
SUPABASE_ACCESS_LOG="${SUPABASE_ACCESS_LOG:-/var/log/nginx/supabase.access.log}"

# 外部拨测（cron-job.org）新鲜度：它的探测会出现在 nginx 访问日志里，UA 含 "cron-job.org"。
# 若哪天它的作业被禁用/删除，站点本身还是好的，但"整机失联"这一层就静默失效了——这里兜住。
EXTERNAL_PROBE_UA="${EXTERNAL_PROBE_UA:-cron-job.org}"
EXTERNAL_PROBE_WARN_MIN="${EXTERNAL_PROBE_WARN_MIN:-25}"
EXTERNAL_PROBE_FAIL_MIN="${EXTERNAL_PROBE_FAIL_MIN:-50}"

FAILS=()
WARNS=()
NOTES=()

fail() { FAILS+=("$*"); printf '[FAIL] %s\n' "$*" >&2; }
warn() { WARNS+=("$*"); printf '[WARN] %s\n' "$*" >&2; }
note() { NOTES+=("$*"); [ "$QUIET" = "1" ] || printf '  %s\n' "$*"; }
section() { [ "$QUIET" = "1" ] || printf '%s\n' "$*"; }

http_code() {
  local code
  code=$(curl -sS -o /dev/null -m 10 -w '%{http_code}' "$1" 2>/dev/null || true)
  printf '%s' "${code:-000}"
}

check_public_http() {
  local url="$1" label="$2" code attempt
  for attempt in 1 2; do
    code=$(http_code "$url")
    [ "$code" = "200" ] && { note "${label} ${url} -> 200"; return 0; }
    [ "$attempt" = "1" ] && sleep 3
  done
  fail "${label}公网不可用：${url} -> ${code}"
}

dbq() {
  docker exec "$DB_CONTAINER" psql -U "$DB_USER" -h 127.0.0.1 -d postgres -tAc "$1" 2>/dev/null | tr -d '\r\n'
}

num_or_minus_one() {
  case "$1" in
    ''|*[!0-9-]*) printf -- '-1' ;;
    *) printf '%s' "$1" ;;
  esac
}

count_window_status() {
  # $1=日志文件。输出 "错误数 总数"（最近 10 分钟）
  local file="$1"
  [ -r "$file" ] || { printf '0 0'; return; }
  local since
  since=$(date -d '-10 min' '+%d/%b/%Y:%H:%M:%S')
  tail -n 20000 "$file" 2>/dev/null | awk -v s="$since" '
    {
      ts = $4; sub(/^\[/, "", ts)
      if (length(ts) >= 20) ts = substr(ts, 1, 20)
      if (ts >= s) {
        total++
        if (substr($9, 1, 1) == "5") err++
      }
    }
    END { printf "%d %d", err + 0, total + 0 }'
}

external_probe_age_min() {
  # 最近一次外部拨测（cron-job.org）命中访问日志距今多少分钟；一条都没有输出 -1
  local newest=-1 file ts y mon d h mi s epoch months
  months="Jan:01 Feb:02 Mar:03 Apr:04 May:05 Jun:06 Jul:07 Aug:08 Sep:09 Oct:10 Nov:11 Dec:12"
  for file in "$APP_ACCESS_LOG" "$SUPABASE_ACCESS_LOG"; do
    [ -r "$file" ] || continue
    ts=$(tail -n 4000 "$file" 2>/dev/null | grep -F "$EXTERNAL_PROBE_UA" | tail -n 1 | awk '{print $4}')
    [ -n "$ts" ] || continue
    ts=${ts#\[}
    ts=${ts%% *}                       # 24/Nov/2026:14:09:46
    local datepart=${ts%%:*} timepart=${ts#*:}
    d=${datepart%%/*}                  # 24
    mon=${datepart#*/}; mon=${mon%%/*} # Nov
    y=${datepart##*/}                  # 2026
    h=${timepart%%:*}                  # 14
    mi=${timepart#*:}; mi=${mi%%:*}    # 09
    s=${timepart##*:}                  # 46
    for pair in $months; do
      [ "${pair%%:*}" = "$mon" ] && mon=${pair##*:}
    done
    epoch=$(date -d "${y}-${mon}-${d} ${h}:${mi}:${s}" +%s 2>/dev/null) || continue
    [ "$epoch" -gt "$newest" ] && newest=$epoch
  done
  if [ "$newest" -lt 0 ]; then
    printf -- '-1'
  else
    printf '%s' $(( ( $(date +%s) - newest ) / 60 ))
  fi
}

cert_days() {
  # 输出证书剩余天数；取不到输出空
  local host="$1" end end_epoch
  end=$(echo | timeout 12 openssl s_client -servername "$host" -connect "${host}:443" -verify_hostname "$host" 2>/dev/null \
        | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  [ -n "$end" ] || return 0
  end_epoch=$(date -d "$end" +%s 2>/dev/null) || return 0
  printf '%s' $(( (end_epoch - $(date +%s)) / 86400 ))
}

mkdir -p "$STATE_DIR"

section "=== Liorvix 巡检 $(date '+%F %T %Z') ==="

section "[1] 基础设施（healthcheck.sh）"
BASE_OUT=$(bash "$BASE_HEALTHCHECK" --quiet 2>&1)
BASE_RC=$?
if [ "$BASE_RC" -ne 0 ]; then
  while IFS= read -r line; do
    [ -n "$line" ] && fail "基础设施：${line#\[FAIL\] }"
  done <<< "$BASE_OUT"
else
  note "容器 / 端口 / 磁盘 / 数据库 / 备份新鲜度 全部正常"
fi

section "[2] 公网可达性（经 Cloudflare → nginx → 应用）"
check_public_http "$APP_PUBLIC_HEALTH" "应用健康"
check_public_http "$AUTH_PUBLIC_HEALTH" "认证服务"

section "[3] 岗位同步"
RUN_AGE=$(num_or_minus_one "$(dbq "select coalesce(round(extract(epoch from (now() - max(created_at))) / 60)::int, -1) from public.job_sync_runs")")
FAILED_1H=$(num_or_minus_one "$(dbq "select count(*) from public.job_sync_runs where created_at > now() - interval '1 hour' and status = 'failed'")")
TOTAL_1H=$(num_or_minus_one "$(dbq "select count(*) from public.job_sync_runs where created_at > now() - interval '1 hour'")")
if [ "$RUN_AGE" -lt 0 ]; then
  fail "同步进程从未运行（job_sync_runs 为空）"
elif [ "$RUN_AGE" -gt "$WORKER_MAX_MIN" ]; then
  fail "同步进程已 ${RUN_AGE} 分钟没有新运行（阈值 ${WORKER_MAX_MIN} 分钟）"
elif [ "$RUN_AGE" -gt "$WORKER_WARN_MIN" ]; then
  warn "同步进程 ${RUN_AGE} 分钟未运行（阈值 ${WORKER_WARN_MIN} 分钟）"
else
  note "同步进程 ${RUN_AGE} 分钟前还在跑（近 1h 共 ${TOTAL_1H} 次运行）"
fi
if [ "$FAILED_1H" -ge 5 ]; then
  fail "近 1 小时有 ${FAILED_1H} 次同步运行失败"
elif [ "$FAILED_1H" -gt 0 ]; then
  warn "近 1 小时有 ${FAILED_1H} 次同步运行失败"
fi

section "[4] 岗位数据写入新鲜度"
WRITE_AGE=$(num_or_minus_one "$(dbq "select coalesce(round(extract(epoch from (now() - max(updated_at))) / 60)::int, -1) from public.jobs")")
if [ "$WRITE_AGE" -lt 0 ]; then
  fail "读不到 jobs 表更新时间"
elif [ "$WRITE_AGE" -gt "$WRITE_MAX_MIN" ]; then
  fail "岗位数据已 ${WRITE_AGE} 分钟未更新（阈值 ${WRITE_MAX_MIN} 分钟）"
elif [ "$WRITE_AGE" -gt "$WRITE_WARN_MIN" ]; then
  warn "岗位数据 ${WRITE_AGE} 分钟未更新"
else
  note "岗位数据 ${WRITE_AGE} 分钟前更新过"
fi

section "[5] 近 10 分钟 HTTP 5xx"
read -r APP_ERR APP_TOTAL <<< "$(count_window_status "$APP_ACCESS_LOG")"
if [ "${APP_TOTAL:-0}" -gt 0 ]; then
  APP_RATE=$(( APP_ERR * 100 / APP_TOTAL ))
  if [ "$APP_ERR" -ge 5 ] || { [ "$APP_TOTAL" -ge 100 ] && [ "$APP_RATE" -gt 2 ]; }; then
    fail "应用 5xx ${APP_ERR}/${APP_TOTAL}（${APP_RATE}%）"
  elif [ "$APP_ERR" -gt 0 ]; then
    warn "应用 5xx ${APP_ERR}/${APP_TOTAL}（${APP_RATE}%）"
  else
    note "应用 0 条 5xx（${APP_TOTAL} 次请求）"
  fi
else
  warn "近 10 分钟应用访问日志没有请求（${APP_ACCESS_LOG}），可能没有流量或日志未写"
fi
read -r SUPA_ERR SUPA_TOTAL <<< "$(count_window_status "$SUPABASE_ACCESS_LOG")"
if [ "${SUPA_TOTAL:-0}" -gt 0 ]; then
  if [ "$SUPA_ERR" -ge 30 ]; then
    fail "Supabase 网关 5xx ${SUPA_ERR}/${SUPA_TOTAL}"
  elif [ "$SUPA_ERR" -ge 5 ]; then
    warn "Supabase 网关 5xx ${SUPA_ERR}/${SUPA_TOTAL}"
  else
    note "Supabase 网关 0 条 5xx（${SUPA_TOTAL} 次请求）"
  fi
else
  note "Supabase 网关近 10 分钟无请求（正常，客户端直连发起的写入很少）"
fi

section "[6] TLS 证书"
for host in liorvix.com supabase.liorvix.com; do
  DAYS=$(cert_days "$host")
  if [ -z "$DAYS" ]; then
    warn "读取 ${host} 证书失败（不影响服务，可能是网络抖动）"
  elif [ "$DAYS" -lt "$TLS_FAIL_DAYS" ]; then
    fail "${host} 证书仅剩 ${DAYS} 天，即将过期"
  elif [ "$DAYS" -lt "$TLS_WARN_DAYS" ]; then
    warn "${host} 证书剩 ${DAYS} 天"
  else
    note "${host} 证书剩 ${DAYS} 天"
  fi
done

section "[7] 恢复演练报告"
NEWEST_DRILL=$(ls -1t "${DRILL_DIR}"/*.json 2>/dev/null | head -1)
if [ -z "$NEWEST_DRILL" ]; then
  warn "还没有恢复演练报告（${DRILL_DIR}），建议手动跑一次 scripts/migrate/restore-drill.sh"
else
  DRILL_AGE_D=$(( ( $(date +%s) - $(stat -c %Y "$NEWEST_DRILL") ) / 86400 ))
  if [ "$DRILL_AGE_D" -gt "$DRILL_MAX_DAYS" ]; then
    fail "最近一次恢复演练在 ${DRILL_AGE_D} 天前（阈值 ${DRILL_MAX_DAYS} 天）"
  elif [ "$DRILL_AGE_D" -gt "$DRILL_WARN_DAYS" ]; then
    warn "最近一次恢复演练在 ${DRILL_AGE_D} 天前"
  else
    note "最近恢复演练 ${DRILL_AGE_D} 天前：$(basename "$NEWEST_DRILL")"
  fi
fi

section "[8] 外部拨测新鲜度（cron-job.org）"
PROBE_AGE=$(external_probe_age_min)
if [ "$PROBE_AGE" -lt 0 ]; then
  fail "访问日志里找不到任何 cron-job.org 探测记录（外部拨测可能已被禁用/删除）"
elif [ "$PROBE_AGE" -gt "$EXTERNAL_PROBE_FAIL_MIN" ]; then
  fail "外部拨测已 ${PROBE_AGE} 分钟没有新记录（阈值 ${EXTERNAL_PROBE_FAIL_MIN} 分钟），去 cron-job.org 控制台看两条作业是否被禁用"
elif [ "$PROBE_AGE" -gt "$EXTERNAL_PROBE_WARN_MIN" ]; then
  warn "外部拨测 ${PROBE_AGE} 分钟没有新记录（阈值 ${EXTERNAL_PROBE_WARN_MIN} 分钟）"
else
  note "外部拨测 ${PROBE_AGE} 分钟前还在打（cron-job.org，10 分钟一次）"
fi
# ---- 状态机与发信 ----
STATUS="ok"
[ "${#FAILS[@]}" -gt 0 ] && STATUS="fail"

NOW=$(date +%s)
PREV_STATUS="ok"
PREV_FIRST_FAIL=0
PREV_LAST_ALERT=0
if [ -r "$STATE_FILE" ]; then
  PREV_STATUS=$(jq -r '.status // "ok"' "$STATE_FILE" 2>/dev/null || printf 'ok')
  PREV_FIRST_FAIL=$(jq -r '.first_fail_epoch // 0' "$STATE_FILE" 2>/dev/null || printf '0')
  PREV_LAST_ALERT=$(jq -r '.last_alert_epoch // 0' "$STATE_FILE" 2>/dev/null || printf '0')
fi
case "$PREV_FIRST_FAIL" in ''|*[!0-9]*) PREV_FIRST_FAIL=0 ;; esac
case "$PREV_LAST_ALERT" in ''|*[!0-9]*) PREV_LAST_ALERT=0 ;; esac
case "$PREV_STATUS" in ok|fail) ;; *) PREV_STATUS="ok" ;; esac

FIRST_FAIL=0
[ "$STATUS" = "fail" ] && FIRST_FAIL=$([ "$PREV_STATUS" = "fail" ] && printf '%s' "$PREV_FIRST_FAIL" || printf '%s' "$NOW")

MAIL_KIND=""
if [ "$FORCE_MAIL" = "1" ]; then
  MAIL_KIND="forced"
elif [ "$STATUS" = "fail" ] && [ "$PREV_STATUS" != "fail" ]; then
  MAIL_KIND="alert"
elif [ "$STATUS" = "fail" ] && [ $(( NOW - PREV_LAST_ALERT )) -ge "$ALERT_REMINDER_SEC" ]; then
  MAIL_KIND="reminder"
elif [ "$STATUS" = "ok" ] && [ "$PREV_STATUS" = "fail" ]; then
  MAIL_KIND="recovery"
fi


section "[9] 结论"
if [ "$STATUS" = "ok" ]; then
  printf '  OK：0 项失败，%d 项提醒\n' "${#WARNS[@]}"
else
  printf '  FAIL：%d 项失败，%d 项提醒\n' "${#FAILS[@]}" "${#WARNS[@]}"
fi

LAST_ALERT="$PREV_LAST_ALERT"
if [ -n "$MAIL_KIND" ]; then
  BODY_FILE=$(mktemp /tmp/liorvix-alert-XXXXXX.txt)
  {
    printf 'Liorvix 巡检报告\n'
    printf '时间：%s\n' "$(date '+%F %T %Z')"
    printf '主机：%s\n' "$(hostname)"
    printf '结论：%s\n' "$([ "$STATUS" = "ok" ] && printf '正常' || printf '异常（%d 项）' "${#FAILS[@]}")"
    printf '触发：%s\n' "$MAIL_KIND"
    if [ "${#FAILS[@]}" -gt 0 ]; then
      printf '\n【失败项】\n'
      for item in "${FAILS[@]}"; do printf '  - %s\n' "$item"; done
    fi
    if [ "${#WARNS[@]}" -gt 0 ]; then
      printf '\n【提醒项】\n'
      for item in "${WARNS[@]}"; do printf '  - %s\n' "$item"; done
    fi
    printf '\n【关键指标】\n'
    printf '  - 同步进程最后运行：%s 分钟前（近 1h 失败 %s 次 / 共 %s 次）\n' "$RUN_AGE" "$FAILED_1H" "$TOTAL_1H"
    printf '  - 岗位数据最后更新：%s 分钟前\n' "$WRITE_AGE"
    printf '  - 近 10 分钟 5xx：应用 %s/%s，Supabase 网关 %s/%s\n' "$APP_ERR" "$APP_TOTAL" "$SUPA_ERR" "$SUPA_TOTAL"
    printf '  - 外部拨测（cron-job.org）：%s\n' "$([ "${PROBE_AGE:-0}" -lt 0 ] && printf '日志中无记录' || printf '%s 分钟前' "$PROBE_AGE")"
    printf '\n【排查入口】\n'
    printf '  - 人读巡检：bash %s\n' "$0"
    printf '  - 应用状态：systemctl status liorvix；日志：journalctl -u liorvix -n 200\n'
    printf '  - 自托管栈：docker ps --filter name=liorvix-supabase；日志：docker logs --since 30m liorvix-supabase-auth\n'
    printf '  - 迁移与回滚：docs/supabase-selfhost-migration-plan.md\n'
    if [ "$STATUS" = "fail" ]; then
      printf '\n持续异常期间每小时提醒一次；恢复后会自动再发一封恢复通知。\n'
    else
      printf '\n服务已恢复。\n'
    fi
  } > "$BODY_FILE"

  case "$MAIL_KIND" in
    alert) SUBJECT="告警：${#FAILS[@]} 项异常（$(printf '%s；' "${FAILS[@]:0:2}" | cut -c1-80)…）" ;;
    reminder) SUBJECT="仍未恢复：${#FAILS[@]} 项异常持续中" ;;
    recovery) SUBJECT="已恢复：巡检全部通过" ;;
    *) SUBJECT="状态报告：$([ "$STATUS" = "ok" ] && printf '正常' || printf '%d 项异常' "${#FAILS[@]}")" ;;
  esac

  if [ "$DRY_RUN" = "1" ]; then
    printf '  （dry-run）将发送邮件：%s\n' "$SUBJECT"
    printf '  （dry-run）正文前 3 行：\n'
    sed -n '1,3p' "$BODY_FILE" | sed 's/^/    /'
  else
    if python3 "$MAILER" --subject "$SUBJECT" --body-file "$BODY_FILE"; then
      LAST_ALERT="$NOW"
    else
      printf '[WARN] 告警邮件发送失败，邮件正文保留在 %s\n' "$BODY_FILE" >&2
      BODY_FILE=""
    fi
  fi
  [ -n "${BODY_FILE:-}" ] && rm -f "$BODY_FILE"
else
  [ "$STATUS" = "fail" ] && section "  （${ALERT_REMINDER_SEC} 秒内已发过告警，本次不再重复发送）"
fi

FAILS_JSON=$(printf '%s\n' "${FAILS[@]}" | jq -R -s 'split("\n") | map(select(length > 0))')
WARNS_JSON=$(printf '%s\n' "${WARNS[@]}" | jq -R -s 'split("\n") | map(select(length > 0))')

jq -n \
  --arg status "$STATUS" \
  --argjson fails "$FAILS_JSON" \
  --argjson warns "$WARNS_JSON" \
  --argjson first_fail "$FIRST_FAIL" \
  --argjson last_alert "$LAST_ALERT" \
  --argjson run_age "$RUN_AGE" \
  --argjson write_age "$WRITE_AGE" \
  --argjson failed_1h "$FAILED_1H" \
  --argjson app_5xx "$APP_ERR" \
  --argjson supa_5xx "$SUPA_ERR" \
  --argjson probe_age "$PROBE_AGE" \
  --arg checked_at "$(date -Iseconds)" \
  '{status:$status, failing:$fails, warning:$warns, first_fail_epoch:$first_fail,
    last_alert_epoch:$last_alert, metrics:{worker_age_min:$run_age, write_age_min:$write_age,
    failed_runs_1h:$failed_1h, app_5xx_10m:$app_5xx, supabase_5xx_10m:$supa_5xx,
    external_probe_age_min:$probe_age},
    checked_at:$checked_at}' > "${STATE_FILE}.tmp" 2>/dev/null \
  && mv -f "${STATE_FILE}.tmp" "$STATE_FILE"

[ "$STATUS" = "fail" ] && exit 1
exit 0