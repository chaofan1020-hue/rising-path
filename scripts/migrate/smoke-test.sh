#!/usr/bin/env bash
# 迁移后的可用性冒烟测试（P4 验收 + 切换后 15 分钟观察都用它）。
#
#   APP_URL=https://liorvix.com \
#   SUPABASE_URL=https://supabase.liorvix.com \
#   ANON_KEY=... SERVICE_ROLE_KEY=... \
#   REFRESH_TOKEN=<测试账号 refresh token> \
#   bash scripts/migrate/smoke-test.sh
#
# 只依赖 curl/python3（Ubuntu 24.04 自带）。不做任何写操作 —— 除了会向 storage
# 上传一个 1 字节的探针对象（--no-write 可关）。
# 退出码：0 = 全部通过；1 = 有 FAIL。
set -Eeuo pipefail

APP_URL="${APP_URL:-https://liorvix.com}"
SUPABASE_URL="${SUPABASE_URL:-https://supabase.liorvix.com}"
ANON_KEY="${ANON_KEY:-}"
SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-}"
REFRESH_TOKEN="${REFRESH_TOKEN:-}"
PROBE_WRITE="${PROBE_WRITE:-1}"
TIMEOUT="${TIMEOUT:-30}"

PASS=0
FAIL=0
WARN=0
declare -a FAILURES=()

# Git Bash / 精简镜像里不一定有 python3 命令名
PY="$(command -v python3 || command -v python || true)"
if [ -z "${PY}" ]; then
  echo "python3/python not found; JSON 解析检查会降级" >&2
fi

pass() { PASS=$((PASS + 1)); printf '  \033[32mPASS\033[0m %s\n' "$*"; }
fail() { FAIL=$((FAIL + 1)); FAILURES+=("$*"); printf '  \033[31mFAIL\033[0m %s\n' "$*"; }
warn() { WARN=$((WARN + 1)); printf '  \033[33mWARN\033[0m %s\n' "$*"; }

# http_code URL [extra curl args...]
http_code() {
  local url="$1"; shift
  curl -sS -o /dev/null -m "${TIMEOUT}" -w '%{http_code}' "$@" "${url}" 2>/dev/null || echo 000
}

# expect_status NAME EXPECTED URL [curl args...]
expect_status() {
  local name="$1" expected="$2" url="$3"; shift 3
  local code
  code="$(http_code "${url}" "$@")"
  if [ "${code}" = "${expected}" ]; then pass "${name} (HTTP ${code})"; else fail "${name}: expected ${expected}, got ${code} (${url})"; fi
}

# json_get URL JSONPATH → 用 python 取值（无 jq 依赖）
json_get() {
  local url="$1" expr="$2"; shift 2
  [ -n "${PY}" ] || { echo ""; return; }
  curl -sS -m "${TIMEOUT}" "$@" "${url}" 2>/dev/null \
    | "${PY}" -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {"d": d}))' "${expr}" 2>/dev/null || true
}

echo "== Liorvix smoke test =="
echo "   app:      ${APP_URL}"
echo "   supabase: ${SUPABASE_URL}"
echo

echo "[1] 应用存活"
expect_status "GET /api/health" 200 "${APP_URL}/api/health"
expect_status "GET / (首页)" 200 "${APP_URL}/"

echo
echo "[2] Supabase Auth"
# Cloud 的网关要求所有 /auth/v1 请求带 apikey；自托管（nginx 直连 GoTrue）不需要，
# 带上也不影响，所以统一带。
if [ -n "${ANON_KEY}" ]; then
  expect_status "GET /auth/v1/health" 200 "${SUPABASE_URL}/auth/v1/health" \
    -H "apikey: ${ANON_KEY}"
else
  expect_status "GET /auth/v1/health" 200 "${SUPABASE_URL}/auth/v1/health"
fi

echo
echo "[3] PostgREST（anon 身份读公开岗位）"
if [ -n "${ANON_KEY}" ]; then
  expect_status "GET /rest/v1/jobs?select=id&limit=1" 200 "${SUPABASE_URL}/rest/v1/jobs?select=id&limit=1" \
    -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${ANON_KEY}"
else
  warn "ANON_KEY 未设置，跳过 PostgREST 检查"
fi

echo
echo "[4] AI 选岗 RPC（0139：必须有结果、必须 <3 秒）"
if [ -n "${SERVICE_ROLE_KEY}" ]; then
  RPC_BODY='{"p_terms":["investment banking","financial analyst"],"p_directions":["IBD/S&T","Finance"],"p_region_scopes":["us"],"p_limit":240}'
  RPC_OUT="$(mktemp)"
  RPC_TIME="$(curl -sS -m 120 -o "${RPC_OUT}" -w '%{time_total}' \
    -X POST "${SUPABASE_URL}/rest/v1/rpc/search_ai_match_candidates_v7" \
    -H "apikey: ${SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H 'content-type: application/json' -d "${RPC_BODY}" 2>/dev/null || echo 99)"
  if [ -n "${PY}" ]; then
    # 用 stdin 而不是文件路径：Git Bash 的 /tmp 路径 Windows 原生 python 打不开
    RPC_COUNTS="$("${PY}" -c 'import json,sys; rows=json.load(sys.stdin); print(len(rows), sum(1 for r in rows if (r.get("lexical_score") or 0) > 0))' < "${RPC_OUT}" 2>/dev/null || echo "0 0")"
    RPC_ROWS="$(printf '%s' "${RPC_COUNTS}" | awk '{print $1}')"
    RPC_SCORED="$(printf '%s' "${RPC_COUNTS}" | awk '{print $2}')"
  else
    RPC_ROWS="$(grep -o '"id":' "${RPC_OUT}" 2>/dev/null | wc -l | tr -d ' ')"
    RPC_SCORED="?"
  fi
  if [ "${RPC_ROWS}" -ge 100 ]; then pass "RPC 返回 ${RPC_ROWS} 条（其中 ${RPC_SCORED} 条有关键词命中），耗时 ${RPC_TIME}s"; else fail "RPC 只返回 ${RPC_ROWS} 条（期望 ≥100）"; fi
  if awk -v t="${RPC_TIME}" 'BEGIN{exit !(t < 3)}'; then
    pass "RPC 延迟 ${RPC_TIME}s < 3s"
  elif awk -v t="${RPC_TIME}" 'BEGIN{exit !(t < 10)}'; then
    warn "RPC 延迟 ${RPC_TIME}s（云上跨境 RTT 正常 1.5–4s；自托管应 <0.3s）"
  else
    fail "RPC 延迟 ${RPC_TIME}s ≥ 10s"
  fi
  rm -f "${RPC_OUT}"
else
  warn "SERVICE_ROLE_KEY 未设置，跳过 AI 选岗 RPC 检查（这是最关键的检查，别跳过）"
fi

echo
echo "[5] Storage"
expect_status "GET /storage/v1/status" 200 "${SUPABASE_URL}/storage/v1/status"
if [ -n "${SERVICE_ROLE_KEY}" ]; then
  BUCKETS="$(json_get "${SUPABASE_URL}/storage/v1/bucket" 'len(d)' -H "apikey: ${SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}")"
  if [ "${BUCKETS:-0}" -ge 2 ]; then pass "bucket 数量 ${BUCKETS}（期望 2）"; else fail "bucket 数量 ${BUCKETS:-0}（期望 2：risingpath-assets / risingpath-resumes）"; fi

  if [ "${PROBE_WRITE}" = "1" ]; then
    PROBE_KEY=".smoke/$(date +%s).txt"
    CODE="$(curl -sS -o /dev/null -m "${TIMEOUT}" -w '%{http_code}' -X POST \
      "${SUPABASE_URL}/storage/v1/object/risingpath-resumes/${PROBE_KEY}" \
      -H "apikey: ${SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
      -H 'content-type: text/plain' --data 'ok' 2>/dev/null || echo 000)"
    if [ "${CODE}" = "200" ]; then
      pass "storage 可写（${PROBE_KEY}）"
      curl -sS -o /dev/null -m "${TIMEOUT}" -X DELETE \
        "${SUPABASE_URL}/storage/v1/object/risingpath-resumes/${PROBE_KEY}" \
        -H "apikey: ${SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" 2>/dev/null || true
    else
      fail "storage 写入失败 HTTP ${CODE}（bucket 是否存在/是否 private）"
    fi
  fi
fi

echo
echo "[6] 会话连续性（迁移最关键的一次验证）"
if [ -n "${REFRESH_TOKEN}" ] && [ -n "${ANON_KEY}" ]; then
  TOKEN_OUT="$(mktemp)"
  TOKEN_CODE="$(curl -sS -o "${TOKEN_OUT}" -m "${TIMEOUT}" -w '%{http_code}' -X POST \
    "${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token" \
    -H "apikey: ${ANON_KEY}" -H 'content-type: application/json' \
    -d "{\"refresh_token\":\"${REFRESH_TOKEN}\"}" 2>/dev/null || echo 000)"
  if [ "${TOKEN_CODE}" = "200" ] && grep -q 'access_token' "${TOKEN_OUT}"; then
    pass "旧 refresh token 换到了新 access token（用户不会掉线）"
    NEW_TOKEN="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("access_token",""))' "${TOKEN_OUT}" 2>/dev/null || true)"
    if [ -n "${NEW_TOKEN}" ]; then
      expect_status "新 access token 能查自己的数据" 200 "${SUPABASE_URL}/rest/v1/profiles?select=id&limit=1" \
        -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${NEW_TOKEN}"
    fi
  else
    fail "refresh token 换发失败 HTTP ${TOKEN_CODE}（auth.sessions/refresh_tokens 是否完整迁移？）"
  fi
  rm -f "${TOKEN_OUT}"
else
  warn "REFRESH_TOKEN/ANON_KEY 未提供，跳过（正式切换前必须用一个测试账号跑一次）"
fi

echo
echo "[7] 浏览器 CORS（缺失会让前端登录直接失败）"
CORS_HEADERS="$(curl -sS -o /dev/null -m "${TIMEOUT}" -D - -X OPTIONS \
  "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H 'Origin: https://liorvix.com' -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,apikey' 2>/dev/null || true)"
if printf '%s' "${CORS_HEADERS}" | grep -qi 'access-control-allow-origin'; then
  pass "OPTIONS /auth/v1/token 回了 Access-Control-Allow-Origin"
else
  fail "OPTIONS /auth/v1/token 没有 CORS 头（GoTrue 的 URI_ALLOW_LIST / API_EXTERNAL_URL 可能不对）"
fi

echo
echo "[8] 应用与 Supabase 的指向是否一致"
CONFIG_URL="$(json_get "${APP_URL}/api/auth/config" 'd.get("url","")')"
if [ -z "${CONFIG_URL}" ]; then
  fail "/api/auth/config 没有返回 url"
elif [ "${CONFIG_URL}" = "${SUPABASE_URL}" ]; then
  pass "应用指向 ${CONFIG_URL}"
else
  warn "应用当前指向 ${CONFIG_URL}，与本脚本的 SUPABASE_URL=${SUPABASE_URL} 不同（切换前这是正常的）"
fi

echo
echo "[9] 压缩（gzip 上线后 /api/jobs 应显著变小）"
JOB_SIZE_RAW="$(curl -sS -o /dev/null -m "${TIMEOUT}" -w '%{size_download}' "${APP_URL}/api/jobs?limit=50" 2>/dev/null || echo 0)"
JOB_SIZE_GZ="$(curl -sS -o /dev/null -m "${TIMEOUT}" -w '%{size_download}' -H 'Accept-Encoding: gzip' "${APP_URL}/api/jobs?limit=50" 2>/dev/null || echo 0)"
if [ "${JOB_SIZE_RAW}" -gt 0 ] && [ "${JOB_SIZE_GZ}" -gt 0 ]; then
  if [ "${JOB_SIZE_GZ}" -lt $((JOB_SIZE_RAW * 3 / 4)) ]; then
    pass "/api/jobs 压缩生效：${JOB_SIZE_GZ}B / ${JOB_SIZE_RAW}B"
  else
    warn "/api/jobs 压缩未生效：${JOB_SIZE_GZ}B / ${JOB_SIZE_RAW}B（若前置 Cloudflare 已压缩则属正常）"
  fi
else
  warn "无法测量 /api/jobs 大小"
fi

echo
echo "== 结果：PASS ${PASS} / FAIL ${FAIL} / WARN ${WARN} =="
if [ "${FAIL}" -gt 0 ]; then
  printf '失败项：\n'
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
echo "全部通过。"