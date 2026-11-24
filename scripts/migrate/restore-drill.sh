#!/usr/bin/env bash
# 备份恢复演练（月度）：把最新 dump 恢复到临时库，逐项比对生产，再删掉临时库，出报告并发信。
#
# 为什么要有这个脚本：
#   * 备份"看起来成功"和"真能恢复"是两件事。db-backup.sh 只保证 dump 可读（pg_restore -l），
#     不保证恢复后数据/权限/RLS 是对的；
#   * 2026-11-23 的真实切流踩过"重复恢复被依赖挡住"的坑（计划 §5.2），这里每月把那条路再走一遍。
#
# 安全边界（重要）：
#   * 永远只写 **临时库** liorvix_drill_<时间戳>，绝不碰 postgres 库；
#   * 结束/失败/被打断都会 DROP 掉临时库（trap EXIT），并顺手清理历史遗留的演练库；
#   * 只读生产库做"数量对照"，不写生产。
#
# 用法：
#   bash scripts/migrate/restore-drill.sh                 # 跑一次完整演练
#   DUMP_FILE=/path/to/x.dump bash scripts/migrate/restore-drill.sh   # 指定 dump
#   KEEP_DRILL_DB=1 bash ...       # 失败后保留临时库供排查（默认删）
#   NO_MAIL=1 bash ...             # 不发邮件
set -uo pipefail

REPO_ROOT="${REPO_ROOT:-/opt/liorvix}"
BACKUP_DIR="${BACKUP_DIR:-/opt/liorvix-backups}"
DRILL_DIR="${DRILL_DIR:-${BACKUP_DIR}/drills}"
MAILER="${MAILER:-${REPO_ROOT}/scripts/monitor/send-mail.py}"
BENIGN="${BENIGN:-${REPO_ROOT}/scripts/migrate/restore-benign-errors.txt}"

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
ADMIN_USER="${ADMIN_USER:-supabase_admin}"
LIVE_DB="${LIVE_DB:-postgres}"
KEEP_REPORTS="${KEEP_REPORTS:-12}"
KEEP_DRILL_DB="${KEEP_DRILL_DB:-0}"
NO_MAIL="${NO_MAIL:-0}"
DUMP_FILE="${DUMP_FILE:-}"

TS=$(date +%Y%m%d-%H%M%S)
DRILL_DB="liorvix_drill_${TS}"
WORK_DIR=$(mktemp -d "/tmp/liorvix-drill-${TS}.XXXXXX")
LOG="${WORK_DIR}/drill.log"
RESTORE_ERR="${WORK_DIR}/restore-errors.txt"
START_EPOCH=$(date +%s)
VERDICT="FAIL"
MAIL_SENT=0

log() { printf '[drill %s] %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOG"; }
die() { printf '[drill %s] ERROR: %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOG" >&2; exit 1; }

psql_db() {  # $1=database  $2=sql
  psql -X -q -h "$DB_HOST" -p "$DB_PORT" -U "$ADMIN_USER" -d "$1" -tAc "$2" 2>>"$LOG"
}

drop_drill_db() {
  local db="$1"
  [ -n "$db" ] || return 0
  psql -X -q -h "$DB_HOST" -p "$DB_PORT" -U "$ADMIN_USER" -d "$LIVE_DB" \
    -c "drop database if exists \"${db}\" with (force)" >>"$LOG" 2>&1 || true
}

cleanup_leftovers() {
  # 清理历史遗留的演练库（只匹配本脚本自己的命名，避免误删）
  local stale
  for stale in $(psql_db "$LIVE_DB" "select datname from pg_database where datname like 'liorvix_drill_%' or datname = 'liorvix_restore_drill'"); do
    [ -n "$stale" ] || continue
    [ "$stale" = "$DRILL_DB" ] && continue
    log "清理遗留演练库：${stale}"
    drop_drill_db "$stale"
  done
}

write_report() {
  local md="${DRILL_DIR}/restore-drill-${TS}.md"
  local json="${DRILL_DIR}/restore-drill-${TS}.json"
  local duration=$(( $(date +%s) - START_EPOCH ))
  {
    printf '# 备份恢复演练报告 %s\n\n' "$TS"
    printf -- '- 结论：**%s**\n' "$VERDICT"
    printf -- '- dump：`%s`（%s）\n' "$(basename "$DUMP_FILE")" "$(du -h "$DUMP_FILE" 2>/dev/null | cut -f1)"
    printf -- '- 临时库：`%s`（演练结束已删除）\n' "$DRILL_DB"
    printf -- '- 总耗时：%s 秒\n' "$duration"
    printf -- '- pg_restore 错误行：%s（其中非白名单：%s）\n\n' "${RESTORE_ERR_LINES:-0}" "${UNEXPECTED_ERR:-0}"
    printf '## 数据量对照\n\n| 表 | 演练恢复 | 生产当前 | 差值 |\n| --- | ---: | ---: | ---: |\n'
    local row table drill live delta
    for row in ${COUNT_ROWS:-}; do
      IFS='|' read -r table drill live <<< "$row"
      delta=$(( drill - live ))
      printf '| %s | %s | %s | %s |\n' "$table" "$drill" "$live" "$delta"
    done
    printf '\n## 保真性检查\n\n'
    printf '%s\n' "${CHECK_LINES:-（无）}" | sed 's/^/  - /'
    printf '\n## 恢复错误（非白名单）\n\n```\n%s\n```\n' "$(sed -n '1,40p' "$UNEXPECTED_ERR_FILE" 2>/dev/null)"
    printf '\n## 原始日志\n\n`%s`（已复制到 %s）\n' "$LOG" "${DRILL_DIR}/restore-drill-${TS}.log"
  } > "$md"
  cp -f "$LOG" "${DRILL_DIR}/restore-drill-${TS}.log" 2>/dev/null || true
  jq -n \
    --arg ts "$TS" \
    --arg verdict "$VERDICT" \
    --arg dump "$(basename "$DUMP_FILE")" \
    --argjson dump_bytes "$(stat -c %s "$DUMP_FILE" 2>/dev/null || echo 0)" \
    --argjson duration "$duration" \
    --argjson restore_errors "${RESTORE_ERR_LINES:-0}" \
    --argjson unexpected_errors "${UNEXPECTED_ERR:-0}" \
    --argjson counts "${COUNTS_JSON:-{\}}" \
    --arg report "$(basename "$md")" \
    '{ts:$ts, verdict:$verdict, dump:$dump, dump_bytes:$dump_bytes, duration_sec:$duration,
      restore_errors:$restore_errors, unexpected_errors:$unexpected_errors, counts:$counts,
      report:$report}' > "$json"
  # 只保留最近 KEEP_REPORTS 份
  ls -1t "${DRILL_DIR}"/restore-drill-*.md 2>/dev/null | tail -n +"$((KEEP_REPORTS + 1))" | while IFS= read -r old; do
    [ -n "$old" ] || continue
    rm -f "$old" "${old%.md}.json" "${old%.md}.log"
  done
  REPORT_MD="$md"
  REPORT_JSON="$json"
}

cleanup() {
  local rc=$?
  [ "$VERDICT" = "FAIL" ] && [ "$KEEP_DRILL_DB" = "1" ] && log "按要求保留临时库：${DRILL_DB}"
  if [ "$VERDICT" = "FAIL" ] && [ -f "$LOG" ] && [ -d "$DRILL_DIR" ]; then
    cp -f "$LOG" "${DRILL_DIR}/failure-${TS}.log" 2>/dev/null || true
  fi
  if [ "$VERDICT" = "FAIL" ] || [ "$KEEP_DRILL_DB" != "1" ]; then
    drop_drill_db "$DRILL_DB"
  fi
  rm -rf "$WORK_DIR" 2>/dev/null || true
  exit "$rc"
}
trap cleanup EXIT

command -v psql >/dev/null 2>&1 || die "psql 不存在"
command -v pg_restore >/dev/null 2>&1 || die "pg_restore 不存在"
mkdir -p "$DRILL_DIR"

if [ -z "$DUMP_FILE" ]; then
  DUMP_FILE=$(ls -1t "${BACKUP_DIR}"/liorvix-*.dump 2>/dev/null | head -1)
fi
[ -n "$DUMP_FILE" ] && [ -f "$DUMP_FILE" ] || die "${BACKUP_DIR} 里找不到 liorvix-*.dump"

log "dump: ${DUMP_FILE}（$(du -h "$DUMP_FILE" | cut -f1)）"

# 先清掉历史遗留的演练库（例如上次中断留下的 3 GB+ 临时库），再开始本次演练
cleanup_leftovers

TOC_COUNT=$(pg_restore -l "$DUMP_FILE" 2>/dev/null | grep -cE '^[0-9]+;' || true)
[ "${TOC_COUNT:-0}" -gt 100 ] || die "dump 不可读（TOC 条目 ${TOC_COUNT}）"
log "TOC 条目：${TOC_COUNT}"

log "创建临时库 ${DRILL_DB}"
psql -X -q -h "$DB_HOST" -p "$DB_PORT" -U "$ADMIN_USER" -d "$LIVE_DB" \
  -c "create database \"${DRILL_DB}\"" >>"$LOG" 2>&1 || die "建库失败（见 ${LOG}）"

PRE_SQL="${DUMP_FILE%.dump}.pre.sql"
if [ -f "$PRE_SQL" ]; then
  log "安装扩展（$(basename "$PRE_SQL")）"
  psql -X -q -h "$DB_HOST" -p "$DB_PORT" -U "$ADMIN_USER" -d "$DRILL_DB" -f "$PRE_SQL" >>"$LOG" 2>&1 \
    || die "扩展安装失败（见 ${LOG}）"
else
  log "WARN：没有 ${PRE_SQL}，尝试直接用 dump 里的对象（可能缺扩展）"
fi

log "生成恢复清单（过滤 public schema 与默认 ACL，与生产恢复口径一致）"
pg_restore -l "$DUMP_FILE" 2>/dev/null \
  | grep -vE '^[0-9]+; [0-9]+ [0-9]+ (SCHEMA - public |DEFAULT ACL)' > "${WORK_DIR}/restore.list" || true
FILTERED=$(grep -cE '^[0-9]+;' "${WORK_DIR}/restore.list" || true)
[ "${FILTERED:-0}" -gt 100 ] || die "过滤后的恢复清单异常（条目 ${FILTERED}）"
log "恢复清单条目：${FILTERED}"

log "开始 pg_restore（单线程，禁用触发器以避开同步维护逻辑）"
RESTORE_START=$(date +%s)
pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$ADMIN_USER" -d "$DRILL_DB" \
  -L "${WORK_DIR}/restore.list" --disable-triggers >/dev/null 2>"$RESTORE_ERR"
RESTORE_RC=$?
RESTORE_DURATION=$(( $(date +%s) - RESTORE_START ))
RESTORE_ERR_LINES=$(grep -cE '^pg_restore: error' "$RESTORE_ERR" 2>/dev/null || true)
[ "${RESTORE_ERR_LINES:-0}" -gt 0 ] || RESTORE_ERR_LINES=0
log "pg_restore 退出码 ${RESTORE_RC}，耗时 ${RESTORE_DURATION}s，错误行 ${RESTORE_ERR_LINES}"

if [ -s "$BENIGN" ]; then
  grep -E '^pg_restore: error' "$RESTORE_ERR" 2>/dev/null | grep -vFf "$BENIGN" > "${WORK_DIR}/unexpected-errors.txt" || true
else
  grep -E '^pg_restore: error' "$RESTORE_ERR" 2>/dev/null > "${WORK_DIR}/unexpected-errors.txt" || true
fi
UNEXPECTED_ERR=$(grep -c . "${WORK_DIR}/unexpected-errors.txt" 2>/dev/null || true)
[ "${UNEXPECTED_ERR:-0}" -gt 0 ] || UNEXPECTED_ERR=0
UNEXPECTED_ERR_FILE="${WORK_DIR}/unexpected-errors.txt"

# ---- 数据量对照 ----
log "比对数据量"
COUNT_ROWS=""
COUNTS_JSON="{"
check_count() {
  local table="$1" sql="$2" drill live critical="${3:-0}"
  drill=$(psql_db "$DRILL_DB" "$sql")
  live=$(psql_db "$LIVE_DB" "$sql")
  case "$drill" in ''|*[!0-9]*) drill=-1 ;; esac
  case "$live" in ''|*[!0-9]*) live=-1 ;; esac
  COUNT_ROWS="${COUNT_ROWS} ${table}|${drill}|${live}"
  COUNTS_JSON="${COUNTS_JSON}\"${table}\":{\"drill\":${drill},\"live\":${live}},"
  if [ "$drill" -lt 0 ]; then
    CHECK_LINES="${CHECK_LINES}${table}：演练库读取失败"$'\n'
    [ "$critical" = "1" ] && FAIL_DETAILS="${FAIL_DETAILS}${table} 在演练库不存在；"
  elif [ "$live" -gt 0 ] && [ "$drill" -gt "$live" ]; then
    CHECK_LINES="${CHECK_LINES}${table}：演练库 ${drill} > 生产 ${live}（异常）"$'\n'
    FAIL_DETAILS="${FAIL_DETAILS}${table} 恢复后比生产还多；"
  else
    CHECK_LINES="${CHECK_LINES}${table}：演练 ${drill} / 生产 ${live}"$'\n'
  fi
  [ "$critical" = "1" ] && [ "$drill" -le 0 ] && FAIL_DETAILS="${FAIL_DETAILS}${table} 恢复为空；"
}

CHECK_LINES=""
FAIL_DETAILS=""
check_count auth.users "select count(*) from auth.users" 1
check_count auth.identities "select count(*) from auth.identities" 1
check_count profiles "select count(*) from public.profiles" 1
check_count resumes "select count(*) from public.resumes" 1
check_count ai_matches "select count(*) from public.ai_matches" 1
check_count jobs "select count(*) from public.jobs" 1
check_count jobs_active "select count(*) from public.jobs where is_active" 1
check_count applications "select count(*) from public.applications"
check_count interview_sessions "select count(*) from public.interview_sessions"
check_count company_dna "select count(*) from public.company_dna"
COUNTS_JSON="${COUNTS_JSON%,}}"

# ---- 保真性检查 ----
log "保真性检查"
fidelity() {
  local name="$1" sql="$2" expected="$3"
  local value
  value=$(psql_db "$DRILL_DB" "$sql")
  case "$value" in ''|*[!0-9]*) value=-1 ;; esac
  if [ "$value" = "$expected" ]; then
    CHECK_LINES="${CHECK_LINES}${name}：${value}（符合预期）"$'\n'
  else
    CHECK_LINES="${CHECK_LINES}${name}：${value}（预期 ${expected}）"$'\n'
    FAIL_DETAILS="${FAIL_DETAILS}${name} 不符；"
  fi
}

fidelity "pg_trgm 在 public 下" \
  "select count(*) from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm' and n.nspname = 'public'" 1
fidelity "jobs 开启 RLS" \
  "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'jobs' and c.relrowsecurity" 1
fidelity "jobs 至少 1 条策略" \
  "select case when count(*) >= 1 then 1 else 0 end from pg_policies where schemaname = 'public' and tablename = 'jobs'" 1
fidelity "AI 选岗检索函数存在" \
  "select case when count(*) >= 1 then 1 else 0 end from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'search_ai_match_candidates_v7'" 1
fidelity "auth.users 属主为 supabase_auth_admin" \
  "select case when pg_get_userbyid(c.relowner) = 'supabase_auth_admin' then 1 else 0 end from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'auth' and c.relname = 'users'" 1

# ---- 判定 ----
if [ "$RESTORE_RC" -ne 0 ] && [ "$UNEXPECTED_ERR" -gt 0 ]; then
  FAIL_DETAILS="${FAIL_DETAILS}pg_restore 非白名单错误 ${UNEXPECTED_ERR} 行；"
elif [ "$RESTORE_RC" -ne 0 ] && [ "$UNEXPECTED_ERR" -eq 0 ]; then
  CHECK_LINES="${CHECK_LINES}pg_restore 退出码 ${RESTORE_RC}，但全部错误都在白名单内（可接受）"$'\n'
fi

if [ -z "$FAIL_DETAILS" ]; then VERDICT="PASS"; else VERDICT="FAIL"; fi
log "结论：${VERDICT}${FAIL_DETAILS:+（${FAIL_DETAILS}）}"

write_report

# ---- 发信 ----
if [ "$NO_MAIL" = "0" ] && [ -x "$(command -v python3 2>/dev/null || printf '/nonexistent')" ] && [ -f "$MAILER" ]; then
  SUBJECT="备份恢复演练：$([ "$VERDICT" = "PASS" ] && printf '通过' || printf '失败')（$(basename "$DUMP_FILE")）"
  if python3 "$MAILER" --subject "$SUBJECT" --body-file "$REPORT_MD"; then
    MAIL_SENT=1
  else
    log "WARN：演练报告邮件发送失败"
  fi
fi

[ "$VERDICT" = "PASS" ] && exit 0
exit 1