'use client';

import { AuthGuard } from '@/components/auth-guard';
import { AutoApplicationContent } from '../field-mappings/page';

export default function AutoApplyPage() {
  return <AuthGuard><AutoApplicationContent /></AuthGuard>;
}
