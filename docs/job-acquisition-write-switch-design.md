# 方案 B（写切换）设计 · C1

> 状态：**设计稿，未实施**。需要人工确认后再动手；方案 A（读切换）已在生产运行。
> 前置阅读：`docs/job-acquisition-v3-cutover-runbook.md`（方案 A 执行记录）、`docs/job-acquisition-next-phase-execution-plan.md`（C 工作流）。
> 编写：2026-11-26 15:05 +08。所有数字均为生产库实测。

## 1. 为什么要做

方案 A 只切了读，写仍然打在 `public.jobs` 上、再由影子触发器复制到 `jobs_v3`。后果：

| 问题 | 实测证据 |
|---|---|
| 写入没有变快 | 1,500 行批量 upsert：**7.65s → 0.83s**（走 v3 直写 vs 走旧表+影子）；影子触发器把每条写放大成 2 次写 |
| 磁盘双倍增长 | `jobs` 5.4 GB + `jobs_v3` 3.4 GB；双写期每天 +0.3–0.5 GB，磁盘只剩 6 GB |
| 旧的 12 万关闭行永远占着 1.5 GB | `jobs` 344,617 行 vs `jobs_v3` 245,145 行 |

**收益**：写入 ~9x 提速、磁盘停止双倍增长、7 天后可归档旧表腾出 ~5.4 GB。

## 2. 现在的写路径（8 个文件，48 处 `from('jobs')`）

`src/lib/job-sync.ts`（主 upsert + 关闭）、`src/lib/jobs-feed.ts`、`src/lib/job-sync-failure-worker.ts`、`src/lib/job-ttl-worker.ts`、`src/lib/job-maintenance.ts`、`src/lib/official-details-worker.ts`、`src/lib/job-connectors/sync.ts`、`src/app/api/jobs/batch/route.ts`，外加混合路由 `src/app/api/jobs/[id]/open/route.ts`（读走 v3、关闭写走旧表）。

`scripts/test-job-read-source.ts` 已经用 `mustStayOnWriteTable` 把这 8 个文件锁在旧表上——方案 B 要改的就是这份清单，测试也要同步改成 `mustFollowWriteSwitch`。

## 3. 五个必须先解决的技术障碍（本次实测发现）

### 3.1 `jobs_v3` 上**一个触发器都没有** —— 最关键

`public.jobs` 上有 3 个业务触发器，`jobs_v3` 上一个都没有（只有 `jobs` 侧 3 个影子触发器）：

| 触发器 | 作用 | 直写 v3 的后果 |
|---|---|---|
| `jobs_sync_matches_target_region`（BEFORE） | 算 `matches_target_region` | **新岗位 flag 为 NULL → 目录里直接看不见** |
| `jobs_sync_ai_match_scope`（AFTER） | 维护 `job_ai_match_scopes` | **AI 选岗 / 地区识别拿不到新岗位** |
| `jobs_set_company_config_id`（BEFORE） | 关联 `company_config` | 公司配置关联丢失 |

必须先迁移到 `jobs_v3`。注意顺序：v3 触发器要在**反向影子之前**触发（BEFORE 触发器天然先于 AFTER），且反向影子写回 `jobs` 时会再触发一次旧表触发器（幂等，可接受）。

### 3.2 `jobs_v3_id_seq` 落后于真实数据 —— 会撞主键

```
jobs_v3_id_seq.last_value = 325,404
max(jobs_v3.id)          = 382,313
```

影子回填是显式带 `id` 插入的，**没有推进序列**。如果直接让 v3 用自己的序列发号，会立刻 `duplicate key value violates unique constraint "jobs_v3_pkey"`。

修法（二选一，推荐 A）：
- **A. 把 `jobs_v3.id` 的默认值改成 `nextval('jobs_id_seq')`**，让两张表共用一条序列 → 迁移期 id 全局唯一，反向影子不会撞 id，7 天后停旧表写入时序列天然接续。
- B. `setval('jobs_v3_id_seq', 382313 + 1000)` —— 迁移期两表各自发号，反向影子回写 `jobs` 可能撞 `jobs` 的 pkey，**不推荐**。

### 3.3 三个 v3 专属列没有默认值

`lane`（varchar，可空但有 CHECK 只允许 `ats`/`legacy`）、`canonical_job_id`（int，可空）、`closure_evidence`（jsonb NOT NULL default `'{}'`）。

直写时 `lane` 为 NULL 会让 `jobs_v3_ats_identity_uidx`（`WHERE lane='ats' AND is_active ...`）失效 → **新 ATS 岗位不参与唯一约束去重**。必须给 `lane` 加默认值或由写入层显式赋值（`source_key is not null → 'ats' else 'legacy'`，与影子函数同规则）。

### 3.4 反向影子（v3 → jobs）是 7 天回滚的唯一保障

方案 A 的回滚是「删 flag + 重启」，10 分钟。方案 B 一旦写了新行到 v3，回滚时这些行在 `jobs` 里不存在 → 回滚即丢数据。所以必须有反向影子：

```
jobs_v3 上的 AFTER INSERT/UPDATE/DELETE（statement-level）
  → 复制到 public.jobs（全列，含 id）
```

要点：
- 反向影子写 `jobs` 时会触发 `jobs` 的 3 个业务触发器 + 3 个前向影子触发器 → **前向影子会再把这次写复制回 v3，造成回环**。必须让前向影子在「写入源 = 反向影子」时短路。实现方式：`jobs` 上加一个 session 变量或用一个 `ALTER TABLE ... DISABLE TRIGGER` 不行（会漏真实写）。推荐：给 `shadow_jobs_to_v3_*` 加守卫 `if current_setting('liorvix.reverse_shadow', true) = 'on' then return null; end if;`，反向影子函数里 `perform set_config('liorvix.reverse_shadow','on',true)`。
- 回环若没拦住，`jobs_v3` 会无限膨胀 —— 这是本方案最大风险点，必须在 staging 用 100 行夹具验证「写 1 次 = 两表各 1 行」。

### 3.5 归档读路径的依赖

`/api/jobs?status=closed|all` 现在固定读 `public.jobs`（因为有 12.2 万关闭行只在旧表）。方案 B 切写后，新关闭行只进 v3 → **旧表不再完整**，归档页会缺新关闭的岗位。

两个选择：
- **B-1（推荐，低风险）**：把 `status=closed|all` 也切到 v3，同时**先把旧表的 12.2 万关闭行回填进 v3**（约 +1.5 GB 磁盘，需先腾空间）。
- B-2：归档页保持读旧表，接受「新关闭岗位没归档」，并在 UI 标注。不推荐——数据会越分越开。

## 4. 实施步骤

| # | 动作 | 验收 | 回滚 |
|---|---|---|---|
| C1 | 本文档 + 人工确认 | 用户确认 §3.5 选 B-1 还是 B-2 | — |
| C2 | 迁移 `0161_jobs_v3_write_ready.sql`：① `jobs_v3.id` 默认改 `nextval('jobs_id_seq')`；② 迁移 3 个业务触发器到 v3；③ 给 `lane` 加默认/写入约束；④ 建反向影子函数 + 触发器（带回环守卫）；⑤ 前向影子加守卫 | staging 100 行夹具：写 1 次 → 两表各 1 行、flag 正确、scope 正确、无回环 | `drop trigger`/还原 default |
| C3 | 加 `jobWriteTable()` + `JOBS_WRITE_SOURCE`，改 8 个写文件的写语句（只改写，不改读） | 新增 `scripts/test-job-write-source.ts`（与读测试同构），全绿；`tsc` 通过 | 删 flag 重启 |
| C4 | 影子验证 24h：双向全列对账（现有 `jobs-v3-reconcile.sh` 反向跑一遍） | `missing/extra/field_mismatches` 全 0，24h | 关 flag |
| C5 | 切写 `JOBS_WRITE_SOURCE=v3` + 反向影子常开，观察 7 天 | 写入耗时下降、feed 延迟不升、对账零差异 | 删 flag 重启（旧表因反向影子始终最新） |
| C6 | 7 天后：停旧表写入、归档 `jobs`（保留 30 天备份）、回收磁盘 | 磁盘 6 GB → ~11 GB | 从备份恢复 |

## 5. 停止线

- 反向/前向影子出现回环（单次写导致 v3 行数 >+2）→ 立即 `drop` 反向影子，回滚 flag
- 对账 `field_mismatches > 0` 持续 2 个周期 → 停
- 切写后 feed 延迟 >15 min 或 5xx 上升 → 停
- 磁盘 <4 GB → 暂停（先做 C6 的旧表归档反而腾空间，但归档前需备份空间）

## 6. 需要拍板的问题

1. **§3.5 归档策略**：B-1 回填 12.2 万关闭行（+1.5 GB，需先腾磁盘）还是 B-2 接受归档不完整？
   → 建议 B-1，但要先把磁盘从 6 GB 腾到 ≥10 GB（可选：`vacuum full jobs_v3` 回收 3.4 GB 里的膨胀，或先归档最老的关闭行）。
2. **是否值得做**：总工期 2–3 天 + 7 天观察，收益是写入 9x + 磁盘 5.4 GB。
   → 如果后续还要扩到 6,000 board，磁盘会是硬瓶颈，建议做。
3. **是否先做「低成本替代」**：不切写，只对 `jobs` 做一次 `vacuum full`（腾 ~1–2 GB），把方案 B 推迟到扩量完成之后。
   → 如果磁盘告急而时间紧，这是性价比更高的临时手段。
