# 岗位采集与字段补充快速收口计划

更新时间：2026-09-07

## 一、目标

在不误关岗位、不删除岗位历史、不破坏收藏/投递/AI 匹配关系的前提下，用最短时间把“上游采集 + 美国端同步 + 官方字段补充”推进到可交付状态。

这里的“完成”不是把每个字段强行填满，而是：

- 每家活跃公司都有来源状态和下一步动作。
- 主 Feed 稳定运行，新增、更新、关闭事件可追踪。
- 已确认官方来源的岗位完成分批字段补充和生命周期核验。
- 官网未提供的字段明确保持为空，不使用模型猜测。
- 受反爬、登录墙或验证码影响的公司有可复核的阻塞证据，不再被反复重试拖慢全局。

不能把官方源受限的公司标记为“已完成字段补充”；这些公司只能标记为 `blocked_by_official_source`。

## 二、当前基线

最近一次美国生产只读盘点：

- 活跃公司：75 家。
- 活跃岗位：59,617 条。
- 来源状态：52 家 `configured_connector`、20 家 `source_family_identified`、3 家 `discovery_required`。
- 历史复核：70 家 `completed`、5 家 `paused`；暂停候选约 30,972 条。
- 主 Feed：上游健康检查 HTTP 200；最近 180 分钟 19 次成功，0 页面级失败，0 行级失败，失败队列为空。
- 字段有值比例：地点约 99.1%，岗位类型 77.1%，经验 66.8%，薪资 22.7%，截止日期 12.4%，工作方式 11.1%。
- 最大未收口量：Amazon 约 20,098 条历史详情候选；JPMorgan 队列约 10,359 条暂停候选。

以上数量每天会变化，执行时必须重新 dry-run，以生产数据库和当次上游快照为准。

## 三、最快执行方式

采用五条并行轨道，但所有写入都受同一套门禁控制：

| 轨道 | 目标 | 负责人/环境 | 是否允许改岗位状态 |
| --- | --- | --- | --- |
| A 主 Feed | 保证新增、更新、关闭及时进入网站 | 美国应用服务器 | 允许接收上游明确关闭事件 |
| B 来源台账 | 75 家来源状态和元数据收口 | 美国应用服务器 + 上游接口 | 不允许 |
| C 大批量字段 | Amazon、JPMorgan、已识别 Workday 分批补字段 | 美国应用服务器 | 仅明确官网 404/410 时允许下架 |
| D 中小公司 | Google、Microsoft、Meta、Deloitte、Morgan Stanley、Goldman Sachs 等逐家公司验收 | 美国应用服务器 | 仅明确官网关闭时允许下架 |
| E 阻塞与上游 | 核实采集器调度、来源受限证据和恢复条件 | 上游服务器 | 不绕过验证码/反爬 |

美国端当前使用应用内 worker（`JOBS_AUTO_WORKER=true`），不要同时启用 `liorvix-jobs-incremental.timer` 或 `liorvix-jobs-maintenance.timer`。

## 四、执行阶段

### 阶段 0：半小时内锁定生产基线

只读执行并保存一份带 UTC 时间的报告：

```bash
cd /opt/liorvix
pnpm run check:jobs-feed
pnpm exec tsx scripts/check-job-sync-state.ts
pnpm run check:company-source-matrix
pnpm exec tsx scripts/audit-company-source-matrix.ts --out=output/fast-track-matrix-<utc>.json
pnpm run audit:job-fields
```

同时确认：

1. Supabase project ref 是生产项目。
2. 上游 `/dashboard/company-directory` 返回数组、数量有时间戳、没有 `9999/99999` 占位值。
3. `liorvix.service` 是唯一 worker 入口。
4. `job_sync_runs` 没有有效租约之外的假 `running`。
5. `job_sync_failures` 的 pending/processing/dead 数量可解释。

阶段门槛：任何一项不满足，先修运行台账或环境，不开始大批量字段写入。

### 阶段 1：2 小时内完成可执行队列重排

将公司按以下顺序排队，不等待全站完成后再开始下一家公司：

1. Amazon：先完成 `--close-removed` 的剩余生命周期核验，再继续字段补充。
2. JPMorgan Chase：先解决 Oracle 官方列表与历史队列数量不一致，再分批字段回填。
3. 已识别 Workday：按岗位量从低到高补齐连接器元数据并做 20 条 dry-run。
4. Google、Microsoft、Meta、Deloitte、Morgan Stanley、Goldman Sachs：每家公司独立 20 条 dry-run/canary。
5. 3 家 `discovery_required`：只完成来源探测和阻塞记录，不进入字段写入。

对每家公司持久化：`source_family`、官方 host、外部 ID、详情规则、候选数、已处理数、剩余数、失败原因和最近心跳。

### 阶段 2：Amazon 与 JPMorgan 大批量收口

#### Amazon

- 使用官方详情页逐批 `--scan-all --close-removed`，每批 500-1,000 条。
- 并发从 4 开始；同一 host 请求间隔至少 350-400ms。
- 404/410/明确关闭页才下架；403、429、超时和 SPA 壳只进入阻塞统计。
- 先完成生命周期清理，再打开 Amazon 字段写入；不得把 404 岗位当作字段解析失败无限重试。
- 每批记录 `checked/open/removed/unknown/updated/failed`，批次失败不推进错误游标。

#### JPMorgan Chase

- 先用 Oracle HCM 官方列表做数量和外部 ID 对账，明确历史岗位与当前开放岗位的差集。
- 用 20 条真实样本验证列表、详情、稳定 ID 和关闭保护。
- 通过后按 500-1,000 条分批只补字段；每批写入后查询 `field_evidence` 和岗位生命周期。
- 官网列表缺失不直接下架；只有官方详情明确 404/410 或关闭才改变状态。

两家公司都必须满足：外部 ID 重复为 0、页面级失败为 0、行级失败进入失败队列、生产数据库/API 抽样一致。

### 阶段 3：已确认来源的快速并行收口

每家公司固定执行以下流水线：

```text
20 条真实 dry-run
  -> 20 条 canary write
  -> 写入后同批次 dry-run 候选为 0
  -> 500-1,000 条分批写入
  -> 三个 worker 周期观察
  -> 标记 regular_observed
```

批量参数建议：

- 官方详情：每批 500-1,000 条，单 host 并发不超过 4，请求间隔不低于 350ms。
- 注册连接器：沿用连接器默认分页和数据库批量写入，不重置公司游标。
- 每轮最多并行 3 家公司，但同一官方 host 串行。
- 任何公司出现 429、详情失败率异常或数量骤降，立即暂停该公司，不影响其他公司。

完成顺序：

1. Google：已完成首个 20 条 canary，继续从现有游标推进。
2. Microsoft、Meta、Deloitte、Goldman Sachs：先补字段，再做官网关闭核验。
3. Morgan Stanley：Eightfold 可继续；Taleo 保持验证码阻塞。
4. 已完成公司：只处理新岗位和新缺口，不重新全量扫描。

### 阶段 4：来源台账和历史队列收口

将以下状态拆开显示，禁止统一显示“暂停”：

- `ready`: 来源和连接器完整，可执行。
- `observing`: 已完成 canary，等待三个周期。
- `backlog`: 来源已确认但还有候选。
- `blocked_by_official_source`: 403、验证码、登录墙、SPA 壳或供应商限制。
- `discovery_required`: 尚未取得足够官方来源证据。
- `completed_no_evidence`: 官网明确没有该字段，保持空值。

历史复核队列只保留真正有候选的公司。已完成公司从调度候选中排除；暂停公司必须有恢复条件；过期租约和 stale 运行记录自动收口，但不清空游标。

### 阶段 5：最终验收

每家公司完成后保存一份报告，至少包含：

- 上游官方数量和时间戳。
- 美国端活跃岗位数、唯一外部 ID、重复数。
- `received / parsed / normalized / filtered / failed`。
- 六项字段的 verified、pending、rejected、官网未提供数量。
- 官网明确下架数与无法判定数。
- 数据库、公开 `/api/jobs`、岗位详情页抽样结果。
- 运行 ID、游标、最近心跳、失败队列数量。

全局完成门槛：

1. 75 家都有来源状态；`discovery_required` 只剩有证据的阻塞公司。
2. 主 Feed 连续三个周期成功或可解释 partial，游标无异常停滞。
3. 外部 ID 重复为 0，行级失败不阻塞整页。
4. 官网已确认撤下的岗位在一个同步周期内关闭；403/429/超时不误关闭。
5. 所有展示字段都有官方证据；官网未提供字段不再作为失败重试。
6. 大屏能显示当前公司、已处理、剩余、写入、关闭、失败、心跳和阻塞原因。

## 五、时间安排

在上游接口可访问、美国服务器稳定、没有新增供应商限流的前提下：

- 0-2 小时：生产基线、队列重排、Amazon/JPMorgan 只读对账。
- 2-8 小时：Amazon 生命周期剩余批次、JPMorgan 20 条 canary、2-4 家中小公司 canary。
- 8-24 小时：已确认来源分批字段补充，完成 Google/Microsoft/Meta/Deloitte/Goldman Sachs 等第一轮。
- 1-3 天：Amazon/JPMorgan 大批量收口、所有已确认来源进入观察期、台账和历史队列一致。
- 3-5 天：完成三周期观察、最终对账、失败队列演练和大屏验收。

如果 Amazon 或 JPMorgan 的官方接口限流，时间会按供应商退避延长；不能通过提高并发换取“更快完成”。

## 六、明确阻塞项

以下情况不应被伪装成“未完成但继续重试”：

- UBS：官方页面 AJAX/验证码或响应限制，等待供应商可访问或人工提供公开接口证据。
- McKinsey & Company：官方源反爬/登录受限。
- Citadel：官方页面反爬受限。
- Morgan Stanley Taleo：`Quick Check Needed` 人机验证。
- Accenture Workday 部分岗位：CXS API 返回 403，保留岗位，不误删。
- 上游采集器 SSH 无法登录：先通过公开健康接口和目录契约完成验收；需要修改上游调度时再恢复 SSH 或由上游运维执行。

阻塞公司的交付物是来源证据、错误分类、恢复条件和下一次检查时间，而不是猜测字段或强制下架。

## 七、回滚与安全规则

- 所有生产写入前必须显式确认 project ref，并先 dry-run。
- 只补缺失字段或历史无证据字段，不删除岗位、不重建 ID。
- 生命周期变更保留岗位记录和同步记录，生成受影响 ID 清单。
- 单家公司异常只暂停该公司，不暂停全站。
- 不同时启用应用内 worker 和 systemd timer。
- 不提交密钥、密码、Cookie、验证码信息或原始敏感 payload。

## 八、每日执行报告

每天生成一份简报，只回答以下问题：

1. 主 Feed 最近成功时间和连续失败数是多少？
2. 今天新增、更新、关闭、跳过、失败多少？
3. 哪些公司完成了 canary、批量写入或三周期观察？
4. Amazon/JPMorgan 剩余候选和官网下架数是多少？
5. 哪些公司是可执行、观察中、阻塞或待探测？
6. 是否出现误关闭、外部 ID 重复、游标停滞或跨公司阻塞？

只要以上六个问题能由生产运行记录直接回答，就可以把这项工作从“临时救火”转为持续可控的收口流程。
