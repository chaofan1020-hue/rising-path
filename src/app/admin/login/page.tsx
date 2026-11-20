import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AdminLoginForm } from '@/components/admin/admin-login-form';
import { isSharedAdminPasswordAllowed, resolveAdminSessionToken } from '@/lib/admin-auth';
import { ADMIN_SESSION_COOKIE } from '@/lib/admin-session-token';
import { isCaptchaEnabled } from '@/lib/altcha';

export const dynamic = 'force-dynamic';

/**
 * Decided on the server so the form arrives ready to use.
 *
 * The page used to boot with a spinner and wait `GET /api/admin/auth` before it
 * could even know whether password login was available — one extra slow hop
 * before the first input was usable.
 */
export default async function AdminLoginPage() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value ?? null;
  if (await resolveAdminSessionToken(token)) redirect('/admin');

  return (
    <AdminLoginForm
      passwordLoginAllowed={await isSharedAdminPasswordAllowed()}
      captchaEnabledHint={isCaptchaEnabled()}
    />
  );
}