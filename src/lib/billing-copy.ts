import type { Locale } from '@/lib/language-context';

export type BillingCopy = {
  eyebrow: string;
  title: string;
  description: string;
  balance: string;
  credits: string;
  perMonth: string;
  oneTime: string;
  recommended: string;
  currentPlan: string;
  choosePlan: string;
  choosing: string;
  paymentTitle: string;
  wechat: string;
  alipay: string;
  wechatH5: string;
  alipayWap: string;
  createOrder: string;
  creatingOrder: string;
  paymentPending: string;
  paymentPendingDescription: string;
  paymentPaid: string;
  paymentPaidDescription: string;
  paymentFailed: string;
  paymentCancelled: string;
  paymentExpired: string;
  paymentDisabled: string;
  paymentDisabledDescription: string;
  copyCode: string;
  copied: string;
  openPayment: string;
  orderNumber: string;
  refreshStatus: string;
  refreshing: string;
  closePayment: string;
  orderHistory: string;
  emptyOrders: string;
  orderStatus: string;
  orderAmount: string;
  orderCredits: string;
  orderDate: string;
  loadFailed: string;
  plansLoadFailed: string;
  orderCreateFailed: string;
  statusLoadFailed: string;
  loginRequired: string;
  free: string;
  subscription: string;
  purchaseCredits: string;
  viewOrders: string;
  viewCredits: string;
  cancelPayment: string;
  cancelling: string;
  scanQr: string;
  subscriptionComingSoon: string;
};

export const BILLING_COPY: Record<Locale, BillingCopy> = {
  'zh-CN': {
    eyebrow: '积分',
    title: '购买积分',
    description: '',
    balance: '余额',
    credits: '积分',
    perMonth: '/月',
    oneTime: '',
    recommended: '推荐',
    currentPlan: '当前方案',
    choosePlan: '选择',
    choosing: '已选择',
    paymentTitle: '支付',
    wechat: '微信支付',
    alipay: '支付宝',
    wechatH5: '微信支付',
    alipayWap: '支付宝',
    createOrder: '去支付',
    creatingOrder: '创建中...',
    paymentPending: '待支付',
    paymentPendingDescription: '支付完成后自动到账',
    paymentPaid: '支付成功',
    paymentPaidDescription: '积分已到账',
    paymentFailed: '支付失败',
    paymentCancelled: '已取消',
    paymentExpired: '已过期',
    paymentDisabled: '支付暂未开放',
    paymentDisabledDescription: '商户配置完成后即可购买。',
    copyCode: '复制支付码',
    copied: '已复制',
    openPayment: '打开支付页',
    orderNumber: '订单号',
    refreshStatus: '刷新',
    refreshing: '刷新中...',
    closePayment: '关闭',
    orderHistory: '订单',
    emptyOrders: '暂无订单',
    orderStatus: '状态',
    orderAmount: '金额',
    orderCredits: '积分',
    orderDate: '时间',
    loadFailed: '加载失败，请重试。',
    plansLoadFailed: '套餐暂时无法加载。',
    orderCreateFailed: '暂时无法创建订单。',
    statusLoadFailed: '暂时无法更新订单状态。',
    loginRequired: '请先登录',
    free: '免费',
    subscription: '订阅',
    purchaseCredits: '购买积分',
    viewOrders: '查看订单',
    viewCredits: '查看积分',
    cancelPayment: '取消',
    cancelling: '取消中...',
    scanQr: '扫码支付',
    subscriptionComingSoon: '即将开放',
  },
  'zh-TW': {
    eyebrow: '積分',
    title: '購買積分',
    description: '',
    balance: '餘額',
    credits: '積分',
    perMonth: '/月',
    oneTime: '',
    recommended: '推薦',
    currentPlan: '目前方案',
    choosePlan: '選擇',
    choosing: '已選擇',
    paymentTitle: '付款',
    wechat: '微信支付',
    alipay: '支付寶',
    wechatH5: '微信支付',
    alipayWap: '支付寶',
    createOrder: '去付款',
    creatingOrder: '建立中...',
    paymentPending: '待付款',
    paymentPendingDescription: '付款完成後自動到帳',
    paymentPaid: '付款成功',
    paymentPaidDescription: '積分已到帳',
    paymentFailed: '付款失敗',
    paymentCancelled: '已取消',
    paymentExpired: '已過期',
    paymentDisabled: '付款暫未開放',
    paymentDisabledDescription: '商戶設定完成後即可購買。',
    copyCode: '複製付款碼',
    copied: '已複製',
    openPayment: '開啟付款頁',
    orderNumber: '訂單號',
    refreshStatus: '重新整理',
    refreshing: '重新整理中...',
    closePayment: '關閉',
    orderHistory: '訂單',
    emptyOrders: '暫無訂單',
    orderStatus: '狀態',
    orderAmount: '金額',
    orderCredits: '積分',
    orderDate: '時間',
    loadFailed: '載入失敗，請重試。',
    plansLoadFailed: '方案暫時無法載入。',
    orderCreateFailed: '暫時無法建立訂單。',
    statusLoadFailed: '暫時無法更新訂單狀態。',
    loginRequired: '請先登入',
    free: '免費',
    subscription: '訂閱',
    purchaseCredits: '購買積分',
    viewOrders: '查看訂單',
    viewCredits: '查看積分',
    cancelPayment: '取消',
    cancelling: '取消中...',
    scanQr: '掃碼付款',
    subscriptionComingSoon: '即將開放',
  },
  en: {
    eyebrow: 'Credits',
    title: 'Buy credits',
    description: '',
    balance: 'Balance',
    credits: 'credits',
    perMonth: '/month',
    oneTime: '',
    recommended: 'Recommended',
    currentPlan: 'Current plan',
    choosePlan: 'Select',
    choosing: 'Selected',
    paymentTitle: 'Pay',
    wechat: 'WeChat Pay',
    alipay: 'Alipay',
    wechatH5: 'WeChat Pay',
    alipayWap: 'Alipay',
    createOrder: 'Pay',
    creatingOrder: 'Creating...',
    paymentPending: 'Awaiting payment',
    paymentPendingDescription: 'Credits are added automatically after payment',
    paymentPaid: 'Paid',
    paymentPaidDescription: 'Credits are ready',
    paymentFailed: 'Payment failed',
    paymentCancelled: 'Cancelled',
    paymentExpired: 'Expired',
    paymentDisabled: 'Checkout is not open yet',
    paymentDisabledDescription: 'Purchases open after merchant setup is complete.',
    copyCode: 'Copy payment code',
    copied: 'Copied',
    openPayment: 'Open payment page',
    orderNumber: 'Order',
    refreshStatus: 'Refresh',
    refreshing: 'Refreshing...',
    closePayment: 'Close',
    orderHistory: 'Orders',
    emptyOrders: 'No orders yet',
    orderStatus: 'Status',
    orderAmount: 'Amount',
    orderCredits: 'Credits',
    orderDate: 'Date',
    loadFailed: 'Could not load this page. Please try again.',
    plansLoadFailed: 'Plans are temporarily unavailable.',
    orderCreateFailed: 'Could not create the order.',
    statusLoadFailed: 'Could not refresh the order status.',
    loginRequired: 'Sign in to purchase',
    free: 'Free',
    subscription: 'Subscription',
    purchaseCredits: 'Buy credits',
    viewOrders: 'View orders',
    viewCredits: 'View credits',
    cancelPayment: 'Cancel',
    cancelling: 'Cancelling...',
    scanQr: 'Scan to pay',
    subscriptionComingSoon: 'Coming soon',
  },
};
