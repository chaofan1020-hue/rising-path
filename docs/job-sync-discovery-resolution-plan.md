# 岗位来源探测与暂停队列逐家公司解决计划

更新时间：2026-09-02

## 目标

逐一解决生产环境中“来源待探测”和“连接器历史复核暂停”的公司，使每家公司都能明确进入以下三种结果之一：

- 已验证并可持续补全官方字段。
- 已确认官网没有某些字段，并以“官网未提供”记录。
- 暂不具备安全接入条件，保留暂停并写明具体阻塞原因。

本计划不修改主 Feed 的分页、游标、并发和关闭逻辑，不修改 `jobs.is_active` / `jobs.is_closed`。

## 当前基线

生产来源台账共有 75 家活跃公司：

- 24 家 `discovery_required`。
- 24 家已识别来源族但仍缺少可执行的官方接入配置。
- 27 家已有注册连接器，但历史复核写入开关未开启。

复核队列中当前有 56 家暂停：29 家原因是“来源待探测”，27 家原因是“连接器历史复核未启用写入开关”。

## 第三阶段首轮盘点结果

已对等待探测公司的本站真实岗位 URL 做只读盘点。多数公司已经有明确的官方来源，当前阻塞点是美国端没有对应的官方字段处理器，不是官网不存在：

- Amazon：`amazon.jobs`，约 2 万条岗位。
- JPMorgan Chase：Oracle HCM，约 1 万条岗位。
- Apple：`jobs.apple.com`，约 3400 条岗位。
- Google：Google Careers，约 2300 条岗位。
- Microsoft：`apply.careers.microsoft.com`，约 1400 条岗位。
- Deloitte：Avature，约 1100 条岗位。
- Morgan Stanley：Eightfold/Taleo，约 1100 条岗位。
- Meta：Meta Careers，约 775 条岗位。
- Goldman Sachs：`higher.gs.com`，约 758 条岗位。
- UBS、Jane Street、Deutsche Bank、Roblox、BlackRock、Okta、MongoDB、Elastic 等也已有官方域名岗位链接。

首批真实样本 dry-run 已确认：Amazon、Apple、Microsoft、Meta、Deloitte、Morgan Stanley、Goldman Sachs 等页面可以访问并取得岗位正文；Google 和 UBS 的响应超过当前安全响应大小限制，Jane Street 的样本 URL 存在协议异常，需要单独处理。以上 dry-run 没有写入岗位或字段。

因此第三阶段不再重复寻找 careers 首页，改为“按官方来源族补适配器”。当前仓库已有连接器只覆盖 Greenhouse、Ashby、Lever、Phenom；Amazon、Apple、Google、Microsoft、Meta、Avature、Oracle HCM、Eightfold、Taleo 等必须新增专用适配器或经过评估后接入通用官方详情解析器，不能仅修改状态字段放行。

## 执行顺序

### 第 0 步：建立执行台账

每家公司建立一条记录，至少包含：公司名、上游公司 ID、官方 careers URL、官方 ATS、官方岗位详情 URL、来源族、连接器、负责人、当前状态、阻塞原因、dry-run 时间、样本数、写入时间、验收结果。

状态只能使用：`待探测`、`待 dry-run`、`dry-run 失败`、`待生产写入`、`处理中`、`已完成`、`暂停待补资料`。

### 第 1 批：已有连接器的公司

先处理 27 家已有连接器的公司。不要一开始打开全部生产写入，先按每批 1-2 家做 dry-run：

1. 检查连接器配置和官方 URL。
2. 抓取最多 20 条真实岗位样本。
3. 核对外部 ID、岗位 URL、地点、工作方式、岗位类型、经验、薪资、截止日期。
4. 统计接收、解析、地区过滤、匹配、跳过和失败数量。
5. dry-run 通过后才允许写入；失败则只修连接器，不改岗位生命周期。

建议先从岗位量小、结构稳定的公司开始，再处理 OpenAI、Databricks 等岗位量较大的公司。每批完成后观察至少一个官方字段周期和一个失败队列周期。

### 第 2 批：已识别来源族但 worker 尚未接入的公司

这 5 家不能直接解除暂停，必须先确认 worker 有对应实现：

- Apple：核对 Apple 官方接口适配器。
- Lazard：核对 Oracle HCM 适配器。
- Oliver Wyman：核对 Phenom 适配器。
- Jefferies、JPMorgan Chase：重新确认官方 ATS，不能仅凭当前来源类型放行。

完成适配器和真实样本测试后，才把台账从“来源族已识别”提升为“已配置连接器”或“可执行官方来源”。

### 第 3 批：仍待探测的 24 家

按影响优先级逐家公司探测，优先处理本站岗位量最大的公司：

Amazon、Microsoft、Google、Morgan Stanley、Deloitte、Meta、Goldman Sachs、McKinsey & Company、UBS，然后再处理其余公司。

每家公司必须完成：

1. 确认官方 careers URL 和岗位详情域名。
2. 确认 ATS 或官方 API，不使用聚合站替代。
3. 保存脱敏的真实岗位样本。
4. 确认六项字段哪些可提供，哪些应标记为“官网未提供”。
5. 增加或复用连接器，并通过 dry-run。
6. 更新上游来源登记和美国 `job_company_sources` 台账。
7. 让历史复核队列自动从暂停变为可执行，再观察首批结果。

## 第三阶段执行批次

为了提高效率，按来源族安排并行批次，每批最多 1-2 家，先 dry-run 后写入：

| 批次 | 公司 | 来源族 | 处理目标 |
| --- | --- | --- | --- |
| 3A | Amazon | Amazon Jobs | 建立官方详情适配器，先验证 20 条样本 |
| 3B | Apple、Google | Apple API、Google Careers | 处理 API/响应大小限制，验证稳定 ID |
| 3C | Microsoft、Meta | Microsoft Careers、Meta Careers | 验证详情接口和字段证据 |
| 3D | JPMorgan Chase、Lazard | Oracle HCM | 复用同一来源族适配器，分别验收租户配置 |
| 3E | Deloitte、McKinsey & Company、Bain & Company | Avature | 复用 Avature 解析层，分别验收岗位 URL 和字段 |
| 3F | Morgan Stanley、Millennium Management | Eightfold/Taleo | 分开验证 Eightfold 与 Taleo，不能混为一种连接器 |
| 3G | Goldman Sachs、UBS、Jane Street | 自定义官方来源 | 先完成响应、分页和字段证据探测，再决定是否新建适配器 |
| 3H | 其余待探测公司 | 自定义/混合来源 | 依岗位量和官方来源证据继续排队 |

每个批次完成后才把对应公司从 `discovery_required` 提升为可执行来源；未通过样本验收的公司继续暂停，不占用复核并发名额。

当前进度：3A 已完成首轮 dry-run，Amazon 已登记为 `amazon_jobs`，但因 20 条样本中 10 条返回 404，仍保持暂停。3B 的 Apple、Google 均已完成 20 条生产 dry-run、独立 canary 并进入历史复核队列。3C 的 Microsoft、Meta 已复用 JSON-LD `JobPosting` 官方详情解析，均完成 20 条生产 dry-run（`20/20` 成功、`0` 失败）和独立 20 条 canary，并已加入生产白名单；Microsoft 已进入 `running`，Meta 已进入 `queued`。3D-3H 尚未在本线程开放生产写入。

## 每家公司验收标准

- 上游目录有稳定公司 ID，且与美国台账一致。
- 官方 URL、ATS、来源域名和连接器配置可追溯。
- 至少 20 条真实样本，或官网不足 20 条时验证全部岗位。
- 六项字段逐项有 `verified`、`pending`、`rejected` 或 `unavailable` 结果。
- 没有官方证据的字段保持为空，不使用模型猜测。
- 行级失败进入失败队列，不能阻塞整家公司，也不能改变岗位上下架。
- 首次生产写入后，数据库字段证据、后台大屏和岗位详情页抽样一致。
- 连续两个官方字段周期无页面级失败，才标记为“已完成”。

## 生产开关策略

`JOBS_CONNECTOR_BACKFILL_WRITE_ENABLED` 当前保持关闭。只有第 1 批 dry-run 通过后才开启。

开启后需要：

1. 记录变更时间和目标公司批次。
2. 观察处理岗位数、补全数、官网未提供数、跳过数和失败数。
3. 发现页面级失败、字段大面积异常或写入耗时异常时立即关闭开关并暂停当前批次。

主 Feed 和 Workday 字段任务必须持续独立运行；连接器历史复核出现问题不能停止主 Feed。

## 回滚条件

出现以下任一情况，暂停当前公司，不清空岗位、不回退主 Feed 游标：

- 官方 URL 或 ATS 无法确认。
- 样本岗位外部 ID 不稳定或匹配错误。
- 解析结果大面积为空或出现未授权字段。
- 页面级失败连续发生。
- 发现岗位状态被字段复核误改。
- 数据库、API 和大屏数量口径不一致。

回滚只包括关闭连接器写入、暂停公司队列和恢复连接器代码版本；不得用删除岗位或重置全局游标代替回滚。

## 每批执行记录

每一批结束后记录：

- 批次公司和 UTC 时间。
- dry-run 接收、解析、过滤、匹配、写入候选数。
- 实际补全、官网未提供、跳过、失败数量。
- 失败队列新增数量和主要错误类别。
- `job_company_sources`、`job_sync_state` 和 `job_historical_field_reviews` 的最终状态。
- 公网岗位 API、岗位详情和后台同步大屏抽样结果。

## 完成定义

当所有公司都已经完成官方来源确认，或明确记录为“暂停待补资料”并有下一步动作时，本计划完成。任何未验证的公司不得仅通过手工改状态标记为正常。
