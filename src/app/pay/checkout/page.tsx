import { PaymentCheckout } from '@/components/payment-checkout';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function PaymentCheckoutPage() {
  return <><PaymentCheckout /><div className="fixed bottom-3 left-0 right-0 flex justify-center gap-4 text-xs text-zinc-500"><Link href="/pay">服务信息</Link><a href="https://liorvix.cn/privacy.html" target="_blank" rel="noreferrer">隐私政策</a><a href="https://liorvix.cn/terms.html" target="_blank" rel="noreferrer">用户协议与退款规则</a><a href="https://liorvix.cn/contact.html" target="_blank" rel="noreferrer">联系客服</a></div></>;
}
