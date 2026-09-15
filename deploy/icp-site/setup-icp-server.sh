#!/bin/bash
set -euo pipefail
export LANG=en_US.UTF-8

SITE_TAR=/tmp/liorvix-icp-site.tar
NGINX_CONF_SRC=/tmp/liorvix-cn.conf
SITE_DST=/www/wwwroot/liorvix-cn
PANEL_USER=liorvix
PANEL_PASS='LiorvixIcp2026Sh'
PANEL_PATH='/liorvix-ops'

echo "[1/6] installing nginx"
dnf install -y nginx-core nginx-filesystem certbot python3-certbot-nginx dnf-automatic

echo "[2/6] deploying site"
mkdir -p "$SITE_DST"
tar -xf "$SITE_TAR" -C "$SITE_DST"
# drop helper scripts from web root if archived together
rm -f "$SITE_DST/setup-icp-server.sh"
if id nginx >/dev/null 2>&1; then
  chown -R nginx:nginx "$SITE_DST"
elif id www >/dev/null 2>&1; then
  chown -R www:www "$SITE_DST"
fi
chmod -R a+rX "$SITE_DST"

echo "[3/6] configuring nginx"
mkdir -p /etc/nginx/conf.d
if [ -f /etc/nginx/nginx.conf ]; then
  # keep distro nginx.conf; only drop a default site that would steal port 80
  rm -f /etc/nginx/conf.d/default.conf /usr/share/nginx/html/index.html
fi
cp "$NGINX_CONF_SRC" /etc/nginx/conf.d/liorvix-cn.conf
# If the package nginx.conf already has a default_server, comment it out
if grep -q 'default_server' /etc/nginx/nginx.conf; then
  python3 - <<'PY'
from pathlib import Path
p = Path("/etc/nginx/nginx.conf")
text = p.read_text()
if "conf.d" not in text:
    text = text.replace("http {", "http {\n    include /etc/nginx/conf.d/*.conf;")
    p.write_text(text)
PY
fi
nginx -t
systemctl enable nginx
systemctl restart nginx

echo "[4/6] securing BT panel"
if command -v btpython >/dev/null 2>&1; then
  btpython /www/server/panel/tools.py username "$PANEL_USER" || true
  btpython /www/server/panel/tools.py panel "$PANEL_PASS" || true
  printf '%s\n' "$PANEL_PATH" > /www/server/panel/data/admin_path.pl
  chmod 600 /www/server/panel/data/admin_path.pl
  bt restart || systemctl restart bt || true
fi

echo "[5/6] automatic security updates"
if systemctl list-unit-files | grep -q dnf-automatic.timer; then
  systemctl enable --now dnf-automatic.timer || true
fi

echo "[6/6] writing local notes"
umask 077
cat > /root/icp-credentials.txt <<EOF
Liorvix China ICP server
Public IP: 115.159.38.86
SSH: root@115.159.38.86
Region: ap-shanghai (Tencent Lighthouse)

Website root: /www/wwwroot/liorvix-cn
Nginx site: /etc/nginx/conf.d/liorvix-cn.conf
Health: http://115.159.38.86/healthz

BT panel:
  URL: http://115.159.38.86:8888${PANEL_PATH}
  username: ${PANEL_USER}
  password: ${PANEL_PASS}

Do not point liorvix.com at this IP.
Use a dedicated China domain after ICP filing.
EOF
chmod 600 /root/icp-credentials.txt

echo "===== VERIFY ====="
systemctl is-active nginx
ss -lntp | grep -E ':80|:8888|:22' || true
curl -fsS http://127.0.0.1/healthz
curl -fsS -o /dev/null -w "homepage:%{http_code}\n" http://127.0.0.1/
echo DONE
