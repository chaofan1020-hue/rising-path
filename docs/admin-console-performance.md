# 运营后台登录与首屏卡顿：排查与修复

对象：`liorvix.com` 运营后台（`/admin/**`、`/api/admin/**`）。
起因：管理员反馈每次登录后台都非常卡。

## 1. 结论

后台慢的主因不是数据库，而是**每条请求都要跨一次洋**，再被**三处串行等待**放大：

- 请求落到 Cloudflare **阿姆斯特丹**节点（`cf-ray: …-AMS`），源站在**美国加州圣克拉拉**；
- 一次「登录 → 看到工作台」原本要串行发 6 跳：登录页 HTML → 鉴权 → 人机验证配置 → 登录后 HTML → 守卫鉴权 → 外壳鉴权 → 统计；
- 鉴权接口内部把同一次会话查询重复做了 3 遍，另加 2 遍「超级管理员计数」。

## 2. 实测证据（2026-11-20，3 次重复，数值稳定）

| 测量项 | 结果 |
| --- | --- |
| Cloudflare 节点 | AMS（阿姆斯特丹） |
| 源站 | `43.172.117.125`，加州圣克拉拉（腾讯云） |
| 新建连接 | 建连 0.25s + TLS 0.25s ≈ 0.5s |
| 长连接下每条请求 | 0.45s（`/api/health`）～0.62s（`/api/jobs`） |
| 查一次库的增量 | ≈ 0.15s |
| `/admin/login` 首字节 | 0.83–1.48s |
| 模拟 4 跳串行 | 4.21s |

结论：**请求本身不重，重的是每跳约 0.45s 的固定过路费**；串行跳数越多，乘得越狠。

### 2.1 一处需要更正的测量

第一版记录里「登录页静态资源 1295 KB」是 **curl 未带压缩头**的结果。
Cloudflare 实际开了 brotli：227 KB 的 chunk 传输只有 **71 KB**，整页首屏约 350–400 KB。
**静态体积不是本次的主因**，不要按 1.3 MB 去优化。

## 3. 原因与修复

### 3.1 首屏整屏转圈守卫（已删）

`src/components/admin-auth-guard.tsx` 在 layout 里先请求 `/api/admin/auth`，不返回就渲染整屏 spinner。
中间件（`src/middleware.ts`）已经校验签名 cookie，未登录直接 307。守卫属于重复校验，却把首屏渲染卡住了。

→ 删除该组件；鉴权与权限改为在 layout（服务端组件）里一次算好。

### 3.2 外壳再请求一次同样的鉴权（已删）

`src/components/admin-shell.tsx` 挂载后又发一次 `/api/admin/auth` 取 role/permissions，
并在返回前把页面内容挡在 `loading` 后面。

→ `AdminShell` 改为接收 `role` / `permissions` 两个 props；`useAdminPermissions()` 的 `loading` 恒为 `false`。
注意：**登录成功后必须整页跳转**（`window.location.assign('/admin')`），否则客户端跳转不会重跑布局，侧边栏会拿到登录时的空权限。

### 3.3 鉴权接口重复查询（已合并）

原 `GET /api/admin/auth`：

```
hasValidAdminSession → resolveAdminSession   (第 1 次 admin_sessions 查询)
resolveAdminSession  → resolveAdminSession   (第 2 次)
getAdminSessionRole  → resolveAdminSession   (第 3 次)
getEffectiveAdminPermissions → countActiveSuperAdmins (第 4 次)
isSharedAdminPasswordAllowed → countActiveSuperAdmins (第 5 次)
```

→ `src/lib/admin-auth.ts` 拆出 `resolveAdminSessionFromPayload()` 与 `resolveAdminSessionToken()`；
路由只解析一次，权限与启动密码开关并行走。super_admin 走短路径时实际为 **1 次查询**。

### 3.4 登录页多一跳（已改服务端）

登录页原来挂载后请求 `/api/admin/auth` 才知道「是否允许启动密码」，期间整屏 spinner。

→ `src/app/admin/login/page.tsx` 改为服务端组件：已登录直接 `redirect('/admin')`，
把 `passwordLoginAllowed` 与 `captchaEnabledHint` 作为 props 传给新的
`src/components/admin/admin-login-form.tsx`。

### 3.5 人机验证配置白等一趟（已改服务端注入）

`HumanVerification` 先请求 `/api/auth/config` 才渲染验证框。

→ 新增可选 `enabledHint`：由服务端传入时跳过该请求（`src/components/human-verification.tsx`）。
同时 `/api/auth/config` 改为可被边缘缓存（内容为部署常量，非用户数据）：

```
Cache-Control: public, max-age=300, s-maxage=300, stale-while-revalidate=600
```

### 3.6 页面级重复请求（已去重）

`src/components/admin/jobs-panel.tsx` 同时请求 `/api/configs` 与 `/api/admin/configs?page=1&pageSize=100`，
两者返回同一份分组配置、写进同一个 state（后者还会在配置超过 100 条时静默截断）。

→ 只保留 `/api/configs`（完整、不限量），企业列表单独请求。

### 3.7 工作台统计（两轮改造）

`get_admin_analytics` 会物化在架岗位并做多次表计数，是最贵的一条查询。

第一轮：给 `GET /api/admin/analytics` 加 60 秒进程内缓存。

第二轮（本轮）：

- **服务端直出**：`src/app/admin/page.tsx` 改为服务端组件，`src/lib/admin-analytics.ts` 抽出查询；
  首屏 HTML 里已经带数据，不再有 hydration 后的 `/api/admin/analytics` 请求。
- **流式**：统计放在 `<Suspense>` 里，冷缓存时先出骨架（首字节 0.12s），数据在同一个响应里补进来。
- **stale-while-revalidate**：缓存 3 分钟（`ADMIN_ANALYTICS_CACHE_TTL_SECONDS` 可调），过期后先返回旧快照、
  后台再刷新，因此除进程启动后第一次外，工作台都不再等待聚合。
- 会话与权限用 `src/lib/admin-request-context.ts`（React `cache()`）在布局和页面之间复用，一次请求只查一次库。

### 3.8 采集 worker 与 Web 同进程（已拆出可运行模式）

生产 `JOBS_AUTO_WORKER=true`，采集/复核每 1–2 分钟一轮，和页面渲染抢同一个事件循环。

→ `src/server.ts` 新增 `WORKER_ONLY=true` 模式：只启动 worker、不创建 Next 与 HTTP 监听，
并用一个常驻定时器保证进程不退出。Web 进程设 `JOBS_AUTO_WORKER=false` 后即完成拆分。

## 4. 改后实测（本地生产模式，测试库）

| 场景 | 结果 |
| --- | --- |
| `/admin` 缓存过期（冷算） | 首字节 0.13s，整页 2.7s（骨架先出，数据流式补上） |
| `/admin` 缓存命中 | 10ms |
| `/admin` 缓存过期（旧值先回） | 11ms |
| `/api/admin/analytics` 冷 → 热 | 3.5s → 4ms |
| `/admin/students` / `/admin/jobs` / `/admin/credits` | 24ms / 13ms / 36ms |

> 注：测试库（`bonvalewfehgarshxkyl`）在本轮中途**域名已无法解析**，聚合查询 3–6 秒的数字不可信。
> 生产环境的聚合耗时必须单独实测（见 §7）。

## 5. 验证（本次已执行）

- `pnpm run ts-check`：改动文件 0 错误（仓库既有错误在 `scripts/test-phase3.ts`、`src/lib/linkedin-official.ts`，与本次无关）。
- `pnpm run test:admin-session-token` / `test:admin-permissions` / `test:admin-origin`：全部通过。
- `pnpm run build`：通过。
- `pnpm exec eslint <改动文件> --quiet`：0 报错。
- 冒烟（生产模式，`JOBS_AUTO_WORKER=false`，端口 5055）：
  - `/admin/login` → 200，服务端已渲染登录表单；
  - 未登录访问 `/admin`、`/admin/students` → 307 到 `/admin/login`；
  - 已登录 `/admin` → 200，HTML 含统计数字，无 hydration 后的统计请求；
  - 工作台冷/热/过期三种路径均按预期（见 §4）；
  - `WORKER_ONLY=true` → 打印模式行、不监听端口、进程常驻。

## 6. 上线步骤

```bash
cd /path/to/liorvix
git pull
pnpm install               # 本次未新增依赖，可跳过
pnpm run build             # next build + dist/server.js
systemctl restart liorvix.service
```

验收：打开 `/admin/login`，Network 里登录全过程只应出现 **1 条** `/api/admin/auth`（在登录成功之后）；
进入 `/admin` 后不再有 `/api/admin/analytics` 请求，数字直接在 HTML 里。

### 6.1 可选：把采集 worker 拆成独立服务

```ini
# /etc/systemd/system/liorvix.service（Web）
Environment=JOBS_AUTO_WORKER=false

# /etc/systemd/system/liorvix-worker.service（新增）
Environment=WORKER_ONLY=true
Environment=JOBS_AUTO_WORKER=true
ExecStart=/usr/bin/node /path/to/liorvix/dist/server.js
```

两个服务共用同一份 `.env`；worker 服务**不要**设 `JOBS_AUTO_WORKER=false`，否则它会连自己都关掉。

## 7. 未做 / 后续

1. **网络层（收益最大）**：请求现在从阿姆斯特丹绕到加州。后台换美国西部出口或启用 Cloudflare Argo
   （约 $5/月）可把每跳 0.45s 降到约 0.2s，比任何代码改动都值钱。
2. **实测生产聚合耗时**，再决定是否加索引或做汇总表：
   ```sql
   explain (analyze, buffers)
   select public.get_admin_analytics(now() - interval '7 days', now());
   ```
   若瓶颈在范围计数，候选索引是 `resumes(created_at)`、`applications(created_at)`
   （现有的 `(user_id, created_at)` 复合索引无法支持单独的 `created_at` 范围过滤）。
   若 `jobs` 扫描是瓶颈，考虑在 worker 里维护一张汇总表。**在没有实测前不要盲加索引。**
3. **静态资源**：经 brotli 压缩后约 350–400 KB，优先级低；若仍想优化，可从后台路由剥离前台共享的重型依赖。
4. **`/admin/credits`**：仍会把学员目录的所有分页全拉下来（每页 100 条）。学员数增长后改成服务端关键词搜索。

## 8. 已知取舍

- 删掉前端鉴权守卫后，若 8 小时会话在页面打开期间过期，下一次数据请求会返回 401 并显示错误，
  而不会像以前那样自动跳回登录页。数据接口的鉴权未放宽：每个 `/api/admin/*` 仍独立校验会话。
- 工作台统计允许 3 分钟陈旧：过期后先显示上一版数字再后台刷新。要更强的新鲜度可调小
  `ADMIN_ANALYTICS_CACHE_TTL_SECONDS`（代价是更频繁地等待聚合）。
- 服务端需查一次会话才能直出数据（约 0.15–0.35s/次整页加载），这是直出数据的安全前提，
  不能只验签名跳过吊销检查。
- 尝试过的方案（未采用）：在外壳进程里定时预热统计缓存无效——`dist/server.js` 与 Next 的编译产物
  是两套模块实例，缓存不共享。