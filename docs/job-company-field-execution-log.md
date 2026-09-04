# 公司岗位字段执行记录

本记录对应 [`all-company-job-field-completion-plan.md`](all-company-job-field-completion-plan.md)。它记录真实运行结果，不以测试环境或历史快照代替生产验收。

## 执行规则

- 每家公司先记录来源、真实样本、dry-run 和字段候选数，完成生产库/API/页面三处验收后才标为已上线。
- 此处的“匹配”仅指使用 `company + external_job_id` 找到当前 `collector_feed` 在招岗位，不代表已经写入。
- 所有字段回填只补空值或无官方证据的历史值，不新增 ATS 岗位记录，不更新 `is_active` 或 `is_closed`。
- 本地 `.env.local` 的项目 ref 只能用于本轮环境记录，不能自行视为生产环境。

## 批次 3：等待探测公司首轮盘点

执行时间：2026-09-02

本批只读检查生产环境，没有写入岗位或字段。生产台账中 29 家被标记为“来源待探测”的公司，实际岗位链接盘点显示多数已经指向官方来源：

| 公司/来源族 | 代表性岗位链接域名 | 规模（约） | 当前结论 |
| --- | --- | ---: | --- |
| Amazon | `www.amazon.jobs` | 20,318 | 页面可访问，需 Amazon 专用适配器 |
| JPMorgan Chase | `jpmc.fa.oraclecloud.com` | 10,373 | Oracle HCM，需租户配置 |
| Apple | `jobs.apple.com` | 3,442 | 官方 API，需接入适配器 |
| Google | `www.google.com` | 2,345 | 官方 Careers，响应超过当前安全大小限制 |
| Microsoft | `apply.careers.microsoft.com` | 1,474 | 页面可访问，需专用适配器 |
| Deloitte | `apply.deloitte.com` | 1,163 | Avature，需适配器 |
| Morgan Stanley | `morganstanley.eightfold.ai` / `morganstanley.tal.net` | 1,128 | Eightfold/Taleo，需分开处理 |
| Meta | `www.metacareers.com` | 775 | 页面可访问，部分字段可提取 |
| Goldman Sachs | `higher.gs.com` | 758 | 自定义官方来源，需分页探测 |
| UBS、Jane Street、Deutsche Bank 等 | 各自官方域名 | 约 1,000+ | 已有官方链接，需逐家适配 |

样本 dry-run 结果：Amazon、Apple、Microsoft、Meta、Deloitte、Morgan Stanley、Goldman Sachs 页面可访问并能取得正文；Google/UBS 需要先处理响应大小限制；Jane Street 存在协议异常。所有样本均为 dry-run，没有写入。

下一步按 [`job-sync-discovery-resolution-plan.md`](job-sync-discovery-resolution-plan.md) 的 3A-3H 批次实施。当前不能仅修改 `job_company_sources.status`，必须先有官方来源证据、连接器或安全通用详情解析器，再开放历史字段复核。

### 批次 3A：Amazon Jobs 首次 dry-run

执行时间：2026-09-02

已将 Amazon 的官方来源登记为 `amazon_jobs`，并部署独立的通用详情任务。生产写入开关 `JOBS_GENERIC_OFFICIAL_BACKFILL_WRITE_ENABLED` 保持关闭。

| 指标 | 结果 |
| --- | ---: |
| 生产在招岗位候选 | 20,306 |
| 本次抽样 | 20 |
| 官网页面成功取得正文 | 10 |
| 官网返回 404 | 10 |
| 可补字段岗位 | 10 |
| dry-run 实际写入 | 0 |

结论：Amazon 详情链接存在一半已失效或已关闭，不能直接全量写入。下一步先修复上游 Amazon 岗位 URL/关闭状态映射，再复跑 20 条样本；通过后才开启 Amazon 专用写入开关。Amazon 当前在历史复核队列中显示为“官方详情复核未启用写入开关”，不会自动写入。

### 批次 3B：Apple Jobs 官方 API dry-run

执行时间：2026-09-03

Apple 详情页是前端壳页面，岗位正文由同域只读接口返回：先请求 `/api/v1/CSRFToken`，再请求 `/api/v1/jobDetails/<jobNumber>`。已将该接口接入安全外部抓取层，仅对白名单域名 `jobs.apple.com` 启用，并保留 DNS 校验、HTTPS、响应大小和官方域名限制。生产通用官方写入开关仍保持关闭。

| 指标 | 结果 |
| --- | ---: |
| 生产在招岗位候选 | 3,483 |
| 本次抽样 | 20 |
| 官方 API 成功 | 20 |
| 页面级失败/跳过 | 0 |
| 实际可补岗位 | 15 |
| 地点候选字段 | 15 |
| 经验候选字段 | 12 |
| 岗位类型候选字段 | 7 |
| 工作方式/薪资/截止日期候选字段 | 0 / 0 / 0 |
| dry-run 实际写入 | 0 |

结论：Apple 官方 API、岗位号和详情链接匹配稳定；地点、官方资格文本和部分经验要求可形成字段证据。Apple 页面没有在样本中提供明确工作方式、具体薪资或截止日期，这三项保持为空，不用通用规则猜测。Apple 已具备小批量生产验收条件，但在完成首批生产写入前仍保持 `JOBS_GENERIC_OFFICIAL_BACKFILL_WRITE_ENABLED=false`。

#### Apple 生产 canary

执行时间：2026-09-03

在独立公司白名单 `JOBS_GENERIC_OFFICIAL_BACKFILL_COMPANIES=Apple` 下完成首批 20 条生产写入：更新 20 条岗位，0 失败，0 跳过；没有修改 `is_active`、`is_closed` 或岗位 ID。写入后 Apple 队列保留游标并显示“canary 已完成 20 条”，随后已重新排队从第 21 条继续。当前服务配置只允许 Apple 的通用官方复核，Amazon 仍保持暂停。

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

## 2026-09-02：Accenture 官方字段队列完成与性能修复

生产环境：`weqvdtdjdzmqflhwobec`。Accenture 官方 Workday 来源为 `accenture.wd103.myworkdayjobs.com`，tenant `accenture`，site `AccentureCareers`。最终生产在招 `collector_feed` 岗位为 2,380 条。

本轮自动队列最后批次从游标 `46960` 推进到 `64264`：100 条候选，详情成功 94 条，跳过 100 条，更新 0 条，失败 0；游标已到当前最大岗位 ID，后续进入 10 分钟复查冷却。字段审计（有值 / verified）为：地点 `2,380 / 2,292`、工作方式 `428 / 428`、岗位类型 `1,564 / 1,540`、经验 `1,134 / 1,429`、薪资 `710 / 710`、截止日期 `0 / 0`。经验 verified 多于当前有值是历史证据残留，不据此补猜测；官网没有可验证截止日期时保持为空。

生产 `/api/health`、`/api/jobs/6767`、`/jobs/6767` 和 Accenture 官方详情页均返回 HTTP 200，岗位仍保持开放；严格回归结果为 `company_count: 75`、`regressions: []`，报告为 `output/connector-regression-after-accenture-20260902.json`。

本轮同时修复了队列重复扫描：完成公司不再将游标清为 `null`，游标到达当前最大岗位 ID后不再启动详情子进程，并设置 10 分钟完成复查冷却；Workday 详情请求最多 3 个并发 worker，但仍保持全局 `JOB_BACKFILL_REQUEST_DELAY_MS=1200` 请求启动间隔。生产实测 100 条批次约 122 秒，失败 0；未修改岗位 ID、`is_active`、`is_closed`、收藏或投递记录。

## 2026-09-02：生产队列运行复核与调度参数恢复

生产 project ref 再次只读核对为 `weqvdtdjdzmqflhwobec`。复核时发现服务器 `.env.local` 被保留为旧的 `JOBS_OFFICIAL_DETAILS_BATCH_SIZE=20`、`JOBS_OFFICIAL_DETAILS_INTERVAL_MINUTES=0.5`，与已验证的性能配置不一致；这会让队列每轮少处理、等待时间更长，但不是游标回退的根因。

已先将原配置备份至服务器 `/root/liorvix-env-before-official-details-config-20260902`，再恢复以下生产参数：

- `JOBS_OFFICIAL_DETAILS_BATCH_SIZE=100`
- `JOBS_OFFICIAL_DETAILS_INTERVAL_MINUTES=0.1`
- `JOBS_OFFICIAL_DETAILS_COMPANIES_PER_CYCLE=3`
- `JOB_BACKFILL_CONCURRENCY=3`
- `JOB_BACKFILL_REQUEST_DELAY_MS=1200`
- `JOBS_OFFICIAL_DETAILS_FOCUS_COMPANY=`（Accenture 已完成，恢复公平轮转）

重启后 `liorvix.service=active`，公网 `/api/health` 返回 `{"status":"ok"}`。队列复核显示旧的 Intel/Blackstone 租约自然过期并释放，随后 Accenture、Bain Capital、Ares Management、Rothschild & Co、Adobe、Brookfield、State Street、Vanguard、Intel、Apollo Global Management、Wells Fargo、PIMCO 等公司均有成功批次，失败数均为 `0`；Intel 游标从 `24882` 推进到 `64073`。完成公司保留末端游标并进入 10 分钟复查冷却，没有重复启动详情子进程。

本次只调整生产调度配置，没有修改岗位 ID、`is_active`、`is_closed`、收藏、投递记录或有效租约；后续继续由自动队列按公司独立游标处理新增岗位。

## 2026-09-03：Databricks 历史字段复核完成

本次操作直接在生产服务器 `/opt/liorvix` 执行，目标 Supabase project ref 为 `weqvdtdjdzmqflhwobec`。执行前先做 dry-run 和 1 条 canary，确认 Greenhouse 官方源稳定后才进行全量只补缺失字段回填。

| 指标 | 结果 |
| --- | ---: |
| 官方接收 / 解析 | 859 / 859 |
| 官方重复外部 ID | 0 |
| 详情请求 / 失败 / 关闭 | 0 / 0 / 0 |
| 目标地区官方岗位 | 557 |
| 生产在招 `collector_feed` 岗位 | 545（写入前后不变） |
| 外部 ID 匹配 | 543 |
| canary 写入 | 1 |
| canary 公开 API 验收 | 岗位 `20126` 返回 200，薪资字段和官方证据可见 |
| canary 后剩余候选 / 全量写入 | 415 / 415 |
| 全量回填总数 | 416 |

字段审计显示：薪资 `415 / 415` 已有官方证据；地点 `545 / 545` 已验证；其余字段仅在官网提供明确证据时补全。截止日期官方源未提供，保持为空。所有写入均限定 `source_system=collector_feed`、`is_active=true`，没有新增岗位，也没有修改 `is_active`、`is_closed`、收藏或投递记录。

历史复核队列 `Databricks` 已标记为 `completed`，`processed_candidates=416`、`remaining_candidates=0`；暂停队列从 31 家降为 30 家。

## 2026-09-03：BCG 暂停复核结论

重新在生产执行只读 dry-run，结果为：官方接收 906、解析 706、详情请求 213、详情失败 0、详情歧义 213、重复外部 ID 200、目标地区岗位 211、现有岗位匹配 207、可补候选 22。重复 ID 和详情歧义仍然存在，因此 BCG 继续保持“连接器历史复核未启用写入开关”暂停状态，禁止通过队列或手工脚本写入；这不会影响主 Feed 或岗位生命周期。

## 2026-09-03：Apple 官方 API canary

生产 dry-run 抽样 20 条岗位，官方 API 20/20 成功、页面级失败 0、跳过 0。随后使用仅针对 Apple 的官方详情写入开关完成 20 条 canary：写入 20、失败 0，地点、经验和岗位类型等有官方证据的字段写入 `verified`；官网未提供的工作方式、薪资和截止日期写入 `unavailable_on_official_source`，不作为解析失败。

岗位 `13925` 的公网详情 API 返回 200，地点为 `Cupertino`，经验和岗位类型字段及其官方证据可见，岗位仍保持在招。Apple 历史复核队列已记录 `processed_candidates=20`、`remaining_candidates=3402`，继续保持暂停，等待后续按批次开启；Amazon 和 BCG 均未被放开。

为便于后续人工记录 canary 或分批进度，新增 `scripts/update-historical-review-progress.ts`。该脚本只更新历史复核队列的进度元数据，不写入岗位字段，不修改岗位生命周期。

## 2026-09-03：BCG Phenom 修复与回填完成

先修复 Phenom 审计口径：同一 `jobSeqNo` 在多地点/多分类列表中重复出现时合并地点信息，单独记录 `duplicate_listing_rows`；只有标题、公司或官方链接冲突才计入 `duplicate_external_ids`。生产 dry-run 复核为重复展示 200 条、核心冲突 0、详情失败 0。

随后完成 20 条 canary 和剩余 3 条全量回填，共 23 条只补缺失字段写入。20 条公开 API 抽样全部返回 200 且 `is_active=true`、`is_closed=false`。最终生产在招岗位仍为 257 条，字段审计为：地点 `257/257`、工作方式 `181/181`、岗位类型 `248/248`、经验 `200/202`、薪资 `30/30`、截止日期 `6/6`。BCG 历史复核队列已完成，剩余暂停公司减少至 27 家。

## 2026-09-03：Oliver Wyman Phenom 接入与回填完成

按既定批次新增 Oliver Wyman 独立 Phenom 配置：搜索页 `https://careers.marsh.com/global/en/search-results`，官方 host `careers.marsh.com`，连接器 board `MARSHGLOBAL`。来源矩阵同步后，生产 dry-run 为官方接收 `1,897`、解析约 `1,545`、详情失败 `0`、核心冲突 ID `0`，重复展示行单独记录，不作为错误匹配。

20 条 canary 全部通过，公开 API 抽样 `20/20` 返回 200 且岗位保持在招；随后全量补齐剩余 140 条，共写入 160 条。最终生产在招岗位为 191 条，字段审计为：地点 `191/188`、工作方式 `163/163`、岗位类型 `169/164`、经验 `130/132`、薪资 `42/42`、截止日期 `4/4`。Oliver Wyman 历史复核队列已完成，没有修改岗位生命周期。

本批部署后服务 `liorvix.service=active`，公网 `/api/health` 返回 `{"status":"ok"}`。当前暂停队列为 27 家：Amazon 仍等待专用写入开关；其余 26 家为来源待探测。Apple 保留 20 条 canary 结果但按要求继续暂停。

## 2026-09-03：Lazard Oracle HCM 接入与字段回填完成

按 Oracle HCM 先锋批次处理 Lazard。官方候选人站点为 `icbpjb.fa.ocs.oraclecloud.com`，站点号 `CX_1`，列表接口 `recruitingCEJobRequisitions`，详情接口 `recruitingCEJobRequisitionDetails`（`ById`）。连接器新增独立租户配置、分页、稳定数字岗位 ID、详情字段证据和页面级失败保护；不修改主 Feed 游标、并发或岗位生命周期。

生产目标为 `weqvdtdjdzmqflhwobec`（美国服务器 `/opt/liorvix/.env.local`）。真实 dry-run：官方接收/解析 `41 / 41`，详情请求/失败 `41 / 0`，目标地区岗位 `36`，生产在招 `collector_feed` 岗位 `36`，外部 ID 匹配 `36`，重复外部 ID `0`。20 条 canary 写入更新 `20` 条；随后剩余 `16` 条候选完成全量只补缺失字段回填，共更新 `36` 条岗位字段。

字段写入仅来自官方详情正文或结构化字段：工作方式 33 条、岗位类型 19 条、经验 31 条、薪资 26 条、截止日期 4 条；官网未提供的字段保持为空。生产审计确认 Lazard 在招岗位仍为 `36`，没有新增岗位、关闭岗位或修改 `is_active` / `is_closed`、收藏和投递记录。公开 `/api/jobs?company=Lazard` 返回 36 条岗位，canary 岗位详情均保持 `is_active=true`、`is_closed=false`，并可见官方字段证据。

新增 `src/lib/job-connectors/oracle-hcm.ts` 及 20 条脱敏 fixture 和连接器回归测试；本地 `pnpm run ts-check`、`pnpm run test:job-connectors` 已通过。来源矩阵生产写入后为 75 家活跃公司，Oracle HCM 来源 3 家（Lazard、Jefferies、JPMorgan Chase），当前仅 Lazard 完成连接器验收，Jefferies/JPMorgan Chase 仍按顺序等待。

## 2026-09-03：Google Careers 适配准备

Google 真实岗位详情 URL 为 `https://www.google.com/about/careers/applications/jobs/results/<externalJobId>`。详情页包含约 1.3MB 的 Google Careers 应用壳，岗位正文位于响应后段；通用 1MB 限制会在正文前截断。

本次代码变更仅对 Google Careers 页面启用受控 2MB 响应上限，其他外部来源仍保持 1MB；同时从页面可见证据提取地点和最低/优先资格段，未对工作方式、薪资或截止日期做猜测。新增 `scripts/test-google-official-detail.ts` fixture 回归测试和 `scripts/mark-google-careers-ready.ts` 台账升级脚本，后者要求显式设置 `GOOGLE_SOURCE_PROMOTION_WRITE_ENABLED=true`。

本机 dry-run 因开发环境 DNS 将 `www.google.com` 解析到受限地址而无法发起真实请求，未写入数据库。下一步必须在美国生产服务器执行：

```bash
pnpm run backfill:official-details -- --company=Google --limit=20 --review-missing-fields
```

只有 20 条真实样本页面级失败为 0、岗位 ID 匹配稳定、字段证据可追溯时，才可执行台账升级和独立 canary；不得直接全量开启 Google 写入。

## 2026-09-03：Google Careers 生产 canary 与复核启动

美国生产服务器 `/opt/liorvix` 上执行真实 20 条 dry-run：官方页面请求 `20/20` 成功、页面级失败 `0`、跳过 `0`，候选更新 `20`。地点已稳定提取，薪资示例为 `$118000 - $169000`，没有再出现截断的 `000 - $169`；官网未提供的工作方式和截止日期保持 `unavailable_on_official_source`。

随后完成 Google 独立 20 条 canary：更新 `20`、失败 `0`。岗位 `11414` 的公网 `/api/jobs/11414` 返回 `200`，地点、岗位类型、经验、薪资和 `field_evidence` 均可见，岗位仍保持在招。生产环境白名单已从 `Apple` 扩展为 `Apple,Google`，原 `.env.local` 已备份至服务器 root 目录；主 Feed、岗位 ID、收藏投递和岗位生命周期未修改。

Google 历史字段复核已从“来源待探测”修正为 `official_generic/running` 并开始持续处理。当前观察值：候选 `2,389`，已处理 `1,540`，剩余 `849`，已更新 `1,540`，失败 `0`，当前岗位游标 `43200`；服务日志仍显示 Google 每批更新 `100`、失败 `0`。后续由自动队列继续从现有游标推进，不重置游标、不暂停主线。

## 2026-09-03：Jefferies Oracle HCM 接入与字段回填完成

按 Oracle HCM 先锋批次第二家处理 Jefferies。官方候选人站点为 `hdid.fa.us2.oraclecloud.com`，站点号 `CX_1`。与 Lazard 复用同一 Oracle HCM 连接器，但 Jefferies 是混合来源：生产台账 160 条在招岗位中，122 条指向 Oracle HCM，38 条指向 Taleo；官方 Oracle 列表本身声明 160 条岗位。本批只按 Oracle 官方总列表做只读核验和字段回填，不触碰 Taleo 侧记录。

生产目标为 `weqvdtdjdzmqflhwobec`（美国服务器 `/opt/liorvix/.env.local`）。真实 dry-run：官方接收/解析 `160 / 160`，详情请求/失败 `160 / 0`，目标地区岗位 `122`，生产在招 `collector_feed` 岗位 `160`，Oracle 外部 ID 匹配 `122`，重复外部 ID `0`；另有 38 条官方列表岗位落在目标地区之外，保持不写入字段、不关闭岗位。

20 条 canary 写入更新 `20` 条，公网 API 抽样 `20/20` 返回 200 且 `is_active=true`、`is_closed=false`。随后剩余 `85` 条候选完成全量只补缺失字段回填，共更新 `105` 条岗位字段。字段覆盖由回填前提升为：岗位类型 `50→118`、经验 `48→114`、薪资 `12→58`、截止日期 `0→2`、地点 `136→137`；官网未提供的工作方式保持为空。生产审计确认 Jefferies 在招岗位仍为 `160`，没有新增、关闭岗位或修改 `is_active` / `is_closed`、收藏和投递记录。

来源矩阵生产写入后活跃公司仍为 75 家，Jefferies 已从 `source_family_identified` 提升为已配置连接器。Oracle HCM 三家中已完成 Lazard、Jefferies，JPMorgan Chase 仍按计划等待，完成两家先锋验收后进入 JPMorgan 20 条样本阶段。

## 2026-09-03：JPMorgan Chase Oracle HCM 20 条样本 canary

Lazard、Jefferies 两家 Oracle HCM 先锋验收通过后，按计划让 JPMorgan Chase 进入 20 条样本阶段。官方候选人站点为 `jpmc.fa.oraclecloud.com`，站点号 `CX_1001`。因该站点岗位量大，为 Oracle HCM 连接器新增 `detailJobIds` 分阶段详情请求能力，并修正列表分页在短页时提前停止的问题；首轮只请求 20 条详情，不批量请求数千条详情。

生产目标为 `weqvdtdjdzmqflhwobec`（美国服务器 `/opt/liorvix/.env.local`）。只读 dry-run：官方列表 `7,219-7,220`，解析一致，20 条详情请求 `20 / 0` 成功，生产在招 `collector_feed` 岗位 `10,578`，官方列表匹配外部 ID `6,243`。数量存在明显缺口：生产该 host 在招岗位比当前 Oracle 官方列表多约 `4,300` 条，说明主 Feed 里存在已不在官方列表中的历史岗位；本批字段回填只更新能匹配的岗位，不关闭、不新建、不修改 `is_active` / `is_closed`。

20 条 canary 写入更新 `9` 条岗位字段：岗位类型 `6`、经验 `6`、截止日期 `1`；官网未提供的薪资保持为空。9 条岗位公网 `/api/jobs/[id]` 全部返回 200，`is_active=true`、`is_closed=false`。数量缺口和主 Feed 口径需要单独对账，未执行 JPMorgan `--all` 全量字段回填。

来源矩阵生产写入后活跃公司仍为 75 家，JPMorgan Chase 已从 `source_family_identified` 提升为已配置连接器 `oracle_hcm` / `CX_1001`。

## 2026-09-03：JPMorgan Chase 未匹配岗位只读抽查（继续）

为核查生产中“本站仍在招、当前官方列表没有”的岗位，先修正抽样脚本：Oracle 列表接口必须携带 `requisitionList` 展开参数，并直接复用现有 Oracle HCM 连接器的分页读取逻辑；此前一次脚本因漏参数把官方列表读成 0，结果已作废。

修正后同一生产快照显示：官方列表接收 7,217 行、去重外部 ID 7,215 个；生产 JPMorgan 在招岗位 10,579 条；未匹配 4,339 条。对未匹配集合按更新时间段和外部 ID 全范围均匀抽取 40 条，调用同一站点 `CX_1001` 的 `ById` 官方详情接口进行只读验证：

| 详情结果 | 数量 |
| --- | ---: |
| 官方详情明确存在 | 5 |
| 官方详情明确不存在 | 35 |
| 请求错误 | 0 |

这说明两类情况同时存在：大多数是官方当前已撤下或不再返回的历史岗位，但也有少量岗位详情仍存在、只是没有出现在当前列表快照中，不能仅凭列表差异关闭岗位。当前没有写入字段、关闭岗位、推进游标或修改主同步逻辑。JPMorgan 继续保持只读核查状态；后续如需处理历史残留，必须先连续多个官方快照周期确认缺失，再进入独立 dry-run/人工复核队列。

随后对该集合进行了全量详情核验：4,338 条未匹配岗位中，官方 `ById` 详情首轮确认不存在 3,881 条、仍存在 457 条、请求失败 0 条。对首轮确认不存在的 3,881 条再次逐条核验，第二轮结果为不存在 3,881 条、重新出现 0 条、请求失败 0 条。因此目前可以把 3,881 条列为“连续两次官方详情缺失”的历史残留候选；457 条必须保留并标记为“官方详情存在但列表漏返回”。本次仍未修改岗位生命周期，后续处理必须单独 dry-run 并保留可恢复清单。

候选清单已生成至 `output/jpmorgan-history-candidates.json`：3,881 条均仍为在招状态；其中 0 条有关联投递，2 条有关联 AI 匹配，只有 1 条存在缺 Feed 对账观察。清单仅用于后续独立处理，不删除岗位、不删除用户关联数据、不改变主 Feed。

根据严格官网同步要求，完成写入前来源校验后，将上述 3,881 条连续两次官方详情缺失岗位批量标记为 `is_active=false`、`is_closed=true`，并同步更新 `job_sync_records` 为 `closed`，原因记录为“官方 Oracle ById 连续两次未返回”。生产复核结果：JPMorgan 总岗位 10,585 条，在招 6,698 条，已关闭 3,887 条（含此前已有的 6 条）；当前官网列表与在招集合只剩 459 条待继续核查，未删除岗位记录、收藏、投递或 AI 匹配，未修改主 Feed、游标、并发。

## 2026-09-03：Microsoft、Meta 官方 JSON-LD 详情接入（3C）

Microsoft 岗位详情页为 `apply.careers.microsoft.com/careers/job/<id>`，Meta 为 `www.metacareers.com/profile/job_details/<id>/`。两家详情页均内嵌 `application/ld+json` 的 `JobPosting`，包含官方地点、截止日期 `validThrough`、岗位类型、部分经验和资格文本；Meta 官网不提供薪资和工作方式，Microsoft 结构化数据也不提供 `baseSalary`，这些字段按“官网未提供”处理，不猜测。

生产 dry-run：Microsoft `20/20` 成功、`0` 失败、`0` 跳过；Meta `20/20` 成功、`0` 失败、`0` 跳过。随后两家分别完成独立 20 条 canary，均更新 `20` 条、失败 `0`。生产白名单已扩展为 `Apple,Google,Microsoft,Meta`，原 `.env.local` 已备份至服务器 root 目录。来源台账已从 `discovery_required` 提升为 `microsoft_careers` / `meta_careers` 且 `configured_connector`。

历史复核队列：Microsoft `official_generic/running`，Meta `official_generic/queued`，均不再显示“来源待探测”。公网 `/api/jobs/9044`（Microsoft）和 `/api/jobs/23270`（Meta）抽样返回 `200`，地点、岗位类型、经验、截止日期和 `field_evidence` 可见，岗位仍保持在招。

同时修复截止日期展示门槛：结构化官方详情写入 `deadline_source=official_link_structured_field` 且 `field_evidence.source_type=official_ats` 的截止日期，此前会被公网岗位详情接口隐藏；现已在 `isDisplayableJobDeadline` 中放行该来源类型，仅限 `official_ats`，并增加回归测试。修复后 Microsoft 岗位 `9044` 公网返回 `valid_through=2027-03-01`，Meta 岗位 `23270` 返回 `valid_through=2026-10-03`。
## 2026-09-03：上游 Oracle HCM 覆盖完整性修复

上游生产采集器 `/opt/global-jobs/app/connectors.py` 已完成最小范围修复并部署到 `47.83.172.45`。未修改主 Feed 游标、分页、并发或公司轮换逻辑；线上文件已保留部署前备份。

- 每次 coverage retry pass 独立统计重复行和无效行，避免跨重试累计出 `duplicate=21670` 等错误值。
- Oracle 官方总数允许包含重复展示：当 `canonical_count + duplicate_count >= official_count` 且分页边界完成时，标记为 `publisher_reported_complete`。
- `source_missing_count` 按官方总数减去唯一岗位和重复展示计算，避免把重复展示误报为缺失。
- 正常完整快照只执行一遍分页；只有数量仍无法解释时才进入有限复核，不无限重扫。

生产验证：JPMorgan 最新快照为官方报告 `7,234`、唯一岗位 `7,232`、重复展示 `2`，状态 `publisher_reported_complete`。同轮审计确认 Amazon、Accenture、Bank of America、Microsoft 仍有各自独立的分页/供应商上限覆盖问题，继续保留“不可批量关闭”保护。

## 2026-09-04：P1 收口后 NVIDIA、Intel 官方字段 dry-run

按岗位同步总计划的 P2 顺序，在不修改主 Feed、岗位生命周期或生产字段的前提下，对 NVIDIA 和 Intel 各抽查 20 条官方 Workday 详情。

- NVIDIA：候选 `41` 条，抽取 `20` 条，详情失败 `0`，其中 `17` 条存在可补字段；薪资和截止日期等空值均记录为官网未提供。
- Intel：候选 `34` 条，抽取 `20` 条，详情失败 `0`，其中 `18` 条存在可补字段；样本中少量岗位有官方薪资，截止日期有 `18` 条明确未提供。

两家公司均未执行 `--write`，没有更新数据库。结果表明当前主要缺口是官方页面字段缺失，不是连接器或同步失败；后续只对具备官方证据的字段做 20 条 canary，不能根据空字段猜测薪资或截止日期。

## 2026-09-04：Deloitte、Morgan Stanley、Goldman Sachs 待探测公司收口

本轮按“完全待探测公司”清单顺序继续处理。所有写入均为只补缺失字段，未新增岗位，未修改 `is_active` / `is_closed`、收藏、投递或主 Feed 逻辑。

### Deloitte

- 官方来源：`apply.deloitte.com`，来源类型 `deloitte_careers`，状态 `configured_connector`。
- 生产在招候选：1,187 条。
- 复核结果：`completed`，处理 1,187，更新 1,157，失败 30，剩余 0。
- 字段口径：官方提供地点、岗位类型、经验、截止日期等字段；工作方式、薪资等官网未提供的部分记录为 `unavailable_on_official_source`。

### Morgan Stanley

- 官方来源：`morganstanley.eightfold.ai`，来源类型 `morgan_stanley_eightfold`，状态 `configured_connector`。
- 探测：20 条 Eightfold 详情全部可读，地点 18/20、岗位类型 20/20、截止日期 20/20；Taleo 侧 20/20 均为壳页面，未混入主连接器。
- 生产 canary：20 条写入，0 失败，0 跳过；随后进入历史复核队列。
- 复核结果：`completed`，处理 1,120，更新 1,070，失败 0，剩余 0。

### Goldman Sachs

- 官方来源：`higher.gs.com`，来源类型 `goldman_sachs_careers`，状态 `configured_connector`。
- 探测：20 条页面全部可读；当前专用解析可提取地点 20/20、经验 6/20、薪资 8/20，官网未提供工作方式和截止日期。
- 生产 canary：20 条写入，0 失败，0 跳过。
- 复核状态：`running`，候选 760，已处理 120，剩余 640，当前仍在由自动队列继续处理。

### 后续观察

UBS 和 Jane Street 按顺序为下一批，但均需要先解决独立阻塞：UBS 官方页面超过当前安全响应大小限制；Jane Street 样本出现重定向到非 HTTPS 目标的协议问题。两家均未写入、未改状态，继续保持 `discovery_required`，待处理完上述阻塞后再回到队列。

## 2026-09-04：Deloitte 地点证据修复与 Morgan Stanley Taleo 阻塞（生产复核）

### Deloitte 地点修复

- 已将 `src/lib/job-official-detail.ts` 的解析修复部署到美国生产服务器 `/opt/liorvix`，旧文件已保留带时间戳备份；数据库迁移检查无待执行项，服务重启后本机 `/api/health` 返回 `{"status":"ok"}`。
- 生产 dry-run 显式使用 `/opt/liorvix/.env.local`，目标 Supabase project ref 为 `weqvdtdjdzmqflhwobec`。当时在招岗位 `1,207` 条，地点证据为 `unavailable_on_official_source`/`pending_recheck` 的候选 `1,153` 条；详情成功 `1,146` 条，全部抽取到 `apply.deloitte.com` 页面标题下方的官方地点，7 条返回 HTTP 404。
- 已完成 20 条 canary 和后续 100 条小批量写入，均为只更新 `region`、`location_source`、地点 `field_evidence` 和 `updated_at`；两批均为 `20/20`、`100/100` 成功。岗位未新增、未删除，`is_active` / `is_closed` 未被修改。实际可回填数高于旧记录中的“约 862”，后续以本次生产 dry-run 的 `1,146` 条官方地点证据为准。

### Morgan Stanley Taleo 未完成

- 生产来源分布已拆开核对：Eightfold `1,092` 条，Taleo `43` 条（host：`morganstanley.eightfold.ai` 与 `morganstanley.tal.net`），不能共用 Eightfold 连接器或游标。
- Taleo 真实样本 `20/20` 返回 HTTP 200，但页面内容均为 Oleeo/Cloudflare `Quick Check Needed` 人机验证壳；官方字段覆盖为地点 `0`、岗位类型 `0`、经验 `0`、薪资 `0`、截止日期 `0`。未执行 canary、未写入岗位字段、未改变岗位生命周期。
- 当前阻塞不是解析失败，而是官方详情需要人机验证。禁止通过验证码绕过、伪造或第三方破解服务继续抓取。恢复条件：Morgan Stanley/Taleo 提供官方公开 API 或导出接口、对生产出口做正式 allowlist，或人工验证后获得可审计且获授权的正式接口。满足条件前，43 条保持原有字段证据状态并继续单独列在 Taleo 队列，不得标记为 Eightfold 已完成。
