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

### 6.1 生产方式（与假设不同，请注意）

`/opt/liorvix` **不是 git 仓库**（没有 `.git`），生产源码是一棵上传的源码树。
所以本项目的部署方式不是 `git pull`，而是：

1. 上传改动文件；
2. 在服务器上 `pnpm run build`；
3. `sudo systemctl restart liorvix.service`。

仓库侧只需要保留源码版本（本次为提交 `0f7d47b`），生产并不消费 git。

部署前做过一致性核对：生产上这批文件与仓库 `5949e29` 逐行一致（忽略 CRLF），
确认没有未纳入版本库的生产改动后，才覆盖上传。

改动清单：

- 新增：`src/lib/admin-analytics.ts`、`src/lib/admin-request-context.ts`、`src/components/admin/admin-login-form.tsx`
- 修改：`src/app/admin/{layout,page,login/page}.tsx`、`src/app/api/admin/{auth,analytics}/route.ts`、
  `src/app/api/auth/config/route.ts`、`src/components/admin-shell.tsx`、
  `src/components/admin/{jobs-panel,overview-panel}.tsx`、`src/components/human-verification.tsx`、
  `src/lib/admin-auth.ts`、`src/server.ts`
- 删除：`src/components/admin-auth-guard.tsx`

### 6.2 构建与重启（在实际服务器上执行）

```bash
cd /opt/liorvix
sudo /usr/bin/pnpm run build          # node 20.20.2 / pnpm 9.0.0；必须构建，只重启不生效
sudo systemctl restart liorvix.service
sudo systemctl is-active liorvix.service
```

### 6.3 验收（部署前后有明确对照）

```bash
curl -sS -o /dev/null -w 'health %{http_code}\n' https://liorvix.com/api/health
curl -sS https://liorvix.com/api/auth/config -D - -o /dev/null | grep -i cache-control
curl -sS https://liorvix.com/admin/login | grep -c '运营后台登录'
curl -sS -o /dev/null -w 'admin %{http_code} -> %{redirect_url}\n' https://liorvix.com/admin
```

| 检查项 | 部署前（实测） | 部署后应为 |
| --- | --- | --- |
| `/admin/login` HTML 含「运营后台登录」 | `0`（客户端渲染的空壳，11.6 KB） | `1` |
| `/api/auth/config` 的 `Cache-Control` | `private, max-age=60` | `public, max-age=300, s-maxage=300, …` |
| 未登录 `/admin` | 307 → `/admin/login` | 不变 |

浏览器侧：打开 `/admin/login`，Network 里登录全过程只应出现 **1 条** `/api/admin/auth`（在登录成功之后），
页面加载阶段不再有它；进入 `/admin` 后不再有 `/api/admin/analytics` 请求，数字直接在 HTML 里。

### 6.4 部署结果（2026-11-20 已上线）

| 检查项 | 部署前 | 部署后（实测） |
| --- | --- | --- |
| `/admin/login` HTML 含「运营后台登录」 | 0（11.6 KB 空壳） | **1**（15.9 KB，含表单） |
| `/api/auth/config` 的 `Cache-Control` | `private, max-age=60` | `public, max-age=300, s-maxage=300, …` |
| 未登录 `/admin` | 307 | 307（不变） |
| 未登录 `/api/admin/analytics`、`/api/admin/students` | — | **401**（鉴权未放宽） |
| 服务状态 | active | active，重启后无未捕获异常 |

注意：Cloudflare 默认不缓存 `/api/*`（实测 `cf-cache-status: DYNAMIC`），
所以该 `s-maxage` 只对浏览器生效，边缘并没有缓存这个响应。

### 6.5 生产实测：统计聚合确实慢

在生产机上直接测量（只读）：

| 测量 | 结果 |
| --- | --- |
| `get_admin_analytics('7d')`（应用链路） | 6.4–6.6 s |
| 同一函数（pg 直连） | 2.49 s（第二轮 4.95 s） |
| `select count(*) from jobs where is_active` | 1.7–2.3 s |
| `jobs` 表体积 | 总计 **4,048 MB**，堆仅 390 MB（约 3.6 GB 为 TOAST） |
| 执行计划 | `Buffers: shared hit=32081 read=18118, temp read=2133 written=711` |

结论：慢在「扫 390 MB 堆 + 磁盘吞吐低 + 采集写入争用」，与网络无关（pg 与 REST 同为 2.5 s）。
6.4 s 与 2.5 s 的差异来自采集 worker 同时在写库。

已加的缓解：首次取数成功后，缓存模块会在过期前 20 秒自动后台刷新
（`ADMIN_ANALYTICS_REFRESH=false` 可关闭），所以管理员除进程重启后的第一次外基本不再等待。

### 6.6 建议的下一步（需批准后才动生产库）

1. `VACUUM (ANALYZE) public.jobs;` —— 若可见性映射陈旧，索引扫描会被迫回表；
2. 覆盖索引 `on jobs (region, direction, created_at) where is_active`，让 `active_jobs` 走 index-only scan；
3. 若仍慢：由采集 worker 维护一张统计小表，后台直接读汇总，彻底不碰 `jobs`。

### 6.7 回滚

回滚材料：`/opt/liorvix/backups/admin-perf-20261120T063018Z/`
（被覆盖的 16 个源文件 + 部署前的 `dist/` 与 `.next/`，共 98 MB）

```bash
cd /opt/liorvix
BK=backups/admin-perf-20261120T063018Z
sudo cp -a $BK/src/. src/
sudo rm -rf dist .next
sudo cp -a $BK/dist dist
sudo cp -a $BK/.next .next
sudo systemctl restart liorvix.service
```

### 6.8 可选：把采集 worker 拆成独立服务

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
2. **统计聚合的 SQL 层**（已测出结论，见 §6.5）：生产库 `jobs` 堆 390 MB、总 4 GB（TOAST 占 3.6 GB），
   函数在库内 2.5 s、经应用链路 6.4 s。治本方案见 §6.6，需要批准后才动生产库。
   已先落地的是“后台自动刷新”，让管理员基本不等待。
3. **静态资源**：经 brotli 压缩后约 350–400 KB，优先级低；若仍想优化，可从后台路由剥离前台共享的重型依赖。
4. **`/admin/credits`**：仍会把学员目录的所有分页全拉下来（每页 100 条）。学员数增长后改成服务端关键词搜索。
5. **登录页多了一次库查询**：服务端要判断「是否允许启动密码」，实测使 HTML 首字节增加约 0.2 s；
   换来的是省掉客户端两跳（鉴权 + 配置）。若要再省，可给该判断加 60 秒进程内缓存（它只影响按钮是否显示）。

## 8. 已知取舍

- 删掉前端鉴权守卫后，若 8 小时会话在页面打开期间过期，下一次数据请求会返回 401 并显示错误，
  而不会像以前那样自动跳回登录页。数据接口的鉴权未放宽：每个 `/api/admin/*` 仍独立校验会话。
- 工作台统计允许 3 分钟陈旧：过期后先显示上一版数字再后台刷新。要更强的新鲜度可调小
  `ADMIN_ANALYTICS_CACHE_TTL_SECONDS`（代价是更频繁地等待聚合）。
- 服务端需查一次会话才能直出数据（约 0.15–0.35s/次整页加载），这是直出数据的安全前提，
  不能只验签名跳过吊销检查。
- 尝试过的方案（未采用）：在外壳进程里定时预热统计缓存无效——`dist/server.js` 与 Next 的编译产物
  是两套模块实例，缓存不共享。