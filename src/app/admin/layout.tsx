import type { Metadata } from 'next';
import { AdminAuthGuard } from '@/components/admin-auth-guard';
import { AdminShell } from '@/components/admin-shell';

export const metadata: Metadata = {
  title: 'Liorvix',
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminAuthGuard>
      <AdminShell>{children}</AdminShell>
    </AdminAuthGuard>
  );
}
