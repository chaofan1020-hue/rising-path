export interface BillingCheckoutRequest {
  userId: string;
  planCode: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface BillingCheckoutSession {
  provider: string;
  sessionId: string;
  checkoutUrl: string | null;
  enabled: boolean;
}

export interface BillingProvider {
  readonly name: string;
  createCheckoutSession(input: BillingCheckoutRequest): Promise<BillingCheckoutSession>;
  verifyWebhook(headers: Headers, rawBody: string): Promise<{ eventId: string; eventType: string; payload: Record<string, unknown> }>;
}

/** Payment is deliberately disabled until the operating entity, market and provider are confirmed. */
export class ManualBetaBillingProvider implements BillingProvider {
  readonly name = 'manual_beta';

  async createCheckoutSession(): Promise<BillingCheckoutSession> {
    return { provider: this.name, sessionId: '', checkoutUrl: null, enabled: false };
  }

  async verifyWebhook(): Promise<never> {
    throw new Error('manual_beta 不接收外部支付回调');
  }
}

export function getBillingProvider(): BillingProvider {
  return new ManualBetaBillingProvider();
}
