export class BillingProviderDisabledError extends Error {
  constructor(message = '支付渠道尚未启用') {
    super(message);
    this.name = 'BillingProviderDisabledError';
  }
}
