# D07 · 扩量探测到 2,000 active（P1）

> 日期：2026-11-24 20:35 +08（UTC 12:35）
> 输入：`tmp/boards/candidates-p1.csv`（1,500 个未探测候选）→ 实际探测 1,201 个
> 未探的 299 个是长尾中的长尾（多为最小 board），在 active 1,042、总 active 1,944 已超过验收线后停止，避免对同一 host 追加无收益请求；这不是“探测失败”，剩余候选保留在 `tmp/boards/candidates-p1-remaining4.csv`。
> 输出：`data/p1-boards.csv`（冻结 1,000 个新 board；见 §5）
> 状态：**探测与冻结完成，生产导入待 G2**

## 1. 结果

| 指标 | 值 |
|---|---:|
| 已探测 | 1,201 |
| active | **1,042** |
| quarantined | 121（10.1%） |
| error | 38（3.2%） |
| active 率 | 86.8% |
| D02 已有 active | 902 |
| **累计 active** | **1,944** |

- 验收“新增 active ≥1,000”：**1,042，通过**。
- 验收“active ≥1,800”：**1,944，通过**。
- 隔离率 <20%：**10.1%，通过**。
- 所有 active 都来自官方 ATS API（Greenhouse / Ashby / Lever），robots 证据字段齐全；无登录、无 CAPTCHA、无个人 cookie。

## 2. 为什么没有“优先 50-2,000 岗位”的剩余池

- D02 的 1,500 个候选已经优先覆盖了 GH/Ashby/Lever 中岗位数 50-2,000 的头部 board；
- 把这 1,500 个和 P0 500 个全部排除后，18,164 个总候选里 **50-2,000 区间只剩 0 个**（1,176 个全部已在 D02/P0/active）；
- 因此 P1 只能从剩余的长尾 board 取候选，实际 active 率仍有 86.8%，说明长尾不是“死 board”；
- 这不是降低标准：所有 active 仍要求官方 API 返回 200、有目标地区样本、robots allow。

## 3. 分布

| vendor | active |
|---|---:|
| greenhouse | 681 |
| ashby | 295 |
| lever | 225 |
| 合计 | 1,201 探测 / 1,042 active |

隔离原因：

| 原因 | 数量 |
|---|---:|
| no_target_region_in_sample | 104 |
| not_found | 17 |
| fetch_failed | 21 |
| empty_board | 17 |

## 4. 证据与限制

- 每个 active 的 `robots_verdict`、`robots_evidence_url`、`robots_checked_at`、`sample`（含官方 job URL）都在 `tmp/boards/probe-p1-all.jsonl`；
- `posting_count` 来自列表 API 的 `content=false`/轻量字段；不是完整快照，因此只是 board 级活跃证据，不是岗位级字段证据；
- 岗位级字段（薪资/截止/经验）仍按权威慢车道补，D07 不负责；
- 1,042 个 active 中可能有同一公司多 board，冻结时按公司域名/名称去重；若去重后不足 1,000，保留实际数量并记录，不拿重复公司凑数。

## 5. 冻结

- 输出 `data/p1-boards.csv`，实际 **1,000** 个新 board；P0 500 个公司已排除。
- 配额与结果：GH 610 / Ashby 236 / Lever 154；A 21 / B 895 / C 84。
- 公司名：954/1,042 有页面标题/域名证据；冻结 1,000 个里 **86 个 `name_source=token_fallback`**，已标记 `confidence=low`，导入前需人工/域名补全，不能直接当成高质量公司名。
- 域名：仅 199/1,000 有可验证公司域名；GH/Ashby/Lever 的 board URL 常驻 ATS 域名，不能从 board 反推公司官网。`missing_domain` 不阻断抓取，但阻断“公司官网”展示。
- 其他拒绝：staffing 6、与现有 active 同公司 7、P1 内重复公司 2；重复 token 0。
- `data/p1-boards.csv` sha256 `C77E235864A700E0335DFFAD794E9037EDE167E24C15F3ED255913AC7227B6B7`。
- 冻结后不自动导入生产；等 V02 48h 观察通过（G2）后，按 U08/U09 的节奏分批导入 1,000 个；86 个 fallback 先不导入或先补名。

## 6. 回滚

- 只读探测，无生产写入；`data/p1-boards.csv` 是文件产物，不涉及回滚。
- 若后续导入触发停止线，按 `source_key` 删除 P1 岗位并关写开关；P0 500 不受影响。