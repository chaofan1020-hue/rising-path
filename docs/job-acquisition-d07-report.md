# D07 · 扩量探测到 2,000 active（P1）

> 日期：2026-11-24 20:35 +08（UTC 12:35），20:58 +08 追加 203 个 active
> 输入：`tmp/boards/candidates-p1.csv`（1,500 个未探测候选）→ 实际探测 1,440 个
> 未探的 60 个 Lever 候选保留在 `tmp/boards/candidates-p1-remaining4.csv`；原因：Lever 单 board 超时会把整个批次拖住，且 active 已远超验收线。
> 输出：`data/p1-boards.csv`（冻结 1,000 个新 board；见 §5）
> 状态：**探测与冻结完成，生产导入待 G2**

## 1. 结果

| 指标 | 值 |
|---|---:|
| 已探测 | 1,440 |
| active | **1,245** |
| quarantined | 153（10.6%） |
| error | 42（2.9%） |
| active 率 | 86.5% |
| D02 已有 active | 902 |
| **累计 active** | **2,147** |

- 验收“新增 active ≥1,000”：**1,245，通过**。
- 验收“active ≥1,800”：**2,147，通过**。
- 隔离率 <20%：**10.6%，通过**。
- active 全部来自官方 ATS API（Greenhouse / Ashby / Lever），robots 证据齐全；无登录、无 CAPTCHA、无个人 cookie。

## 2. 为什么没有“优先 50-2,000 岗位”的剩余池

- D02 的 1,500 个候选已经优先覆盖了 GH/Ashby/Lever 中岗位数 50-2,000 的头部 board；
- 把这 1,500 个和 P0 500 个全部排除后，18,164 个总候选里 **50-2,000 区间只剩 0 个**（1,176 个全部已在 D02/P0/active）；
- 因此 P1 只能从剩余长尾 board 取候选，实际 active 率仍有 86.5%，说明长尾不是“死 board”；
- 这不是降低标准：所有 active 仍要求官方 API 200、有目标地区样本、robots allow。

## 3. 分布

| vendor | active |
|---|---:|
| greenhouse | 735 |
| ashby | 340 |
| lever | 170 |
| 合计 | 1,245 |

隔离原因：

| 原因 | 数量 |
|---|---:|
| no_target_region_in_sample | 132 |
| not_found | 21 |
| fetch_failed | 21 |
| empty_board | 21 |

## 4. 证据与限制

- 每个 active 的 `robots_verdict`、`robots_evidence_url`、`robots_checked_at`、`sample`（含官方 job URL）都在 `tmp/boards/probe-p1-all2.jsonl`；
- `posting_count` 来自列表 API 的 `content=false`/轻量字段；不是完整快照，因此只是 board 级活跃证据，不是岗位级字段证据；
- 岗位级字段（薪资/截止/经验）仍按权威慢车道补，D07 不负责；
- 冻结时按公司域名/名称去重；不足 1,000 时保留实际数量并记录，不拿重复公司凑数；
- 60 个 Lever 未探，不影响 active 验收；后续可按单 board 5 分钟超时再补。

## 5. 冻结

- 冻结 `data/p1-boards.csv`，实际 **1,000** 个新 board；P0 500 个公司已排除。
- 配额与结果：GH 630 / Ashby 252 / Lever 118；A 21 / B 904 / C 75。
- 公司名：1,245 个 active 中 1,145 个有页面标题/域名证据；最终 1,000 个**全部 `name_source=page_title`，token fallback 0**。
- 域名：仅 215/1,000 有可验证公司域名；GH/Ashby/Lever 的 board URL 常驻 ATS 域名，不能从 board 反推公司官网。`missing_domain` 不阻断抓取，但阻断“公司官网”展示；`confidence=low` 922 个，主要就是无域名。
- 其他拒绝：name_fallback 100、staffing 7、与现有 active 同公司 7、P1 内重复公司 2；重复 token 0。
- `data/p1-boards.csv` sha256 `A9B982A5C02F4FD6F0052B1257E54C007C418CBDEBB52D0DB6BA9023F2264FFE`。
- 冻结后不自动导入生产；等 V02 48h 观察通过（G2）后，按 U08/U09 的节奏分批导入 1,000 个；无 fallback，不需要先补名。

## 5.1 最终冻结结果

- 输入 active 1,245；按公司域名/名称去重并排除 P0 902 个公司后，eligible 1,129。
- selected **1,000**：GH 630 / Ashby 252 / Lever 118；A 21 / B 904 / C 75。
- `name_source=page_title` 1,000；`token_fallback` **0**；`company_domain` 215。
- `data/p1-boards.csv` sha256 `A9B982A5C02F4FD6F0052B1257E54C007C418CBDEBB52D0DB6BA9023F2264FFE`。

## 6. 回滚

- 只读探测，无生产写入；`data/p1-boards.csv` 是文件产物，不涉及回滚。
- 若后续导入触发停止线，按 `source_key` 删除 P1 岗位并关写开关；P0 500 不受影响。