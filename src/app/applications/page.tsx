'use client';

import { AuthGuard } from '@/components/auth-guard';
import { AutoApplicationContent } from '../field-mappings/page';

export default function ApplicationsPage() {
  return <AuthGuard><AutoApplicationContent initialTab="records" /></AuthGuard>;
}
