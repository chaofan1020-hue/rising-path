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

# 4) 记录回滚点
sudo git -C /opt/liorvix rev-parse HEAD
```

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
curl -s -o /dev/null -w 'jobs_list=%{http_code}\n' 'http://127.0.0.1:5000/api/jobs?limit=5'
curl -s 'http://127.0.0.1:5000/api/jobs?limit=5' | head -c 300
curl -s -o /dev/null -w 'stats=%{http_code}\n' http://127.0.0.1:5000/api/jobs/stats
# 取列表里任意 id，验详情与 open
curl -s -o /dev/null -w 'detail=%{http_code}\n' http://127.0.0.1:5000/api/jobs/<id>
```

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
- 误关 <0.2%：抽样 50 条 v3 关闭行核对上游与 `closure_evidence`；
- 48h 达标后才允许 P1 1,500 board（R28）与 G3（R29）。

## 5. 明确不做

- 不清空 `public.jobs`、不直接 SQL 改生产岗位数据；
- 不在同一窗口同时做“写切换 + 清理旧表”；
- 不在没有证据 `PASS` 的情况下先用 `JOBS_READ_SOURCE=v3` 对外；
- 不把方案 A 说成“写入量已下降”。
