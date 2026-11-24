#!/usr/bin/env bash
# 切流前置检查：一条命令回答"现在能不能切"。
#
#   bash scripts/migrate/preflight-cutover.sh            # 全量检查（只读，除 SMTP 探测会发一封信）
#   SKIP_SMTP=1 bash scripts/migrate/preflight-cutover.sh
#
# 设计：每一项都独立判定，失败也继续跑完，最后给一张"还差什么"的清单。
# 只依赖 curl / python3 / dig（Ubuntu 自带）。在 VPS 上跑（需要能读 /opt/supabase/.env）。
set -uo pipefail

EXPECT_IP="${EXPECT_IP:-43.172.117.125}"
HOST="${HOST:-supabase.liorvix.com}"
BASE="https://${HOST}"
APP_URL="${APP_URL:-https://liorvix.com}"
SB_ENV="${SB_ENV:-/opt/supabase/.env}"
SKIP_SMTP="${SKIP_SMTP:-0}"
SMTP_PROBE_TO="${SMTP_PROBE_TO:-}"
TIMEOUT="${TIMEOUT:-15}"

PASS=0; FAIL=0; SKIP=0
declare -a FAILS=()
pass() { PASS=$((PASS+1)); printf '  [PASS] %s\n' "$*"; }
fail() { FAIL=$((FAIL+1)); FAILS+=("$*"); printf '  [FAIL] %s\n' "$*"; }
skip() { SKIP=$((SKIP+1)); printf '  [SKIP] %s\n' "$*"; }

read_env() { grep -E "^$1=" "$SB_ENV" 2>/dev/null | head -1 | cut -d= -f2-; }
ANON="$(read_env ANON_KEY)"
SR="$(read_env SERVICE_ROLE_KEY)"

echo "=== 切流前置检查  host=${HOST}  app=${APP_URL} ==="
[ -f "$SB_ENV" ] || { echo "missing $SB_ENV" >&2; exit 1; }

echo
echo "[1] DNS"
# 注意：VPS 的 /etc/hosts 里有 `127.0.0.1 supabase.liorvix.com`（切流前的回环垫片），
# 所以 getent 一定返回 127.0.0.1，不能用来判断"公网 DNS 有没有生效"。
# 这里直接问 public resolver（DoH），看到的就是互联网看到的。
RESOLVED="$(curl -sS -m "$TIMEOUT" -H 'accept: application/dns-json' \
  "https://cloudflare-dns.com/dns-query?name=${HOST}&type=A" 2>/dev/null \
  | python3 -c 'import json,sys;d=json.load(sys.stdin);print(next((a["data"] for a in d.get("Answer",[]) if a.get("type")==1),""))' 2>/dev/null)"
if [ -z "$RESOLVED" ]; then
  fail "DNS: 公网解析不到 ${HOST}（去 Cloudflare 加 A 记录 → ${EXPECT_IP}，灰云/DNS only）"
elif [ "$RESOLVED" = "$EXPECT_IP" ]; then
  pass "DNS: 公网 ${HOST} -> ${RESOLVED}"
else
  fail "DNS: 公网 ${HOST} -> ${RESOLVED}，期望 ${EXPECT_IP}（Cloudflare 是否开了橙云代理？）"
fi

echo
echo "[2] TLS 证书"
CERT_OUT="$(curl -sS -o /dev/null -m "$TIMEOUT" -w '%{http_code}' "${BASE}/auth/v1/health" 2>&1)"
if [ "$CERT_OUT" = "200" ]; then
  EXPIRY="$(echo | openssl s_client -servername "$HOST" -connect "${HOST}:443" 2>/dev/null \
            | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
  pass "TLS: ${BASE} 证书有效且 /auth/v1/health = 200（到期 ${EXPIRY:-未知}）"
else
  fail "TLS: ${BASE} 不可用（$CERT_OUT）→ 先 \`certbot --nginx -d ${HOST}\`"
fi

echo
echo "[3] 三条数据面路径（HTTPS + 服务密钥）"
for spec in "auth/v1/health|" "rest/v1/|${SR}" "storage/v1/status|"; do
  path="${spec%%|*}"; key="${spec##*|}"
  if [ -n "$key" ]; then
    code="$(curl -sS -o /dev/null -m "$TIMEOUT" -w '%{http_code}' -H "apikey: ${key}" "${BASE}/${path}" 2>&1)"
  else
    code="$(curl -sS -o /dev/null -m "$TIMEOUT" -w '%{http_code}' "${BASE}/${path}" 2>&1)"
  fi
  case "$path" in
    rest/v1/) [ "$code" = "200" ] && pass "${path} -> 200" || fail "${path} -> ${code}" ;;
    *)        [ "$code" = "200" ] && pass "${path} -> 200" || fail "${path} -> ${code}" ;;
  esac
done

echo
echo "[4] 浏览器 CORS 预检（缺了前端登录直接死）"
CORS="$(curl -sS -o /dev/null -D - -m "$TIMEOUT" -X OPTIONS "${BASE}/auth/v1/token?grant_type=password" \
  -H 'Origin: https://liorvix.com' -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,apikey' -H "apikey: ${ANON}" 2>/dev/null \
  | grep -ic 'access-control-allow-origin')"
[ "${CORS:-0}" -ge 1 ] && pass "OPTIONS /auth/v1/token 有 ACAO" || fail "预检没有 ACAO（nginx 是否 include supabase-cors-preflight.conf）"

echo
echo "[5] GitHub OAuth 回调"
LOC="$(curl -sS -o /dev/null -D - -m "$TIMEOUT" "${BASE}/auth/v1/authorize?provider=github&redirect_to=${APP_URL}/auth/callback" \
  -H "apikey: ${ANON}" 2>/dev/null | grep -i '^location:' | head -1)"
if printf '%s' "$LOC" | grep -q 'github.com/login/oauth/authorize'; then
  pass "authorize -> github.com"
  printf '%s' "$LOC" | grep -q "redirect_uri=https%3A%2F%2F${HOST}" \
    && pass "redirect_uri 指向 ${HOST}/auth/v1/callback" \
    || fail "redirect_uri 不是 ${HOST}（检查 API_EXTERNAL_URL）"
  echo "        ⚠ 记得在 GitHub App 的 callback URL 列表里加上 https://${HOST}/auth/v1/callback"
else
  fail "authorize 没有 302 到 github（GITHUB_ENABLED / CLIENT_ID / SECRET）"
fi

echo
echo "[6] SMTP 发信"
SMTP_HOST_V="$(read_env SMTP_HOST)"
SMTP_USER_V="$(read_env SMTP_USER)"
if [ "$SKIP_SMTP" = "1" ]; then
  skip "SKIP_SMTP=1"
elif printf '%s' "$SMTP_USER_V" | grep -qi 'REPLACE'; then
  fail "SMTP_USER 还是占位符 ${SMTP_USER_V}（需 Brevo 的 SMTP Login，形如 xxx@smtp-brevo.com）"
elif [ -z "$SMTP_PROBE_TO" ]; then
  skip "未设置 SMTP_PROBE_TO（设为自己的邮箱可实测发信）"
else
  probe="$(curl -sS -m 30 -o /tmp/smtp-probe.out -w '%{http_code}' -X POST "${BASE}/auth/v1/otp" \
    -H "apikey: ${ANON}" -H 'content-type: application/json' \
    -d "{\"email\":\"${SMTP_PROBE_TO}\",\"create_user\":false}" 2>/dev/null || echo 000)"
  if [ "$probe" = "200" ]; then
    pass "SMTP: /auth/v1/otp 已受理（检查 ${SMTP_PROBE_TO} 收件箱）"
  else
    fail "SMTP: /auth/v1/otp -> ${probe} $(head -c 200 /tmp/smtp-probe.out 2>/dev/null)"
  fi
  rm -f /tmp/smtp-probe.out
fi
[ -n "$SMTP_HOST_V" ] && echo "        SMTP_HOST=${SMTP_HOST_V}"

echo
echo "[7] 应用指向（切换前应为 Cloud，切换后必须等于 ${BASE}）"
APP_CFG="$(curl -sS -m "$TIMEOUT" "${APP_URL}/api/auth/config" 2>/dev/null | head -c 400)"
printf '%s' "$APP_CFG" | grep -q "$HOST" \
  && pass "应用已指向 ${HOST}" \
  || pass "应用仍指向 Cloud（切换前正常；切换后必须一致）"

echo
echo "[8] 自托管栈健康 + 数据量"
HEALTH="$(sudo -n docker ps --filter 'name=liorvix-supabase' --format '{{.Names}} {{.Status}}' 2>/dev/null)"
printf '%s\n' "$HEALTH" | grep -q 'unhealthy\|Restarting' \
  && fail "有容器不健康：$(printf '%s' "$HEALTH" | grep 'unhealthy\|Restarting' | tr '\n' ';')" \
  || pass "5 个容器无 unhealthy/Restarting"
ROWS="$(sudo -n docker exec liorvix-supabase-db psql -U supabase_admin -h 127.0.0.1 -d postgres -tAc \
  "select 'jobs='||count(*) from public.jobs union all select 'users='||count(*) from auth.users union all select 'objects='||count(*) from storage.objects" 2>/dev/null | tr '\n' ' ')"
[ -n "$ROWS" ] && pass "数据：${ROWS}" || fail "查不到数据行数"

echo
echo "[9] 写入路径（POST 请求体是否被保住）"
# 自托管栈必须走 https。若 SUPABASE_URL 写成 http://，nginx 会把 POST 301 到 https，
# 浏览器/fetch 跟随 301 时会把 POST 降级成 GET、丢掉 body —— 表现是岗位 worker 报
#   "初始化岗位同步状态失败: Cannot coerce the result to a single JSON object"
#   "Could not find the function public.claim_job_sync without parameters in the schema cache"
# 这里用一条带参 RPC 直接验证"请求体真的到了 PostgREST"。
if [ -f /opt/liorvix/.env.local ] && grep -qE '^SUPABASE_URL=http://.*supabase\.liorvix\.com' /opt/liorvix/.env.local 2>/dev/null; then
  fail "应用 SUPABASE_URL 用了 http://（301 会丢 POST body）→ 必须改成 https://${HOST}"
else
  pass "应用 SUPABASE_URL 未使用 http://（如已切换则为 https）"
fi
RPC_CODE="$(curl -sS -m "$TIMEOUT" -o /tmp/pre-rpc.out -w '%{http_code}' -X POST "${BASE}/rest/v1/rpc/claim_job_sync" \
  -H "apikey: ${SR}" -H "authorization: Bearer ${SR}" -H 'content-type: application/json' \
  -d '{"p_source_system":"_preflight","p_owner":"00000000-0000-0000-0000-000000000000","p_ttl_seconds":1}' 2>/dev/null || echo 000)"
RPC_BODY="$(head -c 160 /tmp/pre-rpc.out 2>/dev/null)"
rm -f /tmp/pre-rpc.out
if [ "$RPC_CODE" = "200" ] && [ "$RPC_BODY" = "true" ]; then
  pass "POST /rpc/claim_job_sync（带参）-> true（请求体完整、service_role 可写）"
else
  fail "POST /rpc/claim_job_sync -> ${RPC_CODE} ${RPC_BODY}"
fi
sudo -n docker exec liorvix-supabase-db psql -U supabase_admin -h 127.0.0.1 -d postgres -qtAc \
  "delete from public.job_sync_state where source_system='_preflight'" >/dev/null 2>&1 || true

echo
echo "[10] 长 URI（岗位同步的 in.(...) 查询 / nginx 缓冲）"
# PostgREST 会把完整 URI 回显进 Content-Location 响应头；岗位同步/官方字段任务会拼出
# 4–6 KB 的查询。nginx 默认 proxy_buffer_size=4k、large_client_header_buffers=4×8k，
# 不放大就会 502（upstream sent too big header）或 414，岗位数据从切流起停止更新。
for n in 5600 10000; do
  PAD="$(python3 -c "print('a'*$n)")"
  code="$(curl -sS -o /dev/null -m "$TIMEOUT" -w '%{http_code}' \
    "${BASE}/rest/v1/job_sync_state?select=source_system&source_system=eq.${PAD}" \
    -H "apikey: ${SR}" -H "authorization: Bearer ${SR}" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then
    pass "URI≈${n}B -> 200"
  else
    fail "URI≈${n}B -> ${code}（nginx 需 proxy_buffer_size 32k / large_client_header_buffers 4 32k）"
  fi
done

echo
echo "=== 结果：PASS ${PASS} / FAIL ${FAIL} / SKIP ${SKIP} ==="
if [ "$FAIL" -gt 0 ]; then
  echo "还不能切，先解决："
  printf '  - %s\n' "${FAILS[@]}"
  exit 1
fi
echo "全部前置通过：可以执行 scripts/migrate/cutover-app-env.sh --apply --restart"
