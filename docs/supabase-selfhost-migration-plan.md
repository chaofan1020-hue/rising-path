# Liorvix 数据库自托管迁移与系统改进计划

> 版本：v1.3 · 2026-11-20（v1.1 删除"复用 JWT secret"假设；v1.2 完成 P0 第二轮凭据验证：GitHub 凭据已验证配对、Cloudflare Token 只读、基线快照与部分邮件模板已落盘。**v1.3 = P1 首批修复落地**：AI 选岗 RPC 已重写并直接在生产库生效（69.7 s → 1.78 s、稳定 240 条）、路由兜底改写、部署/审计脚本改为 host 校验；同时补上"冷读 0.7 ms/页 + TOAST 2.7 GB"这一关键性能事实。**v1.3 第二批 = P2 产物落盘**：`deploy/supabase/` 全套（compose + env 模板 + bootstrap）、nginx 路径路由、迁移 dump/restore 脚本；并把架构从"Envoy 网关 + ES256/JWKS"简化为"nginx 路由 + HS256"，依据见 §2 的依赖实测表。采集与验证记录见 [p0-migration-prerequisites-collected.md](p0-migration-prerequisites-collected.md)，P1 进度见 §4.2，P2 产物见 §4.3）
> 目标：把生产环境从 Supabase Cloud 平滑迁移到现有生产服务器（43.172.117.125，8 vCPU / 16 GB / 50 GB）上的自托管 Supabase，**停机 ≤ 20 分钟、功能零损失、可随时回滚**；同时完成 AI 选岗检索、后台 worker、带宽压缩等改进。
> 适用对象：本项目维护者（单人运维）。

---

## 0. 执行摘要

| 项目 | 现状 | 迁移后 |
|---|---|---|
| 数据库 | Supabase Cloud，PostgreSQL 17.6，4.36 GB | 本机 PostgreSQL 17，Docker 自托管 |
| 计算 | 共享 CPU、1–2 GB 内存，`shared_buffers` 256 MB | 8 vCPU / 16 GB，`shared_buffers` 4 GB，全库常驻内存 |
| 语句超时 | `authenticated` 角色 8 秒（AI 检索被强杀） | 可配置 30 秒，且检索 SQL 已优化到 < 1 秒 |
| 网络 | 应用 → Supabase 每次 36–46 ms RTT | 本机回环，< 1 ms |
| 月费 | 约 $30 | $0（VPS 已在付），备份存储约 $0–5 |
| 停机 | — | 计划 20–30 分钟维护窗口（实际切换约 10–15 分钟） |

**必须遵守的三条红线：**

1. **迁移 `auth.sessions` / `auth.refresh_tokens`**，让已登录用户不掉线。注意：**复用旧 JWT secret 这条路已被实测否定**（Cloud 用 ES256 非对称签名 + `sb_publishable_`/`sb_secret_` 新式 opaque key，私钥无法导出），改为"老 refresh token 换新 token"的续期方案（见 §6.1）。
2. **旧 Supabase 项目保留至少 30 天**，不删除、不改配置，作为回滚与数据兜底。
3. **先演练两次再切换**；切换后一旦开放流量，只允许"向前修"，不允许反向回滚（见 §13）。

---

## 1. 现状盘点

### 1.1 运行架构

```
用户 → Cloudflare（liorvix.com）→ nginx :443 → Next.js 自定义 server :5000（liorvix.service）
                                                     ├── Supabase Cloud（Auth / PostgREST / Storage）
                                                     ├── Alibaba Model Studio（文本、ASR、TTS）
                                                     ├── Cartesia（TTS）
                                                     └── JS Feed collector（hfscareer.com）
后台任务：与 Web 同进程（JOBS_AUTO_WORKER=true）运行 job sync / maintenance / resume / application-profile worker
```

- 应用入口：`src/server.ts`（Next.js 16 + 自定义 HTTP server，含面试 ASR/TTS WebSocket）。
- 部署：`scripts/deploy-production.sh`，systemd `liorvix.service`，`/opt/liorvix`，监听 `127.0.0.1:5000`。
- 数据访问：全部经 `@supabase/supabase-js`（服务端 `getSupabaseClient()`，用户态带 Bearer JWT），依赖 PostgREST + RLS。
- 浏览器端：只用于 Auth（登录、OAuth、session 刷新、OTP 验证），配置由 `GET /api/auth/config` 下发并在 sessionStorage 缓存（60 秒 TTL；旧的无时间戳条目读到即丢弃）。

### 1.2 数据资产清单（生产库实测）

| 类别 | 数量 / 大小 | 说明 |
|---|---|---|
| 数据库总大小 | 4,356 MB | `jobs` 单表 4,050 MB（含 TOAST） |
| 业务表 | 62 张 | 用户、简历、岗位、AI、面试、网申、计费、后台 |
| 视图 | 1 个 | `jobs_listing` |
| 函数 | 101 个（public） | 含检索、计费、后台统计 RPC |
| RLS 策略 | 41 条（public）+ 4 条（storage） | `authenticated` 为隔离主体 |
| 触发器 | `auth.users` 1 个 + `public.jobs` 3 个 | `handle_new_user`、scope/config/region 同步 |
| 扩展 | `pg_trgm`、`pgcrypto`、`uuid-ossp`、`pg_stat_statements`、`supabase_vault` | 自托管镜像需具备前四项 |
| 迁移记录 | `public.liorvix_migration_history` 144 行（最后 2026-11-19） | 部署时 `db:migrate:admin` 依赖此表 |
| 岗位 | 224,741 行 / active 112,727（P0 采集日） | `job_sync_records` 174 MB、`job_sync_runs` 87 MB |
| 账号 | `auth.users` 43 个；身份 44 条（email 35 / GitHub 9，1 人同时绑定两种） | 无 Google 身份 |
| 存储 | 2 个 bucket、67→**69** 个对象、约 11.3 MB（迁移当天实测 49 + 20） | `risingpath-assets`（public，logo/头像）、`risingpath-resumes`（private） |
| 存储外链 | `company_logos` 42 行、`profiles` 1 行使用旧 Supabase 绝对 URL | 切换后必须改写域名 |

### 1.3 Supabase 能力依赖矩阵

| Supabase 能力 | 应用使用点 | 迁移后由谁提供 | 迁移风险 |
|---|---|---|---|
| Postgres + RLS | 全部业务查询 | 自托管 `supabase/postgres` | 低（dump/restore + 策略校验） |
| PostgREST | `supabase-js` 所有 `.from()` / `.rpc()` | 自托管 PostgREST | 低（同版本 API） |
| GoTrue（Auth） | 注册/登录/OTP/邮箱验证/重置/GitHub OAuth/`auth.admin` | 自托管 GoTrue | **中**（schema 版本、SMTP、OAuth） |
| Storage API | 简历上传下载、头像、公司 logo | 自托管 storage-api（file 后端） | 低（对象仅 11 MB） |
| 邮件发送 | 验证码、确认链接、重置密码 | 自有 SMTP | **中**（模板与可达性） |
| API Key / JWT 签名 | 服务端与浏览器 | 自托管生成新套（官方网关已支持 `sb_publishable_`/`sb_secret_` 形态 + ES256 JWKS） | **中**（key 必然更换；靠 refresh token 续期兜住会话） |
| Realtime / GraphQL / Vault | **未使用** | 不部署 | 无 |
| 每日备份 | Supabase Pro 7 天 | 自建 pgBackRest + 对象存储 | **高**（必须自建并演练） |

### 1.4 当前已知问题（迁移前后必须处理）

1. **AI 选岗检索超时（已修复，2026-11-20）**：`search_ai_match_candidates_v7`（[0113](../supabase/migrations/0113_ai_match_search_query_plan.sql)）对 3–10 万级命中做 `ts_rank_cd` 全量排序，生产实测 31–70 秒，被 8 秒语句超时杀死；兜底从 `job_ai_match_scopes` 任意取 240 条，仅 2 条 active，导致"选不出来"。[0139](../supabase/migrations/0139_ai_match_retrieval_bounded.sql) 已重写并在生产库生效（PostgREST 实测 240 条 / 1.8 秒含跨境 RTT），设计与实测见 §10.1。
2. **兜底查询缺陷（已修复，待发版）**：[match/route.ts](../src/app/api/ai/match/route.ts) 不再读 scope 表，改为按 `created_at` 倒序取 2×limit 条活跃岗位、内存中按 `regionMatchesScopeKeys` 过滤，再按 id 回填；整条路径有界，永不再扫描 17.9 万行 scope 表。
3. **scope 残留**：`job_ai_match_scopes` 179,741 行中约 9.2 万条对应已下架岗位；检索路径已不再依赖该表，清理由 P1 收尾项处理（§10.1）。
4. **冷读极慢（新发现，2026-11-20）**：`jobs` 4.0 GB 中 2.7 GB 是 TOAST（`ai_match_search` 均值 6.7 KB、最大 20 KB），Cloud 实例冷读随机页约 0.7 ms/页（≈1400 IOPS），所以任何"多扫几千行"的查询都会退化到 3–20 秒。这既是 AI 选岗的病根，也是自托管最直接的收益（本地 NVMe + 16 GB 缓存，4.3 GB 库可全量常驻）。
5. **JSON 未压缩**：`/api/jobs` 返回 194 KB，nginx 未压缩 JSON，出口流量与延迟被放大 5–8 倍。
6. **worker 与 Web 混跑**：job sync 单轮约 52 秒，高峰期抬高接口 p95；简历解析等 CPU 任务也在同一进程。
7. **脚本硬编码生产 ref（已改为 host 校验）**：`deploy-production.sh`、`audit-job-field-phase1.ts`、`reparse-official-job-experience.ts` 原先断言 project ref = `weqvdtdjdzmqflhwobec`，自托管域名必然失败；现统一改为 `EXPECTED_SUPABASE_HOST`（托管项目默认 `<ref>.supabase.co`），并有 8 组用例验证（§8.3）。`create-production-env.ts` 仍校验 6543 池地址，属切换时一次性脚本，按 §8.3 调整即可。

---

## 2. 目标架构

> **v1.3 调整（已落成文件）**：取消 Envoy/Kong 网关，改为 nginx 按路径把三个服务拼到同一个域名下
> （`deploy/nginx/supabase.conf`）；JWT 用 HS256 对称密钥（不再需要 ES256 私钥/JWKS 分发）；
> 管理台放进 compose 的 `studio` profile，默认不启动。这样常量从 7 个容器降到 5 个，少一个
> 需要手写配置文件的网关进程 —— 对"单人运维 + 要求高可用"是净收益。完整栈见
> [deploy/supabase/docker-compose.yml](../deploy/supabase/docker-compose.yml) 与
> [deploy/supabase/README.md](../deploy/supabase/README.md)。

```
                         ┌──────────────────────── VPS 43.172.117.125 ─────────────────────────┐
Internet → Cloudflare → nginx :443 │  liorvix.com            → 127.0.0.1:5000  (Next.js)
                                   │  supabase.liorvix.com   → 按路径分流（无网关容器）：
                                   │      /auth/v1/*    → 127.0.0.1:9999  GoTrue
                                   │      /rest/v1/*    → 127.0.0.1:3000  PostgREST
                                   │      /storage/v1/* → 127.0.0.1:5100  storage-api
                                   │
                                   │  Docker Compose: /opt/supabase
                                   │   ├── db         (PostgreSQL 17.6) :5432 仅本机
                                   │   ├── auth       (GoTrue)      ─┐
                                   │   ├── rest       (PostgREST)   ─┼─→ db
                                   │   ├── storage    (storage-api) ─┘
                                   │   ├── imgproxy   (storage 依赖) :5101
                                   │   └── studio/meta  (profile，默认不启动)
                                   │
                                   │  /opt/liorvix  (Next.js + worker 拆分)
                                   │  /opt/supabase/volumes/{db,storage}
                                   │  /opt/liorvix-backups（本地）→ 对象存储（异地）
                                   └────────────────────────────────────────────────────────────┘
```

**组件与版本**

| 组件 | 版本策略 | 资源上限 |
|---|---|---|
| PostgreSQL | 官方 compose 固定 `supabase/postgres:17.6.1.136`（与 Cloud 17.6 同小版本） | `shared_buffers=4GB`，容器内存 8 GB |
| GoTrue | 官方 compose 固定 `supabase/gotrue:v2.197.0`；启动后校验 `auth.schema_migrations` ≥ `20261030120000`（若报 schema 错误，升到 `v2.198.0`，Docker Hub 已有） | 512 MB |
| PostgREST | 官方 compose 固定 `postgrest/postgrest:v14.18`，`PGRST_DB_SCHEMAS=public` | 512 MB |
| storage-api | 官方 compose 固定 `supabase/storage-api:v1.89.12`，`STORAGE_BACKEND=file` | 768 MB |
| 入口 | **宿主机 nginx**（已有 1.24.0），按路径转发，无 Envoy/Kong | 复用现有 |
| Studio | `supabase/studio:2026.11.02-sha-a05e7ec` + `postgres-meta:v0.100.0`，`--profile studio` 才启动，只监听 127.0.0.1:5102/5103 | 512 MB |

**不部署**：realtime、supavisor/pooler、vector/analytics、edge functions、graphql。应用未使用，减少攻击面与内存占用；`imgproxy` 仅作为 storage 依赖随其启动，不对外暴露。

**已验证的"可安全搬运"事实（2026-11-20 生产库实测）**：

| 检查项 | 结果 |
|---|---|
| public/auth 触发器、函数、RLS 策略是否依赖 `supabase_functions`/`realtime`/`graphql`/`vault`/`net`/`cron` | **全部为 0**（无跨 schema 依赖） |
| 外部 FDW / logical replication publication | **无** |
| 已装扩展 | `pg_stat_statements`、`pgcrypto`、`uuid-ossp`（都在 `extensions`）、`pg_trgm`（在 **public**）、`supabase_vault`（在 `vault`） |
| 结论 | `pg_dump --schema=public --schema=auth` 是自包含的；唯一需要额外处理的是 **`pg_trgm` 要重定位到 public**，否则 dump 里的 `gin_trgm_ops` 索引恢复会失败（bootstrap 脚本已处理） |

**schema-only dump 实证（2026-11-20，本机 `pg_dump 17` 直连生产，只读）**：

| 检查 | 实际输出 | 含义 |
|---|---|---|
| trgm 索引的 opclass 写法 | `USING gin (company public.gin_trgm_ops)` / `USING gin (title public.gin_trgm_ops)` | **带 schema 前缀**，必须先在 public 里装上 pg_trgm，否则恢复报 `operator class "public.gin_trgm_ops" does not exist` |
| dump 里的 `CREATE EXTENSION` | **0 条** | 扩展只能由 bootstrap 预装（pg_trgm/pgcrypto/uuid-ossp/pg_stat_statements 四条已经写进 bootstrap） |
| 跨 schema 引用计数 | `extensions.` / `vault.` / `supabase_functions.` / `realtime.` / `graphql.` / `net.` / `cron.` 全为 **0** | public+auth 不依赖任何其它 schema |
| 对象规模 | 89 张表 / 41 条策略 / `auth.uid(` 75 处 / `public.ai_match_region_scope(` 19 处 | 与基线一致，RLS 是主要 auth 依赖 |

**与官方 `supabase/docker` 逐项核对后的 5 处修正（2026-11-20，同一个 image tag 对照官方 compose）**：

| 项 | 官方写法 | 我们原先的问题 | 修正后 |
|---|---|---|---|
| storage 的 JWT 变量名 | `AUTH_JWT_SECRET` | 只写了 `PGRST_JWT_SECRET`（旧别名，v1.89 不读）→ 上传会 401 | 两个都给 |
| storage 的对外 URL | `STORAGE_PUBLIC_URL: ${SUPABASE_PUBLIC_URL}` | 没设 → 返回的 publicUrl 可能是容器内地址 | `STORAGE_PUBLIC_URL: ${API_EXTERNAL_URL}` |
| 反代下的路径 | `REQUEST_ALLOW_X_FORWARDED_PATH: "true"` | 没设 → nginx 后面生成的 URL 会丢 `/storage/v1` | 已加 |
| 邮件链接路径 | `MAILER_URLPATHS_*=/auth/v1/verify` | 用 GoTrue 默认 `/verify` → 自托管没有该路由，确认邮件 404 | 四个都显式配 `/auth/v1/verify` |
| initdb 挂载 | 只挂单个文件到子目录 | 我们挂了**整个目录**到 `/docker-entrypoint-initdb.d` → 覆盖镜像自带初始化 | 改为 `/opt/liorvix/bootstrap` + 显式执行 |

---

## 3. 迁移原则与总策略

1. **先改代码，再搬库**：AI 检索、兜底、gzip、worker 拆分在旧库上先上线并观察 2–3 天，避免把已知 bug 搬过去。
2. **靠 refresh token 免掉线**：迁移 auth 会话表 + `refresh_token_hmac_key`，旧 refresh token 换新 access token；不依赖密钥复用（物理上做不到，见 §6.1）。
3. **两阶段搬运**：演练环境完整跑一遍 → 正式窗口做最终 dump/restore（4.3 GB 导出 + 单线程恢复预计 15–30 分钟，索引重建占大头）。
4. **数据校验驱动**：行数、序列、函数、策略、对象、用户全部有基线快照，切换后逐项比对。
5. **旧库 30 天兜底**：不删、不改、不降级；确认稳定后再取消订阅。
6. **只向前修**：维护窗口内失败可回滚；开放流量后失败只修不滚（避免丢新写入）。

---

## 4. 阶段计划

| 阶段 | 内容 | 预计 | 产出 / 验收 |
|---|---|---|---|
| **P0 准备** | 收集凭据、基线快照、备份现有 env、确认维护窗口 | 0.5 天 | §4.1 清单全部就绪 |
| **P1 应用改造** | AI 检索 SQL、兜底、gzip、worker 拆分、脚本 ref、auth 缓存 key | 2 天 | 旧库上功能正常，CI/构建通过（进度见 §4.2） |
| **P2 新栈搭建** | Docker + compose + PG17 + GoTrue/REST/Storage + nginx/TLS | 1 天 | `supabase.liorvix.com` 健康检查通过（产物已落盘，见 §4.3） |
| **P3 首次演练** | dump/restore、auth/storage 迁移、staging 应用联调 | 1 天 | 冒烟 + 登录全流程通过 |
| **P4 全量验收** | 功能矩阵全跑、压测、备份恢复演练、第二次迁移演练 | 2 天 | 验收清单 100% |
| **P5 正式切换** | 维护窗口内切换（§12） | 0.5 天 | 线上冒烟通过，观察 2 小时 |
| **P6 观察收尾** | 监控 14 天、旧库归档、退订 | 30 天 | 无回归，账单归零 |

### 4.1 P0 必须准备好的东西

> 采集状态见 [p0-migration-prerequisites-collected.md](p0-migration-prerequisites-collected.md)（含第二轮凭据验证 §11）。**14 项中 10 项已 ✅；只剩 2 项等你补值，1 项待定。**

- [x] ✅ 生产服务器 SSH（`ubuntu@43.172.117.125`）+ 免密 sudo + 资源/端口/证书盘点
- [x] ✅ 数据库连接串（`aws-0-us-west-1.pooler.supabase.com:6543`，已实测可 dump）
- [x] ✅ 现有 `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`（服务器 `/opt/liorvix/.env.local`；**注意是新式 `sb_publishable_` / `sb_secret_`，不能照搬**）
- [x] ✅ ~~JWT Secret~~ **不需要了**：项目用 ES256 非对称密钥，私钥不可导出；改走 §6.1 续期方案
- [x] ✅ SMTP 提供商已确认 **Brevo**（发件人 `noreply@liorvix.com`，SPF + `default._domainkey.mail` DKIM 齐全，已实测收信成功）
- [x] ✅ SMTP key 已收到（`xsmtpsib-…`），连接/STARTTLS/AUTH 流程实测可用（535 仅因用户名不对）
- [x] ✅ GitHub OAuth **新 App `Ov23liSDUNUddkcJoYkb` + secret 已验证配对**（`bad_verification_code` 而非 `incorrect_client_credentials`）
- [x] ✅ Cloudflare 区域已确认（zone `d09765a8…`，Free，`liorvix.com` 橙云代理）
- [x] ✅ Cloudflare Token 有效性已验证（`status=active`，可读 DNS）
- [x] ✅ Docker 可由 apt 直接安装（`docker.io 29.1.3` + `docker-compose-v2`），Docker Hub 直连可用，无需镜像站
- [x] ✅ 出站 SMTP 端口 587/465 未被封，GoTrue 发信可行
- [x] ✅ 基线快照已产出：`docs/baseline/prod-before-2026-11-20.json`（脚本 `scripts/snapshot-db-baseline.ts`，支持 `--compare`）
- [x] ⚠️ Auth 邮件模板**部分**自动捕获：`docs/baseline/email-templates-captured/`（确认信 + 重置信）；OTP 撞 429、邀请信未送达，其余需从 Dashboard 补
- [ ] ⏳ **Brevo SMTP `Login`**（`xxx@smtp-brevo.com`，与 key 同页面）— 唯一没有替代方案的阻塞项
- [ ] ⏳ **Cloudflare DNS Edit 权限**（当前 Token 只读：建记录 403 / purge 401），或你手工加 `supabase` A 记录（灰云 / DNS only）
- [ ] ⏳ **本机到 VPS 的 SSH 通道**（`ssh ubuntu@43.172.117.125` 目前 `Permission denied (publickey,password)`；两种解法：把公钥加进 `~/.ssh/authorized_keys`，或你在服务器上按 README 逐条执行）— 阻塞 P3/P5
- [ ] ⏳ **维护窗口**（10–20 分钟静默，建议 02:00–04:00）— 可在演练通过后再定，不阻塞 P1/P2

### 4.2 P1 可用性修复进度（2026-11-20）

> 目标：**交付时是"处处能用"的站点**，而不是"迁移完再修"。P1 里所有不依赖新栈的修复都先在现网做完并验证。

| # | 项目 | 状态 | 证据 |
|---|---|---|---|
| 1 | AI 选岗检索可超时 | ✅ 已修 + 已进生产库 | 0139 已 `create or replace` 生效；PostgREST 实测 240 条 / 1.78 s；8 组场景矩阵见 §10.1 |
| 2 | AI 选岗兜底只剩 2 条 | ✅ 代码已改（需随下次发版上线） | `route.ts` 改为活跃岗位倒序 + 内存地区过滤；`tsc` 通过 |
| 3 | 部署/审计脚本硬编码旧 ref | ✅ 已完成 | 3 个脚本统一 `EXPECTED_SUPABASE_HOST`；Git Bash 8 组用例通过；`tsc` 通过 |
| 4 | 冷读放大（TOAST 2.7 GB） | ✅ 根因定位，已纳入 0139 设计 | 见 §1.4 第 4 条 / §10.1 实测表 |
| 5 | nginx JSON 未 gzip | ✅ 片段就绪（待服务器执行） | `deploy/nginx/gzip.conf` 已写好含验证/回滚步骤；上线后 `/api/jobs` 预期 194 KB → ~25 KB |
| 6 | worker 与 Web 混跑 | ✅ 单元就绪（待服务器执行） | `deploy/systemd/liorvix-worker.service`；`src/server.ts` 已有 `WORKER_ONLY` 分支（实读代码确认） |
| 7 | auth 配置缓存 key + 会话跨域连续 | ✅ 已完成 | 缓存 key → v2；`storageKey` 固定 `liorvix.auth.session.v1`；旧 `sb-*-auth-token` 一次性迁移；host 变化主动 refresh；`test:auth-session-migration` 10 场景通过（§6.1） |
| 8 | `job_ai_match_scopes` 9.2 万残留 | ⏳ 待做（不阻塞） | 检索已不依赖；清理 SQL 见 §10.1 |
| 9 | `create-production-env.ts` 6543 断言 | ✅ 已完成 | 改为"托管池 6543 或自托管 5432/socket 二选一"，`tsc` 通过 |

### 4.3 P2 产物（已落盘，可直接部署）

| 文件 | 内容 | 校验 |
|---|---|---|
| [deploy/supabase/docker-compose.yml](../deploy/supabase/docker-compose.yml) | 7 个服务（db/auth/rest/storage/imgproxy + studio/meta profile），端口全部只绑 127.0.0.1，Postgres 用 `-c` 传 §10.2 的调优参数 | YAML 解析通过；43 个变量与模板一一对应；服务语义自检通过（端口全部只绑 127.0.0.1、无冲突、depends_on/卷/网络均有效） |
| [deploy/supabase/.env.example](../deploy/supabase/.env.example) | 43 个变量，`[auto]`/`[user]` 标注 | 与 compose 交叉校验：无缺、无多余 |
| [deploy/supabase/bootstrap/10-liorvix-roles.sh](../deploy/supabase/bootstrap/10-liorvix-roles.sh) | 角色（含 Cloud 专有 `supabase_admin`/`dashboard_user`）、`auth`/`storage`/`extensions` schema、**pg_trgm 条件式重定位到 public** | `bash -n` 通过；本机演练实测 0 error，§5.5 |
| [deploy/nginx/supabase.conf](../deploy/nginx/supabase.conf) | `/auth/v1`→9999、`/rest/v1`→3000、`/storage/v1`→5100、`/healthz`；storage 额外传 `X-Forwarded-Path`；三个 location 各 include CORS 预检片段 | ✅ VPS 已上线：三条路径 200，主站 `liorvix.com` 不受影响 |
| [scripts/migrate/generate-selfhost-secrets.mjs](../scripts/migrate/generate-selfhost-secrets.mjs) | 生成 JWT_SECRET / POSTGRES_PASSWORD / anon+service_role JWT / imgproxy key+salt | 实跑：JWT 自校验通过，二次写入拒绝（防误轮换），env 11 个必填项齐全 |
| [scripts/migrate/dump-from-cloud.sh](../scripts/migrate/dump-from-cloud.sh) | 5432 会话模式导出 public+auth，带 pg_dump 主版本校验、耗时/大小/行数基线 | `bash -n` 通过 |
| [scripts/migrate/restore-into-selfhost.sh](../scripts/migrate/restore-into-selfhost.sh) | 容器内 `pg_restore --clean --disable-triggers`（**单线程** + `-L` 过滤 public-schema/DEFAULT ACL 条目），白名单兜底，`vacuum analyze`，行数/RPC/ACL 保真断言 | `bash -n` 通过；同参数本机演练两遍均 0 error，§5.5 |
| [scripts/migrate/bootstrap-roles.sh](../scripts/migrate/bootstrap-roles.sh) | 非空数据目录时手动补角色 | `bash -n` 通过 |
| [deploy/supabase/README.md](../deploy/supabase/README.md) | 首次部署 7 步、部署后 6 条验证、排障速查、回滚 | - |
| [scripts/migrate/smoke-test.sh](../scripts/migrate/smoke-test.sh) | 9 组可用性检查（应用/Auth/REST/RPC/Storage/CORS/配置一致性/压缩） | ✅ VPS 对自托管栈实跑：**11 PASS / 0 FAIL / 2 WARN**（WARN = 没给 refresh token 样本、应用还指着 Cloud） |
| [scripts/migrate/verify-data.sh](../scripts/migrate/verify-data.sh) + [compare-baseline.mjs](../scripts/migrate/compare-baseline.mjs) | 快照 + 分级对账（缺表/行数减少 → FAIL；体积/序列/上下架变化 → WARN）；`storageByBucket` 支持"桶内对象只增" | ✅ VPS 实跑 **exit 0**：全部行数只增不减；另修了把"窗口内新上传简历"误判成 FAIL 的比较逻辑 |
| [scripts/migrate/migrate-storage-objects.mjs](../scripts/migrate/migrate-storage-objects.mjs) | 递归枚举 + 逐对象复制 + 上传后回查 + 逐 bucket 对账 | ✅ VPS 实跑：**69 对象 / 11.32 MB，failed 0**，两个桶 49 / 20 计数一致 |
| [scripts/migrate/apply-storage-policies.sh](../scripts/migrate/apply-storage-policies.sh) | 在 storage-api 建好 schema 后重建简历桶 4 条 RLS 策略并核对数量 | ✅ VPS 实跑 4 条策略；**必须 `-U supabase_admin`**（`postgres` 会报 `must be owner of table objects`） |
| [scripts/migrate/rewrite-storage-urls.mjs](../scripts/migrate/rewrite-storage-urls.mjs) | 改写库里指向旧域名的绝对 URL（dry-run 默认，`--apply` 生效，幂等） | ✅ VPS 实跑：**42 + 1 = 43 行改写完毕**，全库 text/jsonb 列扫描**零残留** |
| [scripts/migrate/cutover-app-env.sh](../scripts/migrate/cutover-app-env.sh) | 切流：`--check` 脱敏对比 / `--apply` 备份后改写 5 个变量 / `--restart` 重启校验 / `--rollback` 一条命令退回 | ✅ VPS `--check` 实跑：正确列出 5 个待改变量；备份 600 权限；不手抄 base64 密钥 |
| [scripts/migrate/preflight-cutover.sh](../scripts/migrate/preflight-cutover.sh) | 切流前置体检 8 项：公网 DNS（DoH，绕开 /etc/hosts 垫片）/ 证书 / 三条数据面 / CORS 预检 / GitHub OAuth / SMTP / 应用指向 / 栈健康 | ✅ VPS 实跑能精确定位"还差哪几件"（当前 3 PASS / 8 FAIL，全部是外部依赖） |
| [scripts/migrate/enable-tls.sh](../scripts/migrate/enable-tls.sh) | DNS 生效后一条命令签证书：先校验解析=本机 IP，再 `certbot --nginx`，最后验 4 条路径 + 续期演练 | ✅ 实跑：DNS 未生效时干净退出并给出要加的记录；`--dry-run` 只走 ACME 校验 |
| [scripts/migrate/run-cutover.sh](../scripts/migrate/run-cutover.sh) | 一键切换编排（preflight→dump→restore→storage→urls→verify→env→app→smoke），任一步失败自动回滚 env | ✅ 实跑：preflight 未过时**在第 1 步就停**，应用仍在跑且仍指向 Cloud（零副作用） |
| [scripts/migrate/healthcheck.sh](../scripts/migrate/healthcheck.sh) + [deploy/systemd/liorvix-healthcheck.timer](../deploy/systemd/liorvix-healthcheck.timer) | 每 5 分钟巡检容器/HTTP/磁盘/数据库/备份新鲜度，异常写 journal + 可选 webhook | ✅ VPS 已装：首跑 5/5 容器、4/4 端点、磁盘 64%、conns 4/100、备份 0 小时前 |
| [scripts/migrate/restore-benign-errors.txt](../scripts/migrate/restore-benign-errors.txt) | 恢复时允许的"已存在"类噪音白名单 | 与 restore 脚本配套 |
| [scripts/migrate/db-backup.sh](../scripts/migrate/db-backup.sh) + [deploy/systemd/liorvix-db-backup.timer](../deploy/systemd/liorvix-db-backup.timer) | 每日 03:20 全备 public+auth（原子落盘、TOC 校验、7 天保留）+ 伴生 `.pre.sql`（扩展 DDL），systemd timer 驱动 | ✅ VPS 实跑：**423 MB / 65 秒 / TOC 1277**；再从这份 dump 真恢复 217 秒，§11.3.1 |
| [deploy/nginx/supabase-cors-preflight.conf](../deploy/nginx/supabase-cors-preflight.conf) | OPTIONS 预检专用 CORS 片段（GoTrue 自己不发预检头） | ✅ VPS：三个端点预检均 `ACAO: *`，真实响应仍只有 1 个 ACAO |
| [scripts/migrate/check-artifacts.mjs](../scripts/migrate/check-artifacts.mjs) | 静态体检：docs 相对链接、LF 行尾、compose 变量与模板一致性 | ✅ 通过：43/43 变量、112 链接、15 文件 |

> ~~还没做的 P2 部分：真实 `docker compose up` 以及 4.3 GB 数据的容器内恢复~~
> **已在 VPS 上全部做完**：真的 `docker compose up`、真的 421 MB dump、真的 219 秒恢复、真的冒烟 —— 结果见 §5.6 / §5.7。

---

## 5. 数据库迁移手册

### 5.1 角色与扩展（新库先建）

**已经脚本化**：[deploy/supabase/bootstrap/10-liorvix-roles.sh](../deploy/supabase/bootstrap/10-liorvix-roles.sh)，
**显式执行一次**（`docker compose exec -T db bash /opt/liorvix/bootstrap/10-liorvix-roles.sh`，封装在
[scripts/migrate/bootstrap-roles.sh](../scripts/migrate/bootstrap-roles.sh) 里，`restore-into-selfhost.sh` 也会先跑它）。
脚本是幂等的，做六件事：

1. 建 `anon` / `authenticated` / `service_role`（nologin，`service_role` 带 `bypassrls`）；
2. 建 `authenticator` / `supabase_auth_admin` / `supabase_storage_admin`（口令 = `POSTGRES_PASSWORD`，password 走 psql 变量，含特殊字符也不需要转义）；
3. 建 **Cloud 专有角色** `supabase_admin`（superuser）与 `dashboard_user`：dump 里有
   `ALTER SCHEMA auth OWNER TO supabase_admin`、35 处 `GRANT ... TO dashboard_user`、
   `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin`；角色缺失时本机演练实测 39 处报错。
   `supabase/postgres` 镜像虽然会自建它们，但显式补上才能不依赖镜像内部实现；
4. 授权：`grant anon,authenticated,service_role to authenticator`、`grant create on database` 给两个迁移用户、预建 `auth`/`storage` schema 并指定 owner；**不写 default privileges**（表级 GRANT 由 dump 自带，避免权限漂移）；
5. 建 `extensions` schema 并确保 `pgcrypto` / `uuid-ossp` / `pg_stat_statements` / `citext` 在 `extensions`（dump 里没有 `CREATE EXTENSION`）；
6. **重定位 `pg_trgm` 到 `public`**（见下）。

> 为什么不用 initdb 自动执行：把 `./bootstrap` 挂到 `/docker-entrypoint-initdb.d` 会**整目录覆盖**
> 镜像自带的初始化脚本（schema/角色/pgsodium 等）。现在的做法是镜像默认初始化照旧跑，我们的脚本
> 在 `up -d db` 之后显式跑，既安全又能在"已有数据"时重复执行。

扩展与 Cloud 保持一致；Cloud 的 `pg_trgm` 装在 `public`，`supabase/postgres` 镜像装在 `extensions`。
dump 里 trgm 索引是 `USING gin (title public.gin_trgm_ops)` 这种**带 schema 前缀**的写法（已实证），
所以不重定位就会在恢复时报 `operator class "public.gin_trgm_ops" does not exist`：

```sql
-- bootstrap 里的真实实现（幂等：只在"不在 public"时才重装，避免已恢复库上的 trgm 索引依赖报错）
do $$
declare
  trgm_schema text;   -- 不能叫 current_schema：PL/pgSQL 会把它解析成内置函数，SELECT INTO 静默失效
begin
  select n.nspname into trgm_schema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';
  if trgm_schema is null then
    create extension if not exists pg_trgm with schema public;
  elsif trgm_schema <> 'public' then
    drop extension pg_trgm;
    create extension pg_trgm with schema public;
  end if;
end
$$;
```

> `pgcrypto` / `uuid-ossp` / `pg_stat_statements` Cloud 都在 `extensions` 下，bootstrap 会显式
> `create extension if not exists … with schema extensions` 兜底（dump 里没有 `CREATE EXTENSION`）。
> `supabase_vault` 在 `vault` 下：生产库已核实 public/auth 里没有任何对象引用它，不需要迁移。

### 5.2 导出（在 VPS 上执行，优先 5432）

**已脚本化**：[scripts/migrate/dump-from-cloud.sh](../scripts/migrate/dump-from-cloud.sh)。它比下面的手写命令多做了几件必要的事：
校验 `pg_dump` 主版本 ≥ 17（Ubuntu 24.04 默认的 16 会直接拒绝 17 的服务端）、要求 5432 会话模式连接串、
把行数基线写进 `counts-<stamp>.txt`、记录耗时/大小/日志。

```bash
# 安装同版本客户端（Ubuntu 24.04 默认只有 16）
sudo apt-get install -y postgresql-client-17

CLOUD_DB_URL='postgresql://postgres.weqvdtdjdzmqflhwobec:<db-password>@aws-0-us-west-1.pooler.supabase.com:5432/postgres' \
OUT_DIR=/opt/liorvix-backups bash scripts/migrate/dump-from-cloud.sh
```

等价的裸命令（供排障对照）：

```bash
pg_dump "$SRC" --format=custom --compress=6 \
  --schema=public --schema=auth \
  --no-publications --no-subscriptions \
  --file=/opt/liorvix-backups/liorvix-$(date +%Y%m%d-%H%M).dump
```

> 保留 ownership（**不要** `--no-owner`）：Cloud 里 `auth` 归 `supabase_auth_admin`、`public` 归
> `postgres`，本地角色名完全一致，恢复后 ownership 才是对的。也**不要**加 `--no-privileges`，
> 否则 anon/authenticated 的 GRANT 丢失，RLS 直接失效。

**带宽实测（2026-11-23，本机 Windows/上海 → Supabase us-west-1）**：直接对 pooler 5432 做 `pg_dump` 时，
`pg_stat_progress_copy` 显示 415 秒只搬了 28.5 MB（≈68 KB/s，后端一直卡在 `ClientWrite`）；
同一台机器用 HTTPS REST 取 1.27 MB 只要 1.7 秒（≈775 KB/s）。结论：**慢在长连接 pg 通道，不是纯带宽**，
所以：

- 全量 dump **只在 VPS 上跑**（`dump-from-cloud.sh` 本来就是这么设计的）；本机只做 600 KB 的 schema 与 145 KB 的 auth 数据演练（§5.5 已完成）。
- VPS 上先跑 5 分钟看 `pg_stat_progress_copy.bytes_processed` 估算总耗时；若也 <1 MB/s，按顺序用兜底：
  1. `pg_dump -Fd -j 8 --compress=6`（并行 COPY，多连接叠加吞吐；目录格式 + `pg_restore -j 8` 配套）；
  2. 开 Supabase IPv4 add-on 走 **直连 5432**（绕开 pooler 的单连接节流），一次性费用，迁移后可退订；
  3. 在 us-west-1 临时起一台小 VM 做"同区 dump"，再 rsync 回 VPS（用对象存储中转，避免跨境长连接）。
- 预算：1.2–1.5 GB 压缩 dump 在 ≥1 MB/s 时约 20–25 分钟；把维护窗口的下限按"dump 25 分钟 + 恢复 15–30 分钟"准备。

### 5.3 恢复

**已脚本化**：[scripts/migrate/restore-into-selfhost.sh](../scripts/migrate/restore-into-selfhost.sh)。五个关键设计（每一条都对应一次真实演练踩到的坑，见 §5.4）：

- `--disable-triggers`：否则 11 万行 `jobs` 插入会触发 scope/AI 检索维护触发器，恢复从 1–2 分钟变成半小时以上；
- **单线程恢复（不传 `--jobs`）**：`--clean` 与并行会让"drop"和"create"交错，演练实测出现过 pg_trgm 被后置 drop、函数数量 101→70 的间歇性损坏；
- **用 `pg_restore -L` 过滤两类条目**：`SCHEMA - public`（否则 `DROP SCHEMA public` 必失败、`CREATE` 必重复）与 `DEFAULT ACL`（Cloud 默认权限会给 anon 灌 ALL，属权限放大）；
- **硬断言**：恢复后检查 `pg_trgm` 在 public、v7 RPC 没有 anon EXECUTE、`jobs` RLS 开启、`auth.users` 属主是 `supabase_auth_admin`，任一 FAIL 立即退出；
- 恢复后自动 `vacuum analyze`（不做的话切换后第一波查询就是冷读 4 GB，正是 §10.1 那类慢查询）。

```bash
DUMP_FILE=/opt/liorvix-backups/liorvix-<stamp>.dump \
  bash scripts/migrate/restore-into-selfhost.sh
# 期望：errors: 0 total / 0 unexpected，fidelity checks 全 ok
```

手工等价命令（演练排障用）：

```bash
cd /opt/supabase && docker compose up -d db
docker compose exec -T db pg_isready -U postgres
docker compose cp /opt/liorvix-backups/liorvix-<stamp>.dump db:/tmp/restore.dump
# 1) 生成清单并过滤（两条规则都必须有）
docker compose exec -T db pg_restore -l /tmp/restore.dump > /tmp/restore.list
grep -vE '^[0-9]+; [0-9]+ [0-9]+ (SCHEMA - public |DEFAULT ACL)' /tmp/restore.list > /tmp/restore.filtered.list
docker compose cp /tmp/restore.filtered.list db:/tmp/restore.filtered.list
# 2) 单线程恢复
docker compose exec -T db pg_restore --clean --if-exists --disable-triggers \
  --dbname=postgres -L /tmp/restore.filtered.list --verbose /tmp/restore.dump
```

**所有权**：dump 里 `ALTER SCHEMA auth OWNER TO supabase_admin` 会照常执行（bootstrap 已创建该角色），
`auth` 下所有表的属主仍是 `supabase_auth_admin`，并且 dump 的 ACL 给了它
`GRANT ALL ON SCHEMA auth`（含 CREATE），所以 GoTrue 后续迁移能正常建表。
**正常恢复不需要手工改所有权**；只有在演练中真的看到 `must be owner of relation/schema`
时才执行下面的修正：

```sql
-- 所有权修正（仅在报 must be owner 时；GoTrue / Storage 需要对自己的 schema 有 DDL 权限）
alter schema auth owner to supabase_admin;
grant usage, create on schema auth to supabase_auth_admin;
-- storage schema：由 storage-api 首次启动时自动创建，owner 即 supabase_storage_admin；
-- 若你在它创建之后又手工恢复过，再执行：
-- alter schema storage owner to supabase_storage_admin;
-- grant usage, create on schema storage to supabase_storage_admin;

-- 登录角色密码：Cloud 的哈希未知，统一改成 compose 的 POSTGRES_PASSWORD
alter role authenticator with password '<POSTGRES_PASSWORD>';
alter role supabase_auth_admin with password '<POSTGRES_PASSWORD>';
alter role supabase_storage_admin with password '<POSTGRES_PASSWORD>';

-- 让 PostgREST 重新加载 schema
notify pgrst, 'reload schema';
```

> 官方 compose 的 `.env` 使用 `JWT_SECRET` / `ANON_KEY` / `SERVICE_ROLE_KEY` / `PGRST_DB_SCHEMAS` 等变量，再由 compose 注入为容器内的 `GOTRUE_JWT_SECRET` / `PGRST_JWT_SECRET`。下文的 `GOTRUE_*` 写法在官方 compose 中对应 `.env` 的 `JWT_SECRET` / `SITE_URL` / `SMTP_*` 等；修改时以 `/opt/supabase/.env` 为准，不要重复定义。

### 5.4 校验（必须与基线一致）

```sql
-- 行数
select 'jobs' t, count(*) from public.jobs
union all select 'profiles', count(*) from public.profiles
union all select 'resumes', count(*) from public.resumes
union all select 'auth.users', count(*) from auth.users
union all select 'auth.identities', count(*) from auth.identities;

-- 对象数量
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'; -- 101
select count(*) from pg_policies where schemaname='public';                                            -- 41
select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r';                                                          -- 62
select count(*) from pg_views where schemaname='public';                                               -- 1

-- 序列/视图/触发器
select count(*) from public.jobs_listing limit 1;
select tgname from pg_trigger where tgname='on_auth_user_created';
select count(*) from public.liorvix_migration_history;                                                 -- 144
```

**基线快照**用附录 B 的脚本生成 `baseline.json`，与恢复后生成的 `after.json` diff，必须全等（允许 `created_at` 类字段除外）。

### 5.5 本机演练结果（2026-11-20，DDL + auth 数据面）

用真实的 `10-liorvix-roles.sh` 和真实的 Cloud schema dump（608 KB，`server_version_num=170006`）
在本机临时 PostgreSQL 17.11 集群（端口 55433，模拟 compose 的 17.6 主版本）上完整跑了两遍恢复，
**两遍都是 0 error / 0 unexpected**（幂等可重复）。对象面与 §5.4 的期望值逐项吻合：

| 校验项 | 期望 | 演练实测 |
| --- | --- | --- |
| public / auth 表 | 62 / 27 | 62 / 27 ✅ |
| `public` 策略 | 41 | 41 ✅ |
| `public` 函数 | 101 | 101 ✅ |
| `search_ai_match_candidates_v7` | 存在，仅 authenticated/service_role 可执行 | 存在，grantees=`authenticated,postgres,service_role` ✅ |
| `pg_trgm` 操作符类 | 在 `public` | `public.gin_trgm_ops` ✅ |
| `jobs` 索引 | 39 | 39 ✅ |
| `auth.uid()` | 存在 | 存在 ✅ |
| `public` 属主 | `pg_database_owner`（与 Cloud 一致） | `pg_database_owner` ✅ |
| `auth` 属主 / `auth.users` 属主 | `supabase_admin` / `supabase_auth_admin` | 一致 ✅ |
| anon 对 `jobs` 的表级授权 | 7 条（读 + RLS 兜底） | 7 ✅ |
| 启用 RLS 的 public 表 | 58 / 62 | 58 ✅ |

**auth 数据面**（1.8 MB 的 `auth` schema 单独 dump，145 KB）恢复后与生产**逐字节指纹一致**：

| 表 | 行数 | 指纹（md5，与生产比对） |
| --- | --- | --- |
| `auth.users` | 43 | `eb5b51bf53d9e9bd3a6be5cb88ba8299` ✅ |
| `auth.identities` | 44 | — |
| `auth.sessions` | 66 | ids `a5d9273028fb6f5b626e208666d9b906`，users `206a9f1be8a0d3453a5c216d674e5d57` ✅ |
| `auth.refresh_tokens` | 328 | `9fa0a04eecd5191daf67cee1e9719a06` ✅ |
| `auth.schema_migrations` | 84 | max `20261030120000` ✅ |

即"用户不掉线"的数据前提成立，`supabase_auth_admin` 的属主关系也保住了（GoTrue 后续迁移能建表）。

演练暴露并已修正的 5 个真问题（每一个都会让线上恢复失败或权限漂移）：

| # | 现象 | 根因 | 修正 |
| --- | --- | --- | --- |
| 1 | 39 处 `role "dashboard_user"/"supabase_admin" does not exist` | Cloud dump 里 `ALTER SCHEMA auth OWNER TO supabase_admin`、`GRANT ... TO dashboard_user`、`ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` 引用了 Cloud 专有角色，镜像虽会自建但不可依赖 | bootstrap 幂等创建 `supabase_admin`（superuser）与 `dashboard_user`，并统一设密码 |
| 2 | `cannot drop schema public ...` + `schema "public" already exists` | bootstrap 把 pg_trgm 装进 public → `--clean` 的 `DROP SCHEMA public` 因依赖失败，随后 `CREATE SCHEMA public` 重复 | 用 `pg_restore -L` 清单**剔除 `SCHEMA - public` 条目**，public 保持 `pg_database_owner` 默认属主 |
| 3 | v7 RPC 在恢复后多了 `anon` EXECUTE | Cloud 的 `DEFAULT ACL`（`GRANT ALL ON FUNCTIONS/TABLES TO anon`）在 CREATE 时生效，而显式 ACL 只 REVOKE 了 PUBLIC | 清单**剔除全部 `DEFAULT ACL` 条目**，以 dump 的显式 ACL 为准 |
| 4 | bootstrap 声称成功但 `pg_trgm` 始终缺失 | PL/pgSQL 变量名 `current_schema` 被解析成内置函数 `current_schema()`，`SELECT INTO` 静默拿到 `'public'`，分支永远走"已存在" | 变量改名 `trgm_schema`，并只在"不在 public"时才 drop 重装（避免已恢复库上的依赖报错） |
| 5 | 间歇性 `pg_trgm` 丢失、函数 101→70 | `--clean` 与 `--jobs=4` 并行交错，drop 可能晚于 create | 恢复改**单线程**；DDL 面实测 10 秒级，全量数据恢复时间预算见 §9.1 |

> 本机未覆盖的部分：public 侧 4.3 GB 数据的 COPY 与索引重建耗时、以及真实 compose 容器内的 `pg_restore` 版本行为。
> 这两项只能在 VPS 上做（P3 演练），脚本已按同版本参数固化，差异只可能出现在"耗时"而不是"正确性"。

### 5.6 VPS 实机暴露的 8 个坑（2026-11-23，已全部修掉并复测）

本机演练只能验证 SQL 语义；容器编排、运行时配置、网关行为只有真的在 VPS 上 `up` + 恢复 + 冒烟才会露出来。
下面每个都是**会直接让站点不可用或权限漂移**的错，现已全部修进 compose / bootstrap / nginx / 脚本：

| # | 现象 | 根因 | 修正 |
| --- | --- | --- | --- |
| 1 | `auth` 容器 `Restarting`，日志 `required key API_EXTERNAL_URL missing value` | GoTrue v2.197 读的是**无前缀** `API_EXTERNAL_URL`；compose 里只给了 `GOTRUE_API_EXTERNAL_URL` | auth 服务同时注入 `API_EXTERNAL_URL`（与官方 compose 一致） |
| 2 | `rest`/`storage` 连 `db:5432` 全部 `ECONNREFUSED`，`db` 自己却 healthy | 数据目录里的 `postgresql.conf` 的 `listen_addresses` 是注释状态（默认 localhost）；`POSTGRES_HOST` 环境变量不会改它 | 在 `command` 里显式 `-c listen_addresses=*` |
| 3 | `storage` 一直 `unhealthy`，但 `curl 127.0.0.1:5100/status` 返回 200 | 容器内 `localhost` 先解析成 `::1`，而 storage-api 只监听 IPv4 | healthcheck 与探针一律用 `127.0.0.1` |
| 4 | GoTrue 迁移报 `problem creating schema migrations` / 建表 permission denied | 镜像初始化时 `auth`/`storage` schema 已由 `supabase_admin` 建好，`create schema ... authorization <迁移用户>` 成了 no-op，迁移用户没有 CREATE 权限 | bootstrap 补 `grant all on schema auth to supabase_auth_admin` / `... storage to supabase_storage_admin` |
| 5 | `pg_restore` 直接失败：`FATAL: role "root" does not exist` | `docker compose exec` 默认以 root 进容器，不指定用户时 pg 工具用 OS 用户连库 | 恢复脚本显式 `-U` |
| 6 | 恢复报 24 处 `must be owner of table sessions/refresh_tokens/...` | 镜像里的 `postgres` **不是超级用户**（`supabase_admin` 才是），而 auth 表属主是 `supabase_auth_admin`；`--clean` 的 DROP 与 `--disable-triggers` 都需要超级用户 | 恢复固定 `-U supabase_admin`（`RESTORE_SUPERUSER` 可覆盖） |
| 7 | 恢复后 **101 个 public 函数全部** 对 `anon` 有 EXECUTE（Cloud 只有 75 个） | 镜像初始化时自带 `alter default privileges ... grant execute on functions to anon`，建函数那一刻 anon 就拿到了；dump 的显式 ACL 只有 `REVOKE ALL FROM PUBLIC` + `GRANT TO authenticated/service_role`，**撤不掉 anon** | 恢复前清空镜像默认 ACL → 让 dump 的显式 ACL 成为唯一来源；恢复后重装默认权限但**不给 anon**（刻意的安全收窄）。复测：anon 可执行函数 **75，与 Cloud 完全一致** |
| 8 | smoke-test 第 7 项 FAIL：`OPTIONS /auth/v1/token` 没有 `Access-Control-Allow-Origin` | GoTrue 对真实请求回 `ACAO: *`，但对 **OPTIONS 预检只回 204、不带任何 CORS 头**；Cloud 上这步由 Kong 网关代劳，自托管没有网关 | nginx 里只对 OPTIONS 补 CORS 头（`supabase-cors-preflight.conf`，三个 location 各 include）。复测：三个端点预检都回 `ACAO: *`，真实响应仍是单个 ACAO（无重复头） |

另外两个现场修的小坑：nginx `nginx.conf` 已有 `gzip on;`，gzip 片段再写一遍会 `directive is duplicate` 挡住整站 reload；
`apply-storage-policies.sh` 用 `postgres` 建 `storage.objects` 策略会 `must be owner of table objects`，必须 `-U supabase_admin`。

**修完后的实测状态（VPS，5 个容器）**：`db / auth / rest / storage / imgproxy` 全部 `healthy`；
`/auth/v1/health` 200、`/rest/v1/` 200（OpenAPI `host=supabase.liorvix.com`）、`/storage/v1/status` 200；
GoTrue 自建 `auth` 表并把 `auth.schema_migrations` 推进到 `20260831180000`，storage-api 自建 12 张表。

### 5.7 VPS 实机验收结果（2026-11-23，全部实测，不是估算）

| 验收项 | 命令/方式 | 结果 |
| --- | --- | --- |
| 全量 dump | `dump-from-cloud.sh`（VPS 上跑，pg_dump 17.12） | **224 秒 / 421 MB**（≈2 MB/s；本机只有 68 KB/s，差 30 倍 —— 印证 §5.2 的带宽结论） |
| 全量恢复 | `restore-into-selfhost.sh` | **219 秒，0 error / 0 unexpected**；62 public 表 + 27 auth 表 |
| 数据对账 | `verify-data.sh`（对比 `prod-before-2026-11-20.json`） | **exit 0 通过**；所有行数只增不减 |
| 关键行数 | 恢复后直查 | jobs 230,563（活跃 114,307 / 关闭 116,125）、profiles 47、resumes 19、ai_matches 137、auth.users 47、sessions 72、refresh_tokens 340、identities 48 |
| 保真断言 | 恢复脚本内置 | `pg_trgm_in_public=ok`、`rpc_v7_no_anon_grant=ok`、`jobs_rls_enabled=ok`、`auth_users_owner=ok`、`public_functions_anon_exec=75`（= Cloud） |
| 存储 | `migrate-storage-objects.mjs --apply` | **69 对象 / 11.32 MB**，逐对象 sha256 校验，`copied 69, failed 0`；两个桶 49 / 20 计数一致 |
| 存储策略 | `apply-storage-policies.sh` | `storage.objects` 4 条策略就位 |
| 登录链路 | 一次性测试账号走 admin 建号 → 密码登录 → RLS 读 → v7 RPC → refresh → 登出 → 删号 | 全链路 200；`users_after_cleanup=47`（无残留）；47 个用户里 38 个有 bcrypt 密码（另 9 个是纯 OAuth 账号） |
| AI 选岗 RPC | `POST /rest/v1/rpc/search_ai_match_candidates_v7` | **240 行 / 0.040 秒**（Cloud 上 1.5–4 秒） |
| 冒烟 | `smoke-test.sh` | **PASS 11 / FAIL 0 / WARN 2**（WARN = 未提供 refresh token 样本、应用仍指向 Cloud） |
| gzip | `Accept-Encoding: gzip` 抓 /api/jobs | 429,771 B → 80,597 B（**-81%**） |
| 每日备份 | `liorvix-db-backup.timer` | 实测 **65 秒 / 423 MB / TOC 1277 条**，保留 7 天；timer 下次 03:26 |

> 结论：**自托管栈在功能和数据层面已与 Cloud 等价**，剩下的外部依赖只有 DNS（子域名解析）与 SMTP 登录凭据。

### 5.8 不切流的"应用 × 新栈"探针验证（2026-11-23）

在**不动生产进程、不改 `.env.local`** 的前提下，用同一份 `dist/server.js` 在 5055 端口起了一个临时实例，
只把 `SUPABASE_*` 指到自托管栈、`JOBS_AUTO_WORKER=false` 关掉写入，跑完即杀：

| 端点 | 结果 |
| --- | --- |
| `GET /api/health` | **200**（启动 3 秒内就绪） |
| `GET /`（首页 SSR） | **200**，60,095 B |
| `GET /jobs`（岗位列表页） | **200**，12,275 B |
| `GET /api/jobs?limit=3` | **200**，31,013 B，抽样拿到真实岗位（Micron Technology） |
| `GET /api/auth/config` | **200**，返回 `url=https://supabase.liorvix.com` + 新的 anon JWT |
| 日志 | 无 error / 无 401 / 无 ECONN |

这次探针还**提前暴露了证书问题**：用 `SUPABASE_URL=https://supabase.liorvix.com` 时，
`/api/health` 503、`/api/jobs` 500，日志里是
`Hostname/IP does not match certificate's altnames ... not in the cert's altnames: DNS:liorvix.com`
—— 因为证书还没签，nginx 对这个 SNI 回的是 `liorvix.com` 的证书。
换成 `http://` 直连后全部 200，说明**除证书外没有任何集成问题**；签完证书这条路径自然恢复。

> 复现命令：`bash /tmp/server-probe-app2.sh`（脚本模板见 `tmp/server-probe-app2.sh`，关键点是
> 用 `node --env-file=` 传环境，**不要 `. file`** —— `.env.local` 里有含空格/特殊字符的值，会被 shell 拆坏）。

### 5.9 写入路径验收 + 两个真问题（2026-11-23 下午，最后一轮）

切流会不会"网站能开但岗位数据不再更新"，取决于后台 `[Job Worker]` 的**写入**路径，
只读探针（§5.8）验证不到。这一轮专门验证它，并且发现了两个必须修的真问题。

**① nginx 缓冲太小 → 岗位同步/官方字段任务 502（真 bug，已修）**

| 项 | 内容 |
| --- | --- |
| 现象 | 探针实例日志：`official detail enrichment failed: 读取官方字段调度状态失败: <html>502 Bad Gateway…`、`feed sync failed: 查询岗位外部 ID 失败: <html>…` |
| 复现 | 一条 ≈5.2 KB 的 `GET /rest/v1/job_sync_state?select=*&source_system=in.(...)`，走 nginx 返回 **502**；直连 `127.0.0.1:3000` 同样 URL **200** |
| 根因 | PostgREST 把**完整请求 URI 回显进 `Content-Location` 响应头**（实测 4,072 B）。nginx 默认 `proxy_buffer_size 4k` → `upstream sent too big header while reading response header from upstream` → 502；URI >8 KB 时还会因 `large_client_header_buffers 4 8k` 先吃 **414** |
| 影响面 | 岗位同步用 `source_system=in.(几十个官方源)` 拼查询，公司源越多 URI 越长。**这不修，切流后岗位数据当天就会停更**，而且页面/健康检查都正常、极难发现 |
| 修正 | `deploy/nginx/supabase.conf` 增加 `proxy_buffer_size 32k; proxy_buffers 8 32k; proxy_busy_buffers_size 64k; client_header_buffer_size 8k; large_client_header_buffers 4 32k;` |
| 复测 | URI 4 KB / 5.2 KB / 10 KB / 15 KB / 20 KB 全部 **200**；真实那条 5.2 KB 查询返回 66 KB 数据；`too big header` 新增 **0** |

**② 探针用了 `http://` → 301 把 POST 降级成 GET，错报一堆"函数不存在"（假 bug，但暴露真实陷阱）**

- 探针脚本把 `SUPABASE_URL` 写成 `http://supabase.liorvix.com`，nginx 回 **301 → https**。
  `fetch` 跟随 301 时按规范**把 POST 改成 GET、丢掉 body 和 Prefer 头**，于是：
  - `POST /rpc/claim_job_sync` 变成 `GET /rpc/claim_job_sync` → `PGRST202 Could not find the function public.claim_job_sync without parameters…`
  - `INSERT … .select().single()` 变成 `GET /rest/v1/job_sync_state?select=*`（多行 + `Accept: object`）→ `PGRST116 Cannot coerce the result to a single JSON object`
  - 这两条错误此前被误判成"自托管写路径坏了"，实际是探针自己的 URL 少了 `s`。改成 `https://` 后同样的调用全部正常。
- 顺手把端口 80 的跳转从 **301 改成 308**（308 保留方法与 body）。注意：跨 scheme 跳转时浏览器/fetch 仍会**丢掉 `Authorization` 头**（实测跳完后被当作 `anon` → `42501 permission denied`），所以**唯一正确做法是 `SUPABASE_URL` 必须写 `https://`**。
- 已把这条做成 `preflight-cutover.sh` 的 **[9] 写入路径**检查（带参 POST `claim_job_sync` 必须回 `true`），以后不会再踩。

**③ 岗位同步租约（`job_sync_state.lease_owner`）会挡住切换后的第一次增量**

- `claim_job_sync` 是分布式锁，TTL 900 秒。Cloud 侧应用停止前若正持有 `collector_feed` 租约，
  恢复出来的库里就带着一个"死人租约"，新 worker 前 15 分钟一直报
  `feed sync failed: 另一个岗位同步任务正在运行，请稍后再试`（实测复现）。
- 已在 `run-cutover.sh` 第 [8] 步启动应用前**清空残留租约**；探针里也验证过清空后立刻恢复。

**④ 全链路写入验收结果（清空租约后跑 200 秒，`SUPABASE_URL=https://…`）**

| 项目 | 结果 |
| --- | --- |
| worker 周期 | `incremental sync completed`、`official detail cycle completed`、`historical field review cycle completed`×3、`failure queue cycle completed`、`lifecycle maintenance completed` |
| 增量同步明细 | 4 页 / received 1,522 / **upserted 363** / closed 150 / **failed 0、fatal_failures 0、write_batch_failures 0**，`write_batches` 14 |
| 数据库效果 | `jobs` 230,463 → 230,550（**+87**，活跃 114,142）；`job_sync_state.last_incremental_success_at` 03:19 → 07:56 UTC（**游标真的推进**） |
| 应用日志 | `PGRST` / `42501` / `502 Bad` / `statement timeout` 命中 **0** |
| 唯一告警 | `官方字段批次有 1 条失败`（某个公司官方站点抓取失败，Cloud 上同类告警 1,698 条/7 天，属外部源问题，与数据库无关） |
| 生产影响 | 全程生产 `liorvix.service` active、`https://liorvix.com/api/health` 200，探针结束即杀，无残留进程 |

**⑤ 用户态（authenticated 角色 + RLS）验收**——这是"登录后能不能正常用"的关键，只读探针和 service_role 探针都测不到：

| 步骤 | 结果 |
| --- | --- |
| admin 建测试用户 → 密码登录（`/auth/v1/token?grant_type=password`，走 anon key，模拟真实前端） | 200，access_token 700 字符 |
| **用户态**调 AI 选岗 RPC `search_ai_match_candidates_v7` | **200，40 行，0.16 秒**（RLS 下正常出候选） |
| 用户态读公共岗位 `jobs` | 200，3 行 |
| 用户态 upsert 自己的 `profiles`（RLS 写策略） | 200，返回自己的 id |
| 用户态读别人的 `resumes`（数据隔离） | 200 但 **0 行**（RLS 生效） |
| 清理（删 profile + 删测试用户） | 204 / 200，`users` 回到 **47**，无残留 |

**⑥ 前置检查现状**：`bash scripts/migrate/preflight-cutover.sh` → **PASS 15 / FAIL 0 / SKIP 1**
（SKIP 仅 SMTP 实测发信，需提供收件邮箱；[9] 写入路径、[10] 长 URI 为本轮新增，均已 PASS）。

---

---

## 6. Auth 迁移手册

### 6.1 会话连续性（实测结论：不靠密钥复用，靠 refresh token）

**为什么"复用 JWT secret"这条老方案对本项目不成立**（三层证据见 [p0 采集文档 §1](p0-migration-prerequisites-collected.md)）：

1. 现有 anon/service 是**新式 opaque key**（`sb_publishable_…` / `sb_secret_…`，非 JWT），由网关按库内映射换内部 JWT，**不是 secret 派生**；
2. 用户 token 由 **ES256（P-256）非对称密钥**签名，公钥可见于 `/auth/v1/.well-known/jwks.json`（`kid=64540132-83a1-4fa8-91e8-850d0d464c08`），**私钥只在 Dashboard，无法导出**；
3. 代码与构建产物中没有任何 HS256 secret 依赖：`src/` 里 `SUPABASE_JWKS_URL`/`jwks` 零引用，`.next` 与 `dist/server.js` 里 key 字面量命中数为 0，浏览器配置全部来自运行时 `GET /api/auth/config`。

**所以新栈必须自建一套签名密钥与 API key**，会话连续性改由 refresh token 保证：

```env
# /opt/supabase/.env —— 全部新生成，不复用 Cloud 的任何密钥
JWT_SECRET=<新生成 40+ 字节随机串，供 legacy HS256 兼容与内部服务使用>
JWT_KEYS=<新生成 ES256 私钥 JWK 的 JSON 数组，交给 GOTRUE_JWT_KEYS>
JWT_JWKS=<与 JWT_KEYS 对应的公开 JWKS，交给 PGRST_JWT_SECRET / API_JWT_JWKS / JWT_JWKS>
ANON_KEY=<用新 JWT_SECRET 自签的 anon JWT>
SERVICE_ROLE_KEY=<用新 JWT_SECRET 自签的 service_role JWT>
SUPABASE_PUBLISHABLE_KEY=<新生成 sb_publishable_… 形态的 opaque key>
SUPABASE_SECRET_KEY=<新生成 sb_secret_… 形态的 opaque key>
JWT_EXPIRY=3600
```

> 官方 compose 已确认支持这套：`api-gw` 接受 `SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_SECRET_KEY`，`auth` 接受 `GOTRUE_JWT_KEYS`（"JSON array of signing JWKs"），`rest` 的 `PGRST_JWT_SECRET: ${JWT_JWKS:-${JWT_SECRET}}` 可直挂 JWKS。也就是说：**应用代码不需要因为 key 形态变化而改动**，只需在 `.env.local` 里换值。

**续期链为什么成立（硬证据）**：GoTrue 校验 refresh token 用的是 `auth.sessions.refresh_token_hmac_key`（session 行内自带），与 JWT 签名密钥无关。

```
auth.refresh_tokens  token 列长度恒定 12 字符（存哈希，非明文），328 行 / 其中未撤销 66 行
auth.sessions        含 refresh_token_hmac_key / refresh_token_counter
```

只要 `auth.sessions` + `auth.refresh_tokens` 原样搬过去，旧 refresh token 就能换出（新密钥签名的）新 access token，**用户不需要重新登录**。

**唯一代价与对策**：切换瞬间，浏览器里"尚未过期"的旧 ES256 access token 会被新 PostgREST/GoTrue 判为签名无效 → 401，最长持续到该 token 过期（≤ 1 小时）。这次一并处理（P1 已完成）：

1. `AUTH_CONFIG_CACHE_KEY` → `liorvix.auth-config.v2`，并把缓存结构改成 `{ config, savedAt }`：
   旧的无时间戳裸配置**读到即丢弃**（正是切换前写进去的那种），之后再按 60 秒 TTL 失效。
   这样切换后任何一次页面加载都会重新拉 `/api/auth/config`，最多 60 秒内全网收敛；
   回滚（host 再变回去）也自动生效，不需要用户清缓存。
2. **storageKey 固定化（新发现，必须改）**：supabase-js v2 的默认存储键是
   `sb-${hostname.split('.')[0]}-auth-token`（`node_modules/@supabase/supabase-js/dist/index.mjs:206`），
   所以 Cloud 上的 `sb-weqvdtdjdzmqflhwobec-auth-token` 在切到
   `https://supabase.liorvix.com` 后会变成 `sb-supabase-auth-token` ——
   **refresh token 迁移得再完美，浏览器也读不到旧 session，等于全员掉线**。
   已在 [supabase-browser.ts](../src/lib/supabase-browser.ts) 改为固定 `storageKey: 'liorvix.auth.session.v1'`，
   并做一次性迁移：新键为空时从任意 `sb-*-auth-token` 里挑 `expires_at` 最大的会话复制过来
   （不删除旧键，回滚仍可用）；同时记录上次 auth host，host 变化或发生迁移时主动
   `refreshSession()` 一次（8 秒超时保护，失败不阻塞首屏）。
3. 单元验证：`pnpm test:auth-session-migration`（**10 个场景**：无遗留、单/多遗留取最晚过期、
   损坏 JSON、code-verifier 干扰、已有新 session 不被覆盖、无过期时间、storage 抛异常，
   以及配置缓存三种情况：裸配置丢弃重拉 / 新鲜缓存不请求 / 过期缓存重拉）。
4. Cloudflare purge `/api/auth/config`。

> **回滚同样受益**：回滚时 auth host 再变一次，`hostChanged` 触发同样的 refresh 逻辑，用户不会二次掉线；`storageKey` 固定后，未来任何 URL 变更都不再丢 session。

> **issuer**：`GOTRUE_JWT_ISSUER` 直接用新值 `https://supabase.liorvix.com/auth/v1`（官方 compose 默认取 `API_EXTERNAL_URL`）。旧 token 本来就要换，不需要为兼容旧 issuer 做任何设置。

**演练必须验证的会话链路**（用测试账号，不要在正式窗口试错）：

1. 旧项目登录 → 记录 refresh token → dump/restore → 用该 refresh token 调新 GoTrue `/auth/v1/token?grant_type=refresh_token` → 返回新 access token（**这是整个迁移最关键的一次验证**）。
2. 新 access token 调新 PostgREST 查自己的数据 → 200。
3. 旧 access token 调新 PostgREST → **预期 401**（验证了"必须换 token"，也验证前端 refresh 逻辑会触发）。
4. 前端完整链路：打开页面 → 配置缓存失效 → 自动 refresh → 无感进入已登录状态。

> **回滚注意**：由于用户会话是"新老共享同一批 refresh token 历史"，切换后旧栈的 refresh token 已被轮换（rotation）。**回滚窗口内不要 revoke、不要删除** `auth.sessions` / `auth.refresh_tokens`，否则回滚后用户会被强制重新登录。

### 6.2 schema 版本门禁

Cloud 当前 `auth.schema_migrations` 最大版本为 `20261030120000`（共 84 条）。自托管 GoTrue 启动时会自动补齐缺失迁移，但**不能比 Cloud 旧**，否则会出现"代码少列/少表"的运行期错误。

- 启动后执行：`select max(version) from auth.schema_migrations;`，必须 **≥ 20261030120000**。
- 若镜像落后：升级镜像后重新执行（GoTrue 会自动补迁移）。
- 若无法升级：改用"新库起 GoTrue → 用 SQL 显式复制 `users/identities/sessions/refresh_tokens` 字段"的备用路径，并在演练中逐表比对列。

### 6.3 GitHub OAuth

现有 client_id（公开信息，取自 authorize 302）为 `Ov23liiTkHiiLKEyzL4O`，回调用的是旧项目回调。**建议新建 App 而不是改旧 App**，这样回滚时旧栈的 GitHub 登录完全不受影响。

1. GitHub → Developer settings → OAuth Apps → **New OAuth App**（保留旧 app）：
   - Application name: `Liorvix (self-host)`
   - Homepage: `https://liorvix.com`
   - Authorization callback URL: `https://supabase.liorvix.com/auth/v1/callback`
2. GoTrue 环境：

```env
GOTRUE_EXTERNAL_GITHUB_ENABLED=true
GOTRUE_EXTERNAL_GITHUB_CLIENT_ID=<new client id>
GOTRUE_EXTERNAL_GITHUB_SECRET=<new secret>
GOTRUE_EXTERNAL_GITHUB_REDIRECT_URI=https://supabase.liorvix.com/auth/v1/callback
```

3. 允许应用回调：

```env
GOTRUE_SITE_URL=https://liorvix.com
GOTRUE_URI_ALLOW_LIST=https://liorvix.com/**,https://www.liorvix.com/**
GOTRUE_API_EXTERNAL_URL=https://supabase.liorvix.com
```

`auth.identities` 随 dump 迁移，已有 9 个 GitHub 账号的 `provider_id` 不变，登录后仍是同一用户。

### 6.4 SMTP 与邮件模板

自托管后**不再有 Supabase 内置邮件服务**。好消息：项目现在用的就是自定义 SMTP，线路已经验证可用 —— **Brevo**（已实测注册确认信成功送达）。

已确认的事实（无需再选型）：

- 发件人：`noreply@liorvix.com`，显示名 `Liorvix`
- 品牌发送域：`mail.liorvix.com` → `*.brand.brevosend.com`；链接跟踪域 `r.mail.liorvix.com` → `*.r.brand.brevosend.com`
- SPF：`include:spf.brevo.com`（另有 `include:spf.qiye.aliyun.com`，对应阿里云企业邮 MX）
- DKIM/DMARC 无独立记录是正常的：DKIM 由 Brevo 的 `brevosend.com` 品牌域承担

1. GoTrue 环境（值从 Brevo → SMTP & API → SMTP 取）：

```env
GOTRUE_SMTP_HOST=smtp-relay.brevo.com
GOTRUE_SMTP_PORT=587
GOTRUE_SMTP_USER=<Brevo SMTP Login，形如 xxxx@smtp-brevo.com>
GOTRUE_SMTP_PASS=<Master password 或 SMTP key（xsmtpsib-…）>
GOTRUE_SMTP_ADMIN_EMAIL=noreply@liorvix.com
GOTRUE_SMTP_SENDER_NAME=Liorvix
GOTRUE_MAILER_AUTOCONFIRM=false
```

> 服务器到 `smtp-relay.brevo.com:587` 的出站连通性已实测 OK（不需要改安全组）。也可顺带配 `GOTRUE_SMTP_MAX_FREQUENCY` 防止突发刷信。

2. **逐封复制** Cloud Dashboard 中的模板（Confirm signup / Magic Link / Recovery / Change Email / Invite / Reauthentication）。关键点：
   - 验证码登录模板必须包含 `{{ .Token }}`（6 位数字）；
   - 确认/重置模板使用 `{{ .ConfirmationURL }}`，并带 `redirect_to`；
   - **模板语言不统一（实测）**：确认信正文是**中文**，重置密码信正文是**英文**。自托管时建议统一成中文，顺便校对主题行；
   - 已有两份可直接对照的抓取件：`docs/baseline/email-templates-captured/{confirm-signup,recovery}.{txt,html}`（含真实主题、发件人、HTML 结构），复制模板时可据此还原排版；
   - 自托管后把 `GOTRUE_RATE_LIMIT_EMAIL_SENT` 适当调高：本次实测 `POST /auth/v1/otp` 已被 Cloud 侧限流打成 **429**，说明现网额度偏紧。
3. 验收（在新环境用测试邮箱）：
   - 注册 → 收到确认邮件 → 点击落到 `/auth/callback` → 完成验证；
   - 邮箱验证码登录 → 输入 6 位码 → 建立会话；
   - 忘记密码 → 收到重置链接 → 设置新密码 → 登录成功；
   - 重发验证邮件 → 限流生效（429）。

### 6.5 重定向与前端缓存

- 应用内所有 `emailRedirectTo` 都由 `AUTH_SITE_URL` 生成，保持 `https://liorvix.com` 不变。
- `src/lib/supabase-browser.ts` 的 `AUTH_CONFIG_CACHE_KEY` 升到 `liorvix.auth-config.v2`，让浏览器在切换后**立即重新拉取**新 `SUPABASE_URL` 与新 API key（旧 tab 里那份无时间戳的旧配置**读到即丢弃**、新格式 60 秒 TTL，最多一分钟内全部重拉；由于密钥本次必然更换，这一步**必须做**，否则旧 tab 会拿旧 key 打到新网关 → 全部 401）。
- **同时**在拉到新配置后主动 `supabase.auth.refreshSession()` 一次：旧 access token 是 ES256 旧密钥签的，新栈必然验签失败，必须用仍然有效的旧 refresh token 换新 token（见 §6.1）。
- 切换窗口内可临时把 `/api/auth/config` 的 `Cache-Control` 改为 `no-store`，切换完成后恢复 `max-age=300`。
- 该接口带 `s-maxage=300`，**Cloudflare 边缘也会缓存**。切换时必须 purge `https://liorvix.com/api/auth/config`（Cloudflare Dashboard → Caching → Purge），否则最长 5 分钟内新访客仍会拿到旧 URL/旧 key，期间注册的账号会落到旧库（这是最隐蔽的"丢用户"路径）。
- **CORS 必须验证**：浏览器从 `https://liorvix.com` 调 `https://supabase.liorvix.com/auth/v1/*`。**自托管没有 Envoy/Kong 网关**，而 GoTrue 只给真实请求发 `Access-Control-Allow-Origin: *`、对 **OPTIONS 预检只回 204 且不带任何 CORS 头**（VPS 实测，smoke-test 第 7 项直接 FAIL）。所以预检头由 nginx 补，且只补预检、不碰真实响应（否则出现重复 ACAO，浏览器同样报错）：

```nginx
# deploy/nginx/supabase-cors-preflight.conf，被 /auth/v1/、/rest/v1/、/storage/v1/ 三个 location 各 include 一次
if ($request_method = OPTIONS) {
  add_header Access-Control-Allow-Origin '*' always;
  add_header Access-Control-Allow-Methods 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS' always;
  add_header Access-Control-Allow-Headers '...' always;
  add_header Access-Control-Max-Age 3600 always;
  add_header Content-Length 0;
  return 204;
}
```

注意 `add_header` **不能写在 server 级的 `if` 里**（nginx 报 `directive is not allowed here`），必须放在 location 内 —— 这就是它做成片段的原因。

验证（三条都要过）：

```bash
# 1) 预检必须带 ACAO
curl -i -X OPTIONS https://supabase.liorvix.com/auth/v1/token \
  -H 'Origin: https://liorvix.com' -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,authorization,apikey'
# 2) 真实请求只能有 1 个 ACAO（重复会让浏览器拒绝）
curl -sSI 'https://supabase.liorvix.com/rest/v1/jobs?select=id&limit=1' \
  -H 'Origin: https://liorvix.com' -H "apikey: $ANON" | grep -ci access-control-allow-origin   # 期望 1
# 3) GoTrue 的 URI_ALLOW_LIST 要写裸 origin（只写 /** 匹配不上 Origin，它没有路径）
```
- **DNS 建议**：`supabase.liorvix.com` 设为 **DNS-only（灰色云）**，用 certbot 签证书；不要让 Cloudflare 代理认证接口，避免 WAF/缓存干扰 OAuth 与 token 刷新。应用主域 `liorvix.com` 保持现状。

---

## 7. Storage 迁移手册

**不要 dump/restore `storage` schema**：storage-api 自带 schema 迁移，Cloud 与自托管版本不一致时容易冲突。正确做法是"新建 bucket → 复制对象 → 重建策略"。

1. 在新环境调用 storage API 创建 bucket（与 Cloud 完全一致）：
   - `risingpath-assets`：`public = true`
   - `risingpath-resumes`：`public = false`
2. 用 [scripts/migrate/migrate-storage-objects.mjs](../scripts/migrate/migrate-storage-objects.mjs) 复制对象（默认 dry-run）：
   - 先 `--list-only` 盘点（**VPS 实跑：2 bucket / 49 + 18 = 67 个对象 / 11.06 MB**；迁移当天再盘点已是 **49 + 20 = 69 个 / 11.32 MB**，说明窗口内仍有新简历上传 —— 计划里所有"对象数"都按**当次盘点结果**为准，不要写死）；
   - `--apply` 才真正写；目标已存在且大小一致的对象自动跳过，`--force` 覆盖；
   - 每个对象上传后回查大小，最后逐 bucket 对账对象数，不一致直接非 0 退出。
3. 重建存储策略（[scripts/migrate/apply-storage-policies.sh](../scripts/migrate/apply-storage-policies.sh)，
   直接复用仓库迁移 [0008](../supabase/migrations/0008_private_resume_storage.sql)，幂等；共 4 条，脚本会核对数量）：

   **实测证据（生产 `pg_policies`）**：策略只有这 4 条，全部 `on storage.objects`，都是
   `bucket_id = 'risingpath-resumes' and (storage.foldername(name))[1] = auth.uid()::text`
   —— 隔离靠**路径首段 = 用户 id**，不靠 `owner_id`；生产的 69 个对象 `owner_id` 全为 `null`，
   所以用 service key 逐个 API 复制不会丢任何"所有者"语义。缺这 4 条策略的后果是：用户用自己的
   token 读自己目录会被 RLS 拒绝（服务端 `resume-storage.ts` 走 service key 所以服务本身不炸，
   但任何客户端直读/直传都会失败）。
4. **改写数据库中的绝对 URL**（唯一会让用户看到"图裂"的点），已脚本化：
   [scripts/migrate/rewrite-storage-urls.mjs](../scripts/migrate/rewrite-storage-urls.mjs)，默认 dry-run。

   **实测证据**：扫描 public 下 31 个"像 URL/路径"的文本列，**只有 2 列**含旧域名：
   `company_logos.logo_url = 42 行`、`profiles.avatar_url = 1 行`（`resumes.file_key`、`jobs.job_url`
   等其余 29 列全部 0），合计 43 行 —— 与旧版计划里手写的两条 SQL 计数一致，脚本 dry-run 已复现该计数。

5. 验收：
   - 新环境 `GET /storage/v1/object/public/risingpath-assets/logos/...` 返回 200；
   - 登录后下载自己的简历（`/api/apply/resume-file`）字节一致；
   - 上传新简历 → worker 解析成功；
   - 管理员上传新 logo → 返回的 `publicUrl` 以新域名开头。

---

## 8. 应用配置与代码改动清单

### 8.1 环境变量（生产 `.env.local`，切换时整段替换 Supabase 部分）

| 变量 | 迁移后取值 | 说明 |
|---|---|---|
| `SUPABASE_URL` | `https://supabase.liorvix.com` | 浏览器与服务器共用 |
| `SUPABASE_ANON_KEY` | **换成新生成的值**（`generate-selfhost-secrets.mjs` 产出的 HS256 JWT，`role=anon`） | 旧值是旧项目的 key，在新实例无效 |
| `SUPABASE_SERVICE_ROLE_KEY` | **换成新生成的值**（同脚本产出，`role=service_role`） | 同上；`.env.local` 保持 600 权限 |
| `SUPABASE_DB_URL` | `postgresql://postgres:<pw>@127.0.0.1:5432/postgres` | 脚本、worker 直连（本机连接，无 RTT） |
| `SUPABASE_RESUME_BUCKET` | 不变 | 桶名不变 |
| `AUTH_SITE_URL` | 不变（`https://liorvix.com`） | 回调域名不变 |
| 其余（AI/TTS/支付等） | 不变 | 与数据库无关 |

> **不要用 `sb_publishable_…` / `sb_secret_…` 这种 opaque key**：那是 Cloud 网关的产物，自托管栈里
> 没有网关，GoTrue/PostgREST 只认 JWT。用脚本生成的 JWT 形态即可 —— 应用代码只是把这些值当字符串
> 发给 REST/Auth，零改动。
> 另外 HS256 没有 JWKS，`SUPABASE_JWKS_URL` 可以直接不配（已确认 `src/` 无任何引用）。
> 服务器上的 `.env.local` 只有 root 可读（`chmod 600`）；切换前先 `cp .env.local .env.local.pre-migration`。

### 8.2 代码改动（P1 进度：8 / 10 已完成并验证）

| 文件 | 改动 | 状态 | 原因 |
|---|---|---|---|
| `supabase/migrations/0139_ai_match_retrieval_bounded.sql` | 重写 v7：有界候选池 + LATERAL 分叉 + direction 降级为偏好 + 补位 | ✅ 已写、已应用生产、PostgREST 实测通过 | 见 §10.1 |
| `src/app/api/ai/match/route.ts` | 兜底不再读 scope 表；改按 `created_at` 倒序取 2×limit → 内存按 `regionMatchesScopeKeys` 过滤 → 按 id 回填 | ✅ 已改、已 typecheck | 修复"只剩 2 条" |
| `src/lib/job-region-scope.ts` | 新增 `regionMatchesScopeKeys()`（`ai_match_region_scope` 的 JS 孪生） | ✅ 已加 | 兜底路径需要在 JS 侧判地区 |
| `scripts/deploy-production.sh` | 旧 project-ref 断言 → `EXPECTED_SUPABASE_HOST`（托管默认 `<ref>.supabase.co`），8 组用例验证 | ✅ 已完成 | 否则自托管部署被拒 |
| `scripts/audit-job-field-phase1.ts` | 同上，host 校验 + 明确报错提示 | ✅ 已完成 | 生产审计脚本 |
| `scripts/reparse-official-job-experience.ts` | 同上，并去掉失效的 `projectRef()`，输出字段 `supabase_ref` → `supabase_host` | ✅ 已完成 | 经验回填写入保护 |
| `src/lib/supabase-browser.ts` | 配置缓存 key → v2；**`storageKey` 固定为 `liorvix.auth.session.v1`** + 一次性迁移旧 `sb-*-auth-token`（取最晚过期）+ auth host 变化/迁移时主动 `refreshSession()`（8s 超时） | ✅ 已改、10 场景测试通过、eslint 通过 | 不固定的 storageKey 会让全员在切换时掉线（见 §6.1） |
| `src/app/api/auth/config/route.ts` | 环境变量控制 `no-store` 窗口 | ⏳ 可选 | 切换期避免旧配置缓存 |
| `scripts/create-production-env.ts` | 去掉"必须 6543 池"的断言：托管池地址或自托管 `127.0.0.1/localhost/db:5432`（含 unix socket 串）均可 | ✅ 已完成 | 本地库无池化地址 |
| `deploy/systemd/liorvix-worker.service` | 新增 worker 独立服务（`WORKER_ONLY=true`，`CPUQuota=200%`/`MemoryMax=2G`/`Nice=10`，并显式覆盖 `JOBS_AUTO_WORKER=true`） | ✅ 已加（待下发到服务器） | 与 Web 解耦 |
| `deploy/nginx/gzip.conf` | JSON/JS/CSS/SVG 压缩片段（含验证与回滚说明） | ✅ 已加（待 `nginx -t && reload`） | `/api/jobs` 194 KB → 预期 ~25 KB |

### 8.3 部署脚本注意点

`deploy-production.sh` 的守卫**已经改完**，逻辑如下（Git Bash 下 8 个用例全部验证）：

```bash
EXPECTED_SUPABASE_PROJECT_REF="${EXPECTED_SUPABASE_PROJECT_REF:-weqvdtdjdzmqflhwobec}"
EXPECTED_SUPABASE_HOST="${EXPECTED_SUPABASE_HOST:-${EXPECTED_SUPABASE_PROJECT_REF}.supabase.co}"
# 从 .env.local 抠 SUPABASE_URL 的 host（去引号、去 path、去端口），与之一致才允许部署
```

- 托管项目：什么都不用设（默认仍等价于旧行为）。
- 自托管：发布时 `EXPECTED_SUPABASE_HOST=supabase.liorvix.com sudo -E bash scripts/deploy-production.sh`（或写进 root 的 systemd/部署环境）。不设就**拒绝部署**，这是故意留的安全闸。
- 已验证用例：托管默认通过、托管错 ref 拒绝、自托管带/不带 opt-in、`127.0.0.1:8000`、带尾斜杠、非 http(s) 串、缺变量。
- 三处 TS 脚本（`audit-job-field-phase1.ts` / `reparse-official-job-experience.ts`）遵循同一约定：`EXPECTED_SUPABASE_HOST` 优先，否则回落到 `<ref>.supabase.co`。

`create-production-env.ts` 的 pooler 校验**也已改完**：托管池（`*.pooler.supabase.com:6543`）或自托管直连（`127.0.0.1`/`localhost`/`db` 的 5432，或 unix socket 串）二者之一即可，其余仍拒绝。

另外两处必须同步调整：

1. `deploy-systemd` 发布流程要同时 `systemctl enable/restart liorvix-worker`（P1 新增的 worker 服务），否则拆分后后台任务不再运行。
2. `/opt/supabase/.env` 中把 `PGRST_DB_SCHEMAS` 设为 **`public`**（官方默认 `public,graphql_public`，但本项目不部署 graphql 且未迁移 `graphql_public` schema，保留默认会导致 PostgREST 启动报 schema 不存在）。`PGRST_DB_MAX_ROWS=1000` 与 Cloud 行为一致。

---

## 9. 功能验证矩阵

> 全部在 **staging 应用（5001 端口，指向新栈）** 上先跑通，再在正式切换后复跑一遍。每项都要记录"通过/失败/现象"。
> staging 环境建议临时 `CREDITS_ENFORCED=false`、`BETA_ACCESS_ENFORCED=false`，避免测试账号额度不足掩盖真实问题；正式环境保持原值。测试账号使用专用邮箱，不要用真实学员账号。

| # | 功能 | 验证方法 | 通过标准 |
|---|---|---|---|
| 1 | 注册（邮箱+密码） | 新邮箱注册 → 收确认邮件 → 点链接 | 落到 `/auth/callback`，状态 confirmed |
| 2 | 邮箱验证码登录 | 已注册邮箱请求 OTP → 输入 6 位码 | 建立会话，`/home` 可访问 |
| 3 | 密码登录 | 已有账号 + 原密码 | 成功；密码哈希来自旧库 |
| 4 | 密码重置 | 忘记密码 → 邮件链接 → 新密码 | 新密码可登录 |
| 5 | GitHub OAuth | 登录页点 GitHub | 回调后同一 `auth.users.id`，数据不丢 |
| 6 | 会话刷新 | 登录后放置 1 小时 / 手动 refresh | 不掉线（旧 refresh token 换新 access token） |
| 7 | 未登录访问 | 直接访问 `/api/resume` | 401 |
| 8 | RLS 隔离 | 用户 A token 查 B 的简历/网申 | 空结果，不越权 |
| 9 | 简历上传+解析 | 上传 PDF/DOCX | 存桶、worker 解析、profile/segmentation 生成 |
| 10 | 简历下载 | `/api/apply/resume-file` | 字节与上传一致 |
| 11 | 分层确认/修正 | 简历页改分层 | 200，重算生效 |
| 12 | 岗位列表/筛选/分页 | `/jobs` 多条件 | 数据完整、耗时 < 1s（本地库） |
| 13 | 岗位详情/公司聚合 | `/api/jobs/[id]`、`/api/jobs/companies` | 200，logo 新域名可显示 |
| 14 | 收藏/网申记录 | 收藏、创建 application | 写库成功，刷新可见 |
| 15 | AI 选岗（缓存恢复） | 打开页面看历史结果 | 与旧库一致 |
| 16 | AI 选岗（新跑） | `stream=true` 跑一次 | `retrieved≈240`、结果非空、SSE 完整 |
| 17 | AI 选岗反馈 | interested / not_interested | 写 `ai_match_feedback`，下次生效 |
| 18 | 简历优化 / ATS 评分 | `/optimize` 全流程 | 生成结果、计费正确 |
| 19 | 求职方向测评 | 12 题 → 结果 | 写 `personality_assessments` + profile |
| 20 | 模拟面试（文本/语音） | 新建会话、ASR/TTS WS、结束出报告 | WS 连上、轮次正常、报告落库 |
| 21 | 面试反馈 | 提交真实度评分 | 写 `interview_feedback` |
| 22 | 网申 AI 填表 | `/api/apply/resolve` | 字段计划生成 |
| 23 | 后台登录与权限 | 管理员登录、访问受限页 | 会话有效、权限正确 |
| 24 | 后台 analytics | 概览、学员目录、AI 用量 | 数据与旧库一致 |
| 25 | 后台岗位同步面板 | 查看 sync runs、触发同步 | 正常读写 |
| 26 | 公司 logo 上传 | 后台选图上传 | 新域名 URL、页面可见 |
| 27 | 计费/积分 | 查余额、消耗一次 AI | 扣减正确、ledger 有记录 |
| 28 | 健康检查 | `/api/health`、GoTrue `/health`、REST | 全部 200 |
| 29 | 后台 worker | 观察一轮 incremental sync | 写入新库、无 statement timeout |
| 30 | 备份恢复 | 从备份恢复到临时库 | 行数/对象与生产一致 |

### 9.1 能自动化的部分（已经脚本化，别手点）

| 脚本 | 覆盖矩阵中的 | 已在生产验证？ |
|---|---|---|
| [smoke-test.sh](../scripts/migrate/smoke-test.sh) | 28（健康检查）、13 的一部分（logo 域名）、16（RPC 返回条数与延迟）、6（refresh token 换发，需提供测试 token）、7（CORS） | ✅ 对当前 Cloud 跑通 **PASS 11 / FAIL 0**（1 条 skip：没有测试账号 refresh token） |
| [verify-data.sh](../scripts/migrate/verify-data.sh) | 30 的数据面（行数/结构/序列/扩展/bucket 配置与基线对账） | ✅ 对当前 Cloud 跑通：177 项一致 / 9 项预期变化 / 0 FAIL |
| [compare-baseline.mjs](../scripts/migrate/compare-baseline.mjs) | 上面那条的分级判定（缺表/行数减少/bucket 配置变化 → 直接 FAIL） | ✅ 同上 |
| [migrate-storage-objects.mjs](../scripts/migrate/migrate-storage-objects.mjs) | 9/10/26 的前置（对象清单与字节复制） | ✅ `--list-only` 对生产跑通：67 对象 / 11.06 MB |
| [apply-storage-policies.sh](../scripts/migrate/apply-storage-policies.sh) | 11（简历桶 RLS，缺了用户直读/直传会被拒） | ✅ 本机用模拟 `storage` schema 把真实 `0008` 迁移跑了两遍：4 条策略、桶为私有、跨用户写入被 RLS 拒绝、本人目录可写；容器内调用仍待 P3 |
| [rewrite-storage-urls.mjs](../scripts/migrate/rewrite-storage-urls.mjs) | 13（logo/头像域名改写，唯一会"图裂"的点） | ✅ 对生产 dry-run：42 + 1 = 43 行；幂等、参数校验已验 |
| [dump-from-cloud.sh](../scripts/migrate/dump-from-cloud.sh) / [restore-into-selfhost.sh](../scripts/migrate/restore-into-selfhost.sh) | 30 的搬运面 | ⏳ 容器内执行需在 VPS 上跑；**同参数本机演练已完成 DDL + auth 数据面（§5.5，两遍均 0 error）**，只剩 4.3 GB 数据的耗时待 P3 实测（预算 15–30 分钟，单线程） |

> 剩下 1–5、8–12、14–15、17–29 基本都是"要真人点一遍"的交互路径，必须在 staging 上手动验收；
> 其中 20（模拟面试 WS）和 22（网申填表）最容易在迁移后暴露问题，优先级最高。

---

## 10. 性能与稳定性改进

### 10.1 AI 选岗检索（P1，最高优先级）— **已实现并已在生产库生效**

**结论先行**：同一批参数，改前 **69.7 秒 / 必然 8 秒超时 / 返回 0–2 条**；改后 **生产 PostgREST 端到端 1.8 秒（含跨境 RTT）/ 稳定 240 条**。自托管后预期 < 0.2 秒。

**实测病根（云实例上逐项验证）**：

| 实验 | 结果 | 含义 |
|---|---|---|
| 原 v7 RPC（命中 ~6 千行，`ts_rank_cd` 全量排序） | **69,704 ms** | 必然超时 |
| `count(*) where ai_match_search @@ …` | **90 s 超时** | 不能先数命中数 |
| 走 `jobs_active_created_at_idx` 倒序 + `@@` 过滤，`limit 4000` | **45 ms 执行 / 229 ms 端到端（热缓存）** | 倒序 btree 扫描是唯一便宜路径 |
| 同一查询 `limit 4000`（冷缓存投影 tsvector） | **13–45 秒** | TOAST 2.7 GB，冷读 0.7 ms/页 |
| 走 GIN bitmap（`jobs_ai_match_search_idx` 301 MB） | 40–65 秒 | bitmap + 随机 TOAST 读，最差 |
| 走 `jobs_active_market_created_idx` + `limit`，但被 `MATERIALIZED` CTE 强加 `Sort` | **101 秒** | `LIMIT` 在 `Sort` 之上 → 必须读完全部命中 |
| `EXISTS` 逐行查 scope（4000 id） | 4,675 ms | 逐行子查询太贵 |
| `direction = 'finance'`（大小写/取值不符） | **21 秒 + 0 条** | 低选择度硬过滤会把索引扫穿 |

**因此 0139 的写法（[迁移文件](../supabase/migrations/0139_ai_match_retrieval_bounded.sql)）**：

1. **不排序、只截断**：候选池按 `created_at desc` 直接走索引（`jobs_active_market_created_idx` 的表达式列 = scope 常量，或 `jobs_active_created_at_idx`），索引本身就提供顺序 → `LIMIT` 能提前停止，**没有 Sort 节点**（已用 `EXPLAIN` 验证单 scope / 多 scope 两条分支）。
2. **多地区用 LATERAL 分叉**：`unnest(scope_list) cross join lateral (… limit per_scope_limit)`，每个分支各自走索引顺序并各自截断；`per_scope_limit = greatest(result_limit, pool_limit / scope 数)`，保证 6 个地区时总池仍 ≈1200 而不是 6×1200。
3. **先池后评分**：`pool`（≈1200 行）物化后再算 `ts_rank_cd`，只对 1200 行排序，而不是 10 万行。
4. **direction 降级为排序偏好**（`direction_rank` 0/1）而不是硬过滤：`direction` 只有 11 个值、窄方向（Legal 742 / IBD 617）命中率 0.7 %，硬过滤会扫穿索引；改成偏好后既保证有结果，又让方向匹配的排在最前。
5. **天然兜底**：池里没命中关键词的行以 `lexical_score = 0` 参与排序，所以冷僻关键词（实测 `quantum/astrophysics/welding` → 6 条命中 + 234 条补位）也永远返回满额候选。
6. **权限收紧**：`security definer` + `revoke from public/anon`，只授 `authenticated` / `service_role`。

**实测矩阵（生产库，`pg_temp` 函数 + 真实参数）**：

| 场景 | 行数 | 命中评分 | 耗时（含 RTT） |
|---|---|---|---|
| 真实关键词 × us | 240 | 240 | 0.4–1.0 s |
| 真实关键词 × hong_kong | 240 | 240 | 1.1 s |
| 真实关键词 × 6 地区 | 240 | 240 | 1.6 s |
| 宽泛关键词 × us | 240 | 240 | 0.4 s |
| 冷僻关键词 × us（纯补位） | 240 | 6 | 0.6 s |
| 无关键词 × us | 240 | 0 | 0.9 s |
| direction 偏好（Data）× us | 240 | 209 | 1.0 s |
| PostgREST 正式调用（service key） | 240 | 209 | **1.78 s** |

**仍需收尾的两件事**：

1. 发一次版，让 [match/route.ts](../src/app/api/ai/match/route.ts) 的兜底改动上线（RPC 本身无需发版，已直接在生产库生效）。
2. `job_ai_match_scopes` 清理：检索已不依赖它，但触发器等写入仍在维护 17.9 万行。清理脚本（先 count 后删，可回滚）：

```sql
-- 先确认数量
select count(*) from public.job_ai_match_scopes s
  join public.jobs j on j.id = s.job_id where j.is_active = false;

delete from public.job_ai_match_scopes s
  using public.jobs j
  where j.id = s.job_id and j.is_active = false;
```

> 迁移到自托管后，因为 4.3 GB 全库可常驻 16 GB 内存、且本地 NVMe 无 IOPS 限制，上面"冷读 0.7 ms/页"的约束消失；届时可把 `pool_limit` 调回 3000–5000 提升召回，而不必担心超时。

**应用层兜底路径（route.ts 里改过的那段）已在真实数据上验证**（只读探针，复刻同样的
`created_at desc limit 480 → 内存地区过滤 → 按 id 回查字段` 序列）：

| 场景 | 命中候选 | 两段查询耗时 |
|---|---|---|
| 目标地区全量（us/canada/uk/australia/hk/singapore） | **240** | 973 + 1343 ms |
| 仅 us | **240** | 765 + 1187 ms |
| us + canada | **240** | 1424 + 2457 ms |
| 仅 uk | 19 | 578 + 439 ms |
| 仅 singapore | 44 | 1193 + 623 ms |

结论：**任何地区组合都不再返回 0 条**（uk/sg 低于 240 只是因为"最近 480 条挂牌"里就这么多，
属于兜底的预期行为，不是 bug）。这段代码仍需发版才生效，但逻辑本身已被生产数据验证。

### 10.2 Postgres 调优（16 GB 机器）

```conf
shared_buffers = 4GB
effective_cache_size = 10GB
work_mem = 32MB
maintenance_work_mem = 512MB
max_connections = 100
random_page_cost = 1.1
effective_io_concurrency = 200
wal_compression = on
checkpoint_completion_target = 0.9
max_wal_size = 2GB
log_min_duration_statement = 500ms
log_temp_files = 0
shared_preload_libraries = 'pg_stat_statements'
autovacuum_naptime = 30s
autovacuum_vacuum_scale_factor = 0.05
autovacuum_analyze_scale_factor = 0.02
statement_timeout = 30s
```

### 10.3 应用层

1. **worker 拆分**：新增 `liorvix-worker.service`（`WORKER_ONLY=true`），Web 服务改 `JOBS_AUTO_WORKER=false`；worker 设 `CPUQuota=200%`、`MemoryMax=2G`、`Nice=10`。
2. **gzip**：nginx `gzip_types application/json application/javascript text/css image/svg+xml; gzip_proxied any;`（`/api/jobs` 194 KB → ~25 KB）。
3. **公开列表短缓存**：`/api/jobs`（公共、无用户态）可加 `s-maxage=30, stale-while-revalidate=60`，或由 nginx 缓存 30 秒，削峰。
4. **Web 多进程**（P6 视流量）：Next 自定义 server 加 `cluster`，或 systemd 起 2 个实例（5000/5002）+ nginx upstream。
5. **慢查询巡检**：每周看 `pg_stat_statements` top 20，超过 200 ms 的查询进优化清单。
6. **数据保留**：`job_sync_runs`（188k 行）、`job_sync_records`（224k 行）按月归档；`job_ai_match_scopes` 只保留 active。

---

## 11. 备份、恢复与监控

### 11.1 备份（已脚本化，切换前必须可用）

| 层级 | 方式 | 频率 | 保留 | 状态 |
|---|---|---|---|---|
| 逻辑全备 | `scripts/migrate/db-backup.sh`（`pg_dump -Fc -Z6`，public+auth，原子落盘 + TOC 校验） | 每日 03:20（`liorvix-db-backup.timer`，`Persistent=true`） | 7 天（`RETENTION_DAYS` 可调） | ✅ 已实现，本机闭环演练通过（§11.3） |
| 配置 | `/opt/supabase/.env`、`/opt/liorvix/.env.local` | 变更时 | 30 天 | ⏳ 手工（`install -m 600` 到备份目录，异地加密存放） |
| 存储文件 | `/opt/supabase/volumes/storage`（当前仅 11.3 MB / 69 对象） | 每日 | 14 天 | ⏳ 手工 `tar`/`rclone`（数据量小，风险低） |
| WAL 归档（PITR） | `wal-g` / `pgBackRest` | 持续 | 7 天 | ⏳ 未实现：单机场景先接受 RPO=24h；要 RPO≤5min 再叠加 |

通过 systemd 安装（一次性）：

```bash
sudo cp deploy/systemd/liorvix-db-backup.service deploy/systemd/liorvix-db-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now liorvix-db-backup.timer
systemctl list-timers liorvix-db-backup.timer        # 看下次触发
sudo systemctl start liorvix-db-backup.service        # 立刻备份一次
ls -lh /opt/liorvix-backups/ && tail -5 /opt/liorvix-backups/backup.log
```

从备份恢复（**与迁移恢复同一条脚本、同一组过滤参数**，所以备份怎么来就能怎么回）：

```bash
DUMP_FILE=/opt/liorvix-backups/liorvix-<stamp>.dump \
  bash scripts/migrate/restore-into-selfhost.sh
```

- 备份文件权限 `600`、目录 `700`；**绝不要**把 dump 提交进仓库。
- **每月一次恢复演练**：恢复到临时数据库 → 跑附录 B 校验 → 记录耗时（§11.3 有本机记录）。
- 磁盘水位：每天备份约 0.6–1.2 GB × 7 天 ≈ 5–9 GB，磁盘 >80% 要告警（§11.2）。

### 11.2 监控与告警

**已落地（VPS，2026-11-23 实测）**：`liorvix-healthcheck.timer` 每 5 分钟跑一次
[scripts/migrate/healthcheck.sh](../scripts/migrate/healthcheck.sh)，检查 5 项，异常时写 journal + 可选 webhook：

| 检查项 | 判定 | 实测 |
| --- | --- | --- |
| 容器 | 任一 `unhealthy`/`Restarting`/`Exited` → FAIL；数量 < 5 → FAIL | 5/5 healthy |
| HTTP 端点 | auth 9999 / rest 3000 / storage 5100 / app 5000 四个本机端点必须 200 | 4/4 200 |
| 磁盘 | `/`、`/opt` 使用率 ≥ 85% → FAIL | 64% |
| 数据库 | 连不上 / 长事务 > 5 分钟 / 连接数 ≥ 80% max_connections → FAIL | conns 4/100、longxact 0、3227 MB |
| 备份新鲜度 | 最近 `liorvix-*.dump` 超过 36 小时 → FAIL | 0 小时前、423 MB |

接入告警只需在 `liorvix-healthcheck.service` 里填 `ALERT_WEBHOOK_URL`（Telegram Bot API 或任意接受 `{"text": "..."}` 的 webhook），
脚本已做 JSON 转义。**注意 `--quiet` 模式只在异常时输出**，避免每 5 分钟刷 journal。

**还需要人工接的（外站视角）**：`https://liorvix.com/api/health`、`https://supabase.liorvix.com/auth/v1/health`
用 Cloudflare/UptimeRobot 加 5 分钟探针 —— DNS 生效后才能加。
数据库层慢查询：`pg_stat_statements` 已装，`select * from pg_stat_statements order by mean_exec_time desc limit 20;`。

### 11.3 备份/恢复闭环演练（2026-11-23，本机 PG17）

用真实脚本对"public schema + 生产 auth 数据"的库做了一次完整闭环：备份 → 全新库恢复 → 双面比对。

| 步骤 | 结果 |
| --- | --- |
| `db-backup.sh` 产出 | 684 KB、TOC 1271 条、`pg_restore -l` 可读 |
| 坏 URL 失败路径 | 退出码 1，无 `.partial` 残留 |
| 保留期清理 | 只删 `liorvix-*.dump`，不动同目录其它文件 |
| 全新库恢复（同迁移参数） | **0 error / 0 unexpected** |
| 对象面 | 62 public 表 / 27 auth 表 / 41 策略 / 101 函数 / v7 RPC / `public.gin_trgm_ops` / 39 个 jobs 索引 ✅ |
| 数据面 | users 43（hash 一致）、refresh_tokens 328（hash 一致）、sessions 66（ids 一致）✅ |

> 结论：备份不是"写了文件就算"，而是**已被证明能恢复**；切换后按 §11.1 装 timer 即可获得 RPO=24h 的兜底。

#### 11.3.1 VPS 真实数据上的备份闭环（2026-11-23，423 MB）

装上 timer 后立刻用**生产规模**的真库跑了一遍，数字全部来自实测：

| 步骤 | 结果 |
| --- | --- |
| `liorvix-db-backup.timer` 安装 | `enabled`，下次触发 03:26（`OnCalendar=03:20` + 随机 10 分钟抖动） |
| 备份产出（`db-backup.sh`） | **423 MB / 65 秒 / TOC 1277 条**，600 权限，先写 `.partial` 再 `mv` |
| 备份能否真恢复 | 复制到容器内 → `pg_restore --clean --if-exists --disable-triggers -L 过滤列表` → **217 秒**，独立库 `liorvix_restore_drill` 跑完再 `drop`，线上库零影响 |
| 恢复后数据面 | jobs **230,432**（= `counts` 文件的 114,307 活跃 + 116,125 关闭，精确值；此前对账里的 230,563 是 `reltuples` 估算）、profiles 47、resumes 19、auth.users 47、refresh_tokens 340 |
| 恢复后结构面 | 62 public 表、37 个 jobs 索引、v7 RPC 存在 |

**这次演练新发现一个只在"裸恢复进全新空库"时才出现的坑**：dump 用 `--schema=public --schema=auth` 生成，
**扩展定义（`CREATE EXTENSION`）不在 TOC 里**，所以往一个完全空的新库恢复时 `pg_trgm` 不会被建、依赖它的
31 个函数随之失败（public 函数 70 ≠ 101，`pg_trgm` 不在 `public`）。
生产恢复路径不受影响，因为 `restore-into-selfhost.sh` **先跑 bootstrap**（bootstrap 负责建扩展并重定位到 `public`），
再去恢复；`postgres` 库本来就有扩展。结论：**恢复流程必须是 bootstrap → restore，不能跳过 bootstrap**。

> RTO 结论：423 MB 库的备份 **65 秒**、恢复 **217 秒**，加上 bootstrap/校验，整站灾难恢复到可用 ≈ **6 分钟**。

---

## 12. 正式切换 Runbook

> 前置：P4 验收 100% 通过；维护公告已发；`.env.local.pre-migration` 已备份；旧项目不动。
> 已提前完成（2026-11-20）：`0139` 已进生产库并生效（AI 选岗恢复 240 条）；部署/审计脚本已改为 `EXPECTED_SUPABASE_HOST` 校验。切换发版时必须 `EXPECTED_SUPABASE_HOST=supabase.liorvix.com`，否则 `deploy-production.sh` 会拒绝部署。
> **切换前的演练顺序已脚本化为一条龙**（导出 → 恢复 → 数据对账 → 对象复制 → 冒烟），见
> [deploy/supabase/README.md](../deploy/supabase/README.md) 的 "P3 演练一条龙"，不要凭记忆手敲命令。
>
> **整个 Runbook 已收敛成一条命令**（2026-11-23 新增，已实测"前置不过就第 1 步停、零副作用"）：
> ```bash
> bash scripts/migrate/preflight-cutover.sh      # 单独体检：还差什么，它直接告诉你
> bash scripts/migrate/run-cutover.sh            # 全流程（会二次确认；任一失败自动回滚 env + 重启应用）
> ```
> 下面的分步清单保留作为**人工复核用的检查表**，实际执行以 `run-cutover.sh` 为准。

**T-60m**
- [ ] 确认最近一次全备成功、对象存储可写
- [ ] 确认 GitHub OAuth 新 app 已生效、SMTP 测试邮件已收到
      —— GitHub **回调地址白名单只能在网页端确认**（实测：未登记的 `redirect_uri` 在"未登录"阶段也只会返回登录页，命令行无法区分；只有真正授权后 GitHub 才会报 `redirect_uri is not associated with this application`）。
      GitHub App 的 Callback URL 设置里**同时填上新的** `https://supabase.liorvix.com/auth/v1/callback`（若界面只允许一个 URL，则先记下旧值再替换：替换后回滚窗口期内 OAuth 登录不可用，邮箱登录不受影响）。
- [ ] 记录基线：行数、auth 用户、对象数、序列（附录 B）
- [ ] `curl -fsS https://weqvdtdjdzmqflhwobec.supabase.co/rest/v1/rpc/search_ai_match_candidates_v7 …` 记录旧栈 AI 选岗仍正常（切换后同参数对比）

**T-30m（开始维护）**
- [ ] `sudo systemctl stop liorvix liorvix-worker 2>/dev/null || true`
- [ ] `pkill -f backfill-official-job-details || true`（停止所有外部回填脚本）
- [ ] `ps -ef | grep -E 'tsx|node' | grep -v grep` 确认没有后台写入
- [ ] nginx 切换到维护页（建议配置 503 页面，而不是直接 502）

**T-25m：最终导出**
- [ ] `pg_dump ... --schema=public --schema=auth`（§5.2）
- [ ] 记录耗时与文件大小（先看 `pg_stat_progress_copy` 估算；本机实测 68 KB/s 的教训见 §5.2 带宽小节）

**T-18m：恢复**
- [ ] `DUMP_FILE=... bash scripts/migrate/restore-into-selfhost.sh`（§5.3；单线程 + `-L` 过滤，期望 `errors: 0 total / 0 unexpected`）
- [ ] 脚本末尾 fidelity checks 必须全 `ok`（pg_trgm / RPC 无 anon / jobs RLS / auth.users 属主）；**任一 FAIL 立即回滚**
- [ ] 基线 diff（附录 B）：**不一致则立即回滚**

**T-12m：存储与 URL**
- [ ] 复制新增对象（按 `created_at` 增量清单）
- [ ] 执行旧域名替换 SQL（§7.4）
- [ ] 校验对象数量 = **当次 `--list-only` 的数字**（迁移当天 69）、bucket 公共属性正确

**T-8m：切换配置**

> 环境变量改写已脚本化，不要手抄 base64 密钥（手抄最容易多一个换行）：
> ```bash
> bash scripts/migrate/cutover-app-env.sh --check     # 先看 5 个值的"当前 -> 目标"（脱敏）
> bash scripts/migrate/cutover-app-env.sh --apply     # 备份 .env.local.pre-migration.<时间戳> + 改写（不动服务）
> bash scripts/migrate/cutover-app-env.sh --apply --restart   # 改写并重启 liorvix（+ worker，如果装了）
> bash scripts/migrate/cutover-app-env.sh --rollback  # 出事时一条命令换回旧 env
> ```

- [ ] `cp .env.local .env.local.pre-migration`（脚本会自动做带时间戳的备份，这步是双保险）
- [ ] 修改 5 个 Supabase 变量（§8.1）：`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_DB_URL` / `SUPABASE_JWKS_URL`（HS256 无 JWKS → 脚本会注释掉）
- [ ] 核对新库 `select count(*) from auth.sessions`（基线 66）、`auth.refresh_tokens`（基线 328，含已撤销的）——**这两个数字决定了用户是否掉线，务必比对**
- [ ] `cd /opt/supabase && docker compose up -d db auth rest storage api-gw studio`（`storage` 会连带 `imgproxy`）
- [ ] 检查：`curl -f https://supabase.liorvix.com/auth/v1/health`、REST 带 service key 查询、storage 健康
- [ ] 浏览器 CORS：`OPTIONS /auth/v1/token` 返回 `Access-Control-Allow-Origin: *`（§6.5；**GoTrue 自己不回预检头，靠 nginx 的 `supabase-cors-preflight.conf`**）
- [ ] GitHub OAuth：`GET /auth/v1/authorize?provider=github` 必须 302 到 github.com，且 `redirect_uri=https://supabase.liorvix.com/auth/v1/callback`；
      该回调地址要**提前**加进 GitHub App 的 callback URL 列表（GitHub App 支持多个，旧的不删 → 切回也还能用）
- [ ] Cloudflare 清除 `/api/auth/config` 缓存（§6.5）

**T-4m：启动应用**
- [ ] 清空残留岗位同步租约（`run-cutover.sh` 已自动做；手敲版）：
      `docker exec liorvix-supabase-db psql -U supabase_admin -h 127.0.0.1 -d postgres -c "update public.job_sync_state set lease_owner=null, lease_expires_at=null where lease_owner is not null"`
      —— 不清的话，新 worker 前 15 分钟会一直报"另一个岗位同步任务正在运行"（§5.9③）
- [ ] `sudo systemctl start liorvix`
- [ ] `curl -f http://127.0.0.1:5000/api/health`
- [ ] 跑自动冒烟脚本（附录 C）
- [ ] **看 `journalctl -u liorvix -f | grep '\[Job Worker\]'` 至少 3 分钟**：要看到
      `incremental sync completed`（`failed 0 / fatal_failures 0`）、`official detail cycle completed`、`historical field review cycle completed`；
      若出现 `<html>502` 或 `without parameters in the schema cache` → 分别查 §5.9①（nginx 缓冲）和 §5.9②（`SUPABASE_URL` 必须 https）

**T+0：开放流量**
- [ ] 移除维护页 / 恢复 nginx
- [ ] 启动 `liorvix-worker`
- [ ] 观察 15 分钟：5xx、p95、`AI match` 日志、worker 首轮 sync
- [ ] 核对岗位数据真的在变：`select count(*) from jobs`、`select last_incremental_success_at from job_sync_state where source_system='collector_feed'` 应每 5 分钟前进
- [ ] 预期现象（不是故障）：已登录用户首次请求会 401 一次 → 前端用 refresh token 换新 token → 恢复；若持续 401 则是 §6.1 续期链没验证到位，立即按 R2 处理

**T+30m 验收**
- [ ] 人工跑功能矩阵中 1–6、9–10、12、16、23–24
- [ ] 确认 `auth.users` / `jobs` / `ai_matches` 行数合理增长
- [ ] 记录切换报告（耗时、异常、指标）

**T+2h**
- [ ] 检查无新增 500、无 OAuth/邮件报错、无 statement timeout
- [ ] 结束维护公告

**失败回滚判定**：T+0 之前任一步失败 → 停应用、恢复 `.env.local.pre-migration`、重启、开放旧环境（数据零丢失）。T+0 之后 → 只修不滚（回滚会丢新写入）。

---

## 12.1 正式切换实况与切流后事故复盘（2026-11-23 ~ 11-24，已全部闭环）

本节记录**真实切换当天发生了什么**，与前面推演式 plan 分开。切换成功不代表故事结束：
真正让用户"登录了却像没登录"的，是下面第 ③ 条前端缓存 + 旧会话的组合事故。

### 成功时间线（UTC+8）

| 时间 | 事件 | 结果 |
| --- | --- | --- |
| 16:33:53 | 开始 cutover（`run-cutover.sh --yes`） | 应用停服进入维护窗口 |
| 16:34–16:41 | dump 恢复（`restore-into-selfhost.sh`）、storage 同步、URL 改写、env 切换 | 422 M dump，`errors: 0`，fidelity 全 ok |
| 16:41:26 | 新栈冒烟 `smoke` 步骤 | **PASS 12 / FAIL 0 / WARN 1**，应用重启并开放流量 |
| 16:41 起 | 生产指向 `https://supabase.liorvix.com`（GoTrue 2.197.0 / PostgREST 14.18 / storage，5 容器健康） | 首日零 502、零 5xx（用户面） |

切换后数据基线（用于日后核对）：`auth.users=48 / profiles=48 / resumes=19 / ai_matches=152 / jobs≈230,594`。

### 事故 ①：Cloud 签名的 token 在自托管 HS256 上必然失效 → 全员强制重登

- Cloud 项目签发 **ES256**，自托管 GoTrue 用 HS256（`GOTRUE_JWT_SECRET` 新生成）。
  老 token 拿过来验证 → `bad_jwt: signing method ES256 is invalid`（切换后 39 次）；`/auth/v1/user` 403。
- 结论：**密钥不可复用（Cloud 的 refresh token hmac 也拿不到）**，所有已登录用户必须重新登录一次。
  这点没法"丝滑过渡"，只能接受并在切换公告里讲清楚。切流后实测有效：两位真实用户当天完成登录并正常使用
  （`/api/jobs`、`/api/resume`、`/api/credits`、`/api/ai/match` 均 200）。

### 事故 ②：GitHub OAuth 仍指向旧 Cloud App → 新 App 不生效

- 现象：用户点 GitHub 登录，回调仍打回旧 Cloud 项目，回来还是"未登录"。
- 根因：前端 bundle 还是**切换部署前的旧构建**（见事故 ③），旧 bundle 把 `supabaseUrl` 当成
  `https://weqvdtdjdzmqflhwobec.supabase.co`，OAuth 自然走旧 App（`Ov23liiTkHiiLKEyzL4O`）。
- 处置：GoTrue 侧 `GOTRUE_EXTERNAL_GITHUB_CLIENT_ID=Ov23liSDUNUddkcJoYkb`，
  新 App 的 callback 固定为 `https://supabase.liorvix.com/auth/v1/callback`；
  前端部署新构建后复测授权跳转正确。

### 事故 ③（最贵的一个）：旧前端 bundle + 无 TTL 的 auth 配置缓存 → "登录了但处处未登录"

这是用户实际看到的故障，也是本次复盘的核心。

| 项 | 内容 |
| --- | --- |
| 现象 | ①GitHub 登录走了旧 App；②登录成功后所有页面仍显示未登录；③未登录却能看到岗位列表（并出现中文"请先登录"） |
| 根因 1 | 线上跑的是切换前的旧前端（`supabase-browser.ts` 85 行版）：`/api/auth/config` 结果写进 `sessionStorage['liorvix.auth-config.v1']`，**没有 TTL、没有栈校验**。切换后即使后端已改为自托管 URL，浏览器里的旧缓存仍把 supabase-js 指向旧 Cloud 项目 → OAuth/会话全走 Cloud |
| 根因 2 | 旧 Cloud 的 `sb-<ref>-auth-token` 还留在 localStorage，supabase-js 读到它 → 前端认为"已登录" → `AuthGuard` 放行渲染 `/jobs`、接口也照常返回数据 |
| 根因 3 | 岗位接口当时**没有鉴权**，访客也能拿到完整岗位数据；401 文案写死中文 `请先登录` |
| 修正 A | 前端 `supabase-browser.ts` 重写为带栈校验的 v2：`AUTH_STACK_KEY=liorvix.auth.stack.v1` 记录当前 auth host；栈变化时 `purgeStoredAuth()` 清掉 `liorvix.auth.session.v1`、所有 `sb-*-auth-token`、`-code-verifier`/`-user` 变体；配置缓存改 `fetch('/api/auth/config', { cache: 'no-store' })` + 60 s TTL + 固定 storageKey `liorvix.auth.session.v1` |
| 修正 B | `clearInvalidSession()`：任何带 token 的请求收到 401 → 清本地会话并 `signOut({ scope: 'local' })` 触发 SIGNED_OUT → `AuthGuard` 跳 `/login`。用户最多重登一次，不会卡在"处处未登录" |
| 修正 C | 新增 `src/lib/job-access.ts`：`/api/jobs`、`/api/jobs/[id]`、`/api/jobs/companies`、`/api/jobs/stats` 统一要求"合法用户 Bearer 或管理员会话"，否则 401 `{"error":"Sign in required","code":"AUTH_REQUIRED"}`；`unauthorizedResponse()` 默认文案改英文（72 个调用点一并生效） |
| 修正 D | `/jobs` 页公司清单改用 `apiFetch`（需要 Bearer），访客不再有"偶发同源请求漏 token"的窗口 |
| 验证 | 访客 + 伪造残留会话访问 `/jobs`、`/resume`、`/ai-match` → 全部跳 `/login`，页面中文行 **0**，岗位接口请求 **0 次**；真实 token 访问三个岗位接口与 `/api/jobs/stats` 全部 200 |
| 教训 | **前端产物是独立的部署物**。改后端 URL/密钥后必须确认线上 chunk 已更新：比对 `.next/BUILD_ID`、在 chunk 里 grep 新常量名（本次靠 `grep -c AUTH_STACK_KEY` 发现第一次推送其实没生效）。只看"服务重启成功"会漏掉这一类事故 |

### 事故 ④：英文界面里混中文文案（同一 bundle 遗留）

| 位置 | 原来 | 现在 |
| --- | --- | --- |
| 未登录 401 | `请先登录` | `Sign in required`（+ `AUTH_REQUIRED` code） |
| 岗龄徽章 | `4+ 年经验` | 三语 key `jobs.expMin/expRange/expMax`（`4+ yrs experience`） |
| 地区筛选（DB 存中文枚举：北美/美国/英国/… ） | 中文直出 | `localizeJobEnum` 扩展地区映射 + `jobs.region.*` 三语文案 |
| 工作类型（实习/校招/社招/未知） | `未知` 漏出 | 映射到 `jobs.enum.*` |
| 空筛选/请求失败兜底 | `暂无可用选项` / `岗位接口请求失败` | 跟随语言 / 英文 |

验收：英文界面登录态打开 `/jobs` 加筛选面板 → 页面中文行数 **0**，标签为 `North America` / `8+ yrs experience`。

### 事故 ⑤：岗位批量 upsert 每天少量 500（`21000 duplicate id in ON CONFLICT`）

- 现象：`POST /rest/v1/jobs?on_conflict=id...` 每天约 24 次 **500**（00:0x、06:0x 各 12 次），PostgREST 响应体：
  `{"code":"21000","message":"ON CONFLICT DO UPDATE command cannot affect row a second time"}`。
- 根因：同一批同步数据里两条记录解析到**同一个既有岗位**（URL 轮换 / `external_job_id` 变体），
  一次 upsert 的 `VALUES` 里出现重复 `id`，PostgreSQL 直接拒绝整批。
- 影响：有单行降级兜底（日志 `write_batch_failures` 会被记录，随后逐条 update 成功），**不是数据丢失**，
  但每天制造 24 条 5xx 噪音并浪费一轮重试。
- 修正：`src/lib/job-sync.ts` 写入前分别按 `id`（updates）和 `external id / job_url / title|company`（inserts）去重，
  后出现的记录覆盖先出现的。部署后 40 分钟复测：`21000` 报错 **0**、`write_batch_failures: 0`。

### 事故 ⑥：`/api/jobs/stats` 对访客泄露岗位库总量

- 该接口只返回聚合数字（today/week/month/total），不含岗位行，但属于岗位库信息。
- 修正：与其余岗位接口同一把锁（`requireJobAccess`）。访客 401；登录用户 200（实测 `total=76666`）。
  `/jobs` 页面的统计 widget 当前无任何引用方，不受影响。

### 当前线上状态（2026-11-24 10:15 复核）

| 项目 | 结果 |
| --- | --- |
| 应用 | `liorvix.service` active（10:11:47 重启，`NRestarts=0`），健康检查 0.08 s |
| 前端 | `BUILD_ID=7D1ckQjhCo9HtwKJsQwtD`（10:11 部署）；`ai/match` 兜底检索新代码已在 `.next/server` 命中；客户端 auth 栈标记 2 个 chunk 命中 |
| 鉴权 | 访客：岗位 4 个接口 401 英文；真实 token：`/api/jobs`、`/api/jobs/[id]`、`/api/jobs/companies`、`/api/jobs/stats` 全 200 |
| 数据 | `auth.users=50 / profiles=50 / resumes=20 / ai_matches=152 / jobs≈232,953（活跃 114,483）`，切流后新增 2 位真实用户 |
| 同步 | `job_sync_runs` 每 1~3 分钟一条、`failed=0`；岗位写入新鲜度 <2 分钟；官方源里 Meta / 部分 Workday 公司为**切流前就存在的**外部源问题（`last_inc` 停在 11-13，`fails` 55+），与自托管无关，另案处理 |
| 监控 | `liorvix-monitor.timer` 每 3 分钟，`state.json` = `status: ok`、0 失败 0 提醒；告警收件人已显式设为 `support@liorvix.com`（此前留空回退到 `noreply@liorvix.com`，导致"发送成功但收不到"，已修正）；邮件通道经 Brevo 实测中继接受（250）|
| 备份 | 每日 03:26 dump（424 MB）+ 月度恢复演练；11-24 10:03 首次实跑 **PASS**（rc=0、0 错误、226 s，逐表差异仅来自 dump 时间差），临时库已自动删除 |
| 异常 | 部署后新 5xx **0**；`bad_jwt` 近 12 h **0**；磁盘 65%、内存 5.7/15 GiB、load 0.5 |

### 2026-11-24 增量交付（可观测性、恢复演练、一次回归部署）

1. **三层监控上线**：本机 3 分钟巡检（`liorvix-monitor.timer`）+ 邮件告警 + GitHub 外部拨测，
   详见 [monitoring-and-drills.md](./monitoring-and-drills.md)。旧的 `liorvix-healthcheck.timer` 已停用，
   其检查被 monitor 的第 1 项完整覆盖。
   - 告警收件人首次留空时回退到了 GoTrue 的发件人 `noreply@liorvix.com`，导致"脚本报发送成功、
     人却收不到"；已显式设置 `ALERT_EMAIL_TO=support@liorvix.com` 并实测中继接受（250），
     该坑写进配置模板与监控文档。
2. **月度恢复演练自动化**：`liorvix-restore-drill.timer`（每月 1 日 04:30），首次实跑 10:03 PASS。
   演练全程走容器内 `psql`/`pg_restore`——首次尝试用宿主机客户端时，因 `pg_hba` 只对 `postgres`
   库免密而卡在 `Password for user supabase_admin:`，该坑已修复并记录。
3. **回归部署**：把已提交但未上线的 `ai/match` 兜底检索加固（`job_ai_match_scopes` 陈旧表 →
   按地区规则过滤）随新构建上线，`BUILD_ID` 由 `wHRZVN5c…` 升到 `7D1ckQjhCo9HtwKJsQwtD`；
   部署后 5xx=0、访客 401 不变、公网页面 200、浏览器冒烟无 console 错误。
4. **Git 历史整理**：47 个未提交改动按主题拆成 7 个提交（迁移资产 / AI 选岗与源抓取 / 登录鉴权与
   i18n / 监控与演练 / Workday 429 文档 / 演练修复 / gitignore），`secrets/` 私钥目录已加入忽略。
5. **已推送 GitHub（2026-11-24 11:06）**：功能分支 `codex/ui-overlay-from-ui-change` 推到
   `4f3ddb8`（10 个提交）；另外把 `uptime-probe.yml` 单独补到默认分支 `main`（`27d97f3`）——
   GitHub 只对默认分支的 `schedule` 生效，只放功能分支时"每 15 分钟"永远不会触发。

### 遗留待办（不阻塞线上）

1. `job_ai_match_scopes` 历史数据清理（约 183k 行，可延迟到低峰批量删）。
2. ~~外部拨测~~ **已完成（2026-11-24）**：三层监控已落地，详见
   [monitoring-and-drills.md](./monitoring-and-drills.md)。
   - 本机 `liorvix-monitor.timer` 每 3 分钟巡检（基础设施 + 公网可达 + 同步/写入新鲜度 + 5xx + 证书 + 演练报告），
     异常按"立即告警 / 每小时提醒 / 恢复通知"发邮件到 `ALERT_EMAIL_TO`（默认 `SMTP_ADMIN_EMAIL`）；
   - 外部 `uptime-probe.yml`（GitHub Actions，每 15 分钟）从 GitHub 网络打公网端点，用于发现"整机失联"；
   - 如需要秒级/多地拨测，再另接 UptimeRobot/BetterStack（步骤见上述文档 §3）。
3. 官方源 Meta / Workday 若干公司连续失败（始于切流前 11-13），按 `docs/job-company-field-connector-runbook.md` 单独立项排查，不要用猜测定截止日期/薪资。
4. ~~备份恢复演练~~ **已完成自动化（2026-11-24）**：`scripts/migrate/restore-drill.sh` +
   `liorvix-restore-drill.timer`（每月 1 日 04:30）会把最新 dump 恢复进临时库、逐表与生产比对、
   校验 RLS/函数/属主，出报告并发信；临时库无论成败都会删除。首次实跑结果见
   [monitoring-and-drills.md](./monitoring-and-drills.md) §4。
5. Cloud 旧项目**保持只读保留**（30 天）作为最后兜底；30 天后按 §13 判定是否回收。

---

---

## 13. 回滚方案

| 场景 | 动作 | 数据影响 |
|---|---|---|
| 恢复失败 / 校验不一致 | 停新栈、恢复 env、启动应用；旧库未动 | 无 |
| 应用冒烟失败（未开放流量） | 同上 | 无 |
| 开放后发现个别功能异常 | 修代码/配置，向前修复；旧库保留只读参照 | 无回滚 |
| 新库不可用（严重） | 从最近全备 + WAL 恢复到新实例；DNS/URL 不变 | 丢失 RPO（≤5 分钟） |
| 需要彻底退回 Supabase | 保留 30 天内可切回 env，但切换后新写入需反向导出 | 高成本，不推荐 |

---

## 14. 风险登记

| # | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| 1 | GoTrue schema 版本落后 | 中 | 登录/注册全挂 | 门禁 §6.2；演练用真实账号 |
| 2 | 旧 access token 在新栈验签失败（**必然发生**） | 高 | 已登录用户最多 1 小时内遇到一次 401 | 迁移 `auth.sessions`/`auth.refresh_tokens`（含 `refresh_token_hmac_key`）+ cache key v2 + 主动 `refreshSession()`；演练第 1 项即验证续期链 |
| 3 | SMTP 送达率差 | 中 | 注册/重置失败 | 提前 3 天测 Gmail/Outlook/QQ；配 SPF/DKIM |
| 4 | GitHub 回调未更新 | 中 | OAuth 失败 | 新 app 提前上线，演练验证 |
| 5 | 权限/RLS 丢失 | 低 | 数据泄露或 401 | 保留 GRANT；策略数 41 校验；双账号越权测试 |
| 6 | 存储 URL 未改写 | 低 | 头像/logo 裂图 | §7.4 SQL + 页面巡检 |
| 7 | dump 在 6543 上失败 | 中 | 迁移阻塞 | 实测 6543 可用；失败则改 5432 session 模式；提前跑全量 dump |
| 8 | 磁盘不足 | 低 | 写入失败 | 备份外置 + 磁盘告警 + 预留 50% |
| 9 | 单机故障 | 低 | 全站不可用 | 每日备份 + 30 分钟恢复演练 + 旧库兜底 |
| 10 | Docker/组件版本不兼容 | 中 | 启动失败 | 固定版本；演练先跑通再切 |
| 11 | 忘记停回填脚本 | 中 | 切换期间旧库仍被写入 | T-30 显式 `pkill` + 检查 `ps` |
| 12 | 浏览器缓存旧 auth 配置 | 中 | 个别用户 5 分钟内打到新网关但用旧 key → 401 | cache key v2 + 主动 refresh + Cloudflare purge；不要依赖"复用 secret" |
| 13 | **nginx 缓冲太小 → 岗位同步 502** | 高（已消除） | 站点正常但岗位数据停更，极难发现 | 已修：`proxy_buffer_size 32k` + `large_client_header_buffers 4 32k`（§5.9①）；`preflight-cutover.sh [10]` 用 5.6 KB/10 KB URI 长查询做门禁 |
| 14 | **`SUPABASE_URL` 写成 `http://`** | 高（已消除） | 所有写操作被 301 降级成 GET → RPC 报"函数不存在"、insert 报"Cannot coerce" | 已修：切流模板强制 `https://`；`preflight-cutover.sh [9]` 用带参 POST RPC 验证请求体完整（§5.9②） |
| 15 | 残留 `job_sync_state` 租约挡住首次增量 | 中（已消除） | 切换后前 15 分钟岗位不同步，日志报"另一个岗位同步任务正在运行" | `run-cutover.sh` 启动应用前清空租约；Runbook T-4m 有手敲兜底（§5.9③） |

---

## 15. 时间表与验收

| 日期 | 任务 | 验收 |
|---|---|---|
| D1 | P0 清单、基线快照、备份 env | 清单全勾 |
| D2–D3 | P1 代码改造 + 灰度上线旧库 | AI 选岗恢复、gzip 生效、worker 拆分 |
| D4 | P2 新栈（db/auth/rest/storage/api-gw/nginx/TLS） | 三个健康检查 200 |
| D5 | P3 首次演练（dump/restore/auth/storage） | 登录、上传、列表通过 |
| D6–D7 | P4 功能矩阵 + 压测 + 备份恢复 + 二次演练 | 30 项全绿，恢复 < 30 分钟 |
| D8 | P5 切换（§12） | 冒烟通过、观察 2 小时 |
| D9–D30 | P6 观察、归档、退订 | 无回归，月费 $0 |
| D30+ | 优化：Web 多进程、列表短缓存、慢查询治理 | 容量报告 |

**最终验收标准**

- 功能矩阵 30/30 通过；
- 切换停机 ≤ 30 分钟（实际目标 15 分钟）；
- 备份可从零恢复（演练记录）；
- 迁移后 7 天无新增 5xx / 无 OAuth 或邮件失败；
- 旧项目 30 天内未被写入（可安全退订）。

---

## 16. 成本

| 项 | 迁移前 | 迁移后 |
|---|---|---|
| Supabase Pro | ~$30/月 | $0 |
| VPS（已付） | 不变 | 不变 |
| 对象存储备份 | — | 约 $1–3/月（5–10 GB） |
| 可选 100 GB 云盘 | — | 约 $3–5/月 |
| SMTP | — | 免费额度通常足够 |
| **合计** | **~$30/月** | **约 $0–5/月** |

---

## 附录 A：环境变量差异（只列变化）

```diff
- SUPABASE_URL=https://weqvdtdjdzmqflhwobec.supabase.co
+ SUPABASE_URL=https://supabase.liorvix.com

- SUPABASE_DB_URL=postgresql://postgres.weqvdtdjdzmqflhwobec:...@aws-0-us-west-1.pooler.supabase.com:6543/postgres
+ SUPABASE_DB_URL=postgresql://postgres:<POSTGRES_PASSWORD>@127.0.0.1:5432/postgres

- SUPABASE_JWKS_URL=https://weqvdtdjdzmqflhwobec.supabase.co/auth/v1/.well-known/jwks.json
+ SUPABASE_JWKS_URL=https://supabase.liorvix.com/auth/v1/.well-known/jwks.json

- SUPABASE_ANON_KEY=sb_publishable_jOXQ...        # 旧项目 opaque key，新网关不认
+ SUPABASE_ANON_KEY=<新生成 sb_publishable_...>   # 或自签 anon JWT
- SUPABASE_SERVICE_ROLE_KEY=sb_secret_Cj...
+ SUPABASE_SERVICE_ROLE_KEY=<新生成 sb_secret_...>

  # 以下保持不变
  SUPABASE_RESUME_BUCKET=risingpath-resumes
  AUTH_SITE_URL=https://liorvix.com
```

## 附录 B：基线快照脚本

已落地为可复用脚本（不是一次性片段）：[scripts/snapshot-db-baseline.ts](../scripts/snapshot-db-baseline.ts)。

```bash
# 迁移前（本次已跑，结果见 docs/baseline/prod-before-2026-11-20.json）
DOTENV_CONFIG_PATH=.env.production.local pnpm exec tsx scripts/snapshot-db-baseline.ts --out=docs/baseline/prod-before-YYYY-MM-DD.json

# 迁移后 + 自动 diff
DOTENV_CONFIG_PATH=.env.local pnpm exec tsx scripts/snapshot-db-baseline.ts \
  --out=docs/baseline/prod-after-YYYY-MM-DD.json \
  --compare=docs/baseline/prod-before-YYYY-MM-DD.json
```

脚本采集项（`--compare` 会逐项比对）：库大小、public 表/视图/函数数、RLS 策略数、触发器数、序列与 `last_value`、
全部表行数（大表用 `reltuples` 估算，避开 8 秒语句超时）、`auth.users/identities/sessions/refresh_tokens` 精确计数、
`auth.schema_migrations` 最高版本、`storage.buckets/objects` 分桶统计、`jobs` 活跃/关闭数、旧域名 URL 引用数、扩展与 schema 清单。

> 门禁标准：`--compare` 的差异里，只有 `sequenceLastValues` 与 `jobsActive` 允许变（切换前的正常写入），其余任何差异都视为迁移失败。
> 特别注意 `auth.sessions` / `auth.refresh_tokens` 必须逐行一致 —— 这是"用户不掉线"的唯一依据。

## 附录 C：冒烟脚本（切换后用）

```bash
#!/usr/bin/env bash
set -euo pipefail
APP=http://127.0.0.1:5000
SUP=https://supabase.liorvix.com

curl -fsS "$APP/api/health" | grep -q '"status":"ok"'
curl -fsS "$SUP/auth/v1/health"
curl -fsS "$SUP/storage/v1/object/public/risingpath-assets/logos/qualcomm_1789550514910.png" -o /dev/null
curl -fsS "$APP/api/auth/config" | grep -q 'supabase.liorvix.com'
curl -fsS "$APP/api/jobs?limit=5" | grep -q '"jobs"'

# 带登录态的链路（需要测试账号 token）
# TOKEN=... curl -fsS -H "Authorization: Bearer $TOKEN" "$APP/api/resume"
# TOKEN=... curl -fsS -H "Authorization: Bearer $TOKEN" "$APP/api/credits"

echo "smoke OK"
```

## 附录 D：nginx 与 compose 关键片段

**nginx**

```nginx
server {
  server_name supabase.liorvix.com;
  client_max_body_size 50m;

  location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
  }
  listen 443 ssl; # certbot
  # ssl_certificate ...
}
```

**compose（以官方 docker-compose.yml 为基线，按需启动/裁剪）**

```yaml
services:
  db:
    image: supabase/postgres:17.6.1.136
    mem_limit: 8g
    restart: unless-stopped
    volumes: [ ./volumes/db/data:/var/lib/postgresql/data ]
    ports: [ "127.0.0.1:5432:5432" ]
  auth:       { image: supabase/gotrue:v2.197.0,          mem_limit: 512m }
  rest:       { image: postgrest/postgrest:v14.18,        mem_limit: 512m }
  storage:    { image: supabase/storage-api:v1.89.12,     mem_limit: 768m }
  imgproxy:   { image: darthsim/imgproxy:v4.0.21,          mem_limit: 512m }
  api-gw:     { image: envoyproxy/envoy:v1.39.6,           mem_limit: 512m, ports: [ "127.0.0.1:8000:8000" ] }
  studio:     { image: supabase/studio:2026.11.02-sha-a05e7ec, mem_limit: 512m }
```

> 以上版本即官方 compose 当前 pin 的版本；直接 `git clone` 官方 `docker/` 目录并按需 `docker compose up -d db auth rest storage api-gw studio` 即可，不要自行降级。
> 不把 `db` 的 5432 暴露到公网；`api-gw` 只绑 127.0.0.1，由 nginx 对外；`studio` 不映射公网端口，需要时用 SSH 隧道。

---

## 附：不要做的事

- ❌ 不要在 `pg_dump` 报事务/预处理错误时硬扛（改用 5432 session 模式，不要反复重试 6543）。
- ❌ 不要 `--no-privileges`（会丢 GRANT，RLS 行为改变）。
- ❌ 不要 dump/restore `storage` schema（让 storage-api 自建，再复制对象）。
- ❌ 不要在切换中途再轮换一次密钥（会让刚换到的 token 又失效）；key 只生成一次、写死到 `.env` 里。
- ❌ 不要删除旧 Supabase 项目（至少保留 30 天）。
- ❌ 不要把 5432、8000、Studio 暴露到公网。
- ❌ 不要在维护窗口内执行未演练过的命令（所有命令先在 staging 跑过）。
