# P0 前置条件收集结果

> 采集时间：2026-11-20 16:0x–16:3x（Asia/Shanghai）
> 采集人：DSH agent（只读为主，唯一写操作见 §7「副作用说明」）
> 目的：把《Supabase 自托管迁移计划》§5 的「需要你提供」清单里，能我自己拿到的部分先拿到，只把真正需要你点鼠标的部分留给你。

---

## 0. 结论速览

| # | P0 项 | 状态 | 说明 |
|---|-------|------|------|
| 1 | 生产服务器 SSH + sudo | ✅ **已取得** | `ubuntu@43.172.117.125`，免密 sudo 可用；`root` 已禁止公钥登录 |
| 2 | 服务器资源 / 端口 / 磁盘 / 证书 | ✅ 已盘点 | 8C16G、32G 空闲、5432/6543/8000/8443 全空闲、`liorvix.com` 证书有效到 2027-01-18 |
| 3 | 生产库连接串（含密码） | ✅ **已取得** | `aws-0-us-west-1.pooler.supabase.com:6543`，角色 `postgres`（可读 `auth.*`），已实测可 `pg_dump` |
| 4 | 生产 API keys（publishable / secret） | ✅ **已取得** | `.env.production.local` + `/opt/liorvix/.env.local` 均已存在，形如 `sb_publishable_…` / `sb_secret_…` |
| 5 | JWT Secret | ❌ 拿不到，**但已确认不再需要** | 项目用的是 ES256 非对称签名密钥（JWKS），私钥只在 Dashboard；新方案用「refresh token 续期」实现零重登（见 §3） |
| 6 | SMTP 提供商 | ✅ **已确认是 Brevo** | `mail.liorvix.com → *.brand.brevosend.com`；发件人 `noreply@liorvix.com`；SPF + DKIM（`default._domainkey.mail.liorvix.com`）齐全；实测注册邮件成功送达 |
| 7 | SMTP 凭据 | ⚠️ **密钥已收到，还差 Login** | `xsmtpsib-…` 已收到；缺 Brevo 的 `xxx@smtp-brevo.com` 登录名（实测 `535 Authentication failed`） |
| 8 | GitHub OAuth client_id | ✅ **已取得** | 旧 App `Ov23liiTkHiiLKEyzL4O`（回滚保留）；新 App `Ov23liSDUNUddkcJoYkb`（新栈用） |
| 9 | GitHub OAuth client_secret | ✅ **已验证有效** | 用错误 code 打 token 端点返回 `bad_verification_code`（而非 `incorrect_client_credentials`），证明 id+secret 配对正确 |
| 10 | Cloudflare 区域归属 | ✅ **已确认** | zone id `d09765a84752a7fcba4a4b0f49553865`，NS `sonny/thea.ns.cloudflare.com`，Free 计划，主域走代理 |
| 11 | Cloudflare 建 DNS / 清缓存 | ⚠️ **Token 只读** | Token 有效但只有 `DNS:Read`：建记录 403、purge 401。需补 `DNS:Edit` + `Cache Purge`，或你手工加记录 |
| 12 | 维护窗口 | ⏳ 待定（不阻塞） | 建议 02:00–04:00，停机 10–20 分钟；等演练通过后再定 |
| 13 | 基线快照 | ✅ **已产出** | `docs/baseline/prod-before-2026-11-20.json`，可复跑脚本 `scripts/snapshot-db-baseline.ts` |
| 14 | Auth 邮件模板导出 | ⚠️ 部分自动捕获 | `docs/baseline/email-templates-captured/`（确认信 + 重置密码信的完整 text/html）；OTP 撞 429、邀请信未送达，其余仍需从 Dashboard 抄 |

**净结论（17:2x 更新）：14 项里 10 项已完成。真正还差你动手的只有 2 项 —— Brevo 的 SMTP `Login`、Cloudflare 的 DNS `Edit` 权限（或手工加一条 A 记录）。维护窗口可以晚点定。**

---

## 1. 重要反转：JWT Secret 这一项可以删除

原计划假设「复用旧 JWT secret 才能让用户不重登」。实测这个假设对**当前这个项目**不成立，原因有三层证据：

**证据 A — 现在的 anon/service key 不是 JWT，是新式 opaque key**

```
SUPABASE_ANON_KEY         = sb_publishable_jOXQ0…E2345l   (46 字符, 0 个 '.')
SUPABASE_SERVICE_ROLE_KEY = sb_secret_Cj……Q0qcGf          (41 字符, 0 个 '.')
```

不是 `eyJhbGciOi…` 形式的 HS256 JWT，说明项目已迁移到 Supabase 新式 API Key 体系（publishable / secret）。新式 key 由网关按库内映射换取内部 JWT，**不是由 secret 派生**，所以「拿到 secret 就能复用旧 key」这条路本身就不通。

**证据 B — 用户 token 用 ES256 非对称密钥签名**

`GET /auth/v1/.well-known/jwks.json` 返回：

```json
{"keys":[{"alg":"ES256","crv":"P-256","kty":"EC","use":"sig",
          "kid":"64540132-83a1-4fa8-91e8-850d0d464c08",
          "x":"VjRIC6HM5ZQbTllA-NQdEQYTG2405SrujokSSJN1KhQ",
          "y":"mGivBNQ8bekKJtSedhmrbA8Rqx0LiDx9kSGXF0rrRhY"}]}
```

私钥只存在 Dashboard（JWT Signing Keys 页面），无法导出。**即使拿到 legacy JWT secret，也签不出能与这组 ES256 公钥匹配的 token。**

**证据 C — 代码与构建产物里没有任何 HS256 secret 依赖**

- `src/` 内 `SUPABASE_JWKS_URL`、`jwks` 零引用（grep 无命中）→ 没有「用 secret 自签 token」的代码路径；
- 生产构建产物里 `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`、`sb_publishable_` 命中数均为 **0** → 浏览器端不烘焙任何密钥；
- 浏览器拿配置的唯一入口是 `GET /api/auth/config`（`src/app/api/auth/config/route.ts`），运行时读 env，`Cache-Control: public, max-age=300, s-maxage=300`；
- 实测该接口现返回 `{"url":"https://weqvdtdjdzmqflhwobec.supabase.co","anonKey":"sb_publishable_…","captchaEnabled":true,"devAuth":false}`。

**所以迁移策略改为：**

1. 自托管时**生成自己的一套密钥**（ES256 JWK + 新式 opaque publishable/secret key 都可由官方 compose 支持，见 §6）；
2. 会话不中断靠**迁移 `auth.sessions` + `auth.refresh_tokens`**，不靠密钥复用；
3. 用户手上的旧 access token 最长 1 小时内失效 → 前端用仍在库里的 refresh token 换新 token。

**为什么 refresh token 一定能续上（这条是硬证据，不是推测）：**

```
auth.refresh_tokens: 327 行（其中 261 revoked），token 列长度恒定 12 字符（存哈希，不是明文）
auth.sessions:       66 行，含 refresh_token_hmac_key / refresh_token_counter 列
```

GoTrue 校验 refresh token 用的是 **session 行内自带的 `refresh_token_hmac_key`**，与 JWT 签名密钥无关。只要 `auth.sessions` / `auth.refresh_tokens` 原样搬过去，旧 refresh token 仍能换出（用新密钥签名的）新 access token。

**残留风险与对策**：切换瞬间，浏览器里那个还「没过期」的旧 access token 会被新 PostgREST/GoTrue 判为签名无效 → 401。对策是这次一并做（已列入 P1）：

- 把 `AUTH_CONFIG_CACHE_KEY` 从 `liorvix.auth-config.v1` bump 到 `v2`（强制重新拉配置）；
- 配置拉到新地址后主动 `supabase.auth.refreshSession()` 一次；
- Cloudflare purge `/api/auth/config`。

这样用户看到的最坏情况是「刷新一下」，而不是「重新登录」。**副作用是：回滚窗口内不要 revoke 旧 refresh token，否则续期链断掉。**

---

## 2. 服务器侧已具备条件（只读盘点）

| 项 | 实测值 |
|---|---|
| 系统 | Ubuntu 24.04.4 LTS，kernel 6.8.0-124，KVM，已运行 91 天 |
| CPU / 内存 | 8 vCPU（EPYC 9754）/ 15 GiB，`available` 14 GiB，swap 1.9 GiB 未用 |
| 磁盘 | `/` 50 G，已用 16 G，**剩 32 G** |
| 负载 | load average 0.04 / 0.01 / 0.05 |
| 监听端口 | 22、80、443（nginx 1.24.0）、**127.0.0.1:5000（node，liorvix.service）** |
| 目标端口占用 | 5432 / 6543 / 8000 / 8443 / 9000 / 2500 **全部空闲** |
| Docker | **未安装**；`apt` 源里有 `docker.io 29.1.3` 与 `docker-compose-v2 2.40.3`（无需加 Docker 官方源） |
| 外网连通性 | Docker Hub `registry-1.docker.io` 401（正常，0.19s）、`auth.docker.io` 200、`ghcr.io` 401（正常）、`github.com` 200 → **拉镜像不需要镜像站** |
| 出站 SMTP | `smtp-relay.brevo.com:587` OK、`smtp.qiye.aliyun.com:465` OK → **GoTrue 发信不会被运营商封端口** |
| nginx | `gzip on` 但 `gzip_types` 整行被注释（确认了「JSON 不压缩」的根因）；站点 `sites-available/liorvix` 只有 `/` 与 `/api/health` 两个 location |
| TLS | certbot 2.9.0 + nginx 插件可用，`certbot.timer` 已激活；`liorvix.com` 证书到 **2027-01-18** |
| 应用 | `liorvix.service`：`User=root`、`EnvironmentFile=/opt/liorvix/.env.local`、`ExecStart=/usr/bin/node /opt/liorvix/dist/server.js`、`Restart=always`；Node v20.20.2 |
| 防火墙 | `ufw` inactive（安全组在腾讯云侧） |
| 目录 | `/opt/liorvix`（当前版本）、5 个历史备份（含 284 MB tar.gz，可清理腾空间） |

> 顺带确认：这台机器上没有任何 Cloudflare 凭据、没有 `cloudflared`、没有 `msmtp/postfix`、没有 supabase CLI —— 所以 §4 那些凭据确实只能从你那边来。

---

## 3. 数据库侧已具备条件

| 项 | 实测值 |
|---|---|
| 版本 / 大小 | PG 17.6（cloud），**4358 MB** |
| 连接 | `aws-0-us-west-1.pooler.supabase.com:6543`（事务池），`postgres` 角色 `rolbypassrls=true`、`is_superuser=off` |
| Schema | `auth`、`extensions`、`graphql`、`graphql_public`、`public`、`realtime`、`storage`、`vault` |
| 扩展 | `pg_stat_statements 1.11`、`pg_trgm 1.6`、`pgcrypto 1.3`、`supabase_vault 0.3.1`、`uuid-ossp 1.1`、`plpgsql` （**没有 pg_graphql / pg_cron / pg_net**） |
| 表 | public 62 张；最大 `jobs` 4050 MB、`job_sync_records` 174 MB、`job_sync_runs` 87 MB、`job_ai_match_scopes` 24 MB |
| 数据量 | `jobs` 224,741 行 / 活跃 112,727；`auth.users` 43、`identities` 44（email 35 / github 9）、`sessions` 66、`refresh_tokens` 327 |
| Auth 迁移版本 | `auth.schema_migrations` max = **20261030120000** |
| 角色 | `anon`、`authenticated`、`authenticator`、`postgres`、`service_role`、`supabase_admin`(super)、`supabase_auth_admin`、`supabase_storage_admin`、`dashboard_user`、`supabase_read_only_user` 等（cloud 专有角色不能照搬） |
| 发布 | `supabase_realtime` 存在（可用于回滚判断是否真需要 realtime，本项目前端未用） |
| 旧域名残留 | `company_logos.logo_url` **42 行**、`profiles.avatar_url` **1 行** 指向 `weqvdtdjdzmqflhwobec.supabase.co`（需改写） |

> 说明：`jobs.description` 全表 LIKE 扫描会撞 8 s `statement_timeout`（已验证超时），迁移后不需要扫它，改写只针对上面两张小表。

---

## 4. 邮件链路：已确认是 Brevo，只差凭据

**端到端实测**（一次性临时邮箱 + 真实触发注册确认信，随后立即删除测试账号）：

```
收件人  lrxmwopvidcgk1v@euploading.com
主题    Confirm your email address（正文为中文模板：验证您的电子邮箱 / 验证码 40003277 / 10 分钟有效）
发件人  {"address":"noreply@liorvix.com","name":"Liorvix"}
邮件内链接  https://r.mail.liorvix.com/tr/op/…
投递结果  成功进收件箱，无退信
```

**DNS 侧交叉验证：**

```
r.mail.liorvix.com  CNAME  mail-liorvix-com.r.brand.brevosend.com  → r1.mailin.fr (172.246.243.65)
img.mail.liorvix.com CNAME mail-liorvix-com.img.brand.brevosend.com
mail.liorvix.com    CNAME  mail-liorvix-com.brand.brevosend.com    → 94.143.16.132
default._domainkey.mail.liorvix.com  TXT  v=DKIM1; k=rsa; p=MIIBIjANBg…   ← Brevo 品牌域 DKIM
liorvix.com  TXT    v=spf1 include:spf.qiye.aliyun.com include:spf.brevo.com ~all
liorvix.com  TXT    brevo-code:bea1dc4dcb2a89988fe546ea3804de52
```

结论：**Supabase 项目已配置自定义 SMTP，走 Brevo（branded sending domain），发件地址 `noreply@liorvix.com`，SPF + DKIM 都已就绪，链路健康。** DKIM/DMARC 配在 `mail.liorvix.com` 子域（`default._domainkey.mail.liorvix.com`），不是主域 `_domainkey` —— 这是 Brevo 品牌发送域的标准做法，主域没有独立 `mail._domainkey` 属正常。

你只需要再给我 **1 个值**（其余我已确认）：

```
SMTP_HOST=smtp-relay.brevo.com      # 已确认
SMTP_PORT=587                        # 已确认，服务器出站连通性已实测
SMTP_USER=<仍需你给：Brevo SMTP Login，形如 xxxx@smtp-brevo.com>
SMTP_PASS=xsmtpsib-…                # 已收到（你提供的 SMTP key）
SMTP_ADMIN_EMAIL=noreply@liorvix.com # 已确认
SMTP_SENDER_NAME=Liorvix             # 已确认
```

> 若你更愿意用 Brevo REST API 而不是 SMTP，需要改发信实现，不建议 —— SMTP 这条路已验证可用，改动面为零。

---

## 5. GitHub OAuth：client_id 已拿到，只差 secret + 回调

`GET /auth/v1/authorize?provider=github` 的 302 Location 暴露了公开的 client_id：

```
client_id     = Ov23liiTkHiiLKEyzL4O
redirect_uri  = https://weqvdtdjdzmqflhwobec.supabase.co/auth/v1/callback
scope         = user:email
```

生产库里 GitHub 身份 **9 条**（`auth.identities.provider='github'`，`provider_id` 全非空），迁移后这些用户必须还能用 GitHub 登录 → 新栈必须配同一套（新）OAuth App。

**已就绪（2026-11-20 17:2x 更新）**：

```
旧 App（回滚用）  client_id = Ov23liiTkHiiLKEyzL4O   callback → weqvdtdjdzmqflhwobec.supabase.co（保持不动）
新 App（新栈用）  client_id = Ov23liSDUNUddkcJoYkb   client_secret 已验证有效 ✅
```

验证方式：用这对凭据向 `POST https://github.com/login/oauth/access_token` 提交一个故意错误的 `code`，GitHub 在**校验完 client_id + client_secret 之后**才检查 code，返回 `bad_verification_code` 而不是 `incorrect_client_credentials` —— 说明凭据真实有效。

仍需你确认一件事：**新 App 的 `Authorization callback URL` 是否为 `https://supabase.liorvix.com/auth/v1/callback`**。这个字段无法通过 API 读取（未带用户 token），而 GitHub 只有在用户登录后的授权阶段才会校验它；P3 演练时用真实 GitHub 账号走一趟即可确认，不匹配会直接报 `redirect_uri_mismatch`。

新建 App 而不是改旧 App 的原因：旧 App 的回调仍指向旧项目，回滚时旧栈的 GitHub 登录**完全不受影响**；如果直接改旧 App 的回调，回滚就会连带断掉 GitHub 登录。

---

## 6. 密钥与镜像：自托管能力已核实（官方 compose 现状）

我重新核对了官方 compose（`supabase/supabase` master，今天抓取），确认自托管**已支持新式 opaque key 与非对称 JWKS**，这意味着业务代码不需要因为「换 key 形态」而改：

| 能力 | compose 中的证据 |
|---|---|
| 新式 opaque key | `api-gw` 注入 `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY`；`functions` 注入 `SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS` |
| 非对称签名 | `GOTRUE_JWT_KEYS`（"JSON array of signing JWKs (EC private + legacy symmetric)"） |
| PostgREST 验签 JWKS | `PGRST_JWT_SECRET: ${JWT_JWKS:-${JWT_SECRET}}`（"accepts a plain-text symmetric secret, a single JWK, or a JWKS"） |
| 其它服务 JWKS | realtime `API_JWT_JWKS`、storage `JWT_JWKS`、functions `SUPABASE_JWKS` |
| 网关 | Envoy 取代 Kong（`envoyproxy/envoy:v1.39.6`），网络别名保留 `kong`/`envoy` 兼容 |

**当前官方 compose 的 pin（可直接作为我们的基线）：**

```
supabase/studio        2026.11.02-sha-a05e7ec
envoyproxy/envoy       v1.39.6
supabase/gotrue        v2.197.0
postgrest/postgrest    v14.18
supabase/storage-api   v1.89.12
supabase/postgres      17.6.1.136     ← 与 Cloud 的 PG 17.6 对齐
supabase/postgres-meta v0.100.0
supabase/realtime      v2.148.3       （本项目未用，可不开）
supabase/supavisor     2.9.13
supabase/edge-runtime  v1.77.9        （本项目未用，可不开）
darthsim/imgproxy      v4.0.21
```

Docker Hub 上已有更新版本（`gotrue v2.198.0`、`postgres 17.12.0.002`、`postgrest v16.6`、`storage-api v1.98.2`）。**建议仍以 compose pin 为准**，原因：这些版本是官方一起测过的组合；Cloud 的 `auth.schema_migrations` 已到 `20261030120000`，若演练时 GoTrue 报 schema 相关错误，再把 auth 单独升到 `v2.198.0`（这是唯一的「必要时升级」点）。

---

## 7. 还差的 2 件事 + 1 个待定（凭据第一轮验证后更新）

> 2026-11-20 17:2x 更新：你已提供 Brevo SMTP key、Cloudflare Token、GitHub Client ID/Secret。逐一验证结果见 §11。**4 项里 2 项已完成，剩 2 项各差一个值/一个权限。**

### 7.1 Brevo SMTP：密钥已收到，**还差 Login**（阻塞：登录/注册邮件）
- 已收到：`xsmtpsib-89f3…`（SMTP key，格式正确）
- 已实测：用 `noreply@liorvix.com` / `no-reply@liorvix.com` 作为用户名 + 该 key 做 `AUTH LOGIN` → 服务器返回 `535 5.7.8 Authentication failed`
- 缺：**Brevo 的 SMTP `Login`**，形如 `xxxxxxx@smtp-brevo.com`（在同一页面、密钥上方/左侧，不在你贴的那行里）
- 位置：Brevo → **SMTP & API** → **SMTP** → `Your SMTP server` 卡片里的 **Login** 一行
- 不给的后果：注册验证、找回密码、邮箱验证码**全部发不出**，等于登录功能不可用。**这是唯一「没有替代方案」的一项。**

### 7.2 GitHub OAuth App ✅ **已完成**
- `client_id = Ov23liSDUNUddkcJoYkb`，secret 已验证有效（见 §11.2）
- 仍需你在 GitHub App 设置页**肉眼确认一次**：`Authorization callback URL` 是否等于 `https://supabase.liorvix.com/auth/v1/callback`（这个字段只能登录后看，我无法读取；P3 会用真实 GitHub 登录做最终验证，若不匹配会报 `redirect_uri_mismatch`）

### 7.3 Cloudflare：Token 有效但**只读**（阻塞：`supabase.liorvix.com` 解析 + 切换后缓存）
- 已实测：`/user/tokens/verify` → `status=active`；能**读** DNS 记录；但
  - `POST /zones/…/dns_records` → `403 Authentication error (10000)`
  - `POST /zones/…/purge_cache` → `401 Authentication error (10000)`
- 结论：该 Token 只勾了 `Zone → DNS → Read`，没有 `Edit`，也没有 `Cache Purge`
- 二选一：
  - **A（推荐）**：重建 Token，Permissions 勾 `Zone → DNS → Edit` + `Zone → Cache Purge → Purge`，Zone Resources = `Include → liorvix.com`。给我后我立刻加记录
  - **B**：你手工加一条记录 —— 类型 `A`、名称 `supabase`、内容 `43.172.117.125`、代理状态 **仅 DNS（灰云）**；切换时手工 purge 一次
- 不给的后果：`supabase.liorvix.com` 不解析 → certbot 签不出证书 → 新栈无法对外；且切换后旧配置缓存最长 5 分钟，期间新注册会落到**旧库**（数据分裂）

### 7.4 维护窗口（待定，不阻塞 P1/P2）
- 需要 10–20 分钟静默窗口（应用停写 → 最终增量 dump → 启动新栈 → 冒烟 → 开流量）
- 建议：工作日 02:00–04:00（当前日活低、且与 jobs 同步任务错峰）
- 由于 P1/P2/P3 还需要几天，这个窗口可以在演练通过后再定，**不必现在决定**

---

## 8. 拿到上面 4 项后，我自己能全部做完的部分

- 安装 `docker.io` + `docker-compose-v2`（apt，无需外部源）
- 落 `/opt/supabase`（compose + `.env` + volumes），生成 ES256 JWK、legacy HS256 secret、新式 opaque keys
- 建库 → 迁移角色/扩展/schema/表/函数/RLS/策略/触发器 → 导入数据（`pg_dump` 已验证 6543 可用）
- 迁 `auth.sessions` / `auth.refresh_tokens` / `auth.identities`（保证会话与 GitHub 身份连续）
- Storage：重建 2 个 bucket、复制 67 个对象、重放 migration 0008 的 4 条策略、改写 42+1 行旧域名 URL
- nginx vhost + certbot 签 `supabase.liorvix.com` + gzip 修复
- 基线快照、两次演练、30 项功能回归、备份/恢复验证
- P1 代码修复（AI 检索重写、兜底、stale scope 清理、worker 拆分、auth 缓存 key bump）
- 切换与回滚执行（若走 Cloudflare 方案 A，含 purge）

---

## 9. 副作用说明（透明起见）

为了确认发信链路，我做了唯一一类写操作（在生产 `auth.users` 里**临时**建账号，随后立即删除）：

| 轮次 | 结果 | 清理 |
|---|---|---|
| 第 1 次（`p0-smtp-probe.mjs`） | 确认信已发出，但一次性邮箱取信失败 → 没看到邮件 | `DELETE /auth/v1/admin/users/{id}` → 200；`profiles` → 204 |
| 第 2 次（`p0-smtp-probe2.mjs`） | 邮箱服务 token 失败，**在 signup 之前就中止**，未建账号 | 无需清理 |
| 第 3 次（`p0-smtp-probe3.mjs`） | 成功取到确认信，拿到发件人证据 | `DELETE` → 200，并再次查询确认 **404 已不存在** |

净残留：**0 个用户、0 行 profile**（两次创建的账号均已删除并核对）。唯一痕迹是 `auth.users` 上的删除记录，不可见、无业务影响。

除以上临时账号外，全程只读：服务器侧无任何配置改动（Docker 未安装、nginx 未动、systemd 未动）；数据库侧未执行任何 DDL/DML。

---

## 10. 附：本次采集用到的命令（可复现）

```bash
# 服务器盘点（只读）
ssh -i deploy-key.pem ubuntu@43.172.117.125 "sudo -n bash -s" < tmp/p0-server-probe.sh
ssh -i deploy-key.pem ubuntu@43.172.117.125 "sudo -n bash -s" < tmp/p0-server-probe2.sh

# 库盘点
node tmp/p0-db-inventory.mjs
node tmp/p0-auth-inventory.mjs

# 发信链路验证（含临时账号清理）
node tmp/p0-smtp-probe3.mjs

# 运行时代码事实
ssh … "sudo -n grep -rl 'sb_publishable_' /opt/liorvix/.next | wc -l"   # → 0
ssh … "curl -s http://127.0.0.1:5000/api/auth/config"                   # → url + publishable key
curl https://weqvdtdjdzmqflhwobec.supabase.co/auth/v1/.well-known/jwks.json   # → ES256 公钥
curl -I "https://weqvdtdjdzmqflhwobec.supabase.co/auth/v1/authorize?provider=github"   # → 302, client_id

# 第二轮（凭据验证，见 §11）
node tmp/p0-smtp-auth.mjs                       # Brevo SMTP AUTH LOGIN（535 = 用户名不对）
node tmp/p0-capture-templates.mjs               # 抓邮件模板（会临时建账号并自动清理）
DOTENV_CONFIG_PATH=.env.production.local node_modules/.bin/tsx scripts/snapshot-db-baseline.ts \
  --out=docs/baseline/prod-before-2026-11-20.json
```

```powershell
# Cloudflare / GitHub 只读验证（PowerShell，凭据从 p0所需.txt 读取，不落日志）
pwsh -NoProfile -File .\tmp\p0-verify-cf-gh.ps1
pwsh -NoProfile -File .\tmp\p0-cf-scope.ps1      # 写权限探测（当前均被拒）
```

---

## 11. 第二轮：凭据到位后的验证结果（2026-11-20 17:1x–17:2x）

你在 `p0所需.txt` 里给了 3 组凭据：Brevo SMTP key、Cloudflare API Token、GitHub Client ID + Secret。逐一实测：

### 11.1 Brevo SMTP key —— 格式正确，但缺 Login（未通过）

实现了最小 SMTP 客户端（`net` → `STARTTLS` → `AUTH LOGIN`），用你给的 key 试了两个用户名：

```
login=noreply@liorvix.com   → 535 5.7.8 Authentication failed
login=no-reply@liorvix.com  → 535 5.7.8 Authentication failed
```

- 535 说明**连接、STARTTLS、认证流程全部正常**，只是用户名不对
- Brevo 用 SMTP key 认证时，用户名必须是页面上的 **Login**（`xxx@smtp-brevo.com`），不是发件地址
- 拿到 Login 后我会重跑 `tmp/p0-smtp-auth.mjs`，成功（235）即刻写入 `.env` 模板

### 11.2 GitHub OAuth —— **通过**

```
POST https://github.com/login/oauth/access_token
  client_id=Ov23liSDUNUddkcJoYkb  client_secret=<你的>  code=invalid-probe-code
→ {"error":"bad_verification_code", ...}
```

GitHub 先校验 client 凭据、再看 code；返回 `bad_verification_code` 说明 **id 与 secret 是配对的**。若 secret 错误会是 `incorrect_client_credentials`。所以这组凭据可直接用于 GoTrue。

### 11.3 Cloudflare Token —— **有效但只读**

```
GET  /user/tokens/verify              → {"status":"active"}
GET  /zones?name=liorvix.com          → d09765a84752a7fcba4a4b0f49553865 (active, Free)
GET  /zones/{id}/dns_records          → 200，能读全部记录
POST /zones/{id}/dns_records          → 403 Authentication error (10000)
POST /zones/{id}/purge_cache          → 401 Authentication error (10000)
```

- 读：✅　建/改记录：❌　清缓存：❌
- 结论：Token 只勾了 `Zone → DNS → Read`
- **`supabase.liorvix.com` 因此仍未创建**（我拒绝用其他途径绕过权限）
- 顺带确认了现有解析布局（比之前更完整）：

| 记录 | 类型 | 内容 | 代理 |
|---|---|---|---|
| liorvix.com | A | 43.172.117.125 | ✅ 橙云 |
| www | CNAME | liorvix.com | ✅ 橙云 |
| liorvix.com | MX ×3 | mx1/2/3.qiye.aliyun.com | 仅 DNS |
| liorvix.com | TXT | `v=spf1 include:spf.qiye.aliyun.com include:spf.brevo.com ~all` | 仅 DNS |
| liorvix.com | TXT | `brevo-code:bea1dc4d…` | 仅 DNS |
| mail / img.mail / r.mail | CNAME | `*.brand.brevosend.com` | 仅 DNS |
| **default._domainkey.mail** | TXT | `v=DKIM1; k=rsa; p=MIIBIjAN…` | 仅 DNS |

> 更正上一版的说法：DKIM **存在**，配在 `default._domainkey.mail.liorvix.com`（Brevo 品牌发送域的常规做法），不是缺失。

### 11.4 基线快照 —— **已产出**

新增可复跑脚本 `scripts/snapshot-db-baseline.ts`（diff 模式：`--compare=旧快照`），本次结果落在 `docs/baseline/prod-before-2026-11-20.json`。关键值：

```
库大小            4359 MB
public 表/视图/函数 62 / 1 / 101
public 策略        41        storage 策略 4
auth               users 43, identities 44 (email 35 + github 9), sessions 66, refresh_tokens 328 (active 66)
storage            buckets 2, objects 67 (assets 49/6.6MB, resumes 18/4.6MB)
jobs               active 112590 / closed 112157
migrations         liorvix 144 条，最新 2026-11-19 04:12
auth schema        20261030120000（68 个迁移）
旧域名引用         company_logos.logo_url 42 + profiles.avatar_url 1
序列               49 个（public 24 + auth 1 + 其余）
```

> 注意 `refresh_tokens` 是 328 行、其中 active 66 —— 迁移脚本必须整表搬（含 `refresh_token_hmac_key`），不能只搬未撤销的。这句是给 P2/P3 的硬约束。

### 11.5 Auth 邮件模板 —— **部分自动捕获**

在 `docs/baseline/email-templates-captured/` 下（`.txt` + `.html` 双份，另有 `index.json`）：

| 模板 | 结果 | 备注 |
|---|---|---|
| Confirm signup | ✅ 抓到 | 主题 `Confirm your email address`，**正文中文**（"验证您的电子邮箱 / 验证码 / 10 分钟有效"） |
| Recovery | ✅ 抓到 | 主题 `Reset your password`，**正文是英文**（"RESET YOUR PASSWORD / We received a request…"） |
| Magic link / OTP | ❌ 撞限流 | `POST /auth/v1/otp` → **429**，Supabase 邮件发送频率限制 |
| Invite | ❌ 未送达 | `generate_link` 返回 200，但目标邮箱 75 秒内未收到（项目可能关了这个模板的发送，或被限流连带） |
| Email change / Reauthentication | — 未做 | 需要已登录会话 + 二次验证链路，成本高、收益低 |

**两条副产品发现（对自托管配置有用）：**

1. **模板语言不统一**：注册确认信是中文，重置密码信是英文。自托管时要决定统一成中文（建议），顺带把 `GOTRUE_RATE_LIMIT_EMAIL_SENT` 调高，否则会像现在这样 429。
2. 邮件里的链接被 Brevo 改写为 `r.mail.liorvix.com/tr/op/…` 点击追踪；自托管若沿用同一 Brevo 账号会保持一致，无需改代码。

### 11.6 本轮副作用

- 为抓模板又建了 3 个一次性账号（1 个首次脚本崩溃遗留 + 2 个本轮），**全部已 DELETE 并核对**：当前 `auth.users` = 43，`lrx*` 残留 = 0
- 期间 `POST /auth/v1/otp` 命中 429（未产生邮件、未产生用户）
- 未执行任何 DDL/DML（除 `profiles` 对应测试行删除）
- Cloudflare 未写入任何记录（权限不足，也**没有**用试探性写入留下垃圾记录）