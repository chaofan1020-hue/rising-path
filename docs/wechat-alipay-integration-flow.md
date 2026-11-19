# 微信支付 / 支付宝接入流程（Liorvix）

本文只写「从零到上线」要做的事，按顺序执行。代码链路已经在仓库里，接的是**商户资质、密钥、回调地址和开关**。

相关文档：`docs/icp-filing-and-payment.md`（备案与商户申请）、`docs/payment-foundation.md`（代码现状）、`docs/payment-production-checklist.md`（验收清单）、`docs/payment-site-rollout.md`（支付站交接）。

---

## 0. 先理解现在的链路

```
主站 (liorvix.com)                         支付站 (/pay)
用户点购买
  └─ POST /api/billing/handoff      签发 10 分钟一次性 ticket（库里只存 HMAC 摘要）
      └─ 302 →  /pay/checkout?ticket=...
                    └─ POST /api/payments/handoff/redeem
                        └─ 兑换 ticket、写 HttpOnly 会话 cookie、返回订单快照
                            └─ POST /api/billing/orders   按套餐创建订单和支付尝试
                                ├─ 微信：/v3/pay/transactions/native  → 二维码
                                ├─ 微信：/v3/pay/transactions/h5      → 跳转链接
                                ├─ 支付宝：alipay.trade.precreate     → 二维码
                                └─ 支付宝：alipay.trade.wap.pay       → 跳转链接
                            └─ 前端每 4 秒 GET /api/payments/session/status（服务端查单对账）
支付机构异步通知
  ├─ POST /api/payments/wechat/notify    验签 → 解密 → 幂等入库
  └─ POST /api/payments/alipay/notify    RSA2 验签 → 幂等入库
        └─ RPC complete_billing_order（金额必须匹配、订单只发放一次积分）
```

关键约束：

- 金额只来自 `billing_plans` 表，客户端传任何 `amount/credits/price` 都会被 400 拒绝。
- 同一用户同时只能有一笔待支付订单（`billing_orders_one_open_per_user_uidx`）。
- 支付成功页不会直接发积分，只显示状态；积分以服务端验签回调或**渠道查单金额**为准入账。
- 展示价是美元目录价 `display_amount_minor`，实际扣款是人民币 `amount_minor`（分）。国内商户号只能收人民币。
- 桌面走 Native / 支付宝扫码，手机走 H5 / 支付宝 WAP（`src/lib/billing-device.ts`）。
- 现在**没有实现**微信 JSAPI（公众号内支付）和自动续费，`plan_type = subscription` 的套餐会被 409 拒绝。

---

## 1. 前置条件（全部满足才能进第 2 步）

| 条件 | 说明 |
| --- | --- |
| 企业或个体户主体 | 个人主体办不了微信网站支付 |
| 已备案域名可公网访问 | 商户审核会打开看，主体要和营业执照一致；文案写「信息技术服务 / 职业咨询」，不要写招聘中介 |
| 官网有价格、售后/退款说明、联系方式 | 审核最常见的驳回原因 |
| 对公账户 | 提现和结算用 |
| 法人身份证、营业执照彩照 | 均在有效期内 |

备案流程见 `docs/icp-filing-and-payment.md` 第一至第三步。

---

## 2. 申请商户号并拿到密钥

> **这一步的逐项操作已展开成独立手册：[wechat-alipay-step2-merchant-credentials.md](wechat-alipay-step2-merchant-credentials.md)**，包含每个参数在哪个菜单取、为什么需要它、以及官方文档里的绑定限制。下面是摘要，实际执行以手册为准。

### 2.1 微信支付（对应 Native / H5）

1. [微信支付商户平台](https://pay.weixin.qq.com/) 用营业执照申请普通商户号，得到 `WECHAT_PAY_MCH_ID`。
2. 开通 **Native 支付**（桌面扫码）。H5 支付审核更严，可能要求经营性 ICP 许可证，第一阶段先不开。
3. 关联 AppID：必须是**已通过微信认证的服务号 / 小程序 / 企业微信 / 移动应用**，且两边的绑定是双向确认（商户侧发起 + 公众号侧确认）。
4. 账户中心 → API 安全：
   - 设置 **APIv3 密钥**（正好 32 字符）→ `WECHAT_PAY_API_V3_KEY`，用于回调解密。
   - 申请 **商户 API 证书**，得到商户私钥 `apiclient_key.pem` → `WECHAT_PAY_PRIVATE_KEY`，证书序列号 → `WECHAT_PAY_SERIAL_NO`。
   - 下载 **微信支付公钥**（新接入推荐，长期有效，替代平台证书）→ `WECHAT_PAY_PLATFORM_PUBLIC_KEY`，仅存量商户仍用平台证书 `WECHAT_PAY_PLATFORM_CERTIFICATE`，用于回调验签。
5. 产品中心配置支付回调地址：`https://liorvix.com/api/payments/wechat/notify`
6. 环境变量按 PEM 单行写，用 `\n` 代替换行；代码会自动还原（`pem()`）。

### 2.2 支付宝（对应扫码 / WAP）

1. [支付宝开放平台](https://open.alipay.com/) 创建**网页/移动应用**，得到 `ALIPAY_APP_ID`。
2. 签约 **电脑网站支付** 或 **当面付**（`alipay.trade.precreate` 扫码需要当面付或电脑网站支付能力）。
3. 开发设置：
   - 应用私钥 → `ALIPAY_PRIVATE_KEY`（RSA2，2048 位）
   - 支付宝公钥 → `ALIPAY_PUBLIC_KEY`
   - 接口加签方式选 **公钥模式 + RSA2**，不要把 `sign_type` 改成 RSA。
4. 异步通知：`https://liorvix.com/api/payments/alipay/notify`
5. 同步跳转：`https://liorvix.com/account/billing`（`ALIPAY_RETURN_URL`）
6. 网关保持 `https://openapi.alipay.com/gateway.do`（`ALIPAY_GATEWAY_URL`）。沙箱联调时只改这一项为沙箱网关，并同时换沙箱 AppID 和密钥；正式上线必须改回生产网关。

> 支付宝的「应用公钥」是**你自己的**，`ALIPAY_PUBLIC_KEY` 填的是**支付宝公钥**。填反了会表现为"创建订单失败 / 验签失败"。

---

## 3. 数据库迁移

按顺序应用到**目标** Supabase（先 dry-run，再执行，再查 `public.liorvix_migration_history`）：

```
0116_payment_foundation.sql        套餐表、支付尝试表、RLS
0117_payment_order_settlement.sql  订单入账
0118_billing_refund_settlement.sql 退款扣回
0119_billing_payment_hardening.sql complete_billing_order / complete_billing_refund（金额校验 + 幂等）
0120_billing_usd_catalog.sql       USD 展示价列
0131_payment_handoff_tickets.sql   主站→支付站一次性票据表（部署支付站才需要）
```

回填/核对 `complete_billing_order` 与 `complete_billing_refund` 必须存在且 `security definer`，只授予 `service_role`：

```sql
select proname, prosecdef from pg_proc
where proname in ('complete_billing_order','complete_billing_refund','prepare_billing_refund','finalize_billing_refund');
```

套餐价格在 `billing_plans`。改价只改这张表，**不要写死在页面**。`amount_minor` 是人民币分，`display_amount_minor` 是美元分。

---

## 4. 写环境变量（只写服务器）

密钥**绝不进 Git、不进构建产物、不进 `.env.example`**。模板见 `.env.example` 第 111–139 行。

美国生产 `/opt/liorvix/.env.local` 最小集合：

```bash
# 总开关，最后再打开
BILLING_ENABLED=false
BILLING_DEFAULT_CURRENCY=CNY
BILLING_USD_CNY_RATE=7.2

WECHAT_PAY_ENABLED=false
WECHAT_PAY_MCH_ID=
WECHAT_PAY_APP_ID=
WECHAT_PAY_SERIAL_NO=
WECHAT_PAY_PRIVATE_KEY=
WECHAT_PAY_API_V3_KEY=
WECHAT_PAY_NOTIFY_URL=https://liorvix.com/api/payments/wechat/notify
WECHAT_PAY_PLATFORM_CERTIFICATE=

ALIPAY_ENABLED=false
ALIPAY_APP_ID=
ALIPAY_PRIVATE_KEY=
ALIPAY_PUBLIC_KEY=
ALIPAY_NOTIFY_URL=https://liorvix.com/api/payments/alipay/notify
ALIPAY_RETURN_URL=https://liorvix.com/account/billing
ALIPAY_GATEWAY_URL=https://openapi.alipay.com/gateway.do

# 主站和支付站必须一致；至少 32 字符随机串，不以 NEXT_PUBLIC_ 开头
PAYMENT_HANDOFF_SECRET=
# 支付站公网地址；不设置时用当前请求域名
PAYMENT_SITE_URL=
```

还有两条硬性运行条件：

1. **Supabase service role key**：支付站和主站都要有，回调入账走 service role。
2. 回调路由跑在 Node 运行时（用到 `node:crypto`），不要给 `/api/payments/*` 加 edge runtime。

生成随机串：

```bash
openssl rand -hex 32
```

写完后**先不要重启打开**，跑检查：

```bash
pnpm run check:billing-readiness
```

输出只有变量名和 HTTPS 告警，不含密钥值。有 `missing` 就补齐，有 `warnings` 先修掉；`configured` 全为 true 才继续。

---

## 5. 部署

1. 把包含支付代码的版本部署到支付要用的机器，保持三个开关为 `false`。
2. 如果启用支付站（独立域名）：同一份构建、同一个 Supabase、同样的 `PAYMENT_HANDOFF_SECRET` 和 `PAYMENT_SITE_URL`，部署后主站下单会跳 `https://<支付域名>/pay/checkout`。
3. 如果不拆支付站，`PAYMENT_SITE_URL` 留空，主站自己承载 `/pay/checkout`（用于验证模式）。
4. 确认 Nginx / 反向代理**原样转发 body**（支付宝回调是 `application/x-www-form-urlencoded`，微信回调验签基于原始 body），且 `X-Forwarded-For` 透传（微信 H5 需要真实客户端 IP）。
5. 回调地址公网可达，且**不能有任何鉴权中间件拦截**：`/api/payments/*` 必须是公开 POST 入口。

---

## 6. 打开开关（先一个渠道）

推荐顺序：**先支付宝，再微信**（支付宝开通更快，微信 AppID 关联卡点更多）。

```bash
# 第一轮：只开支付宝
BILLING_ENABLED=true
ALIPAY_ENABLED=true
WECHAT_PAY_ENABLED=false
```

```bash
pnpm run check:billing-readiness   # checkoutReady 应为 true
pnpm run test:billing
pnpm run test:billing-contract
pnpm run test:billing-payment
```

重启服务后，`GET /api/billing/plans` 的 `billing.alipayEnabled` 应为 `true`，页面套餐会开始允许下单。

微信开关同理，等支付宝全流程验收通过后再单独打开。两个渠道都验收通过才同时开。

---

## 7. 验收用例（必须逐条打勾）

> 支付成功但订单一直显示待支付、积分不到账的根因、修复与补单流程，见 [payment-settlement-troubleshooting.md](payment-settlement-troubleshooting.md)。

用一个测试账号、最小金额套餐执行：

- [ ] 桌面扫码：二维码可扫，客户端显示渠道金额（元）与页面美元标价不同时，用户无投诉口径问题。
- [ ] 手机 H5 / WAP：能拉起支付，且 H5 记录到真实客户端 IP。
- [ ] 支付成功：4 秒轮询内状态变 `paid`，积分只加一次。
- [ ] 支付后**关掉浏览器**：再次进订单页，状态通过查单变 `paid`，积分到账。
- [ ] 重复回调：同一个 `event_id` 重放，返回成功但 `billing_webhook_events` 为 `processed` 且不重复加积分。
- [ ] 重复轮询：多次 `GET /api/billing/orders/:id/status` 只结算一次。
- [ ] 金额篡改：回调金额与订单不等时返回失败，订单保持未支付，日志有 `PAYMENT_AMOUNT_MISMATCH`。
- [ ] 用户主动取消：`POST /api/billing/orders/:id/cancel` 同时关闭渠道订单，状态 `cancelled`。
- [ ] 超时：2 小时后未支付，前端自动关单，渠道侧订单也关闭。
- [ ] 双开订单：同一用户同时点两笔，只剩一个结账上下文。
- [ ] 延迟回调：本地已取消/过期后渠道才回调成功，仍按实收入账（不吞钱）。
- [ ] 退款：后台 `/admin/billing` 发起退款 → 扣回积分；`partially_refunded` 可再次查询完成。
- [ ] 失败回调可重试：`billing_webhook_events.status = failed` 的事件可被重放处理。

排查用 SQL：

```sql
select status, result, processed_at from public.billing_webhook_events
where provider = 'alipay' order by id desc limit 20;

select o.order_no, o.status, a.provider, a.channel, a.status, a.merchant_order_no, a.provider_trade_no
from public.billing_orders o join public.payment_attempts a on a.order_id = o.id
order by o.created_at desc limit 20;
```

---

## 8. 常见失败与对应原因

| 现象 | 常见原因 |
| --- | --- |
| `BILLING_DISABLED` / `BILLING_PROVIDER_DISABLED` | 开关没开或 `check:billing-readiness` 里有 missing |
| `BILLING_PROVIDER_DISABLED`（开关是 true） | 缺密钥或回调 URL 不是 HTTPS |
| `CLIENT_IP_REQUIRED` | 微信 H5 拿不到 `X-Forwarded-For`，检查反向代理 |
| 扫了码但积分不到 | 回调没到：看 `billing_webhook_events` 是否有记录；没记录就是 Nginx 拦截、URL 填错或域名未备案导致微信拦截 |
| 回调返回 `fail` | 验签失败（平台证书/支付宝公钥填错、body 被改写）或 `PAYMENT_AMOUNT_MISMATCH` |
| `PAYMENT_ATTEMPT_NOT_FOUND` | 订单的支付尝试被手动改过或回调里的 `out_trade_no` 不是我们发出去的 |
| 支付宝报 `sign check fail` | `ALIPAY_PUBLIC_KEY` 填成了应用公钥，或 `sign_type` 不是 RSA2 |
| 微信报 401/签名错误 | `WECHAT_PAY_SERIAL_NO` 与私钥不匹配，或时间漂移超过 5 分钟 |

---

## 9. 退款与对账

- 用户退款统一走后台 `/admin/billing`，不要手工调渠道接口；否则积分和订单状态会对不上。
- 退款流程：`prepare_billing_refund` 锁定并预扣积分 → 调渠道退款 → 成功 `finalize_billing_refund(success)`，失败回滚积分。
- 退款回调（微信 `REFUND.*` / 支付宝带回 `refund_fee`）会走 `complete_billing_refund`，与后台操作幂等互不冲突。
- 每日对账建议：以渠道账单为准，与 `billing_orders(status='paid')`、`credit_ledger(entry_type='purchase')` 三方比对；差额按 `order_no` 排查。

---

## 10. 明确还没做的（别指望它工作）

- 微信 JSAPI / 公众号内支付、小程序支付
- 自动续费 / 订阅扣款（相关套餐目前被拒）
- 跨境收单（境外卡、按汇率收美元）
- 自动对账任务、发票/税务

需要这几项时再单独立项，现有 `BillingProvider` 接口留了扩展位。
