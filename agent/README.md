# Liorvix 本地投递 Agent

把「打开官网 → 上传简历 → 逐页填写 → 翻到提交页」交给本机的浏览器自动完成，你早上起来只看报告。

> 默认**演练模式**：填到提交页就停下，不点提交。加 `--submit` 才会真的提交。

## 为什么是本地程序

| 方案 | 复用已登录账号 | 原生上传文件 | 连续多页 | 浏览器关掉还能跑 |
|---|---|---|---|---|
| 网页 | ✅ | ❌ | 受限 | ❌ |
| 浏览器扩展 | ✅ | 需绕路 | ❌ 需人工点每页 | ❌ |
| **本地 Agent** | ✅ | ✅ | ✅ | ✅（窗口最小化也跑） |
| 云浏览器 | ❌ 要交密码 | ✅ | ✅ | ✅（但风控最严） |

密码永远不出你本机：Agent 只用浏览器里已有的登录态（持久化 profile）。

## 快速开始

```bash
# 1. 登录（令牌从浏览器 Local Storage 里的 sb-*-auth-token 复制 access_token）
pnpm agent login --token=<access_token> --resume-id=<简历ID>

# 2. 体检
pnpm agent doctor

# 3. 首次准备：在这个窗口里登录雇主账号（登录态会保存）
pnpm agent open https://boards.greenhouse.io/airbnb

# 4. 演练：只填不提交
pnpm agent run --urls=jobs.txt

# 5. 确认无误后真提交
pnpm agent run --urls=jobs.txt --submit --max=5
```

`jobs.txt` 一行一个岗位链接；也支持 JSON：`[{ "id": 1, "url": "...", "company": "...", "title": "..." }]`。

## 每一步做什么

1. 打开岗位页 → 等页面稳定；
2. 如果有文件输入框，先把简历塞进去（ATS 常会用自家解析器回填，我们只补差集）；
3. 扫描所有 frame（含 iframe / shadow DOM / 自定义下拉 / 单选组）；
4. 调用 `POST /api/apply/resolve`：配方 + 90 题词库 + 档案推导，默认零 AI；
5. 逐字段填写并回读校验；
6. 有必填缺口就停下（不硬投），否则点「下一步」继续；
7. 到提交页：演练模式停，提交模式点提交并抓回执（确认号 + 截图）。

产物：`output/apply-<时间>/results.json` + `screenshots/`。

## 安全边界（刻意做成这样）

- **不存密码**、不代登录、不导出 cookie；
- **高敏字段永不代答**（EEO、授权签名、婚育签证等），只在报告里给建议值；
- **必填缺口即停**：宁可让你补 3 个空，也不投出一份被静默淘汰的申请；
- **不绕过验证码**：遇到人机验证就停下来等人工；
- **限速**：`--max` 控制单次数量，别一次跑 100 单（账号风控）。

## 支持范围

配方内置：Workday / Greenhouse / Lever / Ashby / SmartRecruiters / iCIMS / Taleo / SuccessFactors + 通用兜底。
未命中配方时走通用启发式（词库 + 属性 + section 上下文），覆盖率会下降但不会崩。

## 排障

| 现象 | 处理 |
|---|---|
| `解析接口失败：401` | 令牌过期，重新 `pnpm agent login` |
| 登录态丢失 | `pnpm agent open <站点>` 重新登录一次 |
| 停在「待人工」 | 看 `results.json` 的 `pendingRequired`，补档案后重跑 |
| 字段全没识别 | 站点可能是自建 ATS，需要补配方（见 `src/lib/apply/recipes.ts`） |
| 提交后没有确认号 | 报告里会给截图，人工确认；同时把该站点记为配方失配 |

## 自测

```bash
pnpm test:agent        # 本地夹具：三步向导 + 单页表单（shadow DOM / 自定义下拉 / 上传）
```

夹具在 `agent/fixtures/`，不需要外网。
