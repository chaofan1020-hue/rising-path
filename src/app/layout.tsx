import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import { ThemeProvider } from '@/lib/theme-context';
import { LanguageProvider } from '@/lib/language-context';
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
    icon: '/logo.svg',
    apple: '/logo.svg',
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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&display=swap" rel="stylesheet" />
      </head>
      <body className={`antialiased`}>
        <ThemeProvider>
          <LanguageProvider>
            {isDev && <Inspector />}
            {children}
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
