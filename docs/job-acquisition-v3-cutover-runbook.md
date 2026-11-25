# 岗位库 v3 切换执行手册（Phase 5）

> 状态：**未执行**。本手册是给“停下等确认”的那一步准备的操作清单。
> 归属计划：[job-acquisition-v3-rebuild-plan.md](./job-acquisition-v3-rebuild-plan.md) Phase 5（R21–R25）。
>
> 两条停止线不能绕过：
> 1. `liorvix-jobs-v3-evidence.sh` 必须连续 24h（R19）与 48h（R26）判定 `verdict=PASS`；
> 2. 执行前必须拿到用户明确确认。

## 0. 先分清两种“切换”

| 方案 | 内容 | 现状 | 风险 | 收益 |
|---|---|---|---|---|
| **A · 只切读** | `JOBS_READ_SOURCE=v3`，读走 `jobs_v3`；写仍进 `public.jobs`，由影子触发器同步 v3 | **代码已就绪**（`jobReadTable`/`jobListingReadTable` 覆盖列表、详情、stats、open） | 低，10 分钟内可回滚 | 读路径先用上新表；写出问题不影响读 |
| **B · 读写都切** | feed/worker 直接写 `jobs_v3`，`public.jobs` 转只读 | **代码未建**：目前只有读开关，没有写目标开关 | 高，需要改写入层并重跑全部影子对账 | 才有“写入量下降 ≥60%”的收益 |

计划里 R24“旧库只读”属于方案 B。**在做完 B 之前，不能对外宣称数据库压力/写入量已经改善。**

## 1. 前置检查（T-1 天）

一条命令跑完下面 6 项，输出 `VERDICT READY_TO_CUT_OVER` 才算过线（只读，不写库、不重启、不翻开关）：

```sh
sudo sh /opt/liorvix/scripts/jobs-v3-cutover-precheck.sh
```

它逐项检查：对账不变量全 0、feed 新鲜度 <15min、`source_active` == `jobs_v3` active、`read_index_gaps=0`、56 列全量一致、DLQ pending=0、24h 证据 `verdict=PASS`。

需要手工复核时按下面原命令跑：

```sh
# 1) 24h / 48h 证据（必须 PASS）
sudo sh /opt/liorvix/scripts/jobs-v3-evidence.sh /var/log/liorvix-jobs-v3-reconcile.log 24 \
  2026-11-25T07:11:43Z

# 2) 不变量（全部应为 0 / 期望值）
#    v3_active_only=0  dup_ats_keys=0  ats_missing_key=0  missing_evidence=0
#    missing=0  extra=0  field_mismatches=0  bad_ats_key=0

# 3) 当日备份存在且可读
sudo systemctl list-timers liorvix-db-backup.timer
ls -lh /opt/liorvix/backups | tail -3

# 4) 读路径索引齐（0157 已建，watchdog 每 5 分钟检查）
#    期望输出里 read_index_gaps=0；不为 0 就先补索引再谈切读
sudo tail -1 /var/log/liorvix-jobs-v3-reconcile.log

# 5) 全列一致性（56 个共享列，比 watchdog 的 8 列更严）
sudo sh /opt/liorvix/scripts/jobs-v3-column-audit.sh

# 6) 记录回滚点
sudo git -C /opt/liorvix rev-parse HEAD
```

**为什么第 4 项是硬条件**：`jobs` 有 39 个读路径索引，`jobs_v3` 原本只有 7 个。2026-11-25 实测同一筛选查询（`region_market=us`，精确计数）**旧表 75ms、影子表 930ms（12 倍）**。`0157_jobs_v3_read_indexes.sql` 补齐 15 个表达式/部分索引后降到 56–110ms。缺索引时切读 = 让目录页变慢甚至超时。

**证据日志的保留方式（2026-11-25 核实）**：`liorvix-jobs-v3-reconcile.service` 用 `StandardOutput=append:`/`StandardError=append:` 追加写，`/etc/logrotate.conf` 与 `/etc/logrotate.d/*` 都没有匹配该文件的规则、`tmpfiles.d` 也没有，所以它是**只增不减**（约 7 KB/天）。也就是说 24h/48h 证据不会因为轮转被清零；反过来说，**谁手工清空或改名这个文件，证据窗口就会从零重算**。

任一项不满足 → 停止，不进入第 2 步。

## 2. 方案 A：只切读（推荐先做）

### 2.1 停写窗口（R21，5–10 分钟）

```sh
# 暂停 feed 写入，避免窗口内新旧表计数漂移
sudo sed -i 's/^#*JOBS_SYNC_DISABLED=.*/JOBS_SYNC_DISABLED=true/' /opt/liorvix/.env.local
# 若文件里没有该键，追加：
# echo 'JOBS_SYNC_DISABLED=true' | sudo tee -a /opt/liorvix/.env.local
sudo systemctl restart liorvix
```

### 2.2 追平最后增量（R22）

```sh
# 观察中央 worker 是否停在窗口前；确认后恢复 feed 并等本轮 caught_up
sudo sed -i 's/^JOBS_SYNC_DISABLED=.*/JOBS_SYNC_DISABLED=false/' /opt/liorvix/.env.local
sudo systemctl restart liorvix
# 等 1 轮（≤5 分钟）后核对：
sudo docker exec liorvix-supabase-db psql -U postgres -d postgres -At -F ' | ' -c "
select source_system, caught_up_at, last_incremental_success_at, consecutive_failures
from public.job_sync_state where source_system='collector_feed';"
```

判据：`caught_up_at` 在最近 5 分钟内，`consecutive_failures=0`；随后核对
`source_active` 与 `jobs_v3` active 数一致（差值 0）。

### 2.3 切读（R23）

```sh
sudo sh -c "grep -q '^JOBS_READ_SOURCE=' /opt/liorvix/.env.local \
  && sed -i 's/^JOBS_READ_SOURCE=.*/JOBS_READ_SOURCE=v3/' /opt/liorvix/.env.local \
  || echo 'JOBS_READ_SOURCE=v3' >> /opt/liorvix/.env.local"
sudo systemctl restart liorvix
```

冒烟（全部通过才算成功）：

```sh
curl -s -o /dev/null -w 'health=%{http_code}\n' http://127.0.0.1:5000/
# /api/jobs 与 /api/jobs/stats 都是“登录后权益”，未带凭证时 401 是**预期**，
# 只能证明路由活着，不能证明读的是 v3。真正的读切换证据看下面的计数器。
curl -s -o /dev/null -w 'jobs_unauth=%{http_code}\n' 'http://127.0.0.1:5000/api/jobs?limit=5'
```

读路径是否真的切过去，用表级计数器证明（切换前记一次基线，切换后再记一次）：

```sh
sudo docker exec liorvix-supabase-db psql -U postgres -d postgres -At -F ' | ' -c "
select relname, idx_scan, seq_scan from pg_stat_user_tables
where relname in ('jobs','jobs_v3') order by relname;"
```

判据：切换后 `jobs_v3.idx_scan` 持续增长、`jobs.idx_scan` 基本冻结（feed 写入仍打在 `jobs`，所以只冻结读扫描，不是完全不动）。若两边都没动，说明请求没进来，不要当成切换成功。

另外用 service-role 直连 PostgREST 做一次等价性抽查（这条与 API 无关，只证明视图可用）：

```sh
KEY=$(sudo bash -c "grep -m1 '^SUPABASE_SERVICE_ROLE_KEY=' /opt/liorvix/.env.local | cut -d= -f2- | tr -d '\r'")
for V in jobs_listing jobs_listing_v3; do
  curl -s -D - -o /dev/null -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
    -H 'Prefer: count=exact' "http://127.0.0.1:3000/$V?is_active=eq.true&select=id&limit=1" \
    | grep -i '^content-range' | tr -d '\r' | sed "s/^/$V /"
done
```

两个视图的 `Content-Range` 总数必须相同。

同时确认日志无 `jobs_v3` 报错：

```sh
sudo journalctl -u liorvix --since '-10 min' --no-pager | grep -iE 'jobs_v3|error' | tail -20
```

### 2.4 回滚（≤5 分钟，R25）

```sh
sudo sh -c "sed -i 's/^JOBS_READ_SOURCE=.*/JOBS_READ_SOURCE=jobs/' /opt/liorvix/.env.local"
sudo systemctl restart liorvix
# 冒烟同上；必要时整包回滚：
sudo liorvix-rollback <上一个 release sha>
```

回滚**只切读路径**，不回滚已写入的 v3 增量，也不删数据。

### 2.5 可选预演（不影响线上服务）

想在切之前证明“带 `JOBS_READ_SOURCE=v3` 也能正常起服务”，可以另起一个端口做预演。**必须同时满足下面两个条件**，否则会出两个坑（2026-11-25 实测）：

```sh
# 缺 NODE_ENV 会以 dev 模式启动：不仅 /api/* 行为与线上不一致（看到的 200/401 不能作数），
# dev 模式还会把仓库里的 next-env.d.ts 改写成 .next/dev/types/routes.d.ts，
# 于是 /opt/liorvix 变脏、下一次 deploy 直接报“工作区有未提交改动”。
# 缺 JOBS_AUTO_WORKER=false 会起第二个 feed worker，和线上 worker 抢同一批游标。
sudo -n bash -c 'cd /opt/liorvix && NODE_ENV=production PORT=5011 \
  JOBS_AUTO_WORKER=false JOBS_SYNC_DISABLED=true JOBS_READ_SOURCE=v3 \
  nohup node dist/server.js > /tmp/v3rehearsal.log 2>&1 & echo started'
sleep 12
curl -s -o /dev/null -w 'root=%{http_code}\n' http://127.0.0.1:5011/
# 收尾一定要杀干净（env 不在 argv 里，pkill -f PORT=5011 匹配不到该进程）
sudo -n ss -ltnp | grep ':5011'   # 取 pid
sudo -n kill <pid>
# 预演之后如果 next-env.d.ts 被改过，必须先还原再部署
sudo -n git -C /opt/liorvix checkout -- next-env.d.ts
```

预演只能证明“服务能起、路由不 500”；它拿不到登录凭证，`/api/jobs` 只会 401，读切换的真实证据仍然是 §2.3 的 `idx_scan` 计数器和 PostgREST 计数比对。

## 3. 方案 B：写路径迁移（未建，需先开发）

需要的改动（按依赖顺序）：

1. **写目标开关**：新增 `JOBS_WRITE_SOURCE`（`jobs` | `jobs_v3`），默认 `jobs`。
2. **写入层适配**：feed upsert / 关闭 / 维护任务改成按开关选表；写入 `jobs_v3` 时必须显式写 `lane`、`source_key`、`external_job_id`、`closure_evidence`，并处理 ATS 唯一索引冲突。
3. **影子触发器反转**：切写后由 `jobs_v3` 反向镜像或直接停用触发器，避免双写冲突。
4. **对账改造**：以 `jobs_v3` 为主表重新定义 `missing/extra`，旧表转只读并冻结。
5. **回滚方案**：保留写 `jobs` 的路径 7 天，回滚只需切开关。

## 4. 切换后观察（Phase 6 / R26）

- 每 5 分钟对账继续跑；`feed_age` P95 ≤15 min，`row_failures` 连续 24h = 0；
- 读 API P95 不高于切换前 10%（对比 `/api/jobs` 与 `/api/jobs/stats` 抽样 20 次）；
  切换前基线（2026-11-25，直接量 PostgREST，service-role）：
  `is_active` 精确计数 75ms、`region_market=us` 精确计数 56–110ms、
  计划型列表查询 2–2.5ms；`jobs_v3` 在 0157 索引建好前是 930ms，别拿旧数字当基线；
- 误关 <0.2%：抽样 50 条 v3 关闭行核对上游与 `closure_evidence`；
- 48h 达标后才允许 P1 1,500 board（R28）与 G3（R29）。

## 5. 明确不做

- 不清空 `public.jobs`、不直接 SQL 改生产岗位数据；
- 不在同一窗口同时做“写切换 + 清理旧表”；
- 不在没有证据 `PASS` 的情况下先用 `JOBS_READ_SOURCE=v3` 对外；
- 不把方案 A 说成“写入量已下降”；
- **不在 `jobs_v3` 缺读索引（`read_index_gaps>0`）时切读**。
