# Liorvix 收费模式实施计划

> 状态：方案定稿（2026-08-16，用户确认“按推荐来”）
> 范围：本文件只描述规划和实施蓝图，不包含代码改动

## 1. 目标

Liorvix 面向海外留学生提供一站式求职服务。平台采用订阅制收费，分为两个版本：

- Basic：免费获客层，开放简历管理、岗位查询、AI 选岗、ATS 简历优化
- Pro：深度付费层，核心开放 AI 模拟面试，并包含 Networking、自动网申

用户路径覆盖“接触了解 → 简单体验 → 深度付费”，通过体验额度、Paywall 和完整报告锁定完成转化。

## 2. 已确认决策

| 决策 | 结论 |
| --- | --- |
| Basic 是否收费 | 免费，AI 能力按月限量 |
| 免费体验形式 | 注册送体验额度，不用时间型试用 |
| 支付渠道 | Stripe（Checkout + Customer Portal + Webhook） |
| Pro 范围 | AI 模拟面试、Networking、自动网申 |
| 首发价格 | Pro `$29/月`，年付约 8 折 |

## 3. 套餐与功能矩阵

| 能力 | Basic | Pro |
| --- | --- | --- |
| 简历管理 | 无限 | 无限 |
| 岗位查询 / 收藏 / 追踪 | 无限 | 无限 |
| AI 选岗 | 每月 3 次 | 无限 |
| ATS 简历优化 | 每月 3 次 | 无限 |
| 个人求职驾驶舱 | 完整开放 | 完整开放 |
| Networking 建议 | Pro 专属 | 完整开放 |
| AI 模拟面试 | 注册送 3 次，用完锁定 | 无限（核心权益） |
| 自动网申 / 求职档案 | 不开放 | 开放 |
| 性格测评 | 1 次体验 | 无限 |

## 4. 体验额度模型

- 新用户注册后一次性发放：
  - AI 模拟面试 3 次
  - AI 选岗 3 次
  - ATS 简历优化 3 次
- Basic 用户每月 1 日重置 AI 选岗 / ATS 优化额度
- 体验额度不叠加、不转移；超量后只能升级 Pro 或购买次数包
- Pro 用户可购买“面试次数包”，按次计费，不设硬上限

## 5. 用户转化路径

```mermaid
flowchart LR
  A[免费浏览岗位/首页] --> B[注册并获赠体验额度]
  B --> C[上传简历与分层]
  C --> D[AI 选岗 / ATS 优化消耗额度]
  D --> E[体验 AI 模拟面试]
  E --> F[完整报告/高级功能锁定]
  F --> G[Paywall -> Stripe Checkout]
  G --> H[Pro 全功能 + 次数包]
```

关键钩子：

- 模拟面试首轮可体验，完整评分报告、复盘、语音实时面试属于 Pro
- 驾驶舱完整免费，Networking 和深度付费功能按权限解锁
- 导航与首页卡片展示用量进度和升级入口

## 6. 数据模型

新增 5 张表，沿用 `supabase/migrations` 迁移体系：

### 6.1 plans

- `id`、`code`（`basic` / `pro`）、`name`
- `price_monthly`、`price_yearly`、`currency`
- `entitlements JSONB`、`is_active`、`sort_order`
- `created_at`、`updated_at`

### 6.2 subscriptions

- `id`、`user_id`（唯一）、`plan_id`
- `stripe_customer_id`、`stripe_subscription_id`
- `status`（`active` / `trialing` / `past_due` / `canceled`）
- `billing_interval`、`current_period_start`、`current_period_end`
- `cancel_at_period_end`、`created_at`、`updated_at`

### 6.3 entitlements

- `id`、`plan_id`
- `feature_code`：`ai_match`、`ats_optimize`、`mock_interview`、`networking`、`auto_apply`
- `quota_per_month`、`grant_on_signup`、`is_active`

### 6.4 usage_ledger

- `id`、`user_id`、`feature_code`
- `period_start`、`period_end`、`used_count`
- `source`（`plan_quota` / `credit_pack` / `grant`）
- `credit_pack_id`、`ai_usage_event_id`
- `created_at`

### 6.5 credit_packs

- `id`、`user_id`、`feature_code`
- `stripe_payment_intent_id`、`quantity`、`remaining`
- `status`、`created_at`

## 7. 权限与接口改造

### 7.1 核心库

新增 `src/lib/entitlements.ts`：

- `getUserEntitlements(userId)`：读取订阅、权益、周期内用量
- `requirePlan(feature)`：校验套餐权限
- `consumeUsage(feature)`：并发安全扣减额度，并关联 `ai_usage_events`

### 7.2 需要接入权限的现有接口

- `/api/ai/match`
- `/api/ai/optimize`
- `/api/interview/chat`
- `/api/interview/realtime-ticket`
- `/api/interview/summary`
- `/api/networking/*`
- `/api/application-profile/ai-fill`

### 7.3 统一错误契约

```json
{
  "error": {
    "code": "PLAN_REQUIRED" | "USAGE_EXHAUSTED",
    "message": "...",
    "upgradeUrl": "/pricing"
  }
}
```

前端通过统一 `PaywallDialog` 组件处理。

### 7.4 WebSocket

实时语音面在 `/api/interview/realtime-ticket` 签发时校验 Pro 权益和额度；票据本身不携带订阅状态，服务端每次校验票据哈希。

## 8. Stripe 接入

### 8.1 API

- `POST /api/billing/checkout`：创建 Pro 订阅 Checkout
- `POST /api/billing/portal`：进入 Customer Portal
- `POST /api/billing/webhook`：接收 Stripe 事件
- `GET /api/billing/status`：返回订阅状态、周期、用量

### 8.2 Webhook 事件

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

支付失败时保留 Pro 并提示补卡；连续失败超过宽限期后降级到 Basic。

### 8.3 环境变量

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_PRO_MONTHLY`
- `STRIPE_PRICE_PRO_YEARLY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

## 9. 前端触点

- 新增 `/pricing`：套餐对比、Pro 权益、购买按钮
- 新增 `/account/billing`：订阅状态、发票、周期内用量、次数包
- 导航新增“升级”按钮和套餐 Badge
- 首页功能卡片对 Pro 能力显示锁标识
- 模拟面试结果页锁定完整报告时弹出 Paywall
- 全局用量提示：额度剩余 N / M，点击进入 `/account/billing`

## 10. 管理后台

在现有 `src/components/admin-shell.tsx` 增加“商业化”分组：

- 收入概览：MRR、活跃订阅、新订阅、取消、退款
- 订阅列表：用户、套餐、状态、周期、到期时间
- 用户详情扩展：套餐、额度、AI 成本、用量记录
- 运营操作：手动调整套餐、补发额度、关闭订阅
- 定价看板：Pro 用户平均 AI 成本 vs 收入，用于验证价格

## 11. 实施阶段

### 阶段 1：额度与 Paywall（不接支付）

- 数据库迁移：5 张表 + RLS
- `entitlements.ts` 与现有接口接入
- 注册送额度、Basic 月度限额
- `/pricing`、`PaywallDialog`、用量提示

验收：新用户只能体验 3 次面试；额度用尽后所有 Pro 接口返回 `403`。

### 阶段 2：体验闭环验证

- 模拟面试完整报告锁定
- Networking 模块锁定
- 后台学生详情展示额度与 AI 成本

验收：完成“注册 → 体验 → 用尽 → 升级引导”全链路。

### 阶段 3：Stripe 订阅

- Checkout、Portal、Webhook
- 订阅状态机、宽限期、降级
- 发票与退款记录

验收：真实 Stripe 测试环境可完成订阅、续费、取消、降级。

### 阶段 4：Pro 全功能解锁

- 面试、Networking、自动网申全部挂到 entitlements
- 次数包购买与消耗

### 阶段 5：商业化看板与定价验证

- 后台商业化页面上线
- 用 `ai_usage_events` + `ai_model_prices` 计算单用户真实成本
- 根据转化率和成本调整价格、体验额度

## 12. 上线指标

- 注册 → 首次上传简历转化率
- 体验额度使用率
- 体验 → Pro 付费转化率
- 单用户月均 AI 成本
- MRR、订阅流失率、退款率
- 面试次数包购买率

## 13. 风险与边界

- AI 成本失控：上线前用现有用量数据做成本模拟，动态调整免费额度
- 并发超用：额度扣减必须事务化，并以 `ai_usage_events` 为最终来源
- Stripe 事件乱序/重放：Webhook 使用 `event.id` 幂等，先更新数据库再返回成功
- 体验价值不足：完整报告和语音能力必须只在 Pro 解锁，避免免费层“够用”
- 政策合规：发票、退款、订阅取消需符合目标地区法规，正式上线前做法务确认
