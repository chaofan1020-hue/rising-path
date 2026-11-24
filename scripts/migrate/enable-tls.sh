#!/usr/bin/env bash
# 给 supabase.liorvix.com 签 Let's Encrypt 证书（DNS A 记录生效后才能跑）。
#
#   bash scripts/migrate/enable-tls.sh            # 签发 + 自动改 nginx + 验证
#   bash scripts/migrate/enable-tls.sh --dry-run  # 只走 ACME 校验，不落证书
#
# 前置：公网 A 记录 supabase.liorvix.com -> 本机 IP（灰云/DNS only），80 端口可从公网访问。
# 说明：nginx 侧已在 deploy/nginx/supabase.conf 里配好 80 端口的 vhost 与 ACME 可用路径，
#      certbot 会就地把它升级成 443 + 80→443 跳转（与 liorvix.com 的做法一致）。
set -Eeuo pipefail

DOMAIN="${DOMAIN:-supabase.liorvix.com}"
EMAIL="${EMAIL:-admin@liorvix.com}"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

command -v certbot >/dev/null || { echo "certbot not installed" >&2; exit 1; }

echo "== 1. DNS 预检（必须解析到本机公网 IP）=="
MYIP="$(curl -sS -m 10 https://api.ipify.org 2>/dev/null || true)"
DNSIP="$(curl -sS -m 10 -H 'accept: application/dns-json' \
  "https://cloudflare-dns.com/dns-query?name=${DOMAIN}&type=A" 2>/dev/null \
  | python3 -c 'import json,sys;d=json.load(sys.stdin);print(next((a["data"] for a in d.get("Answer",[]) if a.get("type")==1),""))' 2>/dev/null || true)"
echo "  本机公网 IP : ${MYIP:-unknown}"
echo "  公网解析    : ${DNSIP:-<none>}"
if [ -z "$DNSIP" ]; then
  echo "  ✗ DNS 还没有 A 记录 —— 去 Cloudflare 加：${DOMAIN} → ${MYIP:-<本机IP>}，代理状态选灰云（DNS only）" >&2
  exit 1
fi
[ "$DNSIP" = "$MYIP" ] || { echo "  ✗ 解析到 ${DNSIP}，不是本机 ${MYIP}" >&2; exit 1; }
echo "  ✓ 一致"

echo
echo "== 2. 确认 80 端口上的 vhost 存在 =="
if ! grep -q "$DOMAIN" /etc/nginx/sites-enabled/*.conf 2>/dev/null; then
  echo "  ✗ /etc/nginx/sites-enabled 里没有 $DOMAIN 的 vhost" >&2
  exit 1
fi
echo "  ✓ vhost 已启用"

if [ "$DRY_RUN" = "1" ]; then
  echo
  echo "== 3. certbot --dry-run（只校验，不落证书）=="
  certbot --nginx -d "$DOMAIN" --dry-run --non-interactive --agree-tos -m "$EMAIL"
  echo "dry-run 通过：去掉 --dry-run 即可正式签发"
  exit 0
fi

echo
echo "== 3. 签发证书（certbot --nginx 会自动加 443 监听与跳转）=="
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect --keep-until-expiring

echo
echo "== 4. 校验 =="
if ! nginx -t 2>/dev/null; then
  echo "  ✗ nginx -t 失败" >&2; exit 1
fi
systemctl reload nginx

CERT="$(echo | openssl s_client -servername "$DOMAIN" -connect "${DOMAIN}:443" 2>/dev/null \
        | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)"
echo "  证书到期: ${CERT:-unknown}"

for path in "/auth/v1/health" "/rest/v1/" "/storage/v1/status" "/healthz"; do
  code="$(curl -sS -o /dev/null -m 15 -w '%{http_code}' "https://${DOMAIN}${path}" 2>/dev/null || echo 000)"
  printf '  %-22s -> %s\n' "$path" "$code"
done

echo
echo "== 5. 续期演练 =="
certbot renew --dry-run 2>&1 | tail -3

echo
echo "TLS 就绪。下一步：bash scripts/migrate/preflight-cutover.sh"