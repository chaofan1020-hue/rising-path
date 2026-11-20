# Liorvix 生产部署手册

> 目标：以后部署只花一条命令的时间，失败自动回滚，不用再靠回忆和手工步骤。

## 0. 结论先说

**推荐：把生产变成 git 工作区，用一条命令部署，脚本自动验收、失败自动回滚。**

```bash
pnpm run deploy:prod                      # 部署当前分支最新提交
pnpm run deploy:prod -- <commit|tag>      # 部署指定版本
pnpm run deploy:prod -- --rollback <sha>  # 秒级回滚
pnpm run deploy:prod -- --list            # 看可回滚的快照
```

> **本机没装 pnpm 也能部署。** 当前这台开发机的 `pnpm` 不在 PATH 上
> （`Get-Command pnpm` 返回空），实际验证时用的是等价写法：
>
> ```bash
> node scripts/deploy-production.mjs                  # = pnpm run deploy:prod
> node scripts/deploy-production.mjs -- --rollback <sha>
> node scripts/deploy-production.mjs -- --list
> ```
>
> 两种写法调用的是同一个脚本，参数完全相同。部署本身不依赖 pnpm 在这台机器上。

你只需要记住第一条。下面解释为什么这样选，以及怎么一次性改造成这样。

> **2026-11-20 状态：一次性改造已完成。** `/opt/liorvix` 已是 git 工作区，
> `liorvix-deploy` / `liorvix-rollback` 已安装，本机一条命令、自动验收、秒级回滚均已实测通过
> （记录见 §3.4）。第 3 节保留下来，用于**换服务器、灾难恢复、或再次遇到非 git 目录**时照做。

---

## 1. 用哪种方式更好

### 1.1 现状的代价

今天之前的部署方式是：本地 scp 覆盖文件 → 服务器 `pnpm run build` → 重启。
它能用，但每次都要：

- 手工确认覆盖了哪几个文件、有没有漏；
- 手工核对生产是不是被别人改过；
- 手工备份、手工回滚；
- 出问题时靠人回忆“上次好的版本是哪个”。

一次部署 10+ 个动作，这就是“耽误时间”的来源。

### 1.2 候选方案对比

| 方案 | 每次操作量 | 构建位置 | 可追溯 | 回滚 | 适配本项目 |
| --- | --- | --- | --- | --- | --- |
| A. 手工 scp + 构建（现状） | 10+ 步 | 服务器 | 弱 | 靠手工备份 | 能用，最费人 |
| B. git pull + 手工 build/restart | 3 步 | 服务器 | 强（commit） | 手工 | 已能省一半时间 |
| **C. git + 一键脚本 + 自动验收 + 自动回滚（推荐）** | **1 步** | 服务器 | **强** | **自动/秒级** | **最划算** |
| D. GitHub Actions 自动部署 | 0 步（push 即发） | 服务器/CI | 强 | 自动 | 需要配 SSH secret，后续可加 |
| E. 本地构建后只传产物 | 2 步 | 本机/CI | 中 | 快 | 产物与运行时版本容易漂移 |
| F. Docker 化 | 一次性改造大 | 任意 | 强 | 强 | 单机 + 常驻进程，收益小于成本 |
| G. Vercel 等托管平台 | 0 步 | 平台 | 强 | 强 | **不可行**，见下 |

### 1.3 为什么是 C

四条硬约束决定了它：

1. **本项目跑的是自建常驻 Node 服务**（`src/server.ts`：自定义 HTTP 服务 + WebSocket +
   进程内 worker 定时任务）。托管平台（Vercel）只支持 Serverless/边缘函数，
   这类长连接和常驻定时器放不上去，方案 G 直接排除。
2. **仓库是公开的**（已验证），服务器能直连 GitHub（已验证 `git ls-remote` 成功，git 2.43）。
   所以不需要部署密钥、不需要镜像仓库——方案 B/C 的改造成本几乎为零。
3. **单台服务器**（`43.172.117.125`），没有多机发布、灰度、蓝绿的需求，
   CI/CD 的额外复杂度现在买不到对应收益。方案 D 以后想要再加，脚本不用改。
4. **回滚必须快**：生产出问题要能 30 秒内回到上一版。所以脚本会把每版构建产物
   存到 `releases/<sha>/`，回滚直接换目录，不重新构建。

一句话：**C 用最小的改造拿到“可追溯 + 可回滚 + 一条命令”，D 是它将来的升级项。**

### 1.4 为什么不选 E（只传构建产物）

`.next` 与 `node_modules` 里的 Next/React 版本必须严格配套。把构建产物从本机传上去，
一旦本机依赖版本和服务器不一致，就会出现“本地好的、线上白屏”的隐性问题。
服务器上构建虽然多花一两分钟，但换来“产物与运行时必然匹配”。

---

## 2. 改造后的形态

```
/opt/liorvix/                     # git 工作区（分支见 DEPLOY_BRANCH）
├── .git/                         # 以后所有版本都在这里
├── .env.local                    # 不进 git，升级不受影响（已验证被 ignore）
├── node_modules/                 # 不进 git
├── dist/  .next/                 # 构建产物，不进 git
├── backups/                      # 历史手工备份，不进 git
└── releases/
    ├── <sha-1>/                  # 最近 3 份构建快照（秒级回滚用）
    ├── <sha-2>/
    └── <sha-3>/

/opt/liorvix-deploy-backups/      # 一次性改造前的整树备份 + 指纹清单
/usr/local/bin/liorvix-deploy     # 来自 scripts/production/deploy.sh
/usr/local/bin/liorvix-rollback   # 来自 scripts/production/rollback.sh
/var/log/liorvix-deploy/*.log     # 每次部署的完整日志
```

一条命令背后的 7 步：

1. 前置检查（是 git 仓库、磁盘 ≥5G、工作区干净）
2. 备份当前构建产物到 `releases/<当前sha>/`
3. `git fetch` + `git reset --hard` 到目标版本
4. `pnpm-lock.yaml` 变了才 `pnpm install --frozen-lockfile`
5. `pnpm run build`
6. `systemctl restart liorvix.service`
7. 冒烟验收（健康检查、登录页服务端渲染、未登录 307、未登录接口 401、启动日志无未捕获异常）

任何一步失败 → 自动回到上一版并重启，脚本以非 0 退出。

---

## 3. 一次性改造（把现有源码树变成 git 工作区）

> 这一步只做一次。做完之后才可以用 `pnpm run deploy:prod`。

### 3.1 改造前必须核对的两件事（2026-11-20 已实测，结论见下）

核对方法本身是**只读**的：在 `/tmp` 建一个临时 git 目录，`git read-tree` 出目标提交
的索引，再用 `git --work-tree=/opt/liorvix diff` 比对，全程不写生产工作区。

结果（基线 `2612264`，925 个跟踪文件）：

| 类别 | 数量 | `checkout -f` 之后 |
| --- | --- | --- |
| 完全一致 | 552 | 不变 |
| 只差换行符（CRLF↔LF） | 353 | 统一为仓库版本，无行为影响 |
| 真实内容差异 | 4 | 全部是 HEAD 更新，见下表 |
| HEAD 有、服务器缺 | 16 | 补上（文档 12、部署脚本 3、迁移 1） |

4 个内容差异逐一核对后的处置：

| 文件 | 差异 | 处置 |
| --- | --- | --- |
| `.gitignore` | HEAD 多 `*.pem`/`*.ppk` 等规则 | 保留 HEAD |
| `package.json` | HEAD 多 `deploy:prod` 脚本；依赖项用 node 结构化比对为**零差异** | 保留 HEAD |
| `docs/job-company-field-execution-log.md` | HEAD 比服务器多 709 行；服务器独有的 50 行经逐行集合比对**全部已在 HEAD 中** | 保留 HEAD |
| `docs/north-america-tech-company-capture-plan.md` | 服务器只是同一行的旧状态（`- [ ]` vs `- [x]`） | 保留 HEAD |

另一类必须先处理的：**只存在于服务器、或服务器版本比 git 新的源码**。
`reset --hard` 会把它们回退，所以必须先提交再迁移。实际提交了 8 个文件：

- 7 个公司 logo / 公司筛选相关（此前手工上传到服务器，从未进 git）；
- `src/lib/admin-analytics.ts` 的自刷新逻辑——它随 11-20 的性能发布上线，**当时漏提交**，
  属于最容易漏的一类，迁移前务必用同一套只读比对复核。

`.env.local`、`node_modules/`、`dist/`、`.next/` 均未被跟踪（`git check-ignore` 验证），
且迁移前后 `.env.local` 的 sha256 实测未变（`290760c7…`）。

### 3.2 步骤

**第 1 步（本地）：把线上已运行、但 git 里没有/落后的文件提交**

先把「线上内容」拿下来和本地逐个比对，再决定提交哪一版。别直接 `git add .`：
本地可能比线上更新（那是还没发布的改动）。

```bash
# 已在 2026-11-20 做过的提交（作为参照，不要重复执行）
#   3c9a576  fix(admin): record company-logo changes already running in production
#   09becf1  perf(admin): commit the analytics self-refresh that production already runs
#   2612264  docs: record the 09-07/09-08 collector batches that only existed on the server
#   c9f2e24  chore(git): ignore deploy artifacts and server-side backup dirs
git push
```

**第 2 步（服务器）：整树备份 + 指纹清单**

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT=/opt/liorvix-deploy-backups
sudo mkdir -p "$OUT" && sudo chown ubuntu:ubuntu "$OUT"

sudo tar czf "$OUT/pre-git-$TS.tar.gz" -C /opt \
  --exclude='liorvix/node_modules' --exclude='liorvix/.next' --exclude='liorvix/dist' \
  --exclude='liorvix/backups/*/.next' --exclude='liorvix/backups/*/dist' liorvix
sudo tar tzf "$OUT/pre-git-$TS.tar.gz" > /dev/null && echo "tar OK"

# 记录指纹，迁移后用它证明 .env.local 没被碰
cd /opt/liorvix
sudo find . -path ./node_modules -prune -o -path ./.next -prune -o -path ./dist -prune \
  -o -path ./backups -prune -o -type f -print0 | sort -z \
  | xargs -0 sudo sha256sum > "$OUT/manifest-$TS.sha256"
sudo grep -m1 '\.env\.local$' "$OUT/manifest-$TS.sha256"
```

2026-11-20 实测产物：`pre-git-20261120T073953Z.tar.gz`（19 MB、1253 条目）、
`manifest-20261120T073953Z.sha256`（928 行）。

**第 3 步（服务器）：就地转成 git 工作区**

```bash
cd /opt/liorvix
BRANCH=codex/ui-overlay-from-ui-change      # 换成要跟踪的分支（见 7.2）

sudo git init
sudo git remote add origin https://github.com/chaofan1020-hue/rising-path.git
sudo git fetch --depth 50 --prune origin "$BRANCH"

# 关键：必须带 -f
sudo git checkout -f -B "$BRANCH" "origin/$BRANCH"
sudo git branch --set-upstream-to="origin/$BRANCH" "$BRANCH"

# 这两条是迁移成功的判据
sudo git status --porcelain --untracked-files=no      # 必须为空
sudo git rev-parse --short HEAD
```

> **为什么必须 `-f`**：工作区里所有文件此刻都是“未跟踪”状态，`git checkout -b`
> 会直接报 `error: The following untracked working tree files would be overwritten by checkout`
> 并中止（已在 `/tmp` 用同样的命令模拟复现）。加 `-f` 才会覆盖同名文件；
> `.env.local`（被 `.gitignore` 忽略）和无关的未跟踪文件仍然不受影响。
>
> `checkout -f` 会把 353 个 CRLF 文件统一成仓库版本、补上 16 个缺失文件，
> 并把 4 个内容差异更新为 HEAD 版本——这些都已在上一步逐项核对过。

**第 4 步（服务器）：安装部署脚本**

```bash
sudo install -m 755 /opt/liorvix/scripts/production/deploy.sh   /usr/local/bin/liorvix-deploy
sudo install -m 755 /opt/liorvix/scripts/production/rollback.sh /usr/local/bin/liorvix-rollback
bash -n /usr/local/bin/liorvix-deploy && bash -n /usr/local/bin/liorvix-rollback && echo OK
```

> 先确认 root 的 PATH 里有 pnpm/node（脚本以 root 运行）：
> `sudo env PATH="$PATH" bash -c 'command -v pnpm node rsync'`，实测 `/usr/bin/pnpm`、`/usr/bin/node`。

**第 5 步（服务器）：空跑一次验证链路**

```bash
sudo /usr/local/bin/liorvix-deploy
```

预期：快照 → `lockfile unchanged` → 构建 → 重启 → 冒烟 → `OK <旧sha> -> <新sha>`。

**第 6 步（本地）：配置私钥，让“一条命令”成立**

任选一种（`scripts/deploy-production.mjs` 会按顺序找，并打印实际用的是哪个）：

```bash
# 方式一（推荐）：项目根目录建 .deploy.env，已被 gitignore
PROD_HOST=ubuntu@43.172.117.125
PROD_SSH_KEY=D:\liorvix-archive-20261119\secrets\正式发布服务器密钥.pem

# 方式二：把「正式发布服务器密钥.pem」放到项目根目录
# 方式三：复制到 ~/.ssh/liorvix_prod
# 方式四：临时 export PROD_SSH_KEY=<绝对路径>
```

然后：

```bash
node scripts/deploy-production.mjs        # 本机没 pnpm 时用这条
# 或（装了 pnpm 的机器上）
pnpm run deploy:prod
```

看到同样的 7 步输出即改造完成。

### 3.3 改造失败怎么办

按备份包回退（把文件名换成你实际生成的）：

```bash
BK=/opt/liorvix-deploy-backups
sudo systemctl stop liorvix.service
sudo rm -rf /opt/liorvix/.git                    # 只删 git 元数据，工作区文件保持现状
sudo tar xzf "$BK/pre-git-20261120T073953Z.tar.gz" -C /opt
sudo systemctl start liorvix.service
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5000/api/health
```

校验密钥没被破坏：

```bash
NOW=$(sudo sha256sum /opt/liorvix/.env.local | cut -c1-16)
REC=$(grep -m1 '\.env\.local$' "$BK"/manifest-*.sha256 | cut -c1-16)
[ "$NOW" = "$REC" ] && echo "env OK" || echo "env CHANGED"
```

### 3.4 2026-11-20 实际执行记录（已完成的改造）

| 项 | 值 |
| --- | --- |
| 迁移基线 | `c9f2e24`（925 个跟踪文件） |
| 备份 | `/opt/liorvix-deploy-backups/pre-git-20261120T073953Z.tar.gz`（19 MB / 1253 条目）+ `manifest-…sha256`（928 行） |
| 迁移耗时 | 备份约 20 秒；`init`+`fetch`+`checkout -f` 约 25 秒 |
| 迁移后判据 | `git status --untracked-files=no` 为空；`.env.local` sha256 与备份清单一致；`node_modules`/`.next`/`dist` 的 mtime 未变 |
| 空跑部署 | 15:44:22 开始 → 15:44:47 冒烟通过（构建约 18–40 秒，命中 Turbopack 缓存） |
| 冒烟结果 | `health=200 login_form=1 admin=307 analytics_unauth=401`，服务新 PID 2549269 |
| 本机一条命令 | 15:48 跑通，`exit 0` |
| 回滚实测 | 15:49:18 → 15:49:25 完成（7 秒，直接用 `releases/` 快照，无重建） |
| 公网复查 | `https://liorvix.com/api/health` 200 / `/admin/login` 200 且含「运营后台登录」 / `/admin` 307 |

---

## 4. 日常部署

```bash
node scripts/deploy-production.mjs        # 本机没 pnpm 时用这条
# 或（装了 pnpm 的机器上）
pnpm run deploy:prod
```

- 部署当前分支在远端的**最新提交**（会先 `git fetch`）；
- 耗时：构建约 1–3 分钟，其余几秒（命中 Turbopack 缓存时实测 18–40 秒）；
- 输出尾部会有 `OK <旧sha> -> <新sha>` 和回滚命令。

只部署某个特定版本：

```bash
node scripts/deploy-production.mjs -- <sha>
```

> 只改文档不需要部署；只改 `.env.local` 也不需要构建，改完
> `sudo systemctl restart liorvix.service` 即可（重启会重新读环境变量）。

本机会打印实际使用的私钥路径（配置方式见 §3.2 第 6 步）。
`--list` / `--rollback` 见 §5.3。

### 4.1 不在这台机器上时

在服务器上直接执行等价命令：

```bash
sudo /usr/local/bin/liorvix-deploy                  # 最新
sudo /usr/local/bin/liorvix-deploy <sha>            # 指定版本
sudo tail -f /var/log/liorvix-deploy/$(ls -1t /var/log/liorvix-deploy | head -1)
```

---

## 5. 验收与回滚

### 5.1 脚本自动验收（不通过会自动回滚）

| 检查 | 期望 |
| --- | --- |
| `GET /api/health` | 200 |
| `GET /admin/login` 含「运营后台登录」 | ≥1（说明服务端渲染生效，构建产物已切换） |
| `GET /admin`（未登录） | 307 → `/admin/login` |
| `GET /api/admin/analytics`（未登录） | 401（鉴权没被放宽） |
| 重启后 1 分钟内的服务日志 | 无 `unhandled` / `uncaught` / `Cannot find module` |

### 5.2 手工复查

```bash
curl -s -o /dev/null -w 'health %{http_code}\n' http://127.0.0.1:5000/api/health
curl -s http://127.0.0.1:5000/admin/login | grep -c '运营后台登录'
curl -s -o /dev/null -w 'admin %{http_code} %{redirect_url}\n' http://127.0.0.1:5000/admin
```

公网侧（经过 Cloudflare，可能慢 0.5–1.5 秒，属正常）：

```bash
curl -s -o /dev/null -w '%{http_code} %{time_starttransfer}\n' https://liorvix.com/api/health
```

### 5.3 回滚

```bash
pnpm run deploy:prod -- --list               # 看有哪些快照
pnpm run deploy:prod -- --rollback <sha>     # 秒级回滚（用 releases 里的构建产物）
```

服务器上等价：`sudo /usr/local/bin/liorvix-rollback <sha>`。

没有快照时会自动重新构建（慢一些，但仍是一条命令）。

---

## 6. 故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `找不到生产私钥` | 本机没有密钥，或路径不在候选列表里 | 按提示做：放项目根目录、复制到 `~/.ssh/liorvix_prod`、或写 `.deploy.env`（见 §3.2 第 6 步） |
| `git push` 报 `Connection was reset` / `schannel: server closed abruptly` | 本机到 GitHub 的 TLS 抖动（本项目实际遇到，与服务器无关） | `git -c http.version=HTTP/1.1 push origin <branch>`；实测一条命令即成功，不必改任何配置 |
| `checkout` 报 `untracked working tree files would be overwritten` | 迁移时漏了 `-f` | `git checkout -f -B <branch> origin/<branch>`（见 §3.2 第 3 步） |
| `git status` 一直显示 `releases/`、`backups/` 未跟踪 | 服务器上的 `.gitignore` 版本偏旧 | 已在 `c9f2e24` 补上 `/releases/`、`/backups/`、`.env.local.*`、`dist.rollback-*/` |
| `git fetch 失败` | 服务器到 GitHub 网络抖动 | 重试；`git ls-remote https://github.com/chaofan1020-hue/rising-path.git` 自测 |
| `工作区有未提交改动` | 有人在服务器上直接改了文件 | 先 `git status` 看改动；要保留就提交并推送，不要 `reset --hard` |
| `构建失败，代码已回退` | 代码/依赖问题 | 看 `/var/log/liorvix-deploy/` 最后一个日志；服务仍是旧版本、未中断 |
| `服务未能启动` | 启动即崩溃（环境变量、模块缺失） | `sudo journalctl -u liorvix.service -n 100 --no-pager`；然后 rollback |
| `登录页没有服务端渲染的表单` | 只重启没构建，或部署到了旧产物 | 重新 `pnpm run deploy:prod`（该检查就是为此设计的） |
| `磁盘剩余 <5G` | releases 快照或日志堆积 | `sudo du -sh /opt/liorvix/releases/*`、清理旧日志；脚本默认只留 3 份快照 |
| 浏览器反复跳登录页 | 管理员会话过期（8 小时） | 重新登录；如需延长改 `ADMIN_SESSION_TTL_SECONDS` |

部署日志：`/var/log/liorvix-deploy/<UTC时间>.log`（脚本同时输出到终端）。

---

## 7. 附录

### 7.1 生产事实表

| 项 | 值 |
| --- | --- |
| 站点 | `https://liorvix.com`（Cloudflare 代理，实测落 AMS 节点） |
| 服务器 | `43.172.117.125`（腾讯云，加州圣克拉拉） |
| SSH | `ubuntu@43.172.117.125`，密钥 `正式发布服务器密钥.pem`（**不在仓库里**） |
| 应用目录 | `/opt/liorvix` —— 2026-11-20 起是 **git 工作区**，跟踪 `codex/ui-overlay-from-ui-change`，925 个跟踪文件 |
| 服务 | `liorvix.service`（systemd，`User=root`，`PORT=5000`，`JOBS_AUTO_WORKER=true`，开机自启） |
| 运行时 | Node `v20.20.2`，pnpm `9.0.0`（`/usr/bin/pnpm`），rsync 已装，git `2.43.0` |
| 数据库 | Supabase `weqvdtdjdzmqflhwobec`（us-west-1） |
| 仓库 | `github.com/chaofan1020-hue/rising-path`（**公开**，服务器无需凭证即可 fetch），默认分支 `main` |
| 构建快照 | `/opt/liorvix/releases/<sha>/{.next,dist}`，脚本默认保留 3 份（每份约 100 MB） |
| 部署日志 | `/var/log/liorvix-deploy/<UTC>.log` |
| 迁移备份 | `/opt/liorvix-deploy-backups/pre-git-20261120T073953Z.tar.gz` + `manifest-…sha256` |
| 历史手工备份 | `/opt/liorvix/backups/`（已 gitignore，不影响 `git status`） |
| 本机部署配置 | 项目根 `.deploy.env`（已 gitignore，写 `PROD_HOST` / `PROD_SSH_KEY`） |

### 7.2 分支策略（建议）

生产现在跟踪 `codex/ui-overlay-from-ui-change`，而 `main` 落后较多（`149adec9`）。
建议：

1. 短期：保持现状，`DEPLOY_BRANCH` 指向当前分支（已生效）；
2. 中期：把该分支合回 `main`，然后
   `sudo DEPLOY_BRANCH=main /usr/local/bin/liorvix-deploy` 并把脚本默认值改掉，
   让生产只跟 `main`，避免“生产跟某个 codex 分支”的长期风险。

### 7.3 密钥管理

私钥现在在 `D:\liorvix-archive-20261119\secrets\正式发布服务器密钥.pem`（项目目录外），
本机通过项目根 `.deploy.env` 引用它。推荐保持这个形态：

- `.deploy.env` 已进 `.gitignore`，不会被提交；
- 也可以复制到 `~/.ssh/liorvix_prod`，脚本会按 §3.2 第 6 步的顺序自动找到；
- **不要把私钥、也不要把它的路径写进仓库里的任何文件**；
- 服务器上不需要这份私钥；它只用于本机 → 服务器的 SSH。

### 7.4 将来想做到“push 即上线”

一键脚本已经是幂等的，接 GitHub Actions 只需要在仓库加一个 workflow，
在服务器上装公钥、在仓库配 secret，然后调用同一条命令：

```yaml
- name: Deploy
  run: ssh -i ~/.ssh/deploy_key ubuntu@43.172.117.125 'sudo /usr/local/bin/liorvix-deploy'
```

不需要改 `deploy.sh`。等真的需要“零人工”时再做。

### 7.5 临时应急（已不适用）

一次性改造已于 2026-11-20 完成（见 §3.4），本节仅作历史参考。
当年改造前的紧急上线方式是“手工上传 → 服务器 `pnpm run build` → `systemctl restart`”，
它的问题（容易只重启不构建、无法回滚、源码与 git 分叉）正是本手册要消除的。
如果将来又出现“不是 git 工作区”的机器，按 §3 重新改造，不要回到手工流程。

---

## 8. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-20 | 生产上线后台性能改造（`0f7d47b`）；本手册建立 |
| 2026-11-20 | **完成一次性改造**：把 8 个线上未提交文件记入 git，`/opt/liorvix` 转为 git 工作区（`c9f2e24`），安装 `liorvix-deploy`/`liorvix-rollback`，本机一条命令与秒级回滚均实测通过（见 §3.4） |
| 2026-11-20 | 修正 §3.2 第 3 步：`git checkout` 必须带 `-f`（原写法会报 untracked 冲突）；`.gitignore` 补 `/releases/`、`/backups/`、`.deploy.env` |