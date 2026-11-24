# 自托管 Supabase 栈（/opt/supabase）

本目录是 P2 的产物：一条 `docker compose` 就能在现有 VPS 上拉起 Auth / REST / Storage。
配套的迁移计划与取舍说明见 [docs/supabase-selfhost-migration-plan.md](../../docs/supabase-selfhost-migration-plan.md) §2、§5、§6、§7。

```
deploy/supabase/
├── docker-compose.yml          # 7 个服务；studio/meta 在 profile 里，默认不启动
├── .env.example                # 43 个变量，标了 [auto]/[user]
├── bootstrap/
│   └── 10-liorvix-roles.sh     # 角色（含 Cloud 专有角色）+ schema + 扩展（up -d db 后显式跑一次，幂等）
└── (运行期生成) .env
deploy/nginx/supabase.conf      # /auth/v1 /rest/v1 /storage/v1 按路径转发
scripts/migrate/
├── generate-selfhost-secrets.mjs
├── dump-from-cloud.sh
├── restore-into-selfhost.sh
├── db-backup.sh                # 每日 public+auth 全备（timer 见 deploy/systemd）
└── bootstrap-roles.sh
```

## 与官方 compose 的差异（都是刻意的）

| 差异 | 原因 |
|---|---|
| 不部署 Envoy/Kong，nginx 按路径转发 | 少一层网关，少一个配置文件；路由规则全在 `deploy/nginx/supabase.conf` |
| 不部署 supavisor | 应用与脚本直连 `127.0.0.1:5432`，本机连接无 RTT、无 pgbouncer 兼容问题 |
| 不部署 realtime / functions / edge-runtime | 本项目未使用（已核实生产库无 `supabase_functions`/`realtime` 依赖） |
| JWT 用 HS256 对称密钥 | 自托管不需要兼容 Cloud 的 ES256 公钥；迁移来的 refresh token 会换出新签名 token |
| studio/meta 放在 `studio` profile | 管理台是运维工具，不需要常驻，减少内存占用与攻击面 |
| 引导脚本不用 initdb 自动执行 | 挂到 `/docker-entrypoint-initdb.d` 会把镜像自带初始化脚本整目录盖掉；改为 `up -d db` 后显式跑一次（幂等） |
| 显式给 storage 配 `AUTH_JWT_SECRET` / `STORAGE_PUBLIC_URL` | 前者是 v1.89 实际读取的变量名（`PGRST_JWT_SECRET` 是旧别名），后者决定上传返回的 publicUrl 用哪个域名 |
| bootstrap 额外创建 `supabase_admin` / `dashboard_user` | Cloud dump 里有 `ALTER SCHEMA auth OWNER TO supabase_admin`、35 处 `GRANT ... TO dashboard_user`、`ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin`；不建这两个角色，恢复会报 39 处错（本机演练实测） |

## 端口（全部只绑 127.0.0.1）

| 服务 | 宿主机端口 | 说明 |
|---|---|---|
| db (postgres 17.6) | 5432 | 应用 `SUPABASE_DB_URL`、脚本直连 |
| auth (GoTrue) | 9999 | nginx `/auth/v1/` |
| rest (PostgREST) | 3000 | nginx `/rest/v1/` |
| storage-api | 5100 (容器 5000) | nginx `/storage/v1/` |
| imgproxy | 5101 | 只有 storage 内部调用 |
| studio (profile) | 5102 | 仅本机排障 |
| postgres-meta (profile) | 5103 | studio 依赖 |

> 注意 `3000`：如果你在这台机器上跑过 `next dev`，先确认没被占用（`ss -ltnp | grep 3000`）。

## 首次部署（演练 / 正式通用）

```bash
# 1. 装 docker（Ubuntu 24.04 官方源即可）
sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker

# 2. 放代码与配置（复制目录内容，注意别用 `*` —— 会把 .env.example 漏掉）
sudo mkdir -p /opt/supabase
sudo cp -r deploy/supabase/. /opt/supabase/
cd /opt/supabase
sudo cp .env.example .env && sudo chmod 600 .env

# 3. 生成密钥（在仓库里执行，写进 /opt/supabase/.env）
node scripts/migrate/generate-selfhost-secrets.mjs --write /opt/supabase/.env
#    然后手填 [user] 项：SMTP_USER/SMTP_PASS、GITHUB_CLIENT_ID/SECRET、
#    API_EXTERNAL_URL / SITE_URL / URI_ALLOW_LIST

# 4. 先只起数据库，补角色 / schema / 扩展（幂等，已有数据也能跑）
sudo docker compose up -d db
sudo docker compose exec -T db bash /opt/liorvix/bootstrap/10-liorvix-roles.sh
#    （等价：bash scripts/migrate/bootstrap-roles.sh）

# 5. 恢复 dump（单线程 + 清单过滤；空库首次与重复恢复都应为 0 error / 0 unexpected）
DUMP_FILE=/opt/liorvix-backups/liorvix-<stamp>.dump bash scripts/migrate/restore-into-selfhost.sh

# 6. 起其余服务（db 的 healthy 会先于 auth/rest 满足）
sudo docker compose up -d
sudo docker compose ps          # db/auth/rest/storage/imgproxy 应为 healthy

# 7. nginx + 证书
sudo cp deploy/nginx/supabase.conf /etc/nginx/sites-available/supabase.liorvix.com.conf
sudo ln -sf /etc/nginx/sites-available/supabase.liorvix.com.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d supabase.liorvix.com
```

## 部署后必须跑通的 6 条验证

> 一条命令版：`bash scripts/migrate/smoke-test.sh`（需要 `APP_URL`/`SUPABASE_URL`/`ANON_KEY`/`SERVICE_ROLE_KEY`，
> 建议再给一个测试账号的 `REFRESH_TOKEN`）。下面是它内部做的事，排障时手动逐条更直观。

```bash
# 1. GoTrue 活着
curl -fsS https://supabase.liorvix.com/auth/v1/health

# 2. PostgREST 认识 schema（匿名 key 就是 .env 里的 ANON_KEY）
curl -fsS "https://supabase.liorvix.com/rest/v1/jobs?select=id&limit=1" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"

# 3. AI 选岗 RPC 真的是 0139（有 lateral、无 sort）
curl -fsS -X POST "https://supabase.liorvix.com/rest/v1/rpc/search_ai_match_candidates_v7" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H 'content-type: application/json' \
  -d '{"p_terms":["investment banking"],"p_directions":["IBD/S&T"],"p_region_scopes":["us"],"p_limit":240}' \
  | head -c 200

# 4. storage 健康
curl -fsS "https://supabase.liorvix.com/storage/v1/status"

# 5. 会话连续性（最关键的一条，用测试账号的 refresh token）
curl -fsS -X POST "https://supabase.liorvix.com/auth/v1/token?grant_type=refresh_token" \
  -H "apikey: $ANON_KEY" -H 'content-type: application/json' \
  -d '{"refresh_token":"<测试账号的 refresh token>"}'

# 6. 浏览器 CORS（预检必须回 Access-Control-Allow-Origin）
curl -sS -o /dev/null -D - -X OPTIONS "https://supabase.liorvix.com/auth/v1/token?grant_type=password" \
  -H 'Origin: https://liorvix.com' -H 'Access-Control-Request-Method: POST' | grep -i 'access-control'
```

## P3 演练一条龙（按顺序执行，任一步非 0 就停）

```bash
cd /opt/liorvix    # 仓库目录

# 0) 先测导出吞吐（决定维护窗口长度；<1 MB/s 就用 §5.2 的兜底：-Fd -j 8 / 直连 5432）
#    开跑 1 分钟后，在 Cloud 上看一眼：select bytes_processed from pg_stat_progress_copy;

# 1) 导出（只读）
CLOUD_DB_URL='postgresql://postgres.<ref>:<pw>@aws-0-us-west-1.pooler.supabase.com:5432/postgres' \
OUT_DIR=/opt/liorvix-backups bash scripts/migrate/dump-from-cloud.sh

# 2) 恢复（单线程 + `-L` 过滤；--clean 可反复跑，期望 0 error）
DUMP_FILE=/opt/liorvix-backups/liorvix-<stamp>.dump \
  bash scripts/migrate/restore-into-selfhost.sh

# 3) 数据对账（行数/结构/序列/bucket 配置 vs 基线）
ENV_FILE=/opt/liorvix/.env.local bash scripts/migrate/verify-data.sh

# 4) 对象复制（先 dry-run 看清单；目标里两个 bucket 由脚本自动建）
SOURCE_SUPABASE_URL=https://weqvdtdjdzmqflhwobec.supabase.co \
SOURCE_SERVICE_ROLE_KEY=<旧 service key> \
TARGET_SUPABASE_URL=https://supabase.liorvix.com \
TARGET_SERVICE_ROLE_KEY=<新 service key> \
  node scripts/migrate/migrate-storage-objects.mjs            # dry-run
# 确认无误后加 --apply

# 4.5) 简历桶 RLS 策略（storage schema 不在 dump 里，必须单独补；缺了用户下载会被拒）
ENV_FILE=deploy/supabase/.env bash scripts/migrate/apply-storage-policies.sh
#     策略 SQL 已在本机模拟 storage schema 上演练：4 条策略、桶私有、跨用户写入被 RLS 拒绝

# 4.6) 改写库里指向旧域名的绝对 URL（dry-run 先看计数，再 --apply）
OLD_BASE=https://weqvdtdjdzmqflhwobec.supabase.co \
NEW_BASE=https://supabase.liorvix.com \
  node scripts/migrate/rewrite-storage-urls.mjs               # dry-run
OLD_BASE=... NEW_BASE=... node scripts/migrate/rewrite-storage-urls.mjs --apply

# 5) 可用性冒烟（9 组）
APP_URL=https://liorvix.com \
SUPABASE_URL=https://supabase.liorvix.com \
ANON_KEY=<新 anon JWT> SERVICE_ROLE_KEY=<新 service key> \
REFRESH_TOKEN=<测试账号 refresh token> \
  bash scripts/migrate/smoke-test.sh
```

> 第 4 步与 4.5/4.6 都要连目标库（只读或改写自有数据），所以目标栈必须先 `up -d` 起来。

## 每日备份（切换后第一件事）

```bash
sudo cp deploy/systemd/liorvix-db-backup.service deploy/systemd/liorvix-db-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now liorvix-db-backup.timer
systemctl list-timers liorvix-db-backup.timer      # 下次触发时间
sudo systemctl start liorvix-db-backup.service     # 立刻跑一次
ls -lh /opt/liorvix-backups/ && tail -3 /opt/liorvix-backups/backup.log
```

- 默认每天 03:20、保留 7 天、写到 `/opt/liorvix-backups/liorvix-<stamp>.dump`（600 权限，先写 `.partial` 再改名）。
- 脚本会 `pg_restore -l` 校验可读性，坏 dump 直接退出 1；保留期只清理 `liorvix-*.dump`。
- 恢复就是迁移那条命令：`DUMP_FILE=/opt/liorvix-backups/liorvix-<stamp>.dump bash scripts/migrate/restore-into-selfhost.sh`。
- 本机已做闭环演练（备份 → 全新库恢复 → 62 表 / 41 策略 / 101 函数 / auth 数据指纹一致），见计划 §11.3。
- **VPS 实测（2026-11-23）**：备份 423 MB / **65 秒** / TOC 1277 条；`timer` 下次 03:26。
- ⚠️ 备份必须用 **`supabase_admin`**（镜像里的 `postgres` 不是超级用户，导 `auth.*` 表会 permission denied）。
  密码走 `/root/.pgpass`（600），**不要写进 URL 或 unit 文件**：
  ```bash
  printf '127.0.0.1:5432:postgres:supabase_admin:%s\n' "$(grep -E '^POSTGRES_PASSWORD=' /opt/supabase/.env | cut -d= -f2-)" > /root/.pgpass
  chmod 600 /root/.pgpass
  ```

## 排障速查

| 现象 | 先看 | 常见原因 |
|---|---|---|
| `auth` 容器反复重启，日志 `required key API_EXTERNAL_URL missing value` | `docker compose logs auth` | GoTrue 读的是**无前缀** `API_EXTERNAL_URL`（只给 `GOTRUE_API_EXTERNAL_URL` 不够） |
| `rest`/`storage` 连不上 db（`ECONNREFUSED 172.18.0.x:5432`），而 db 自己 healthy | 容器内 `show listen_addresses` | 数据目录 `postgresql.conf` 默认只听 localhost；`POSTGRES_HOST` 改不了它，必须在 `command` 里 `-c listen_addresses=*` |
| `storage` 一直 unhealthy，但 `curl 127.0.0.1:5100/status` 返回 200 | `docker inspect --format '{{json .State.Health}}'` | 容器内 `localhost` 解析成 `::1`，而服务只听 IPv4 → healthcheck 用 `127.0.0.1` |
| GoTrue 报 `problem creating schema migrations` / 建表 permission denied | bootstrap 是否跑过 | 镜像已把 `auth`/`storage` schema 建给 `supabase_admin`，迁移用户缺 CREATE → bootstrap 里的 `grant all on schema` 补上 |
| `auth` 容器反复重启（其它原因） | `docker compose logs auth` | `GOTRUE_SMTP_*` 缺失、`auth.schema_migrations` 落后（→ 升 `GOTRUE_VERSION=v2.198.0`） |
| `rest` 起不来 | `docker compose logs rest` | `PGRST_JWT_SECRET` 与 GoTrue 不一致、`authenticator` 角色缺 `set role` 授权 |
| 上传 500 | `docker compose logs storage` | `GLOBAL_S3_BUCKET`/`TENANT_ID` 为空、imgproxy key/salt 不匹配 |
| 图片 404 | `docker compose logs imgproxy` | `storage-data` 卷未共享给 imgproxy（两边必须同一卷） |
| 恢复时报 `gin_trgm_ops does not exist` | bootstrap 是否跑过 | `pg_trgm` 没被重定位到 `public`（注意：变量名不能叫 `current_schema`，本机演练踩过这个坑） |
| 恢复报 `role "dashboard_user"/"supabase_admin" does not exist` | 是否跑了 bootstrap | Cloud 专有角色没建；bootstrap 已幂等创建 |
| 恢复后 anon 能直接调 v7 RPC | `role_routine_grants` 里是否出现 anon | 没过滤 dump 的 `DEFAULT ACL` 条目（Cloud 默认权限会给 anon 授 ALL） |
| 恢复后函数/扩展数量少于预期 | 是否用了 `--jobs` | `--clean` 并行会交错 drop/create；恢复必须单线程 |
| 恢复后第一波查询很慢 | - | 没做 `vacuum analyze`（restore 脚本已内置） |
| 恢复到**全新空库**后函数少了三成、`pg_trgm` 不在 public | `pg_restore -l` 里有没有 `EXTENSION` 条目 | dump 用 `--schema=public --schema=auth` 时扩展定义不在 TOC 内 → **先跑 bootstrap 再恢复**（生产恢复路径本来就先 bootstrap，所以不受影响；裸恢复进空库才会缺） |
| 浏览器登录直接失败，预检 `OPTIONS /auth/v1/token` 回 204 但没有 `Access-Control-Allow-Origin` | `curl -X OPTIONS -H 'Origin: https://liorvix.com'` | GoTrue 只给真实请求发 CORS 头，**预检不发光**；Cloud 上由 Kong 代劳 → nginx 需 include `deploy/nginx/supabase-cors-preflight.conf`（只补 OPTIONS，真实响应不重复加头） |
| 登录接口 400，或 CORS 头偶发缺失 | `/opt/supabase/.env` 的 `URI_ALLOW_LIST` | 必须写**裸 origin**（`https://liorvix.com`），只写 `https://liorvix.com/**` 时 Origin 无路径匹配不上 |
| `apply-storage-policies.sh` 报 `must be owner of table objects` | 用哪个用户建策略 | `storage.objects` 属主是 `supabase_storage_admin`，必须 `-U supabase_admin`（脚本已默认） |
| `nginx -t` 报 `"gzip" directive is duplicate` | `/etc/nginx/nginx.conf` 第 46 行 | 主配置已有 `gzip on;`，片段里不要再写一遍 |
| `pg_restore` 报 `must be owner of table sessions/refresh_tokens/...` | 恢复用户 | `postgres` 不是超级用户；`-U supabase_admin`（`RESTORE_SUPERUSER`） |
| `pg_restore` 报 `FATAL: role "root" does not exist` | `docker compose exec` 的默认用户 | exec 以 root 进容器 → 显式 `-U <role>` |

## 回滚

只删 nginx 的 symlink + `docker compose down` 即可回到 Cloud：应用侧只需把 `.env.local`
的 5 个 Supabase 变量换回旧值并重启 `liorvix`（计划 §13）。
**不要** `docker compose down -v`（会删卷，演练数据全丢）。