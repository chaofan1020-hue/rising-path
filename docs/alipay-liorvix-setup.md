# 支付宝接入：Liorvix 专属操作手册（第二步·支付宝部分）

对象：成都数橙研策科技有限公司，运营 Liorvix（`liorvix.com` 产品站，`liorvix.cn` 备案官网）。
本文每一步都对应到你**这个平台的具体代码和页面**，照着做，做完第 8 步就能扫出一张真的收款二维码。

---

## 0. 先认识你在接什么：三个通道，两个接口

你的代码不是接「一个支付宝收银台」，而是根据设备自动选通道（[billing-device.ts](../src/lib/billing-device.ts)）：

| 用户在哪 | 代码选的 channel | 调的支付宝接口 | 用户看到什么 |
| --- | --- | --- | --- |
| 电脑浏览器 | `alipay_qr` | `alipay.trade.precreate` | 你在页面上自绘的二维码，用支付宝 App 扫 |
| 手机浏览器（iPhone/Android 手机 UA、iPad 触摸设备） | `alipay_wap` | `alipay.trade.wap.pay` | 点「打开支付页面」跳到支付宝收银台 |

对应要开通的**产品**（这是签约的核心）：

- `alipay.trade.precreate`（扫码）→ 需要 **当面付**（当面付就含扫码能力；没开当面付时，电脑网站支付同样支持扫码，见 5.3）
- `alipay.trade.wap.pay`（手机网页）→ 需要 **电脑网站支付**（该产品同时覆盖 PC 网页与移动 H5 网页收银台）

> 一句话：**开通「电脑网站支付」是必须的；「当面付」能开就一起开**，这样电脑扫码和手机网页两条路都在，覆盖你 100% 的设备分布。

---

## 1. 开通前先修一个站：审核会打开你的官网，现在会被卡

支付宝审核会看：
1. 能打开；
2. 有明确经营内容；
3. **有完整的商品信息和价格**；
4. 备案主体与支付宝账号主体一致。

对照你的站：

| 检查项 | 现状 | 结论 |
| --- | --- | --- |
| 能公网打开 | `https://liorvix.cn` 正常 | ✅ |
| 备案主体 | 蜀ICP备2026019930号-2，成都数橙研策科技有限公司 | ✅ 与营业执照一致 |
| 经营内容 | 有首页/关于/联系/隐私/协议 | ✅ |
| **商品价格页** | 有服务方案区块，但**没有人民币实收价**，且混入了当前不可购买的 Pro/Career 月卡 | ⚠️ **已帮你修正**（见下） |
| 站点主体署名 | 页脚已有「主办单位：成都数橙研策科技有限公司」+ 备案号 + 版权所有 | ✅ |

### 我已经改好的部分

- `deploy/icp-site/index.html`：价格改为人民币实收价（￥49 / ￥99 / ￥199），移除月卡，副标题改成「一次性积分方案，支付宝或微信结算，登录产品站购买」。
- `deploy/icp-site/checkout.html`：方案表同步改人民币、去掉月卡，补充「积分 365 天有效」「支付成功后数分钟内到账」「退款原路退回」「客服邮箱 support@liorvix.com / 3 个工作日回复」。

改后的官网价格表，与数据库 `billing_plans` 一一对应（库里存的是「分」，页面显示「元」）：

| 套餐 | 说明 | 积分 | 展示价 | 数据库 `amount_minor` |
| --- | --- | --- | --- | --- |
| 体验包 `cn_explorer_49` | 适合偶尔使用 AI 的求职者 | 500 | ￥49.00 | 4900 |
| 求职包 `cn_job_99` | 适合集中求职阶段 | 1200 | ￥99.00 | 9900 |
| 高频包 `cn_high_199` | 适合高频使用 AI 的求职者 | 2800 | ￥199.00 | 19900 |

> 为什么删掉月卡：`plan_type = subscription` 在下单时会被 409 拒绝（[orders/route.ts:93](../src/app/api/billing/orders/route.ts#L93)），官网挂着一个买不了的商品，既是审核风险也是投诉来源。等自动续费功能做完再加回来。

```bash
# 把两页同步到上海备案站（在本机执行，确认无误后跑）
scp deploy/icp-site/index.html deploy/icp-site/checkout.html root@115.159.38.86:/www/wwwroot/liorvix-cn/
# 同步后在浏览器打开 https://liorvix.cn 和 https://liorvix.cn/checkout.html 各看一遍
```

> 为什么必须先做：申请被驳回最常见的三条就是「网站打不开」「没有价格」「没有售后说明」。先补完再提交，能省掉一轮 1–3 个工作日的重审。

---

## 2. 注册/确认企业支付宝，并和开放平台对上号

1. 用**企业对公账户**注册或确认企业支付宝账号（<https://member.alipay.com>），完成企业实名。
2. 确认三件事完全一致：
   - 营业执照名称：**成都数橙研策科技有限公司**
   - 对公账户户名：同上
   - 法定代表人：营业执照上的那个人
3. 实名认证的**主体名称**如果和营业执照差一个字（少「有限公司」、多了「（成都）」等），后面 ICP 主体比对会不过，先去改。

**为什么**：支付宝签约时要校验「申请账号主体 = 网站备案主体」。你用的是对公账户收款，企业实名不通过的话，个人账户签约会限制收款额度，而且和个人实名绑定的对公提现也有障碍。

---

## 3. 创建应用 → 拿到 APPID（`ALIPAY_APP_ID`）

1. 打开 <https://open.alipay.com/>，用**第 2 步那个企业支付宝账号**登录。
2. 进入控制台 → 创建应用 → 选 **网页/移动应用**（自研商家接入模板）。
   - ❌ 不要选「小程序」：你没做支付宝小程序。
   - ❌ 不要选「第三方应用」：那是给服务商的。
3. 应用名称建议填和官网一致的：`Liorvix求职服务平台`，应用类型选网页。
4. 创建成功后在应用详情页顶部看到 `20210xxxxxxxxxxxxx` 这串数字 → 这就是 `ALIPAY_APP_ID`，**记到密码管理器**。

**为什么是「网页/移动应用」**：你的产品是浏览器里的网站，收银台走的是网页跳转类接口（`page.pay` / `wap.pay`）和服务器 API（`precreate`），这些接口都授权给「网页/移动应用」。

---

## 4. 开发设置：四项配置一次填对（这一步填错，后面全部调不通）

进入 **开发 → 开发设置**，逐项：

### 4.1 接口加签方式 = 公钥模式 + RSA2（**最关键，选错只能重建应用**）

你的代码是纯 Node `crypto` 手写签名，没有用支付宝 SDK：

```ts
// src/lib/alipay-provider.ts
const signer = createSign('RSA-SHA256');
signer.sign(createPrivateKey(pem(required('ALIPAY_PRIVATE_KEY'))))
```

这段签名逻辑**只对应「公钥模式」**。如果后台选了**公钥证书模式**，支付宝会要求你每次请求额外带 `app_cert_sn` / `alipay_root_cert_sn` 两个参数，代码里没有实现 → 每一次请求都会被拒。

- ✅ 选：**公钥**（RSA2）
- ❌ 不选：公钥证书
- ❌ 不选：RSA（旧算法，代码固定 `sign_type=RSA2`）

### 4.2 服务器 IP 白名单

填：`43.172.117.125`（美国生产机）。
**为什么**：你的私钥存在服务器上，IP 白名单是万一泄露后的最后一道闸——支付宝只接受来自这个 IP 的请求。注意如果将来加了 CDN 出站或换机，要同步改这里。**初期不确定出口 IP 可以先空着，验收完再补**，别因为填错导致验收阶段全部被拒。

### 4.3 应用网关

填：`https://liorvix.com/api/payments/alipay/notify`

**为什么这里不是决定性配置**：应用网关是「From 蚂蚁消息服务」用的（例如退款到银行卡的回执通知）。你的交易回调实际走的是**下单时传入的 `notify_url`**（[alipay-provider.ts:96](../src/lib/alipay-provider.ts#L96) 读 `ALIPAY_NOTIFY_URL`）。但因为这是必填项，填成同一个地址最省事，将来订阅消息服务也不会互相打架。

### 4.4 授权回调地址

**留空**。这是给「用户信息授权」用的，你的平台用邮箱登录，不拉取支付宝用户信息。填了反而要求你处理 `auth_code`，白增加一个攻击面。

---

## 5. 生成密钥 → 上传应用公钥 → 拿回支付宝公钥

### 5.1 在你自己的电脑上生成（不要用在线工具、不要别人代生成）

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out alipay_app_private_key.pem
openssl pkey -in alipay_app_private_key.pem -pubout -out alipay_app_public_key.pem
```

**为什么 2048 位**：RSA2 强制要求 ≥2048 位；1024 位会被支付宝拒绝，且有安全性问题。

### 5.2 上传「应用公钥」，复制回「支付宝公钥」

在 4.1 的加签方式里点「查看/设置」，粘贴 `alipay_app_public_key.pem` 的内容，提交后页面会显示两把钥匙：

- **应用公钥** —— 你刚上传的，是「你 → 支付宝」的证明
- **支付宝公钥** —— 支付宝生成的，是「支付宝 → 你」的证明（验异步通知签名用）

把**支付宝公钥**复制下来 → `ALIPAY_PUBLIC_KEY`。
把**应用私钥**（`alipay_app_private_key.pem`）→ `ALIPAY_PRIVATE_KEY`（**只放服务器，绝不进 git**）。

> ⚠️ 你平台最高频的故障：把「应用公钥」填进了 `ALIPAY_PUBLIC_KEY`。表现为每次下单都报 `支付宝响应验签失败`（[alipay-provider.ts:73](../src/lib/alipay-provider.ts#L73)），或查询接口一直报错。两把钥匙名字很像，**认准哪一把是支付宝给的**。

### 5.3 提交应用上线（约 1 个工作日）

开发设置填完 → 提交审核 → 应用状态变成 **已上线**。

**为什么必须上线**：未上线的应用只能走沙箱，线上网关 `openapi.alipay.com` 会直接拒绝，表现为 `isv.app-not-online`。**上线前不要开 `ALIPAY_ENABLED=true`**，否则用户点了购买会看到「创建支付订单失败」。

---

## 6. 开通产品：电脑网站支付 +（当面付）

1. 登录商家平台 <https://b.alipay.com>，用**和应用同一个企业账号**。
2. 产品中心 → 搜索 **电脑网站支付** → 立即开通。
3. 开通时填写的资料：
   - 网站地址：**`https://liorvix.cn`**（备案站，主体一致）
   - 经营内容：信息技术服务 / 在线信息服务 / 职业发展咨询（**不要写招聘、人力资源、中介**）
   - 客服与售后：`support@liorvix.com`
4. 提交后看状态页 <https://mrchportalweb.alipay.com/dynlink/productSign/signManage.htm>。

再开 **当面付**（可选但建议）：产品中心 → 当面付 → 开通 → 经营场景选「线上」，主要用于电脑扫码出码。

**为什么这两个都要**：`alipay.trade.precreate`（电脑扫码）靠当面付能力，`alipay.trade.wap.pay`（手机网页）靠电脑网站支付能力。只开一个，你在另一类设备上就会看到「暂不支持该设备」。

### 你的套餐和实际扣款金额（**这一条会影响用户体验，务必确认**）

代码里页面展示价和实际扣款**不是同一个数**：

| 套餐 | 页面展示（USD，来自 `display_amount_minor`） | 实际扣款（CNY，来自 `amount_minor`） |
| --- | --- | --- |
| 体验包 | $6.99 | **49.00 元** |
| 求职包 | $13.99 | **99.00 元** |
| 高频包 | $27.99 | **199.00 元** |

扣款金额由 [orders/route.ts:96](../src/app/api/billing/orders/route.ts#L96) 从 `billing_plans.amount_minor` 读取，客户端传价格会被 400 拒绝（这是安全设计，别改）。但用户看到 $13.99 却在收银台被扣 99 元，**是典型的投诉来源和审核风险**。

三个选择（按推荐排序）：

- **A（推荐，最稳）**：把 `display_currency` 显示成人民币，即 `$` 改成 `¥`，展示价直接等于实收价。
- **B**：页面保留美元，但在结算页加一行「实际以人民币收款：¥99.00（约 $13.99）」。
- **C**：接入跨境收单（需要跨境商户号，短期做不到）。

### 为什么费率退回窗口要写进退款规则

支付宝电脑网站支付：费率 **0.6%/笔**，退款窗口 **交易后 12 个月内**，资金原路退回，**退款时手续费不退**。你的[后台退款](../src/app/api/admin/billing/route.ts)走的就是 `alipay.trade.refund`，超过 12 个月的交易会退不了，届时只能走人工转账——这条得写进 terms.html，避免客诉时无据可依。

---

## 7. 填环境变量（写在美国服务器 `/opt/liorvix/.env.local`）

### 7.1 支付宝这 6 个

```bash
ALIPAY_ENABLED=false                          # 先 false，验收通过再 true
ALIPAY_APP_ID=20210xxxxxxxxxxxxx
ALIPAY_PRIVATE_KEY=<应用私钥，单行>
ALIPAY_PUBLIC_KEY=<支付宝公钥，单行>
ALIPAY_NOTIFY_URL=https://liorvix.com/api/payments/alipay/notify
ALIPAY_RETURN_URL=https://liorvix.com/pay/checkout
ALIPAY_GATEWAY_URL=https://openapi.alipay.com/gateway.do
```

### 7.2 还缺两个变量会直接阻塞你（现在没检查，但运行时必挂）

`check:billing-readiness` 只查 5 个支付宝变量（[billing-config.ts:48](../src/lib/billing-config.ts#L48)），但实际运行时，下面两个变量缺失会让**所有下单请求 500**：

```bash
PAYMENT_HANDOFF_SECRET=<openssl rand -hex 32 生成>   # 主站签发支付票据用，<32 字符直接抛错
PAYMENT_SITE_URL=https://liorvix.com                 # 不填写就取当前请求域名；一旦拆了独立支付域名，必须显式写
```

前者在 [payment-handoff.ts:8](../src/lib/payment-handoff.ts#L8) 里校验长度，不满足就 throw；后者在 [payment-handoff.ts:46](../src/lib/payment-handoff.ts#L46) 决定跳哪个域。**这两个不在支付宝后台，但它们是支付宝收银台能不能打开的前提。**

### 7.3 私钥格式：单行、不带换行

```bash
# 把 pem 转成一行（贴进 .env.local 后不要加引号）
awk 'NF {sub(/\r/,""); printf "%s\\n",$0}' alipay_app_private_key.pem
```

代码 `pem()` 只做 `\\n → \n` 的还原（[alipay-provider.ts:23](../src/lib/alipay-provider.ts#L23)），所以必须是这种形式。**不要保留 `-----BEGIN PRIVATE KEY-----` 前后的空格或中文引号**。

### 7.4 权限收紧

```bash
chmod 600 /opt/liorvix/.env.local
```

---

## 8. 本地干跑一次（不花一分钱）

```bash
# 1) 本地也写一份 .env.local（测试密钥，别用生产私钥）
pnpm run check:billing-readiness
```

期望：`alipay.missing` 为空、`alipay.warnings` 为空、`alipay.configured = true`。

然后打开本地 `/account/billing`，选最便宜的体验包 → 选「支付宝」→ 应该跳转到 `/pay/checkout` 并出现二维码。

如果二维码没出现，看服务端日志，对照下面这张表定位：

| 日志里的报错 | 真实原因 | 你该干什么 |
| --- | --- | --- |
| `支付宝响应验签失败` | `ALIPAY_PUBLIC_KEY` 填成了应用公钥 | 回 5.2 重新复制支付宝公钥 |
| `支付宝业务请求失败：isv.app-not-online` | 应用没上线 | 等审核或提交上线 |
| `ACQ.TRADE_NOT_ALLOWED` / `产品未开通` | 4.x 的电脑网站支付/当面付没开通 | 回第 6 步开通 |
| `缺少支付宝配置：ALIPAY_APP_ID` | 环境变量没读到 | 检查是否写进了 `.env.local` 而没重启进程 |
| `sign check fail`（网关直接拒绝） | 签名里带了多余空格，或 timestamp 时区不对 | 检查私钥是否为单行；代码已固定东八区（[billing-status.ts:1](../src/lib/billing-status.ts#L1)），不要动 |

---

## 9. 一次性对公账户实付验收（正式开闸）

把 `BILLING_ENABLED=true`、`ALIPAY_ENABLED=true`，重启服务，用**你自己的支付宝**买一次体验包（49 元）：

1. 电脑端：出现二维码 → 支付宝 App 扫码 → 输入密码。
2. 回到结算页：4 秒内应变成「支付已完成」，账户积分 +500。
3. 手机端：点「打开支付页面」→ 支付宝收银台 → 付款 → 点击完成后跳回 `/pay/checkout`。

验收成功的判断标准，**只看数据库，不看页面**：

```sql
-- 1) 订单变成 paid，且只扣了一次钱
select order_no, status, amount_minor, currency, credits_granted, paid_at
from public.billing_orders
where order_no = '<你的订单号>';

-- 2) 支付尝试有支付宝交易号
select provider, channel, merchant_order_no, provider_trade_no, status
from public.payment_attempts
where order_id = '<订单ID>';

-- 3) 回调被签名验证、处理成功、幂等（重复回调只会有一条 processed）
select event_id, event_type, status, result, processed_at
from public.billing_webhook_events
where provider = 'alipay'
order by id desc limit 10;

-- 4) 积分只加了一次
select entry_type, delta, balance_after, idempotency_key, reason
from public.credit_ledger
where user_id = '<你的用户ID>'
order by created_at desc limit 5;
```

**如果第 1 条是 `pending` 而钱已扣**：

```bash
# 手动触发一次查单（结算页加载时也会自动触发）
curl -X POST "https://liorvix.com/api/billing/orders/<订单ID>/cancel"
```

`cancel` 会**先关单再查单**，如果支付宝侧显示已支付，会走 `cancel-race` 补入账（[billing-order-service.ts:250](../src/lib/billing-order-service.ts#L250)），不会吞钱。同时看：

```bash
# 回调有没有进来
tail -n 200 /var/log/liorvix/*.log | grep -i "Alipay notify"
```

- 有 `Alipay notify failed` → 验签失败，99% 是支付宝公钥填错。
- 完全没有日志 → 回调根本没到，查 Nginx 是否把 `/api/payments/alipay/notify` 的 POST 拦了、或 server_name 对不上。

---

## 10. 你平台的几个特别提醒（都是真实代码行为）

### 10.1 二维码会过期，代码里其实没校验到期提示

`precreate` 的 `timeout_express` 是 120 分钟（[alipay-provider.ts:130](../src/lib/alipay-provider.ts#L130)），但结算页在你离开后**只靠 4 秒轮询**发现过期，页面不会主动提醒「二维码已过期」。用户对着过期二维码扫，会看到支付宝提示「交易已关闭」。这是可接受的，但客服需要知道这句话，避免误判成「平台故障」。

### 10.2 同一个用户不能同时挂着两笔待支付订单

`billing_orders` 上有唯一索引 `billing_orders_one_open_per_user_uidx`（[0119 迁移](../supabase/migrations/0119_billing_payment_hardening.sql#L3)）。用户换套餐或换渠道时，旧单会被**自动关掉**（调 `alipay.trade.close`）。所以：
- 客户反馈「我扫的码突然不能用了」很可能是他自己换了套餐；
- 你**不能**用同一账号在两台设备上同时测「电脑扫码 + 手机网页」，会被互相关单，要分开用两个测试账号。

### 10.3 退款不是「想哪天退就哪天退」

12 个月窗口 + 手续费不退。退款走后台 `/admin/billing` → 退款 → `alipay.trade.refund` + `alipay.trade.fastpay.refund.query` 兜底。超过 12 个月只能人工转账，且要在 terms.html 里说明。

### 10.4 订阅套餐现在买不了

`plan_type = subscription` 会被 409 拒绝（[orders/route.ts:93](../src/app/api/billing/orders/route.ts#L93)）。Pro 月卡、Career 月卡不要出现在任何对外价格列表里，等自动续费方案立项。

### 10.5 支付 cookie 必须是 HTTPS

兑换支付票据时写的会话 cookie 带 `Secure` 标记（[redeem/route.ts:22](../src/app/api/payments/handoff/redeem/route.ts#L22)）。本地 `http://localhost` 调试时如果发现「支付会话已过期」，是因为生产构建下 cookie 没写进去——**用 `pnpm dev` 本地跑，或用 https 的隧道调**，而不是去改代码。

---

## 11. 时间线（支付宝一条线）

| 阶段 | 你要做什么 | 卡多久 |
| --- | --- | --- |
| Day 0 | 把已改好的官网两页同步到备案站（第 1 步） | 15 分钟 |
| Day 0 | 企业支付宝实名确认、创建应用（第 2–3 步） | 半天 |
| Day 0 | 开发设置 + 生成密钥 + 上传 + 拿支付宝公钥（第 4–5 步） | 1 小时 |
| Day 0 | 提交应用上线 | 等 1 个工作日 |
| Day 1 | 商家平台开通电脑网站支付/当面付 | 当天，可能 1 天 |
| Day 1 | 写环境变量（第 7 步），跑 `check:billing-readiness` | 30 分钟 |
| Day 1–2 | 本地验证能出二维码 | 1 小时 |
| Day 2 | 开开关，对公账户实付 49 元验收（第 9 步） | 1 小时 |
| Day 2 | 后台退款测一次，确认积分被扣回 | 30 分钟 |

顺利的话 **两天内**支付宝可以真实收款。

---

## 12. 你现在就能做的三件事（按顺序）

1. **同步官网**（已帮你改好）：`scp deploy/icp-site/index.html deploy/icp-site/checkout.html root@115.159.38.86:/www/wwwroot/liorvix-cn/`，然后打开 https://liorvix.cn 确认。
2. **决定展示价口径**：选 A / B / C（第 6.3 节）。官网现在已经是人民币口径（A 的方向）；如果你的产品站暂时不改，至少要选 B——在结算页明确写出「实际扣款 ￥99.00」。
3. **注册应用、生成密钥**：第 3–5 步，今天就能提交上线审核。

做完第 7 步把 `check:billing-readiness` 的输出发我（只含变量名，不含密钥），我帮你判断还差什么；第 9 步验收时如果积分没到账，把 `billing_webhook_events` 那几条记录贴给我，我按 `result` 里的 code 定位。
