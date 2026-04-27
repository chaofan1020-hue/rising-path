import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Rising Path后台管理',
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
