import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin-shell';
import { getAdminRequestContext } from '@/lib/admin-request-context';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Liorvix',
};

/**
 * Admin auth is resolved once, on the server, inside the HTML request.
 *
 * This used to be two client fetches (`/api/admin/auth`) that had to finish in
 * sequence before anything painted: a full-screen guard spinner, then the shell
 * loading permissions. Against a far edge node each hop costs ~0.5s, so the
 * dashboard paid over a second of pure round-trip time before its own data
 * request even started. Resolving here folds that into the request the browser
 * is already making.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { role, permissions } = await getAdminRequestContext();

  return (
    <AdminShell role={role} permissions={permissions}>
      {children}
    </AdminShell>
  );
}