import type { Metadata } from 'next';
import { ThemeProvider } from '@/lib/theme-context';
import { LanguageProvider } from '@/lib/language-context';
import './globals.css';

export const metadata: Metadata = {
  title: 'Liorvix',
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
  authors: [{ name: 'Liorvix Team' }],
  generator: 'Liorvix',
  icons: {
    icon: '/logo.svg',
    apple: '/logo.svg',
  },
  other: {
    'link': [
      '<https://fonts.googleapis.com>; rel=preconnect',
      '<https://fonts.gstatic.com>; rel=preconnect; crossorigin',
      '<https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Outfit:wght@600;700;800&display=swap>; rel=stylesheet',
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={`antialiased bg-background`}>
        <ThemeProvider>
          <LanguageProvider>
            {children}
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
