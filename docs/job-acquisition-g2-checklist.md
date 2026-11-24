# G2 观察与 P1 导入清单（V02 → G2 → V03）

> 目的：48h 观察结束后，按同一套口径判 G2；通过后再导入 P1 1,000，不靠“感觉”。
> 观察起点：**2026-11-24 11:50 UTC**；最早判定：**2026-11-26 11:50 UTC**（北京 19:50）。

## 1. 到点先查的 7 个数

上游：

```sql
-- 成功率（累计）
select count(*) filter (where status='success')::numeric / nullif(count(*),0) as success_rate,
       count(*) filter (where status='failed') as failed,
       count(*) as runs
from board_poll_runs where started_at >= '2026-11-24 11:50+00';

-- board 新鲜度（不是 jobs.last_seen_at）
select round(percentile_cont(0.95) within group (
         order by extract(epoch from now()-last_ok_at)/60)::numeric,1) as p95_min
from ats_boards where status='active' and last_ok_at is not null;

-- 误关 / 重复
select count(*) filter (where status::text='CLOSED') as closed,
       count(*) filter (where source_key is not null) as source_jobs
from jobs;
select count(*) from (
  select source_key, external_job_id from jobs
  where source_key is not null group by 1,2 having count(*)>1
) d;
```

美国站：

```sql
select count(*) filter (where is_active) as active,
       count(*) filter (where is_active and source_key is not null) as v2_source,
       count(*) filter (where is_active and display_status='stale') as stale
from jobs;

select last_incremental_success_at,
       round(extract(epoch from now()-last_incremental_success_at)/60)::int as lag_min,
       last_error
from job_sync_state where source_system='collector_feed';
```

## 2. G2 判定表

| 项 | 阈值 | 通过条件 |
|---|---|---|
| 48h 成功率 | ≥98% | 失败数/总 run；单次 502 可接受 |
| 误关 | 0 | `status=CLOSED` 的 source job 必须为 0 |
| 重复 | <0.5% | `(source_key, external_job_id)` 重复 0 |
| board P95 | ≤30 min | 用 `last_ok_at` |
| Feed lag | <15 min | 最近成功时间 |
| US stale | 正常 | 启用 TTL 后抽样，不能把“未同步”误判 stale |
| 成本 | 可接受 | 以当月上游流量/容器成本估算，≤¥0.05/岗/月 |
| 500 board 稳定 | 是 | 无连续失败、无停止线 |
| source_key 覆盖 | 500/500 | 不能只看岗位总数；上游 global board 与 US target 过滤后的差额要能从 skip reason 解释 |

任一项不通过：**不导入 P1**，保持 500 board，按失败项先修（U08/U09 或数据修复）。

## 3. G2 通过后的 P1 导入（分两批，不一次 1,000）

1. **第一批 500**：
   ```bash
   docker cp /tmp/p1-boards.csv global-jobs-bulk-worker-1:/tmp/p1-boards.csv
   docker exec global-jobs-bulk-worker-1 python -m app.bulk_boards \
     --csv /tmp/p1-boards.csv --apply --limit 500
   ```
2. 等 30 min，查 `ats_boards` active=1,000、新 board 的 `last_ok_at` 非空、`board_poll_runs` 无连续失败；
3. 美国站增量同步一次，确认只新增、`status=CLOSED` 仍 0；
4. **第二批 500**：同命令 `--limit 500`（导入脚本跳过已有 token，实际新增 500）；
5. 连续观察 24h；无停止线再进入 V03/U08。
6. 1,000 个 P1 board 全部有页面标题名；215 个有公司域名，785 个只靠 board 标题/ATS 域名，先按“列表展示可用、官网字段留空”处理，不要回填猜测域名。

## 4. 停止线（任一即停）

- 新增 board 连续失败 >5% 或单 vendor 429 >10%；
- `status=CLOSED` 出现任何 source job（非 404/410 证据）；
- 重复 `(source_key, external_job_id)` >0；
- 美国站 feed lag >15 min 持续 30 min；
- 上游 bulk-worker/队列积压导致 500 board P95 >30 min；
- 成本估算超过 ¥0.05/岗/月。

## 5. 回滚

- 先导出该批 `source_key` 对应岗位；
- 按 `source_key` 删除 P1 岗位（不按公司删）；
- `BULK_BOARD_WRITE=false`，保留 board 但停止写；
- 美国站 Feed 游标不回退，避免重复插入；
- 回滚后重新跑 500 board 基线，确认 P0 不受影响。

## 6. 不在 G2 前做的事

- 不启用 `JOB_TTL_ENABLED`（避免未同步误 stale）；
- 不导入 P1；
- 不改 board 间隔/ETag（U08 属于 G2 后）；
- 不因为“D07 已探测 1,944”就认为生产已 1,944；生产仍是 500。