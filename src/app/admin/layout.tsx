import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Liorvix后台管理',
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
