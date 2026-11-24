# S05 · 旧来源重复审计（只读）

> 日期：2026-11-24 20:06 +08（UTC 12:06）
> 数据库：美国站生产 `liorvix-supabase-db`；未写任何行。
> 结论：**没有 `ats:*` 旧来源与 `collector_feed` 的跨来源重复**；不修改展示、不启用 `dedupe_group_id` 合并。

## 1. 活跃规模

| 口径 | 值 |
|---|---:|
| active jobs | 189,146 |
| `source_key` 非空（Feed v2） | 75,176 |
| `source_system='collector_feed'` | 186,467 |
| `source_system like 'ats:%'` | **0** |

- 美国站旧来源实际只有 `collector_feed`（另有一小部分人工/历史来源，不参与本审计）。
- S05 的前提“`ats:*` 与 `collector_feed` 重复”在当前库不成立：`ats:*` 为 0，跨来源重叠自然为 0。
- 新增 ATS 岗位通过 `source_key` + 前缀 `external_job_id` 进入，不改 `source_system`；不能把 `source_key` 当成旧 `ats:*`。

## 2. canonical URL 重复

按 `lower(regexp_replace(job_url,'[?#].*$',''))` 分组：

| 指标 | 值 |
|---|---:|
| 重复 URL 组 | 53 |
| 涉及行 | 14,650 |
| 额外行（n-1） | 14,597 |

- 这些组几乎都是**通用申请入口**，不是同一岗位的重复记录：
  - `https://www.carvana.com/careers/apply` 1,563 行；
  - `https://careers.ibm.com/careers/jobdetail` 811 行；
  - `https://databricks.com/company/careers/open-positions/job` 565 行；
  - `https://www.eyecare-partners.com/careers/current-job-openings/` 378 行；
  - `https://jobs.ubs.com/tgnewui/search/home/homewithpreload` 332 行。
- 因此不能按 URL 去重，也不能把 14,597 当作“重复岗位率”。真正的明细由 `external_job_id`/`source_key` 区分。
- 若以后要用 URL 去重，必须先把 `job_url` 换成带 requisition id 的详情 URL，并保留 `apply_url` 作为申请入口。

## 3. `(company,title,region)` 重复

| 指标 | 值 |
|---|---:|
| 重复组 | 8,766 |
| 涉及行 | 25,035 |
| 额外行 | 16,269 |

- 同公司同标题同地区可能对应多个 requisition（不同班次/地点/团队），不能直接判重。
- 该口径只能用于“人工复核队列”，不能自动隐藏或关闭。

## 4. 决策

| 项 | 决策 |
|---|---|
| 默认列表排除 `source_system like 'ats:%'` | **不做**：`ats:*` active 为 0，排除无意义 |
| 写 `dedupe_group_id` 合并 | **不启用**：当前证据不足以判重，避免误合并 |
| URL canonical 去重 | **不启用**：通用申请入口会误伤 |
| 后续 | 等 `source_key` 覆盖稳定后，用带 job id 的 `apply_url` + `external_job_id` 再做一次精确审计 |

## 5. 验收

- 报告给出重复组、行数、比例与样例：是。
- 未改代码、未改数据：是。
- S05 结论：**跨来源重复 0；通用 URL 重复 7.7% 属展示入口复用，不作为重复率**。
- 回滚：只读，无需回滚。