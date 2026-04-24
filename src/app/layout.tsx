import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Rising Path求职平台',
    template: '%s | Rising Path',
  },
  description:
    '专为海外留学生打造的一站式求职平台，提供岗位查询、AI选岗、简历优化、自动网申等功能',
  keywords: [
    '留学生求职',
    '海外求职',
    '岗位查询',
    'AI选岗',
    '简历优化',
    'ATS简历',
    '网申',
    '求职平台',
  ],
  authors: [{ name: 'Rising Path Team' }],
  generator: 'Coze Code',
  icons: {
    icon: '/favicon.png',
    apple: '/favicon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.COZE_PROJECT_ENV === 'DEV';

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={`antialiased`}>
        {isDev && <Inspector />}
        {children}
      </body>
    </html>
  );
}
