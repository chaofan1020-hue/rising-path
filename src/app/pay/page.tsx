import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function PaymentServicePage() {
  return <main className="min-h-screen bg-zinc-50 px-4 py-10 text-zinc-900 sm:py-16"><article className="mx-auto max-w-3xl">
    <header className="border-b border-zinc-200 pb-7"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Liorvix</p><h1 className="mt-3 text-3xl font-semibold">求职服务结算中心</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600">成都数橙研策科技有限公司运营 Liorvix 求职服务平台，为海外留学生和跨境求职人群提供职业发展信息技术服务。</p></header>
    <section className="grid gap-4 border-b border-zinc-200 py-7 sm:grid-cols-2"><div><h2 className="font-semibold">服务内容</h2><p className="mt-2 text-sm leading-6 text-zinc-600">平台提供岗位信息检索、简历优化、AI 岗位匹配、求职方向建议和模拟面试训练。岗位申请由用户自行通过招聘企业官方渠道完成。本平台不提供招聘中介或录用保证。</p></div><div><h2 className="font-semibold">计费方式</h2><p className="mt-2 text-sm leading-6 text-zinc-600">付费积分用于平台内的 AI 求职辅助功能。结算金额、对应积分及有效期会在确认订单时明确展示。购买前请核对套餐内容和人民币实付金额。</p></div></section>
    <section className="border-b border-zinc-200 py-7"><h2 className="font-semibold">订单与售后</h2><p className="mt-2 text-sm leading-6 text-zinc-600">支付成功后，积分将自动记入对应 Liorvix 账号。到账异常、重复扣款或退款申请，请发送订单号、支付时间和注册邮箱至 support@liorvix.com；我们将在 3 个工作日内核实并回复。数字服务退款按已使用情况及用户协议处理。</p></section>
    <section className="flex flex-wrap items-center justify-between gap-4 py-7"><div className="text-sm text-zinc-600"><p>经营主体：成都数橙研策科技有限公司</p><p className="mt-1">服务备案：蜀ICP备2026019930号-2</p></div><Link href="https://liorvix.com/pricing" className="inline-flex h-10 items-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white">返回 Liorvix 产品站</Link></section>
    <footer className="flex flex-wrap gap-x-5 gap-y-2 border-t border-zinc-200 pt-5 text-xs text-zinc-500"><a href="https://liorvix.cn/about.html">关于我们</a><a href="https://liorvix.cn/contact.html">联系我们</a><a href="https://liorvix.cn/privacy.html">隐私政策</a><a href="https://liorvix.cn/terms.html">用户协议与退款规则</a><a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">蜀ICP备2026019930号-2</a></footer>
  </article></main>;
}
