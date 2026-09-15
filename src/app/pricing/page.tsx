'use client';

import { AuthGuard } from '@/components/auth-guard';
import { BillingCenter } from '@/components/billing-center';
import { Header1 } from '@/components/header1';

export default function PricingPage() {
  return <AuthGuard showAccountBar={false}><div className="min-h-screen bg-muted/20"><Header1 /><main className="mx-auto max-w-6xl px-4 pb-14 pt-24 sm:px-6"><BillingCenter /></main></div></AuthGuard>;
}

