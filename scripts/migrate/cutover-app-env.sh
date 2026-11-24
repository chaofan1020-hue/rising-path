#!/usr/bin/env bash
# 切换把应用的 Supabase 配置从 Cloud 换成自托管栈（只改 env 文件，不重启服务）。
#
#   bash scripts/migrate/cutover-app-env.sh --check     # 只读：看当前值 vs 目标值（脱敏）
#   bash scripts/migrate/cutover-app-env.sh --apply      # 备份 + 改写（不动服务）
#   bash scripts/migrate/cutover-app-env.sh --apply --restart   # 改写后重启 liorvix/worker
#   bash scripts/migrate/cutover-app-env.sh --rollback   # 用最近一次备份回滚
#   bash scripts/migrate/cutover-app-env.sh --list       # 列出备份
#
# 环境变量：
#   APP_ENV_FILE   default /opt/liorvix/.env.local
#   SUPABASE_ENV   default /opt/supabase/.env
#   PUBLIC_BASE    default https://supabase.liorvix.com
#   DB_HOST        default 127.0.0.1:5432
set -Eeuo pipefail

APP_ENV_FILE="${APP_ENV_FILE:-/opt/liorvix/.env.local}"
SUPABASE_ENV="${SUPABASE_ENV:-/opt/supabase/.env}"
PUBLIC_BASE="${PUBLIC_BASE:-https://supabase.liorvix.com}"
DB_HOST="${DB_HOST:-127.0.0.1:5432}"

ACTION=""
RESTART=0
for arg in "$@"; do
  case "$arg" in
    --check|--apply|--rollback|--list) ACTION="${arg#--}" ;;
    --restart) RESTART=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done
[ -n "$ACTION" ] || { sed -n '2,20p' "$0"; exit 2; }

[ -f "$APP_ENV_FILE" ] || { echo "missing $APP_ENV_FILE" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 required" >&2; exit 1; }

mask() {
  local v="$1"
  if [ "${#v}" -le 12 ]; then printf '%s' "$v"; else printf '%s...%s' "${v:0:6}" "${v: -4}"; fi
}

list_backups() {
  ls -1t "${APP_ENV_FILE}".pre-migration.* 2>/dev/null || echo "(no backups yet)"
}

if [ "$ACTION" = "list" ]; then list_backups; exit 0; fi

if [ "$ACTION" = "rollback" ]; then
  latest="$(ls -1t "${APP_ENV_FILE}".pre-migration.* 2>/dev/null | head -1 || true)"
  [ -n "$latest" ] || { echo "no backup to roll back to" >&2; exit 1; }
  cp -a "$latest" "${APP_ENV_FILE}.rollback-src.$$"
  install -m 600 -o root -g root "${APP_ENV_FILE}.rollback-src.$$" "$APP_ENV_FILE"
  rm -f "${APP_ENV_FILE}.rollback-src.$$"
  echo "rolled back from $(basename "$latest")"
  echo "  SUPABASE_URL=$(grep -E '^SUPABASE_URL=' "$APP_ENV_FILE" | cut -d= -f2-)"
  [ "$RESTART" = "1" ] || echo "  (服务未重启；需要时加 --restart 或手工 systemctl restart liorvix)"
  exit 0
fi

read_sb() { # read key from /opt/supabase/.env without echoing
  grep -E "^$1=" "$SUPABASE_ENV" | head -1 | cut -d= -f2-
}

NEW_ANON="$(read_sb ANON_KEY)"
NEW_SERVICE="$(read_sb SERVICE_ROLE_KEY)"
NEW_DB_PW="$(read_sb POSTGRES_PASSWORD)"
[ -n "$NEW_ANON" ] && [ -n "$NEW_SERVICE" ] && [ -n "$NEW_DB_PW" ] || {
  echo "cannot read ANON_KEY / SERVICE_ROLE_KEY / POSTGRES_PASSWORD from $SUPABASE_ENV" >&2; exit 1; }

NEW_DB_URL="postgresql://supabase_admin:${NEW_DB_PW}@${DB_HOST}/postgres"

python3 - "$ACTION" "$APP_ENV_FILE" "$PUBLIC_BASE" "$NEW_ANON" "$NEW_SERVICE" "$NEW_DB_URL" <<'PY'
import os, shutil, sys, time

action, path, base, anon, service, db_url = sys.argv[1:7]

TARGET = {
    'SUPABASE_URL': base,
    'SUPABASE_ANON_KEY': anon,
    'SUPABASE_SERVICE_ROLE_KEY': service,
    'SUPABASE_DB_URL': db_url,
}
# HS256 没有 JWKS 端点；留空会让任何按需读取的代码走"未配置"分支（src/ 目前无引用）。
DROP = {'SUPABASE_JWKS_URL'}

def mask(v):
    return v if len(v) <= 12 else f'{v[:6]}...{v[-4:]}'

lines = open(path, encoding='utf-8').read().splitlines()
current, comments = {}, {}
for line in lines:
    s = line.strip()
    if not s or s.startswith('#') or '=' not in s:
        continue
    k, v = s.split('=', 1)
    current[k] = v.strip().strip('"').strip("'")

print(f'{"key":32} {"current":28} -> target')
changed = 0
for k, v in TARGET.items():
    cur = current.get(k, '<missing>')
    same = cur == v
    if not same:
        changed += 1
    print(f'  {k:30} {mask(cur):28} -> {mask(v)}' + ('   (already)' if same else ''))
for k in DROP:
    if k in current:
        changed += 1
        print(f'  {k:30} {mask(current[k]):28} -> (removed)')

if action == 'check':
    print(f'\ncheck: {changed} value(s) would change; nothing written')
    sys.exit(0 if changed else 0)

if action != 'apply':
    sys.exit(2)

stamp = time.strftime('%Y%m%d-%H%M%S')
backup = f'{path}.pre-migration.{stamp}'
shutil.copy2(path, backup)
os.chmod(backup, 0o600)

out, seen = [], set()
for line in lines:
    s = line.strip()
    if s and not s.startswith('#') and '=' in s:
        k = s.split('=', 1)[0].strip()
        if k in DROP:
            out.append(f'# [migrated {stamp}] {line}  → 自托管 HS256 无 JWKS 端点')
            seen.add(k)
            continue
        if k in TARGET:
            out.append(f'{k}={TARGET[k]}')
            seen.add(k)
            continue
    out.append(line)
for k in TARGET:
    if k not in seen:
        out.append(f'{k}={TARGET[k]}')

tmp = f'{path}.tmp-{os.getpid()}'
with open(tmp, 'w', encoding='utf-8', newline='\n') as fh:
    fh.write('\n'.join(out) + '\n')
os.chmod(tmp, 0o600)
os.replace(tmp, path)
print(f'\napplied: {changed} value(s) changed')
print(f'backup:  {backup}')
PY

if [ "$ACTION" != "apply" ]; then
  exit 0
fi

if [ "$RESTART" = "1" ]; then
  echo
  echo "== restart services =="
  systemctl restart liorvix
  sleep 3
  systemctl is-active liorvix | sed 's/^/  liorvix=/'
  if systemctl list-unit-files | grep -q '^liorvix-worker.service'; then
    systemctl restart liorvix-worker
    sleep 2
    systemctl is-active liorvix-worker | sed 's/^/  liorvix-worker=/'
  else
    echo "  liorvix-worker not installed (skip)"
  fi
  echo
  curl -sS -m 10 -o /dev/null -w '  GET /api/health -> %{http_code}\n' http://127.0.0.1:5000/api/health || true
  curl -sS -m 10 http://127.0.0.1:5000/api/auth/config 2>/dev/null | head -c 300; echo
else
  echo
  echo "服务未重启。生效需要： systemctl restart liorvix && systemctl restart liorvix-worker"
fi