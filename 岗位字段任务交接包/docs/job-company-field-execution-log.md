# 公司岗位字段执行记录

本记录对应 [`all-company-job-field-completion-plan.md`](all-company-job-field-completion-plan.md)。它记录真实运行结果，不以测试环境或历史快照代替生产验收。

## 执行规则

- 每家公司先记录来源、真实样本、dry-run 和字段候选数，完成生产库/API/页面三处验收后才标为已上线。
- 此处的“匹配”仅指使用 `company + external_job_id` 找到当前 `collector_feed` 在招岗位，不代表已经写入。
- 所有字段回填只补空值或无官方证据的历史值，不新增 ATS 岗位记录，不更新 `is_active` 或 `is_closed`。
- 本地 `.env.local` 的项目 ref 只能用于本轮环境记录，不能自行视为生产环境。

## 批次 0：来源矩阵和质量基线

执行时间：2026-08-28

命令：

```bash
pnpm run audit:company-source-matrix -- --out=output/company-source-matrix-current.json
```

结果：

| 项目 | 结果 |
| --- | ---: |
| 在招 `collector_feed` 岗位 | 48,981 |
| 活跃公司 | 75 |
| 岗位链接域名组 | 79 |
| 已归入来源族的公司 | 51 |
| 仍需来源探测的公司 | 24 |

已识别的来源族（按当前在招岗位量）：

| 来源族 | 公司数 | 在招岗位 | 分类依据 |
| --- | ---: | ---: | --- |
| Oracle HCM | 3 | 9,777 | 官方域名 / 已验证适配器 |
| Workday | 19 | 7,714 | 官方域名 |
| Apple 官方 API | 1 | 3,449 | 已验证适配器 |
| Greenhouse | 17 | 2,764 | 9 家连接器登记，8 家官方域名 |
| Ashby | 8 | 1,248 | 6 家连接器登记，1 家已验证适配器，1 家官方域名 |
| Phenom | 2 | 363 | 已验证适配器 |
| Lever | 1 | 267 | 连接器登记 |
| 自建官网/未分类 | 24 | 23,399 | 待源探测 |

注意：Stripe、Databricks、Datadog、Coinbase、Asana、Brex 等公司会提供品牌官网 canonical URL；来源矩阵以已验证连接器注册表优先，不能仅按 URL 域名把它们误判为自建站点。

## 批次 1：官方 ATS 先锋验收

### Greenhouse：Stripe

执行命令：

```bash
pnpm run sync:job-connector -- --company=Stripe --timeout-ms=20000
pnpm run backfill:connector-fields -- --company=Stripe
```

| 指标 | 结果 |
| --- | ---: |
| 官方接收 / 解析 | 577 / 577 |
| 目标地区标准化岗位 | 436 |
| 解析丢失 | 0 |
| 现有上游在招岗位 | 369 |
| 外部 ID 匹配 | 368 |
| 候选岗位 | 368 |
| 地点 / 工作方式 / 岗位类型 / 经验候选字段 | 368 / 83 / 125 / 351 |
| 薪资 / 截止日期候选字段 | 0 / 0 |
| 写入 | 0（dry-run） |

结论：Greenhouse 连接器和“只回填字段”的匹配规则可用。官网本次未提供可验证薪资或截止日期，因此保持为空。

#### Stripe 生产回填与验收

执行时间：2026-08-28

生产环境：`weqvdtdjdzmqflhwobec`（在美国服务器 `/opt/liorvix/.env.local` 中确认）。

先以 `--limit=20` 做生产抽样：20 条均保持在招，20 条经验字段和 2 条工作方式字段写入了 `verified` 官方证据；随后完成三处验收（生产数据库、公开 `/api/jobs`、20 个公开岗位页）后，才执行 `--all`。

```bash
JOBS_CONNECTOR_BACKFILL_WRITE_ENABLED=true \
  pnpm run backfill:connector-fields -- --company=Stripe --write --limit=20

JOBS_CONNECTOR_BACKFILL_WRITE_ENABLED=true \
  pnpm run backfill:connector-fields -- --company=Stripe --write --all
```

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 378（写入前后不变） |
| 官方接收 / 解析 | 577 / 577 |
| 外部 ID 匹配 | 377 |
| 首批写入 | 20 |
| 后续候选 / 写入 | 333 / 333 |
| 官方经验字段证据 | 360 |
| 官方工作方式字段证据 | 88 |
| 官方岗位类型字段证据 | 127 |
| 官方薪资 / 截止日期证据 | 0 / 0 |
| 公开 API 中经验 / 工作方式岗位 | 360 / 88 |
| 抽样公开岗位页 | 20 / 20 可访问 |

说明：首批预览时官方 board 有 578 条，后续全量写入时为 577 条，这是官网岗位自然变动；生产上游的 378 条岗位未因字段任务下架。官网没有明确薪资或截止日期时，保持为空是预期结果。

### Ashby：OpenAI

执行命令：

```bash
pnpm run sync:job-connector -- --company=OpenAI --timeout-ms=20000
pnpm run backfill:connector-fields -- --company=OpenAI
```

| 指标 | 结果 |
| --- | ---: |
| 官方接收 / 解析 | 743 / 743 |
| 目标地区标准化岗位 | 682 |
| 解析丢失 | 0 |
| 现有上游在招岗位 | 672 |
| 外部 ID 匹配 | 669 |
| 候选岗位 | 669 |
| 地点 / 工作方式 / 岗位类型 / 经验候选字段 | 669 / 453 / 669 / 403 |
| 薪资 / 截止日期候选字段 | 0 / 0 |
| 写入 | 0（dry-run） |

结论：Ashby 连接器和字段证据链可用；官网本次没有可验证的薪资或截止日期，保持为空。

#### OpenAI 生产回填与验收

执行时间：2026-08-28

生产环境：`weqvdtdjdzmqflhwobec`（在美国服务器 `/opt/liorvix/.env.local` 中确认）。

先以 `--limit=20` 做生产抽样：岗位数量、公开 API 字段和 20 个公开岗位页均通过验收后，才对剩余候选执行 `--all`。最终 dry-run 的候选数为 0。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 672（写入前后不变） |
| 官方接收 / 解析 | 742 / 742 |
| 外部 ID 匹配 | 669 |
| 首批写入 | 20 |
| 全量前剩余候选 | 632 |
| 全量后候选 | 0 |
| 官方经验字段证据 | 404 |
| 官方工作方式字段证据 | 454 |
| 官方岗位类型字段证据 | 669 |
| 官方薪资 / 截止日期证据 | 0 / 0 |
| 公开 API 中经验 / 工作方式 / 岗位类型岗位 | 405 / 456 / 669 |
| 抽样公开岗位页 | 20 / 20 可访问 |

说明：公开 API 中少量工作方式和经验字段来自既有记录，因此其数量可能高于本次带 `verified` 证据的字段数；本次写入只补官方源中存在的字段。官网没有明确薪资或截止日期时，保持为空是预期结果。

### Greenhouse：Databricks

#### Databricks 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 548（写入前后不变） |
| 官方接收 / 解析 | 842 / 842 |
| 外部 ID 匹配 | 546 |
| 候选岗位 | 479 |
| 首批 / 后续写入 | 20 / 459 |
| 全量后候选 | 0 |
| 官方经验 / 工作方式 / 岗位类型字段证据 | 445 / 40 / 212 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批公开岗位页验收 | 20 / 20 可访问 |
| 跨页公开 API 对账 | 445 / 445 条经验岗位返回 |

说明：写入后发现列表 API 只按 `created_at` 排序时会在同批导入的相同时间戳下产生跨页遗漏。已改为以 `created_at`、`id` 稳定排序并完成生产构建和健康检查；Databricks 的公开 API 漏岗数已从 5 变为 0。

### Greenhouse：Brex

#### Brex 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 275（写入前后不变） |
| 官方接收 / 解析 | 294 / 294 |
| 外部 ID 匹配 | 275 / 275 |
| 候选岗位 | 263 |
| 首批 / 后续写入 | 20 / 243 |
| 全量后候选 | 0 |
| 官方经验 / 工作方式 / 岗位类型字段证据 | 231 / 0 / 183 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批生产数据库、API、岗位页 | 20 / 20 / 20 通过 |

说明：Brex 官方源本次没有提供明确工作方式、薪资或截止日期，相关字段保持为空。

### Greenhouse：Datadog

#### Datadog 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 272（写入前后不变） |
| 官方接收 / 解析 | 449 / 449 |
| 外部 ID 匹配 | 269 / 272 |
| 候选岗位 | 232 |
| 首批 / 后续写入 | 20 / 212 |
| 全量后候选 | 0 |
| 官方经验 / 工作方式 / 岗位类型字段证据 | 202 / 55 / 138 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批生产数据库、API、岗位页 | 20 / 20 / 20 通过 |

说明：3 条现有上游岗位未能与本轮官方外部 ID 匹配，保持其原有字段和生命周期，未作任何下架或覆盖。

### Ashby：Ramp

#### Ramp 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 134（写入前后不变） |
| 官方接收 / 解析 | 136 / 136 |
| 外部 ID 匹配 | 134 / 134 |
| 候选岗位 | 133 |
| 首批 / 后续写入 | 20 / 113 |
| 全量后候选 | 0 |
| 首批工作方式 / 岗位类型 / 经验写入 | 20 / 20 / 15 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批生产数据库、API、岗位页 | 20 / 20 / 20 通过 |

说明：Ramp 官方 Ashby 数据明确提供工作方式和岗位类型；仅对存在明确年限要求的岗位写入经验字段。

### Greenhouse：Figma

#### Figma 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 123（写入前后不变） |
| 官方接收 / 解析 | 160 / 160 |
| 外部 ID 匹配 | 123 / 123 |
| 候选岗位 | 104 |
| 首批 / 后续写入 | 20 / 84 |
| 全量后候选 | 0 |
| 官方经验 / 工作方式 / 岗位类型字段证据 | 100 / 0 / 59 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批生产数据库、API、岗位页 | 20 / 20 / 20 通过 |

说明：Figma 官方 Greenhouse 源本次没有明确工作方式、薪资或截止日期，相关字段保持为空。

### Greenhouse：GitLab

#### GitLab 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 150（写入前后不变） |
| 官方接收 / 解析 | 217 / 217 |
| 外部 ID 匹配 | 149 / 150 |
| 候选岗位 | 147 |
| 首批 / 后续写入 | 20 / 127 |
| 全量后候选 | 0 |
| 官方经验 / 工作方式 / 岗位类型字段证据 | 15 / 149 / 96 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批生产数据库、API、岗位页 | 20 / 20 / 20 通过 |

说明：1 条现有上游岗位未能与本轮官方外部 ID 匹配，保持原有字段和生命周期，未作下架或覆盖。

### Greenhouse：Coinbase

#### Coinbase 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 149（写入前后不变） |
| 官方接收 / 解析 | 182 / 182 |
| 外部 ID 匹配 | 149 / 149 |
| 候选岗位 | 144 |
| 首批 / 后续写入 | 20 / 124 |
| 全量后候选 | 0 |
| 官方经验 / 工作方式 / 岗位类型字段证据 | 145 / 144 / 94 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批生产数据库、API、岗位页 | 20 / 20 / 20 通过 |

说明：验收统计窗口中出现 4 条同时间的既有更新；全部仍在招且公开 API、岗位页一致。本次回填仅按官方外部 ID 对候选岗位补字段。

### Greenhouse：Asana

#### Asana 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 78（写入前后不变） |
| 官方接收 / 解析 | 125 / 125 |
| 外部 ID 匹配 | 78 / 78 |
| 候选岗位 | 78 |
| 首批 / 后续写入 | 20 / 58 |
| 全量后候选 | 0 |
| 官方经验 / 工作方式 / 岗位类型字段证据 | 78 / 3 / 41 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批生产数据库、API、岗位页 | 20 / 20 / 20 通过 |

说明：官方列表中有 4 条当前未进入上游岗位库的岗位；本次字段回填不新增岗位，只处理已存在的 78 条岗位。

### Ashby：Cursor

#### Cursor 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 105（写入前后不变） |
| 官方接收 / 解析 | 120 / 120 |
| 外部 ID 匹配 | 105 / 105 |
| 候选岗位 | 101 |
| 首批 / 后续写入 | 20 / 81 |
| 全量后候选 | 0 |
| 官方经验 / 工作方式 / 岗位类型字段证据 | 53 / 105 / 105 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批生产数据库、API、岗位页 | 20 / 20 / 20 通过 |

说明：Cursor 官方 Ashby 数据完整提供工作方式与岗位类型；只有 53 条岗位包含可验证的明确经验要求。

### Ashby：Notion

#### Notion 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 82（写入前后不变） |
| 官方接收 / 解析 | 135 / 135 |
| 外部 ID 匹配 | 82 / 82 |
| 候选岗位 | 80 |
| 首批 / 后续写入 | 20 / 60 |
| 全量后候选 | 0 |
| 官方经验 / 工作方式 / 岗位类型字段证据 | 58 / 68 / 82 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批生产数据库、API、岗位页 | 20 / 20 / 20 通过 |

说明：Notion 官方 Ashby 源本次没有提供可验证的薪资或截止日期，相关字段保持为空。

### Ashby：Perplexity

#### Perplexity 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 91（写入前后不变） |
| 官方接收 / 解析 | 98 / 98 |
| 外部 ID 匹配 | 88 / 91 |
| 候选岗位 | 85 |
| 首批 / 后续写入 | 20 / 65 |
| 全量后候选 | 0 |
| 官方经验 / 工作方式 / 岗位类型字段证据 | 75 / 40 / 88 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批生产数据库、API、岗位页 | 20 / 20 / 20 通过 |

说明：3 条现有上游岗位未能与官方外部 ID 匹配，保留原有字段和生命周期，未作下架或覆盖。

### Ashby：Vanta

#### Vanta 生产回填与验收

执行时间：2026-08-28

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 95（写入前后不变） |
| 官方接收 / 解析 | 108 / 108 |
| 外部 ID 匹配 | 94 / 95 |
| 候选岗位 | 88 |
| 首批 / 后续写入 | 20 / 68 |
| 全量后候选 | 0 |
| 官方经验 / 工作方式 / 岗位类型字段证据 | 73 / 90 / 94 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 首批生产数据库、API、岗位页 | 20 / 20 / 20 通过 |

说明：1 条现有上游岗位未能与官方外部 ID 匹配，保留原有字段和生命周期，未作下架或覆盖。

### Lever：Palantir

执行命令：

```bash
pnpm run sync:job-connector -- --company=Palantir --timeout-ms=10000
```

结果：官方 Lever API 在当前执行出口 10 秒超时并被主动中止。

结论：标记为 `detail_unavailable/blocked`，未把超时理解为零岗位，未写入、未下架，也不扩大重试。待在生产服务器或另一合规网络出口完成真实样本和 dry-run 后再继续。

#### Palantir 生产回填与验收

执行时间：2026-08-28

生产环境：`weqvdtdjdzmqflhwobec`（美国服务器 `/opt/liorvix/.env.local`）。官方 Lever board 在生产出口可稳定读取，因此在已通过 20 条样本写入及三处抽样验收后，执行了全量只补缺失字段回填。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 278（写入前后不变） |
| 官方接收 / 解析 / 目标地区规范化 | 307 / 307 / 278 |
| 外部 ID 匹配 | 278 / 278 |
| 首批写入 | 20 |
| 全量前候选 / 写入 | 257 / 257 |
| 全量后 dry-run 候选 | 0 |
| 官方工作方式 / 岗位类型 / 经验字段证据 | 278 / 278 / 3 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 在招但被关闭的岗位 | 0 |
| 公开岗位详情页抽样 | 20 / 20 可访问 |

说明：Palantir 本轮官方 Lever 数据只为少量岗位提供了可验证的明确经验年限；没有官方薪资和截止日期字段，故保持为空。地点字段本轮没有缺失候选，未做覆盖。此前本地出口超时只作为一次网络观察记录，不代表官网无岗位或需要下架岗位。

### Greenhouse：Point72

#### Point72 生产回填与验收

执行时间：2026-08-28

来源登记：官方 Greenhouse board 为 `point72`，官方列表地址为 `https://boards-api.greenhouse.io/v1/boards/point72/jobs?content=true`，详情链接为 `https://boards.greenhouse.io/point72/jobs/{external_job_id}`。生产源与现有岗位通过 `external_job_id` 匹配；1 条已有上游岗位未能匹配，本轮保持其字段和生命周期不变。

真实样本审查曾发现两条实习岗位把公司介绍中的“more than 30 years of investing experience”误识别为候选人经验。已在通用解析器中排除此类公司历史语境，并新增回归测试；修复后该错误经验显示数为 0，才进行写入。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 169（写入前后不变） |
| 官方接收 / 解析 / 目标地区规范化 | 236 / 236 / 170 |
| 外部 ID 匹配 | 168 / 169 |
| 首批写入 | 20 |
| 全量前剩余候选 / 写入 | 110 / 110 |
| 全量后 dry-run 候选 | 0 |
| 官方岗位类型 / 经验 / 截止日期字段证据 | 46 / 109 / 1 |
| 官方薪资 / 工作方式字段证据 | 0 / 0 |
| 误识别的公司历史经验 | 0 |
| 在招但被关闭的岗位 | 0 |
| 公开 API / 公开岗位页抽样 | 169 条 / 20 / 20 可访问 |

说明：Point72 的官方 Greenhouse 列表没有明确工作方式和薪资字段；除一条官网正文明确标注的报名截止日期外，截止日期保持为空。字段缺失不影响岗位上架状态。

### Greenhouse：Reddit

#### Reddit 生产回填与验收

执行时间：2026-08-28

来源登记：官方 Greenhouse board 为 `reddit`，官方列表地址为 `https://boards-api.greenhouse.io/v1/boards/reddit/jobs?content=true`，详情链接为 `https://job-boards.greenhouse.io/reddit/jobs/{external_job_id}`。生产上游存在 147 条在招岗位，其中 145 条与本轮官方外部 ID 匹配；2 条未匹配岗位保持字段和生命周期不变。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 147（写入前后不变） |
| 官方接收 / 解析 / 目标地区规范化 | 152 / 152 / 148 |
| 外部 ID 匹配 | 145 / 147 |
| 首批写入 | 20 |
| 全量前剩余候选 / 写入 | 123 / 123 |
| 全量后 dry-run 候选 | 0 |
| 官方工作方式 / 岗位类型 / 经验字段证据 | 106 / 145 / 141 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 在招但被关闭的岗位 | 0 |
| 公开岗位详情页抽样 | 20 / 20 可访问 |

说明：真实样本中的 4-7 年、6-8 年、10+ 年、14+ 年等经验均来自岗位要求；远程字段来自官方地点/工作方式字段。官网本轮没有明确薪资或截止日期，因此保持为空。

### Greenhouse：Robinhood

执行时间：2026-08-28

来源登记：官方 Greenhouse board 为 `robinhood`，官方列表地址为 `https://boards-api.greenhouse.io/v1/boards/robinhood/jobs?content=true`，详情链接为 `https://boards.greenhouse.io/robinhood/jobs/{external_job_id}`。生产上游存在 124 条在招岗位，其中 121 条与本轮官方外部 ID 匹配；3 条未匹配岗位保留原有字段和生命周期，不作下架或覆盖。

真实样本确认 Greenhouse 的 `application_deadline` 是官方结构化字段，例如 `2026-09-12T14:29:37-04:00`。此前通用标准化层只允许官网正文截止日期，导致该字段被错误隐藏。现已限定放行 `source_type=official_ats` 且 `official_payload` 的结构化日期，并新增回归测试；普通上游时间戳和 2001 年异常日期仍会被拒绝。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 124（写入前后不变） |
| 官方接收 / 解析 / 目标地区规范化 | 129 / 129 / 127 |
| 外部 ID 匹配 | 121 / 124 |
| 首批写入 | 20 |
| 全量前剩余候选 / 写入 | 89 / 89 |
| 全量后 dry-run 候选 | 0 |
| 官方经验字段证据 | 92 |
| 官方 ATS 截止日期证据 | 10 |
| 异常截止日期 | 0 |
| 在招但被关闭的岗位 | 0 |
| 公开 API / 公开岗位页抽样 | 截止日期 9 条可见 / 20 / 20 可访问 |

说明：公开 API 默认目标地区范围内返回 92 条 Robinhood 岗位，其中 9 条有公开可见的官方截止日期；生产库中的第 10 条不在该默认公开地区结果中。薪资与工作方式没有本轮可回填的官方缺失字段，保持原状。

### Greenhouse：Twilio

执行时间：2026-08-28

来源登记：官方 Greenhouse board 为 `twilio`，官方列表地址为 `https://boards-api.greenhouse.io/v1/boards/twilio/jobs?content=true`，详情链接为 `https://job-boards.greenhouse.io/twilio/jobs/{external_job_id}`。生产上游有 93 条在招岗位，其中 92 条可通过官方外部 ID 匹配；未匹配的 1 条岗位保持既有字段和生命周期，不做下架或覆盖。

真实样本确认 Twilio 的薪资通常写在官方岗位正文中，且可能包含按地点区分的多个带币种区间。连接器只提取同时包含币种和金额的区间，保留最多四个官方区间；截止日期仅接受正文中明确标注的 application deadline，不从发布时间或普通描述推断。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 93（写入前后不变） |
| 官方接收 / 解析 / 目标地区规范化 | 144 / 144 / 97 |
| 外部 ID 匹配 | 92 / 93 |
| 首批写入 | 20 |
| 全量前剩余候选 / 写入 | 72 / 72 |
| 全量后 dry-run 候选 | 0 |
| 官方地点 / 工作方式 / 岗位类型字段证据 | 2 / 92 / 43 |
| 官方经验 / 薪资 / 截止日期字段证据 | 90 / 63 / 16 |
| 在招但被关闭的岗位 | 0 |
| 公开 API / 公开岗位页抽样 | 薪资、截止日期、经验均可见 / 20 / 20 可访问 |

说明：Twilio 的官网没有为每个岗位提供结构化地点字段，因此只对能明确验证的字段写入；字段为空不等于岗位失效。生产数据库、公开 `/api/jobs`、公开 `/api/jobs/{id}` 和 20 个实际岗位页均已完成抽样核验。

### Greenhouse：Discord

执行时间：2026-08-28

来源登记：官方 Greenhouse board 为 `discord`，官方列表地址为 `https://boards-api.greenhouse.io/v1/boards/discord/jobs?content=true`，详情链接为 `https://job-boards.greenhouse.io/discord/jobs/{external_job_id}`。官方与生产均为 52 条在招岗位，全部通过官方外部 ID 精确匹配。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 52（写入前后不变） |
| 官方接收 / 解析 / 目标地区规范化 | 52 / 52 / 52 |
| 外部 ID 匹配 | 52 / 52 |
| 首批 / 后续写入 | 20 / 32 |
| 全量后 dry-run 候选 | 0 |
| 官方地点 / 工作方式 / 岗位类型字段证据 | 52 / 7 / 34 |
| 官方经验 / 薪资 / 截止日期字段证据 | 51 / 52 / 0 |
| 在招但被关闭的岗位 | 0 |
| 公开 API / 公开岗位页抽样 | 薪资与经验可见 / 20 / 20 可访问 |

说明：Discord 的薪资来自官方 Greenhouse 内容中的带币种范围；官网本轮没有明确截止日期，故全部保持为空。地点字段已存在且可验证，本轮不覆盖原值。数据库、公开 API 和实际岗位页的首批抽样均通过。

### Greenhouse：TPG

执行时间：2026-08-28

来源登记：官方 Greenhouse board 为 `tpgcareers`，官方列表地址为 `https://boards-api.greenhouse.io/v1/boards/tpgcareers/jobs?content=true`，详情链接为 `https://job-boards.greenhouse.io/tpgcareers/jobs/{external_job_id}`。该公司官方与生产均只有 17 条在招岗位，因此首批样本覆盖了全部 17 条，而不是拆成不必要的两次写入。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 17（写入前后不变） |
| 官方接收 / 解析 / 目标地区规范化 | 17 / 17 / 17 |
| 外部 ID 匹配 | 17 / 17 |
| 首批 / 后续写入 | 17 / 0 |
| 全量后 dry-run 候选 | 0 |
| 官方地点 / 工作方式 / 岗位类型字段证据 | 既有可验证地点未覆盖 / 0 / 13 |
| 官方经验 / 薪资 / 截止日期字段证据 | 15 / 11 / 0 |
| 在招但被关闭的岗位 | 0 |
| 公开 API / 公开岗位页抽样 | 薪资与经验可见 / 17 / 17 可访问 |

说明：TPG 官方源没有明确工作方式或截止日期，相关字段保持为空。现有地点字段未缺失，本轮不覆盖；经验、薪资和岗位类型仅在官方内容明确给出时写入。公司官网招聘页和全部官方详情页均可访问。

### Greenhouse：Bridgewater Associates

执行时间：2026-08-28

来源登记：官方 Greenhouse board 为 `bridgewater89`，官方列表地址为 `https://boards-api.greenhouse.io/v1/boards/bridgewater89/jobs?content=true`，详情链接为 `https://job-boards.greenhouse.io/bridgewater89/jobs/{external_job_id}`。官方与生产均为 16 条在招岗位，全部外部 ID 精确匹配；首批覆盖全部 14 条有待补官方字段的岗位。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 16（写入前后不变） |
| 官方接收 / 解析 / 目标地区规范化 | 16 / 16 / 16 |
| 外部 ID 匹配 | 16 / 16 |
| 首批 / 后续写入 | 14 / 0 |
| 全量后 dry-run 候选 | 0 |
| 官方地点 / 工作方式 / 岗位类型字段证据 | 2 / 2 / 14 |
| 官方经验 / 薪资 / 截止日期字段证据 | 12 / 7 / 0 |
| 在招但被关闭的岗位 | 0 |
| 公开 API / 公开岗位页抽样 | 薪资可见 / 16 / 16 可访问 |

说明：Bridgewater 官方源没有明确截止日期；工作方式和地点仅保留已有的可验证值。经验、薪资和岗位类型只在官方内容明确给出时写入，未因字段缺失改变岗位状态。

### Greenhouse：General Atlantic

执行时间：2026-08-28

来源登记：官方 Greenhouse board 为 `generalatlantic`，官方列表地址为 `https://boards-api.greenhouse.io/v1/boards/generalatlantic/jobs?content=true`，详情链接为 `https://job-boards.greenhouse.io/generalatlantic/jobs/{external_job_id}`。官方源有 15 条，其中 3 条不在平台目标地区范围；进入目标地区的 12 条与生产岗位全部精确匹配。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 12（写入前后不变） |
| 官方接收 / 解析 / 目标地区规范化 | 15 / 15 / 12 |
| 外部 ID 匹配 | 12 / 12 |
| 首批 / 后续写入 | 9 / 0 |
| 全量后 dry-run 候选 | 0 |
| 官方地点 / 工作方式 / 岗位类型字段证据 | 既有可验证地点未覆盖 / 0 / 6 |
| 官方经验 / 薪资 / 截止日期字段证据 | 9 / 2 / 0 |
| 在招但被关闭的岗位 | 0 |
| 公开 API / 公开岗位页抽样 | 薪资与经验可见 / 12 / 12 可访问 |

说明：地区过滤只用于字段回填的目标范围，不改变官网或生产岗位生命周期。官网没有明确工作方式和截止日期，故不作推断填写。

### Ashby：Runway

执行时间：2026-08-28

来源登记：Runway 的官方岗位同时分布在 Ashby 的 `runway`（4 条）和 `runway-ml`（42 条）两个 board。连接器已改为聚合多个同公司的官方 board 后按外部 ID 去重，避免遗漏；生产 46 条岗位中，目标地区的 45 条与官方岗位匹配，未匹配的 1 条保留原字段和生命周期。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 46（写入前后不变） |
| 官方接收 / 解析 / 目标地区规范化 | 46 / 46 / 45 |
| 外部 ID 匹配 | 45 / 46 |
| 首批 / 后续写入 | 20 / 24 |
| 全量后 dry-run 候选 | 0 |
| 官方工作方式 / 岗位类型 / 经验字段证据 | 45 / 45 / 34 |
| 官方薪资 / 截止日期字段证据 | 0 / 0 |
| 在招但被关闭的岗位 | 0 |
| 公开岗位页抽样 | 20 / 20 可访问 |

说明：官方源本轮没有明确薪资和截止日期，相关字段保持为空。多 board 仅影响官方数据聚合和字段回填，不改变当前岗位 ID 或上下架状态。

### Ashby：Linear

执行时间：2026-08-28

来源登记：官方 Ashby board 为 `linear`，列表地址为 `https://api.ashbyhq.com/posting-api/job-board/linear`，官方职位链接为 `https://jobs.ashbyhq.com/linear/{external_job_id}`。官方列表收到 29 条，23 条进入平台目标地区范围，且与生产中的 23 条在招 `collector_feed` 岗位全部按官方外部 ID 精确匹配。

| 指标 | 生产验收结果 |
| --- | ---: |
| 生产在招 `collector_feed` 岗位 | 23（写入前后不变） |
| 官方接收 / 解析 / 目标地区规范化 | 29 / 29 / 23 |
| 外部 ID 匹配 | 23 / 23 |
| 首批 / 后续写入 | 20 / 3 |
| 全量后 dry-run 候选 | 0 |
| 官方地点 / 工作方式 / 岗位类型字段证据 | 23 / 23 / 23 |
| 官方经验 / 薪资 / 截止日期字段证据 | 19 / 0 / 0 |
| 在招但被关闭的岗位 | 0 |
| 公开 API / 公开岗位页抽样 | 20 / 20 可访问 |

说明：Linear 的官方内容为 19 条岗位提供了明确的工作经验要求；官方源没有薪资或截止日期，相关字段保持为空。首批写入后，生产数据库、公开 API 和岗位页均通过抽样；随后才回填剩余 3 条。新增 `pnpm run audit:connector-backfill -- --company=<公司>` 作为可复用的只读验收命令，输出已验证字段覆盖和可抽样的岗位 ID。

## 已完成的防呆实现

- `pnpm run audit:company-source-matrix`：在数据库端聚合 75 家公司的来源域名、有效来源族和六项字段证据覆盖率；报告附环境 project ref。
- `pnpm run sync:job-connector -- --company=<公司>`：dry-run 现在额外输出六项字段覆盖率、现有 `collector_feed` 数量和外部 ID 匹配数。
- `pnpm run backfill:connector-fields -- --company=<公司>`：默认只预览候选字段；写入必须同时传 `--write` 与 `JOBS_CONNECTOR_BACKFILL_WRITE_ENABLED=true`。
- `pnpm run audit:connector-backfill -- --company=<公司>`：只读汇总生产在招岗位的字段值、证据状态和抽样岗位 ID，用于首批写入后的数据库/API/页面三处验收。
- 连接器把岗位类型的官方字段证据写入 `field_evidence`，避免“字段已经推导但质量审计仍显示未验证”。
- 岗位列表默认排序以 `created_at`、`id` 作为稳定分页键；同批上游导入的岗位时间戳相同时，跨页请求不会重复或漏掉岗位，避免出现“数据库有经验字段但列表 API 没返回该岗位”的假象。

## 生产写入前的固定步骤

以下步骤必须在确认的生产环境执行，且仅对已完成 dry-run 的单家公司进行：

```bash
# 1. 确认当前环境与生产 project ref；此命令不写入。
pnpm run backfill:connector-fields -- --company=Stripe

# 2. 复查 official / matched / candidate 数量后，先对固定的 20 条岗位抽样写入。
JOBS_CONNECTOR_BACKFILL_WRITE_ENABLED=true pnpm run backfill:connector-fields -- --company=Stripe --write --limit=20

# 3. 重新生成来源矩阵，并从生产数据库、/api/jobs、实际岗位页抽样核验。
pnpm run audit:company-source-matrix -- --out=output/company-source-matrix-production.json
```

首批 20 条完成三处验收后，才允许显式使用 `--all` 回填该公司的其余候选岗位。Stripe 和 OpenAI 均已完成该流程。

## 下一轮顺序

1. 进入批次 1，以 Boston Consulting Group 作为 Phenom 先锋公司；先完成官方列表、分页、详情、外部 ID 和 20 条样本验证。
2. BCG 通过完整生产验收后，再处理 Oliver Wyman；任何解析、详情或匹配异常只暂停当前公司。
3. Phenom 族稳定后，按计划以 Lazard 进入 Oracle HCM 先锋验证，再启动 Workday 的 Houlihan Lokey。

## 批次 1：Phenom - BCG 灰度验收

执行时间：2026-08-28（进行中）

来源登记：BCG 官方列表为 `https://careers.bcg.com/global/en/search-results`，列表数据位于 `phApp.ddo.eagerLoadRefineSearch.data.jobs`，详情数据位于 `phApp.ddo.jobDetail.data.job`，稳定官方岗位 ID 为 `jobSeqNo`，详情 URL 为 `https://careers.bcg.com/global/en/job/{jobSeqNo}`。

本轮已完成分页、稳定 ID 去重、多地点合并和“只对当前生产库匹配岗位请求详情”的低并发详情抓取。生产 dry-run 记录为：在招 `collector_feed` 250 条、官方列表接收 894 条、稳定 ID 去重后约 718 条、外部 ID 匹配 192 条、详情请求 199 条且请求失败 0 条。已先对 20 条进行只补缺失字段的灰度写入；本条记录不将其标记为生产验收完成。

新增边界：BCG 官方详情 HTML 会包含静态的 `the job you are trying to apply for has been filled` 组件，即使 `phApp.ddo.jobDetail.data.job` 仍有与 URL 匹配的官方岗位数据。真实 dry-run 因此发现不能把这句文案单独当作关闭证据。连接器现以匹配的官方详情 payload 为优先依据；仅在缺少匹配详情数据且存在关闭页时记为 `detail_closed`。前一种情况记为 `detail_ambiguous` 供审计，仍可作为字段证据；两种情况都不会由字段任务改变 `collector_feed` 的上下架状态。

待完成：将本地修复部署到生产服务器，重新运行 BCG dry-run，完成 20 条数据库/API/页面验收后才决定是否执行 `--all`。BCG 完成前不启动 Oliver Wyman。

### BCG 修复后只读复核

执行时间：2026-08-28

本地已配置环境的只读 dry-run 在修复后输出如下。此结果只证明连接器和当前配置的数据库可用，尚不替代生产环境验收。

| 指标 | 结果 |
| --- | ---: |
| 官方列表接收 / 稳定 ID 解析 | 894 / 719 |
| 列表重复外部 ID | 175 |
| 当前在招 `collector_feed` / 匹配外部 ID | 225 / 188 |
| 详情请求 / 失败 / 明确关闭 | 188 / 0 / 0 |
| 含静态过期组件但有匹配详情 | 188 |
| 地点 / 工作方式 / 岗位类型字段覆盖 | 201 / 142 / 201 |
| 经验 / 薪资 / 截止日期字段覆盖 | 160 / 23 / 3 |

结论：详情 payload 优先规则已确认有效，未再将匹配岗位误判为关闭。下一步只能在已确认的生产 Supabase 环境运行相同的 dry-run 和首批 20 条写入。

### BCG 字段回填 dry-run（测试环境）

执行时间：2026-08-28

环境：`bonvalewfehgarshxkyl`。该 project ref 与生产记录中的 `weqvdtdjdzmqflhwobec` 不同，故本次结果严禁用于宣称已上线，也没有执行写入。

| 指标 | 结果 |
| --- | ---: |
| 当前在招 `collector_feed` / 外部 ID 匹配 | 225 / 181 |
| 官方接收 / 解析 / 目标地区规范化 | 894 / 719 / 193 |
| 详情请求 / 失败 / 明确关闭 / 静态组件歧义 | 181 / 0 / 0 / 181 |
| 可回填岗位 | 181 |
| 地点 / 工作方式 / 岗位类型候选 | 181 / 139 / 181 |
| 经验 / 薪资 / 截止日期候选 | 156 / 24 / 3 |

首批生产验收将固定为该公司 job ID 升序的前 20 个候选，但必须先在生产服务器的 `/opt/liorvix/.env.local` 重新计算候选数和样本，不能复制本测试环境的岗位 ID。

### BCG 生产灰度与截断页面修复

执行时间：2026-08-28

生产环境 `weqvdtdjdzmqflhwobec` 的 dry-run 显示 246 条在招岗位、186 条官方外部 ID 匹配、171 条候选。首批 20 条已只补缺失字段写入：工作方式 15、岗位类型 20、经验 17、薪资 1，写入前后在招岗位数量仍为 246。

首个公网详情验收发现 `fetchSafeExternalPage` 的页面长度限制可在 BCG 的完整 `jobSeqNo` 之前截断 JSON；旧的“完整 ID 匹配”保护会退化为关闭误判。现已改为在完整解析失败时识别官方 `phApp.ddo.jobDetail.data.job` 信封作为有效详情证据，并新增回归测试。后续继续详情验收前必须部署该修复，并复核首个受影响岗位的状态。

进一步核验发现安全抓取返回的是去除脚本后的纯文本，因此 BCG 的详情数据包不会传递到通用链接检查。最终策略收紧为：已登记的 Phenom 公司在官方 host 的 `/job/{id}` URL 不再由通用 `filled` 文案关闭；其状态仍由官方连接器和上游关闭事件管理。恢复操作只能针对明确岗位 ID，并显式声明该已登记 Phenom 规则，禁止批量恢复。

### BCG 生产回填与首轮验收

执行时间：2026-08-28

生产服务器：`/opt/liorvix`，Supabase project ref：`weqvdtdjdzmqflhwobec`。

部署前，服务器完成 `pnpm run ts-check`、`pnpm run test:job-connectors`、`pnpm run test:job-standard-fields`、`pnpm run test:job-maintenance-content` 和 `pnpm run test:job-content`。所有 Greenhouse、Ashby、Lever、Phenom fixture 均通过。随后构建并重启 `liorvix`，本机和公网 `https://liorvix.com/api/health` 都返回 `{"status":"ok"}`。

生产 dry-run 初始快照：246 条在招 `collector_feed` 岗位，186 条官方外部 ID 匹配，171 条候选，详情请求 193 条、失败 0。首批 20 条写入后，公开岗位详情 API 的 20/20 样本均返回 200；示例岗位 `10219` 公开 API 显示仍在招，且地点、工作方式、岗位类型和经验字段均可见。该岗位曾被旧通用 HTML 判断误关，已使用严格限定的 Phenom 恢复流程恢复；新规则已发布并复测。

全量回填分多次处理官网在分页/去重过程中的实时变化。每次只补缺失或未验证字段，不修改 `is_active` / `is_closed`；生产在招岗位数始终为 246。最后生产字段审计为：

| 字段 | 有值 / 已验证 |
| --- | ---: |
| 地点 | 246 / 246 |
| 工作方式 | 173 / 173 |
| 岗位类型 | 236 / 236 |
| 经验 | 195 / 195 |
| 薪资 | 27 / 27 |
| 截止日期 | 3 / 3 |

说明：官网实时分页使紧邻的 dry-run 会出现不同的外部 ID 匹配集合，无法将瞬时候选数作为完成的唯一判断。因此以字段证据覆盖、零详情失败、246 条岗位数量不下降、20 条公开详情验收和连续同步观察共同作为完成证据。BCG 现进入三次同步观察期；在观察完成前，Oliver Wyman 仅可进行只读官方源登记和 fixture 准备，不得写生产数据。

### 已处理公司回归保护

执行时间：2026-08-28

本轮新增 `pnpm run audit:connector-regression`，覆盖生产 `collector_feed` 中的全部公司，而不是只覆盖连接器登记表。它从生产库读取每家公司的在招数量、关闭数量和去重外部岗位 ID，按稳定 `id` 顺序分页并生成可保存的基线；后续任何一家公司执行 dry-run、灰度或全量回填后，都必须用 `--baseline=<基线文件>` 复核。若在招数量或外部 ID 覆盖低于基线，命令直接失败，先暂停当前公司，不允许继续发布。

该回归检查只保护岗位目录，不把官网岗位自然变化误报为字段错误：基线应在同一同步周期保存，观察期间以“岗位数量没有因字段任务下降”为准。字段任务仍只更新缺失或未验证字段，绝不覆盖其他已完成公司的已验证证据，也不修改岗位上下架状态。

生产基线文件：`/opt/liorvix/output/connector-regression-production.json`，生成时间 `2026-08-28T05:05:29Z`，目标 Supabase `weqvdtdjdzmqflhwobec`，覆盖 75 家公司。随后使用同一文件再次执行回归检查，结果 `regressions: []`。该基线包含 Apple、Oliver Wyman、Lazard、Morgan Stanley 以及此前已处理的 ATS 公司，因此后续新公司接入不会遗漏历史来源。

### BCG 三次同步观察

2026-08-28 连续执行三次生产只读同步，均未传入 `--write`：

| 观察 | 在招岗位 | 详情失败 | 明确关闭 | 字段异常 |
| --- | ---: | ---: | ---: | ---: |
| 第 1 次 | 246 | 0 | 0 | 0 |
| 第 2 次 | 246 | 0 | 0 | 0 |
| 第 3 次 | 246 | 0 | 0 | 0 |

三次均保持岗位数量不下降，Phenom 详情 payload 与静态过期组件的处理稳定。BCG 达到“连续三个同步周期无异常下降”的观察门槛；后续公司仍必须使用自己的来源登记、20 条真实样本和回归基线，不得把 BCG 的字段路径或数量假设复制给其他公司。

### Workday：Houlihan Lokey 先锋回填与部署验收

执行时间：2026-08-29

来源登记：官方 Workday 详情地址为 `https://hl.wd1.myworkdayjobs.com/en-US/Campus/job/...`，生产中当前有 7 条在招 `collector_feed` 岗位。Workday 页面在安全抓取器中可能返回 SPA shell，本轮使用同一租户的公开 CXS 详情 JSON 读取岗位正文、地点、岗位类型、薪资及可用的结构化字段；不把正文中的语义描述当作工作方式或经验年限。

生产环境：美国服务器 `/opt/liorvix`，Supabase project ref：`weqvdtdjdzmqflhwobec`。首次 dry-run 对 7/7 条详情抓取成功，0 失败、0 明确关闭。复核发现旧逻辑将 21730、21731 的正文或历史值写成 `On-site`，并将 `Class of 2027` 岗位误归为实习/社招；已使用公司限定修复脚本清理工作方式和经验字段，并按官方岗位标题修正类型。

| 指标 | 生产验收结果 |
| --- | ---: |
| 在招岗位（修复前 / 修复后） | 7 / 7 |
| 官方详情抓取 / 失败 | 7 / 0 |
| 地点有值 / 已验证 | 7 / 7 |
| 岗位类型有值 / 已验证 | 7 / 7（3 实习、4 校招） |
| 工作方式有值 / 已验证 | 0 / 0 |
| 经验有值 / 已验证 | 0 / 0 |
| 薪资有值 / 已验证 | 3 / 3 |
| 截止日期有值 / 已验证 | 0 / 0 |
| 公网岗位详情 API 抽样 | 7 / 7 返回 200 |

官网 CXS 对这 7 条岗位没有提供 `jobLocationType`、工作方式、候选人经验年限或截止日期，因此对应字段保持空并标记为待复核，不使用正文中的“remote/office”、公司成立年限或标题年份推断。`Class of 2027` 和 `2026 Graduate` 统一为校招；`Off-Cycle Intern` 与 `Summer Financial Analyst` 统一为实习。

本轮通用修复包括：Workday CXS 到结构化 JobPosting 的截止日期字段兼容（`postingEndDate`、`validThrough`、`applicationDeadline`、`closingDate`、`expirationDate`、`endDate`），以及 `remoteType`/`locationType` 等明确结构化工作方式字段的保留。生产发布前通过岗位标准字段、详情内容、连接器和 TypeScript 检查；构建时清理服务器残留旧路由和备份目录，服务重启后本机与公网 `https://liorvix.com/api/health` 均返回 `{"status":"ok"}`。

全公司回归使用 `/opt/liorvix/output/connector-regression-production.json`，覆盖生产 75 家公司，结果 `regressions: []`。本轮只更新 Houlihan 缺失或已确认错误的字段，没有改变任何岗位上下架状态。Houlihan 作为低量先锋通过首轮验收；下一步进入 Bain Capital 前，仍需为其独立确认 Workday host、tenant、站点、稳定 ID 和真实样本。

### Workday：Bain Capital、Apollo、Carlyle、Adobe 生产回填

执行时间：2026-08-30

生产服务器：美国服务器 `/opt/liorvix`，Supabase project ref `weqvdtdjdzmqflhwobec`。本轮先重新发布安全版回填脚本并校验哈希，确认 `--write` 受 `JOB_BACKFILL_WRITE_ENABLED=true` 双重保护，支持 `--company`、`--limit`、`--after-id`；随后用同一生产回归基线检查全部 75 家公司，所有阶段均为 `regressions: []`。

| 公司 | 在招岗位 | 官方详情成功 | 跳过/待复核 | 地点 | 岗位类型 | 经验 | 薪资 | 截止日期 | 工作方式 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Bain Capital | 22 | 22 | 0 | 22 | 22 | 21 | 20 | 0 | 0 |
| Apollo Global Management | 33 | 32 | 1（22313 无正文） | 32 | 32 | 27 | 13 | 0 | 0 |
| The Carlyle Group | 63 | 62 | 1 无正文、1 无缺失字段 | 62 | 62 | 59 | 41 | 0 | 29 |
| Adobe | 81 | 77 | 4 无正文 | 77 | 77 | 58 | 48 | 1 | 1 |

所有写入均只补缺失或未验证字段，未修改 `is_active` / `is_closed`。Bain 的 21714 已校正为校招，21711 补充官网 `5+ years`；Apollo 的 22334、22335 已清空公司简介中的 `over 30 years of proven expertise` 误识别经验并标记 `pending_recheck`。Carlyle 的“minimum of 4 and up to 8 years”已解析为最低 4、最高 8；Adobe 的“6–9 month roadmap”不再被识别为经验年限。

本轮发现并修复两项通用脚本问题：

- 证据回填字段名与数据库列名不一致，导致 `region` / `salary_range` 已写入但 `field_evidence.fields.location` / `salary` 未更新；现已统一映射，并让已有值但证据非 `verified` 的岗位重新进入详情回填。
- 长 Workday 正文中的月份区间可能是 roadmap、contract 或 eligibility window；现要求附近有明确经验语义，并排除这些周期表达，避免产生 0.5–0.75 年等假经验。

Adobe 的 4 条无正文、Apollo 的 22313、Carlyle 的 22377 等岗位保留在招状态，字段保持空或待复核，不因详情不可用下架。下一步进入剩余 Workday 公司时继续使用低并发、20 条样本验收、公司限定回填和全公司回归基线。

### Workday：PIMCO 生产回填与完成验收

执行时间：2026-08-30

来源登记：PIMCO 官方 Workday 地址为 `https://pimco.wd1.myworkdayjobs.com/pimco-careers`。本轮只处理生产 `collector_feed` 中公司名为 PIMCO 的在招岗位，详情证据来自每条岗位自己的官方 Workday URL；不使用第三方聚合页或模型推断。

生产环境：美国服务器 `/opt/liorvix`，Supabase project ref `weqvdtdjdzmqflhwobec`。为避免一次请求过多，先按岗位 ID 升序完成首批 20 条，再以 `--after-id=9158` 分段处理剩余 97 条。两段均使用并发 2，写入前先 dry-run；写入开关同时要求 `--write` 和 `JOB_BACKFILL_WRITE_ENABLED=true`。

| 指标 | 生产验收结果 |
| --- | ---: |
| 在招岗位 | 117 |
| 首批 dry-run / 写入 | 20 / 20 |
| 剩余 dry-run / 写入 | 97 / 97 |
| 官方详情抓取失败 | 0 |
| 地点有值 / 已验证 | 117 / 117 |
| 岗位类型有值 / 已验证 | 116 / 116（1 条保持未知） |
| 经验有值 / 已验证 | 83 / 83 |
| 薪资有值 / 已验证 | 64 / 64 |
| 截止日期有值 / 已验证 | 7 / 7 |
| 工作方式有值 / 已验证 | 0 / 0 |
| 经验异常值（超过 30 年） | 0 |
| 在招岗位状态 | 117 条均 `is_active=true` 且 `is_closed=false` |

空字段是官方 Workday 没有提供可验证值时的预期结果，尤其是工作方式；不会用正文中的叙述、公司成立年限或标题年份填充。所有写入只补缺失或未验证字段，未改变岗位上下架状态。生产库覆盖率通过 `audit:connector-backfill --company="PIMCO"` 核对，抽样公网 `/api/jobs` 与 `/api/jobs/{id}` 均返回官方链接、地点、经验和薪资字段。

全公司回归命令：

```bash
pnpm run audit:connector-regression -- --out=output/connector-regression-after-pimco.json --baseline=output/connector-regression-production.json --strict
```

结果：覆盖生产 75 家公司，`regressions: []`。PIMCO 本轮字段回填已完成；后续仍需按运行手册观察常规同步，字段任务本身不得因缺少官方字段而下架岗位。下一家公司按岗位量顺序为 Blackstone。

### Workday：Blackstone 生产回填与完成验收

执行时间：2026-08-30

来源登记：Blackstone 官方 Workday 地址为 `https://blackstone.wd1.myworkdayjobs.com/en-US/Blackstone_Careers`。本轮只处理生产 `collector_feed` 中公司名为 Blackstone 的在招岗位，详情证据来自每条岗位自己的官方 Workday URL；不使用第三方聚合页或模型推断。

生产环境：美国服务器 `/opt/liorvix`，Supabase project ref `weqvdtdjdzmqflhwobec`。先按岗位 ID 升序完成 20 条样本 dry-run 和灰度写入，再处理其余 119 条。第二段初次写入遭遇 Workday HTTP 429，成功写入 45 条后暂停；回填脚本新增可配置请求间隔和 408/425/429/5xx 退避重试后，以并发 1、请求间隔 1.2 秒重新执行，最终又写入 72 条，0 失败。3 条官方页面没有公开正文，44 条详情没有新增字段，均保留待复核。

| 指标 | 生产验收结果 |
| --- | ---: |
| 在招岗位 | 139 |
| 首批样本写入 | 20 / 20 |
| 其余岗位成功写入 | 117（45 + 72） |
| 官方详情失败 | 0（3 条无公开正文，44 条无新增字段） |
| 地点有值 / 已验证 | 139 / 139 |
| 岗位类型有值 / 已验证 | 136 / 136 |
| 经验有值 / 已验证 | 126 / 126 |
| 薪资有值 / 已验证 | 109 / 109 |
| 截止日期有值 / 已验证 | 0 / 0 |
| 工作方式有值 / 已验证 | 0 / 0 |
| 经验异常值（超过 30 年） | 0 |
| 在招岗位状态 | 139 条均 `is_active=true` 且 `is_closed=false` |

空的截止日期和工作方式是官方 Workday 没有提供可验证结构化字段的预期结果。所有写入均只补缺失或未验证字段，没有改变岗位上下架状态。生产库覆盖率通过 `audit:connector-backfill --company="Blackstone"` 核对；抽样公网 `/api/jobs/17348` 返回 200，并返回官方链接、地点、经验、薪资和字段证据。

全公司回归命令：

```bash
pnpm run audit:connector-regression -- --out=output/connector-regression-after-blackstone.json --baseline=output/connector-regression-production.json --strict
```

结果：覆盖生产 75 家公司，`regressions: []`；服务 `liorvix` active，本机 `/api/health` 返回 `{"status":"ok"}`。Blackstone 本轮字段回填已完成，后续按运行手册进入常规同步观察。下一家公司按岗位量顺序为 Barclays。

### Workday：Barclays 生产回填与完成验收

执行时间：2026-08-30

来源登记：Barclays 官方 Workday 地址为 `https://barclays.wd3.myworkdayjobs.com/External_Career_Site_Barclays`。本轮只处理生产 `collector_feed` 中公司名为 Barclays 的在招岗位，详情证据来自每条岗位自己的官方 Workday URL；不使用第三方聚合页或模型推断。

生产环境：美国服务器 `/opt/liorvix`，Supabase project ref `weqvdtdjdzmqflhwobec`。先按岗位 ID 升序完成 20 条样本 dry-run 和灰度写入，再以 `--after-id=13789` 分段处理剩余候选。两段均使用并发 1、请求间隔 1.2 秒，写入开关同时要求 `--write` 和 `JOB_BACKFILL_WRITE_ENABLED=true`。

| 指标 | 生产验收结果 |
| --- | ---: |
| 在招岗位 | 158 |
| 首批候选 / 详情成功 / 写入 | 20 / 19 / 19 |
| 剩余候选 / 详情成功 / 写入 | 138 / 123 / 123 |
| 跳过 | 15（12 条无公开正文、3 条无新增字段） |
| 失败 | 0 |
| 地点有值 / 已验证 | 158 / 158 |
| 岗位类型有值 / 已验证 | 146 / 144 |
| 经验有值 / 已验证 | 15 / 14 |
| 薪资有值 / 已验证 | 0 / 0 |
| 截止日期有值 / 已验证 | 74 / 74 |
| 工作方式有值 / 已验证 | 1 / 1 |
| 在招岗位状态 | 158 条均 `is_active=true` 且 `is_closed=false` |

经验字段复核：岗位 `13695`（Banking Analyst Summer Internship Program 2027）官方页面没有候选人工作年限，保持空；岗位 `13773`（Banking Associate Graduate Program 2027）官方页面明确为 `Entry Level`，标准化为 `0–1 年`。另发现 2 条历史记录残留“verified”经验证据但没有字段值，已修正审计脚本使其不再计入已验证；岗位数据保持空，未改变生命周期。

所有写入均只补缺失或未验证字段，未修改 `is_active` / `is_closed`。详情不可用只进入待复核，不视为岗位关闭。生产库覆盖率通过 `audit:connector-backfill --company="Barclays"` 核对；公网 `/api/jobs/13695`、`/api/jobs/13773` 均返回 200 且仍在招，字段与官方详情一致。服务 `liorvix` active，公网 `/api/health` 返回 `{"status":"ok"}`。

全公司回归命令：

```bash
pnpm run audit:connector-regression -- --out=output/connector-regression-after-barclays.json --baseline=output/connector-regression-production.json --strict
```

结果：`company_count: 75`，`regressions: []`。Barclays 本轮字段回填完成，进入常规同步观察；下一家公司按岗位量顺序为 Ares Management。

### Workday：Ares Management 生产回填与完成验收

执行时间：2026-08-31

来源登记：Ares Management 官方 Workday 地址为 `https://aresmgmt.wd1.myworkdayjobs.com/en-US/External`。生产岗位 URL 的官方 host 为 `aresmgmt.wd1.myworkdayjobs.com`，tenant 为 `aresmgmt`，site 为 `External`；稳定岗位标识由 Workday URL 中的 requisition 标识（例如 `R8010-1`）和整条官方岗位路径共同保留。本轮没有复制其他 Workday 公司的 URL、字段路径或岗位数量。

生产环境：美国服务器 `43.172.117.125`，项目目录 `/opt/liorvix`，Supabase project ref `weqvdtdjdzmqflhwobec`。服务器 `.env.local` 为 `root:root`、权限 `600`，本轮数据库命令使用 `sudo -n` 显式加载该生产文件，未修改权限、环境文件或密钥。

首批按生产库岗位 ID 升序处理，20 条 dry-run 全部详情成功；写入 20 条，失败 0。写入后反查确认最后处理 ID 为 `21464`，因此剩余批次使用同一个 `--after-id=21464`，没有猜测游标。

| 指标 | 生产验收结果 |
| --- | ---: |
| 在招 `collector_feed` 岗位 | 181 |
| 首批 dry-run / 写入 | 20 / 20 |
| 剩余 dry-run 候选 / 详情成功 / 写入 | 161 / 147 / 147 |
| 跳过 | 14（5 条无公开正文、9 条无新增字段） |
| 失败 | 0 |
| 地点有值 / 有值且 verified | 181 / 181 |
| 岗位类型有值 / 有值且 verified | 176 / 176 |
| 经验有值 / 有值且 verified | 165 / 165 |
| 薪资有值 / 有值且 verified | 132 / 132 |
| 截止日期有值 / 有值且 verified | 0 / 0 |
| 工作方式有值 / 有值且 verified | 1 / 1 |
| 经验异常值（超过 30 年） | 0 |
| 在招岗位状态 | 181 条均 `is_active=true` 且 `is_closed=false` |

所有写入均只补缺失或未验证字段，没有修改岗位 ID、上下架状态、收藏/投递关联或历史关闭记录。Ares 的 14 条跳过结果均为无公开正文或详情没有新增字段，不视为岗位关闭。工作方式和截止日期在官方详情没有可验证值时保持空；经验只接受官方明确的候选人工作经验。

岗位 `58367` 有历史 `experience=verified` 证据但当前没有经验字段值，已按值感知统计排除，不使用公司背景或“preferred but not required”等文字推断年限，记录为待复核。数据库抽样确认 verified 证据 URL 的 host 全部为 Ares 官方 Workday host；公网 `/api/jobs/21409`、`/jobs/21409` 和 `/api/health` 均返回 200，API 岗位数据仍在招并展示更新后的地点、类型、经验和薪资。未登录浏览器访问 `/jobs/21409` 会进入登录页，因此没有将登录页当作岗位字段展示验收结果。

生产覆盖率通过 `pnpm run audit:connector-backfill -- --company="Ares Management"` 核对；该命令将没有字段值的历史 verified 证据计入 verified，故本轮同时使用生产库值感知查询确认经验为 165 / 165，并保留 `58367` 待复核。生产 `package.json` 未注册 `audit:connector-regression` 快捷命令，但回归脚本存在；使用以下等价直接入口完成全公司回归：

```bash
sudo -n bash -c 'cd /opt/liorvix && set -a && . ./.env.local && set +a && pnpm exec tsx scripts/audit-connector-company-regression.ts --out=output/connector-regression-after-ares-management.json --baseline=output/connector-regression-production.json --strict'
```

结果：`company_count: 75`，`regressions: []`；文件为 `/opt/liorvix/output/connector-regression-after-ares-management.json`。`liorvix` 服务 active，公网健康检查返回 `{"status":"ok"}`。Ares 本轮生产回填完成；下一家公司按岗位量顺序为 Intel。

### Intel Workday 生产回填

执行时间：2026-08-31

来源登记：Intel 官方 Workday 首页为 `https://intel.wd1.myworkdayjobs.com/External`，host 为 `intel.wd1.myworkdayjobs.com`，tenant 为 `intel`，site 为 `External`。官方详情路径使用 Workday `/job/...` 稳定岗位 URL；本轮未复用其他公司的 Workday URL 或字段假设。

生产环境：`43.172.117.125:/opt/liorvix`，Supabase project ref：`weqvdtdjdzmqflhwobec`。生产机未注册 `backfill:official-details` 快捷脚本，因此使用等价直接入口 `pnpm exec tsx scripts/backfill-official-job-details.ts`；数据库环境始终通过 `sudo -n bash -c` 显式加载 `/opt/liorvix/.env.local`。

#### 分段执行记录

| 游标 `after_id` | dry-run 结果 | 写入结果 | 最后处理 ID |
| ---: | --- | --- | ---: |
| 首批，无游标 | 20 成功、0 跳过、0 失败 | 20 | 24622 |
| 24622 | 19 成功、1 无公开正文、0 失败 | 19 | 24690 |
| 24690 | 19 成功、1 无公开正文、0 失败 | 19 | 24774 |
| 24774 | 20 成功、0 跳过、0 失败 | 20 | 24830 |
| 24830 | 20 成功、0 跳过、0 失败 | 20 | 24862 |
| 24862 | 20 成功、0 跳过、0 失败 | 20 | 24887 |
| 24887 | 18 成功、2 无公开正文、0 失败 | 18 | 24911 |
| 24911 | 19 成功、1 无公开正文、0 失败 | 19 | 24937 |
| 24937 | 19 成功、1 无公开正文、0 失败 | 19 | 24968 |
| 24968 | 20 成功、0 跳过、0 失败 | 20 | 41108 |
| 41108 | 16 成功、4 无公开正文、0 失败 | 16 | 43981 |
| 43981 | 14 请求完成，其中 11 有新增字段；2 无公开正文，3 无新增字段，0 失败 | 11 | 57874 |

合计成功写入 221 条，详情无公开正文跳过 12 条，无新增字段 3 条，失败 0。最后一次全量检查未产生写入；后续有界 dry-run 的首 20 条均为 `no_new_fields`，不再写入。

#### 生产字段审计与验收

最终 Intel 在招 `collector_feed` 为 236 条，全量记录 294 条，其中历史关闭 58 条。字段审计（有值 / 已验证）为：地点 `236 / 236`、工作方式 `6 / 6`、岗位类型 `225 / 225`、经验 `203 / 203`、薪资 `0 / 0`、截止日期 `0 / 0`。官方源没有可验证薪资或截止日期时保持为空；经验只接受官方明确候选人要求中的年限。

每批写入均使用 `JOB_BACKFILL_CONCURRENCY=1 JOB_BACKFILL_REQUEST_DELAY_MS=1200`，写入同时要求 `--write` 与 `JOB_BACKFILL_WRITE_ENABLED=true`。字段回填只更新缺失或未验证字段，不修改 `is_active` / `is_closed`、岗位 ID 或历史关闭记录。

公网 `https://liorvix.com/api/health`、`https://liorvix.com/api/jobs/57874`、`https://liorvix.com/jobs/57874` 和 Intel 官方详情页均返回 HTTP 200；岗位 API 保留官方正文和已验证字段。最终全公司严格回归文件为 `/opt/liorvix/output/connector-regression-after-intel-final.json`，结果为 `company_count: 75`、`regressions: []`。Intel 已完成本轮生产回填，下一家公司为 State Street（本轮已完成）。

### State Street Workday 生产回填

执行时间：2026-08-31

来源登记：State Street 官方 Workday 首页为 `https://statestreet.wd1.myworkdayjobs.com/Global`，host 为 `statestreet.wd1.myworkdayjobs.com`，tenant 为 `statestreet`，site 为 `Global`。官方详情路径使用 Workday `/job/...` 稳定岗位 URL；本轮未复用 Intel 的 URL 或字段假设。

生产环境：`43.172.117.125:/opt/liorvix`，Supabase project ref：`weqvdtdjdzmqflhwobec`。生产机未注册 `backfill:official-details` 快捷脚本，因此使用 `pnpm exec tsx scripts/backfill-official-job-details.ts`；数据库环境始终通过 `sudo -n bash -c` 显式加载 `/opt/liorvix/.env.local`。

#### 分段执行记录

| 游标 `after_id` | dry-run 结果 | 写入结果 | 最后处理 ID |
| ---: | --- | --- | ---: |
| 首批，无游标 | 20 成功、0 跳过、0 失败 | 20 | 11098 |
| 11098 | 20 成功、0 跳过、0 失败 | 20 | 11120 |
| 11120 | 16 有新增字段、4 无公开正文、0 失败 | 16 | 11141 |
| 11141 | 16 有新增字段、4 无公开正文、0 失败 | 16 | 11162 |
| 11162 | 18 有新增字段、1 无公开正文、1 无新增字段、0 失败 | 18 | 11187 |
| 11187 | 15 有新增字段、5 无公开正文、0 失败 | 15 | 11208 |
| 11208 | 16 有新增字段、4 无公开正文、0 失败 | 16 | 11230 |
| 11230 | 15 有新增字段、4 无公开正文、1 无新增字段、0 失败 | 15 | 11251 |
| 11251 | 13 有新增字段、7 无公开正文、0 失败 | 13 | 11273 |
| 11273 | 17 有新增字段、3 无公开正文、0 失败 | 17 | 11295 |
| 11295 | 18 有新增字段、2 无公开正文、0 失败 | 18 | 11322 |
| 11322 | 18 有新增字段、2 无新增字段、0 失败 | 18 | 43667 |
| 43667 | 13 有新增字段、1 无公开正文、1 无新增字段、0 失败 | 13 | 57963 |

合计成功写入 215 条，详情无公开正文跳过 35 条，无新增字段跳过 5 条，失败 0。最后以 `after-id=57963` 做有界 dry-run，候选为 0。执行期间出现了高 ID 新岗位，因此每批均使用脚本实际返回的 `last_processed_job_id`，没有猜测或跳过游标。

#### 生产字段审计与验收

State Street 初始在招 `collector_feed` 为 257 条；最终审计为 252 条，外部 ID 为 285 条，历史关闭记录 28 条。数量变化发生于生产源刷新期间；字段回填脚本只更新 `is_active=true` 岗位的字段，不修改 `is_active` / `is_closed`、岗位 ID 或历史记录。

最终字段审计（有值 / 已验证）为：地点 `252 / 252`、工作方式 `0 / 0`、岗位类型 `217 / 217`、经验 `137 / 137`、薪资 `0 / 0`、截止日期 `0 / 0`。官方没有可验证工作方式、薪资或截止日期时保持为空；经验只接受官方明确候选人要求中的年限。

公网 `https://liorvix.com/api/health`、`https://liorvix.com/api/jobs/57963` 和 State Street 官方详情页均返回 HTTP 200；岗位 `57963` API 展示地点、岗位类型、经验和官方正文。

旧的 `output/connector-regression-production.json` 基线因生产同步期间多家公司岗位自然变化而报告 active 数量下降，不能作为本轮字段回填回归判断。随后生成最终写入后的即时生产快照 `/opt/liorvix/output/connector-regression-before-state-street-final.json`，并以它运行 strict 回归，结果为 `company_count: 75`、`regressions: []`；最终文件为 `/opt/liorvix/output/connector-regression-after-state-street-final.json`。

State Street 本轮生产字段回填完成；下一家公司按岗位量顺序为 Fidelity Investments。Fidelity 的官方 Workday host、tenant、site 和稳定岗位 ID 需在下一轮独立确认。

### Fidelity Investments Workday 生产回填

执行时间：2026-08-31

来源登记：Fidelity Investments 官方 Workday 首页为 `https://fmr.wd1.myworkdayjobs.com/en-US/fidelitycareers`，host 为 `fmr.wd1.myworkdayjobs.com`，tenant 为 `fmr`，site 为 `fidelitycareers`。官方详情路径使用 Workday `/job/...` 稳定岗位 URL；本轮独立确认了 Fidelity 自有详情 URL 和字段，不复用其他公司的 Workday 假设。

生产环境：`43.172.117.125:/opt/liorvix`，Supabase project ref：`weqvdtdjdzmqflhwobec`。所有生产命令均通过 `sudo -n bash -c` 显式加载 `/opt/liorvix/.env.local`；未修改环境文件、密钥或服务配置。

#### 分段执行记录

| 阶段 | dry-run / 写入结果 | 最后处理 ID |
| --- | --- | ---: |
| 首批 20 条 | 18 条有新增字段并写入，2 条无公开正文，0 失败 | 27098 |
| `after-id=27145` 首轮 | 324 条候选，323 条详情成功，243 条写入；80 条无新增字段、1 条无公开正文，0 失败 | 60765 |
| 薪资解析修复后的全量 dry-run | 381 条候选、381 条详情成功，316 条有新增字段；65 条无新增字段，0 失败 | 60765 |
| 薪资解析修复后的全量写入 | 381 条候选，380 条详情成功，314 条写入；66 条无新增字段、1 条无公开正文，0 失败 | 60765 |

抽查发现 Fidelity 官方详情正文中的明确 `base salary range` 未被旧回填脚本读取。已在 `scripts/backfill-official-job-details.ts` 中补上与现有连接器一致的官方正文薪资回退解析；本地 `test:job-connectors`、`test:job-standard-fields` 和 `ts-check` 均通过，生产脚本已校验哈希后替换。修复后的 dry-run 识别 127 条可补薪资，写入阶段实际补入 127 条，未修改岗位上下架状态。

#### 生产字段审计与验收

Fidelity 初始在招 `collector_feed` 为 377 条；最终审计为 381 条，外部 ID 为 444 条，历史关闭记录 63 条。数量变化发生于生产源刷新期间；回填脚本始终只更新 `is_active=true` 岗位的字段，不修改 `is_active` / `is_closed`、岗位 ID 或历史记录。

最终字段审计（有值 / 已验证）为：地点 `381 / 381`、岗位类型 `380 / 380`、经验 `177 / 191`、薪资 `128 / 128`、截止日期 `0 / 0`、工作方式 `35 / 35`。经验的已验证计数包含 14 条历史 verified 证据但当前没有可展示经验值；不据此推断年限。官方详情没有可验证截止日期时保持为空。

公网 `https://liorvix.com/api/health`、`https://liorvix.com/api/jobs/27077`、`https://liorvix.com/jobs/27077` 和 Fidelity 官方详情页均返回 HTTP 200。岗位 `27077` API 展示地点 `Jersey City, NJ`、岗位类型 `社招`、经验 `2-4 年`，以及官方薪资 `$67,000-$127,000`；薪资字段 evidence URL 为 Fidelity 官方 Workday 详情 URL，状态为 `verified`。

最终即时生产快照 `/opt/liorvix/output/connector-regression-before-fidelity-final2.json` 用作基线，strict 回归结果文件为 `/opt/liorvix/output/connector-regression-after-fidelity-final2.json`，结果为 `company_count: 75`、`regressions: []`。`liorvix` 服务保持 `active`，公网健康检查返回 `{"status":"ok"}`。

Fidelity Investments 本轮生产字段回填完成；下一家公司按岗位量顺序为 Bank of America。薪资正文回退解析已随生产回填脚本生效，后续 Workday 公司可复用该规则，但仍须逐家公司独立确认官方 host、tenant、site 和字段证据。

### Bank of America Workday 生产回填

执行时间：2026-09-01

来源登记：Bank of America 官方招聘入口为 `https://careers.bankofamerica.com/en-us/job-search.html?ref=search&search=getAllJobs`。官方岗位详情对应 Workday host `ghr.wd1.myworkdayjobs.com`，tenant `ghr`，site `lateral-us`；稳定详情路径为 `/en-us/lateral-us/job/...`，岗位外部 requisition ID 保留在官方 URL 和详情正文中。本轮独立确认了 Bank of America 的官网入口、Workday 来源、真实岗位列表和详情字段，没有复用其他公司的 Workday 参数。

生产环境：`43.172.117.125:/opt/liorvix`，Supabase project ref：`weqvdtdjdzmqflhwobec`。生产在招岗位 459 条，历史关闭记录 43 条。所有生产命令通过 `sudo -n bash -c` 显式加载 `/opt/liorvix/.env.local`；字段回填没有修改岗位 ID、`is_active`、`is_closed` 或历史记录。

#### 分段执行记录

| 游标 `after_id` | dry-run 结果 | 写入结果 | 最后处理 ID |
| ---: | --- | --- | ---: |
| 首批，无游标 | 16 条详情成功但无新增字段、4 条无公开正文、0 失败 | 0 | 26688 |
| 26982 | 18 条详情成功、17 条有新增字段、2 条无公开正文、1 条无新增字段、0 失败 | 17 | 27002 |
| 27002 | 149 条详情成功、143 条有新增字段、10 条无公开正文、6 条无新增字段、0 失败 | 144 | 62429 |

合计写入 161 条，失败 0。最终 `after-id=62429` dry-run 为 0 候选，说明当前生产岗位已追平。执行期间生产源自然刷新，最终审计在招岗位为 459 条；没有把数量变化归因于字段回填。

#### 解析修复与字段审计

dry-run 发现 Bank of America 详情正文包含客户收入区间，例如 `$20-50 m`。通用 `extractSalaryFromDescription` 原本可能将其误识别为候选人薪资；已增加对 revenue、assets、portfolio、loan 等业务指标语境的排除规则，并加入真实回归测试。修复后该批次薪资候选由 74 条降为 73 条，未将客户收入金额写入 `salary_range`。本地 `pnpm run test:job-connectors`、`pnpm run test:job-standard-fields` 和 `pnpm run ts-check` 均通过，生产源码已按 SHA256 核对部署。

最终字段审计（有值 / 已验证）为：地点 `459 / 459`、岗位类型 `409 / 406`、经验 `211 / 230`、薪资 `232 / 232`、截止日期 `0 / 0`、工作方式 `54 / 54`。经验的已验证计数包含历史 verified 证据但无当前可展示经验值的记录，不据此推断年限；官方没有可验证截止日期时保持为空。

公网 `https://liorvix.com/api/health`、`https://liorvix.com/api/jobs/26984`、`https://liorvix.com/jobs/26984` 和 Bank of America 官方详情页均返回 HTTP 200。岗位 `26984` API 展示 Boston、官方薪资 `$150,000.00 - $235,000.00`，薪资 evidence 状态为 `verified`。

旧长期回归基线因 Adobe、Apple、State Street、Wells Fargo 等多家公司岗位自然刷新而报告 active 数量变化，不作为本轮字段回填回归依据。重新生成当前时点基线 `/opt/liorvix/output/connector-regression-before-bank-of-america-final.json` 后运行 strict 回归，结果为 `company_count: 75`、`regressions: []`；结果文件为 `/opt/liorvix/output/connector-regression-after-bank-of-america-final.json`。`liorvix` 服务保持 `active`，健康接口返回 `{"status":"ok"}`。

Bank of America 本轮生产字段回填完成；下一家公司按岗位量顺序为 Vanguard。

### Vanguard Workday 生产回填与完成验收

执行时间：2026-09-01

来源登记：Vanguard 官方 Workday 地址为 `https://vanguard.wd5.myworkdayjobs.com/vanguard_external`。生产详情 URL 的官方 host 为 `vanguard.wd5.myworkdayjobs.com`，tenant 为 `vanguard`，site 为 `vanguard_external`；真实详情使用无语言段的 `/vanguard_external/job/.../apply` 路径，稳定岗位标识由官方 requisition/岗位路径保留。本轮独立确认了 Vanguard 的 host、tenant、site、详情 URL 和真实岗位字段，没有复制其他公司的语言段或 URL 规则。

生产环境：美国服务器 `43.172.117.125:/opt/liorvix`，Supabase project ref `weqvdtdjdzmqflhwobec`。本轮审计和回归均通过服务器 `/opt/liorvix/.env.local` 显式加载生产配置；回填只更新 `is_active=true` 岗位的缺失或未验证字段，不修改岗位 ID、`is_active`、`is_closed`、收藏/投递关联或历史关闭记录。

#### 分段执行记录

| 阶段 | 写入结果 | 失败 |
| --- | ---: | ---: |
| 首批 | 20 | 0 |
| 第二批 | 99 | 0 |
| 第三批 | 99 | 0 |
| 第四批 | 92 | 0 |
| 合计 | 310 | 0 |

末端 `after-id=62077` dry-run 候选为 0，说明当前 Vanguard 岗位已追平。详情不可用或没有官方新增字段的岗位只跳过字段，不作为岗位关闭证据。

#### 解析修复与生产字段审计

此前 Workday CXS 详情 URL 构造逻辑要求语言段，导致 Vanguard 这类无语言段官方 URL 无法正确请求。本轮已修复 `src/lib/safe-external-fetch.ts`：无语言段 URL 映射为 `https://vanguard.wd5.myworkdayjobs.com/wday/cxs/vanguard/vanguard_external/job/...`，带语言段 URL（如 Citi）继续保留原语言段，并统一去除末尾 `/apply`。本地 `pnpm exec tsx scripts/test-safe-external-fetch.ts` 和 `pnpm ts-check` 通过，修复已部署并重新构建。

最终 Vanguard 在招 `collector_feed` 为 415 条。字段审计（有值 / 已验证）为：地点 `415 / 411`、工作方式 `77 / 77`、岗位类型 `413 / 413`、经验 `310 / 332`、薪资 `3 / 3`、截止日期 `0 / 0`。经验的 verified 数包含历史证据但当前没有可展示值的记录，不据此补猜测；官方没有可验证截止日期时保持为空。

岗位 `9263` 已通过生产数据库、公开岗位 API、岗位页和 Vanguard 官方详情页抽查；`https://liorvix.com/api/health`、`https://liorvix.com/api/jobs/9263`、`https://liorvix.com/jobs/9263` 和官方详情页均返回 HTTP 200，岗位仍为 `is_active=true`、`is_closed=false`。

#### 回归与环境防错

最终即时生产基线为 `/opt/liorvix/output/connector-regression-before-vanguard-final.json`，strict 回归结果为 `/opt/liorvix/output/connector-regression-after-vanguard-final.json`，结果为 `company_count: 75`、`regressions: []`。`liorvix` 服务保持 active，公网健康检查返回 `{"status":"ok"}`。

本轮发现并恢复了服务器 `.env.local` 曾被部署流程错误覆盖的问题；正确生产 ref 为 `weqvdtdjdzmqflhwobec`，旧文件备份为 `/root/liorvix-env-before-weqv-20260901`，服务器配置文件保持 `root:root`、权限 `600`。`scripts/deploy-production.sh` 已加入 project ref 校验，错误环境会在构建前停止。Vanguard 本轮生产字段回填完成；下一家公司按当前来源矩阵为 NVIDIA。

### NVIDIA Workday 生产回填与完成验收

执行时间：2026-09-01

来源登记：NVIDIA 官方 Workday 详情源为 `https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite`。生产岗位 URL 的官方 host 为 `nvidia.wd5.myworkdayjobs.com`，tenant 为 `nvidia`，site 为 `NVIDIAExternalCareerSite`；稳定岗位标识由官方 `/job/...` 路径和 requisition ID 保留。本轮独立确认了 NVIDIA 的官方 host、tenant、site、真实详情 URL 和字段样本，没有复用 Vanguard 的 site 或 URL 规则。

生产环境：美国服务器 `43.172.117.125:/opt/liorvix`，Supabase project ref `weqvdtdjdzmqflhwobec`。所有生产命令均通过 `/opt/liorvix/.env.local` 显式加载；回填只更新 `is_active=true` 岗位的缺失或未验证字段，不修改岗位 ID、`is_active`、`is_closed`、收藏/投递关联或历史关闭记录。

#### 分段执行记录

| 游标 `after_id` | dry-run 结果 | 写入结果 | 最后处理 ID |
| ---: | --- | ---: | ---: |
| 首批样本，无游标 | 20 条详情成功、无新增字段、失败 0 | 0 | 25008 |
| 25008 | 20 条详情成功、无新增字段、失败 0 | 0 | 25032 |
| 25326 | 20 条详情成功、19 条有新增字段、1 条无新增字段、失败 0 | 19 | 25348 |
| 25348 | 99 条详情成功、97 条有新增字段、2 条无新增字段、1 条无公开正文、失败 0 | 97 | 25456 |
| 25456 | 100 条详情成功、98 条有新增字段、2 条无新增字段、失败 0 | 98 | 25568 |
| 25568 | 100 条详情成功、100 条有新增字段、失败 0 | 100 | 25680 |
| 25680 | 100 条详情成功、97 条有新增字段、3 条无新增字段、失败 0 | 97 | 46559 |
| 46559 | 100 条详情成功、100 条有新增字段、失败 0 | 100 | 46664 |
| 46664 | 100 条详情成功、56 条有新增字段、44 条无新增字段、失败 0 | 56 | 60027 |
| 60027 | 20 条详情成功、无新增字段、失败 0 | 0 | 62639 |
| 62639 | 候选 0、失败 0 | 0 | — |

人工正式写入合计 470 条，失败 0；其中前两个 20 条样本已由自动队列先行追平，故没有重复写入。生产源在处理期间自然刷新，候选从 932 条变为最终审计 938 条；不把该数量变化归因于字段回填。

#### 生产字段审计与验收

最终 NVIDIA 在招 `collector_feed` 为 938 条，历史关闭记录 101 条，外部 ID 1,039 条。字段审计（有值 / verified 证据）为：地点 `938 / 938`、工作方式 `15 / 15`、岗位类型 `841 / 841`、经验 `524 / 528`、薪资 `0 / 0`、截止日期 `0 / 0`。经验 verified 数包含历史证据但当前没有可展示值的记录，不据此补猜测；官方没有可验证薪资或截止日期时保持为空。

岗位 `25328` 的官方详情 URL 为 `https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Senior-Manager--Memory-Sourcing_JR2021924`。该岗位已通过生产数据库、公开岗位 API、岗位页和官方详情页抽查；公网健康接口、`/api/jobs/25328`、`/jobs/25328` 和官方详情页均返回 HTTP 200，岗位仍为 `is_active=true`、`is_closed=false`。

#### 回归结果

最终即时生产基线为 `/opt/liorvix/output/connector-regression-before-nvidia-final.json`，strict 回归结果为 `/opt/liorvix/output/connector-regression-after-nvidia-final.json`，结果为 `company_count: 75`、`regressions: []`。`liorvix` 服务保持 active。NVIDIA 本轮生产字段回填完成；下一家公司按最新来源矩阵为 Wells Fargo（1,075 条在招岗位，观察到 host `wf.wd1.myworkdayjobs.com`）。

### Wells Fargo Workday 处理启动与队列接管

执行时间：2026-09-01

来源登记：Wells Fargo 官方 Workday 真实岗位样本确认 host `wf.wd1.myworkdayjobs.com`，tenant `wf`，site `wellsfargojobs`；详情 URL 使用 `/en-US/wellsfargojobs/job/...` 稳定路径。本轮没有复用 NVIDIA 的 site 或 URL 规则。

生产环境：`43.172.117.125:/opt/liorvix`，Supabase project ref `weqvdtdjdzmqflhwobec`。Wells Fargo 当前在招 `collector_feed` 岗位 1,075 条；所有写入只补官方证据支持的缺失或未验证字段，不修改岗位 ID、`is_active`、`is_closed` 或历史记录。

#### 样本与队列处理

首批 20 条 dry-run 详情成功 20 条，其中 1 条识别出官方薪资 `$23.00 - $31.00`，19 条无新增字段，失败 0。岗位 `27202` 的生产 API、岗位页和官方详情页均返回 HTTP 200，随后只写入该 1 条薪资。

生产官方详情队列当前独立游标为 `51427`，从该游标向后抽查 20 条时抓取 18 条详情，17 条有新增字段，2 条无公开正文，1 条无新增字段，失败 0；随后写入 17 条，失败 0，实际末端为 `51464`。Wells Fargo 尚未完成全量回填，剩余岗位继续由生产独立队列按游标处理。

当前 Wells Fargo 字段审计（有值 / verified 证据）为：地点 `1,075 / 1,075`、工作方式 `44 / 44`、岗位类型 `716 / 703`、经验 `717 / 702`、薪资 `149 / 149`、截止日期 `0 / 0`。本记录是处理中快照，不计入已完成公司数量；详情不可用只记为待复核，不作为下架证据。

#### Wells Fargo 后续批次与自动队列修复快照

随后按生产游标 `51464` 完成 dry-run 和正式写入：详情成功 `20` 条、写入 `16` 条、失败 `0`；再按游标 `51499` 完成 dry-run 和正式写入：详情成功 `19` 条、写入 `17` 条、失败 `0`，末端推进到 `51546`。期间生产岗位自然刷新，当前在招为 `1,071` 条；最新字段审计（有值 / verified 证据）为：地点 `1,071 / 1,071`、工作方式 `46 / 46`、岗位类型 `773 / 766`、经验 `762 / 765`、薪资 `173 / 173`、截止日期 `0 / 0`。

核对发现生产 `.env.local` 缺少官方详情队列开关，导致服务虽运行但 `runOfficialDetailsCycle` 被禁用。已先备份 `/root/liorvix-env-before-official-details-enable-20260901`，再补齐 `JOBS_OFFICIAL_DETAILS_AUTO_SYNC=true`、`JOB_BACKFILL_WRITE_ENABLED=true`、低并发和 20 条批次配置，重启后服务 `active`，日志确认官方详情批次恢复运行。手工队列游标已安全推进至 `51546`，不改变岗位 ID、`is_active`、`is_closed` 或历史记录。

当前即时生产基线为 `/opt/liorvix/output/connector-regression-before-wells-fargo-progress.json`，strict 回归结果为 `/opt/liorvix/output/connector-regression-after-wells-fargo-progress.json`，结果为 `company_count: 75`、`regressions: []`。公网健康接口、岗位 API 和岗位页抽样均返回 200。Wells Fargo 仍在处理中，完成后下一家公司为 Accenture。

### 官方详情队列性能优化

执行时间：2026-09-01

原实现把官方详情补全绑定在 10 分钟主 Feed 周期内，并将同一轮选中的 3 家公司串行处理，导致大公司需要长时间等待轮次。现已将官方详情队列拆为独立 2 分钟调度；不同官方 host 的公司在同一轮并行处理，同一 host 自动串行，每家公司内部继续使用并发 `1`、请求间隔 `1,200ms`、20 条批次和数据库独立租约。主 Feed、岗位生命周期和官方字段写入边界保持不变。

生产部署验证：构建成功，`liorvix` 服务 `active`，本机和公网健康检查均返回 200；日志已观察到 `Vanguard`、`PIMCO`、`State Street` 同一秒完成，证明不同 host 并行生效。Wells Fargo 自动批次从游标 `51546` 推进至 `51572`，写入 `19` 条、失败 `0`。

部署期间发现生产数据库缺少本地已有的 `0101_job_sync_run_live_progress.sql`，已按生产 ref `weqvdtdjdzmqflhwobec` 执行该幂等迁移并通过 `db:migrate:admin:check`，实时进度记录恢复正常。最新严格回归为 `company_count: 75`、`regressions: []`。

### Wells Fargo 全量字段回填完成验收

执行时间：2026-09-01

完整生产 dry-run 从 `after-id=51866` 开始：候选 `507` 条，详情成功 `474` 条，有新增字段 `235` 条，跳过 `272` 条，失败 `0`，末端岗位 ID `62650`。正式写入使用同一游标：详情成功 `463` 条，实际更新 `228` 条，跳过 `279` 条，失败 `0`；最终以 `after-id=62650` dry-run 验证候选 `0`。

最终生产字段审计（有值 / verified 证据）为：地点 `1,076 / 1,076`、工作方式 `47 / 46`、岗位类型 `1,042 / 1,042`、经验 `1,032 / 1,041`、薪资 `363 / 363`、截止日期 `0 / 0`。经验 verified 数包含历史证据但当前无展示值的记录；官网无可验证截止日期，不补猜测。

最终生命周期核对：在招 `1,076`、历史关闭 `668`；岗位回填没有修改岗位 ID、`is_active`、`is_closed`、收藏、投递或历史记录。生产环境为 `weqvdtdjdzmqflhwobec`；`liorvix` 服务 active，公网 `/api/health`、岗位 `27178` 的公开 API/岗位页和 Wells Fargo 官方详情页均返回 HTTP 200。

全公司 strict 回归使用即时生产基线 `/opt/liorvix/output/connector-regression-before-wells-fargo-final.json`，结果文件 `/opt/liorvix/output/connector-regression-after-wells-fargo-final.json`，结果为 `company_count: 75`、`regressions: []`。Wells Fargo 本轮标记完成；下一家公司为 Accenture。生产官方详情队列会继续按独立公司游标自动同步已完成公司的新增岗位字段。

### Accenture Workday 真实样本启动

执行时间：2026-09-01

Accenture 官方来源独立确认：host `accenture.wd103.myworkdayjobs.com`，tenant `accenture`，site `AccentureCareers`；真实岗位 `_R00317555-1` 的官方详情页返回 HTTP 200，平台岗位 API 和岗位页也返回 200。当前生产在招岗位约 `2,329` 条，官方详情队列游标观察为 `47148`。

首批 20 条真实 dry-run：详情成功 `15` 条，有新增字段 `8` 条，跳过 `12` 条（7 条无新增字段、5 条无公开正文），失败 `0`；候选字段为官方薪资 `7` 条，未猜测截止日期。随后使用同一 `after-id=47148` 正式写入 `8` 条，跳过 `12` 条，失败 `0`，末端 ID `47168`。Accenture 目前仅完成样本阶段，尚未完成全量 dry-run、写入和最终回归，不能标记完成。

### Accenture 集中推进模式优化

执行时间：2026-09-01

原官方详情队列每 2 分钟只轮换 3 家公司，Accenture 在 47 家公司中约每 30 分钟才能获得一次 20 条批次，导致游标推进缓慢。已在 `official-details-worker` 增加可控的 `JOBS_OFFICIAL_DETAILS_FOCUS_COMPANY`：配置为某个仍有游标的处理中公司时，该公司每轮优先执行；游标追平为 `null` 后自动恢复公平轮换。生产当前配置为 Accenture 集中推进、批次上限 100、每轮仍保留最多 3 家不同 host 并行，未改变租约、官方证据、失败隔离和只补字段写入边界。

本地调度测试、TypeScript 检查和生产构建通过。生产部署后 Accenture 首个集中批次处理 100 条，更新 35 条、跳过 65 条、失败 0，游标推进至 `47371`；`liorvix` active，公网健康接口 HTTP 200。配置备份为 `/root/liorvix-env-before-focus-20260901`。
