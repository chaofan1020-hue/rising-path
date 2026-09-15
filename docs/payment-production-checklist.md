# Payment Production Readiness

This checklist prepares the payment release without placing merchant secrets in the repository. Production credentials and certificates remain server-only and are intentionally left for the final release window.

## Already prepared in the repo

- Billing schema migrations `0116_payment_foundation.sql`, `0117_payment_order_settlement.sql`, `0118_billing_refund_settlement.sql`, `0119_billing_payment_hardening.sql`, and `0120_billing_usd_catalog.sql`.
- Provider adapters for WeChat Pay Native/H5 and Alipay QR/WAP, including signed callbacks, query, close, refund, and refund query.
- Server-side order amount validation, one open checkout per user, local expiry, user cancel, and idempotent credit settlement.
- `/pricing` and `/account/billing` checkout UI with a scannable QR image, pending/success/failure/cancellation/expiry states, and credit-balance refresh.
- `pnpm run check:billing-readiness` preflight. It reports only missing variable names and URL warnings; it never prints secret values.
- `pnpm run test:billing`, `pnpm run test:billing-contract`, and `pnpm run test:billing-payment`.

## Not on the US production server yet

The current production tree still has the old `manual_beta` provider only. Do not turn on live checkout until the payment code, migrations `0116`-`0119`, and merchant secrets are all present on `43.172.117.125:/opt/liorvix`.

## Before enabling a channel

1. Apply migrations to the intended Supabase project and verify `0116` through `0120` in `public.liorvix_migration_history`.
2. Deploy the payment application build. Keep `BILLING_ENABLED`, `WECHAT_PAY_ENABLED`, and `ALIPAY_ENABLED` false until secrets are in place.
3. Run `pnpm run check:billing-readiness` on the same server environment that will run the app.
4. Confirm each enabled callback URL is public HTTPS and routes to the matching `/api/payments/*/notify` endpoint.
5. Run provider sandbox/certification tests for a small allow-list of users.
6. Keep one provider disabled while validating the other. Enable both only after each callback and refund path is accepted.

## Acceptance cases

- Successful scan, user cancellation, expiration, delayed callback, and browser close after payment.
- Duplicate callback and duplicate status polling grant credits once.
- Callback amount mismatch never grants credits.
- Provider/network failure can be retried without creating a second credit grant.
- Refund transitions are recorded; processing refunds can be queried to completion.
- Two simultaneous orders for one user collapse to a single open checkout.

## Final release-only actions

The following are deliberately excluded from local preparation:

- Production merchant IDs, private keys, API v3 keys, platform certificates, and public keys.
- Production `.env.local` edits.
- Turning on `BILLING_ENABLED`, `WECHAT_PAY_ENABLED`, or `ALIPAY_ENABLED`.
- Public rollout, price changes, tax/receipt policy, and refund policy decisions.
