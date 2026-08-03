'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Route as RouteIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/lib/language-context';

interface FooterLink {
  label: string;
  href: string;
}

interface SocialLink {
  icon: ReactNode;
  href: string;
  label: string;
}

interface FooterProps {
  brandName?: string;
  brandDescription?: string;
  socialLinks?: SocialLink[];
  navLinks?: FooterLink[];
  brandIcon?: ReactNode;
  className?: string;
}

export function Footer({
  brandName = 'Rising Path',
  brandDescription,
  socialLinks = [],
  navLinks,
  brandIcon,
  className,
}: FooterProps) {
  const { t } = useLanguage();
  // 年份在客户端注入，避免 SSR/CSR 跨年边界产生 hydration 差异
  const [year, setYear] = useState<number | null>(null);
  useEffect(() => {
    setYear(new Date().getFullYear());
  }, []);

  const description = brandDescription ?? t('footer.tagline');
  const links: FooterLink[] = navLinks ?? [
    { label: t('nav.jobSearch'), href: '/jobs' },
    { label: t('nav.aiMatch'), href: '/ai-match' },
    { label: t('nav.atsOptimize'), href: '/optimize' },
    { label: t('nav.mockInterview'), href: '/mock-interview' },
    { label: t('nav.applications'), href: '/applications' },
  ];

  return (
    <section className={cn('relative w-full mt-0 overflow-hidden', className)}>
      <footer className="border-t bg-background mt-20 relative">
        <div className="max-w-7xl flex flex-col justify-between mx-auto min-h-[30rem] sm:min-h-[35rem] md:min-h-[40rem] relative p-4 py-10">
          <div className="flex flex-col mb-12 sm:mb-20 md:mb-0 w-full">
            <div className="w-full flex flex-col items-center">
              <div className="space-y-2 flex flex-col items-center flex-1">
                <span className="text-foreground text-3xl font-bold">{brandName}</span>
                <p className="text-muted-foreground font-semibold text-center w-full max-w-sm sm:w-96 px-4 sm:px-0">
                  {description}
                </p>
              </div>

              {socialLinks.length > 0 && (
                <div className="flex mb-8 mt-3 gap-4">
                  {socialLinks.map((link, index) => (
                    <Link
                      key={index}
                      href={link.href}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <div className="w-6 h-6 hover:scale-110 duration-300">{link.icon}</div>
                      <span className="sr-only">{link.label}</span>
                    </Link>
                  ))}
                </div>
              )}

              {links.length > 0 && (
                <div className="flex flex-wrap justify-center gap-4 mt-3 text-sm font-medium text-muted-foreground max-w-full px-4">
                  {links.map((link, index) => (
                    <Link
                      key={index}
                      className="hover:text-foreground duration-300 hover:font-semibold"
                      href={link.href}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mt-20 md:mt-24 flex flex-col gap-2 md:gap-1 items-center justify-center md:flex-row md:justify-between px-4 md:px-0">
            <p className="text-base text-muted-foreground text-center md:text-left">
              ©{year ?? ''} {brandName}. {t('footer.rights')}
            </p>
          </div>
        </div>

        {/* 大号背景品牌字：品牌渐变（赤陶→灰绿）渐隐 */}
        <div
          className="bg-gradient-to-b from-terracotta-500/25 via-sage-500/15 to-transparent bg-clip-text text-transparent leading-none absolute left-1/2 -translate-x-1/2 bottom-40 md:bottom-32 font-extrabold tracking-tighter pointer-events-none select-none text-center px-4 whitespace-nowrap"
          style={{
            fontSize: 'clamp(3rem, 12vw, 10rem)',
            maxWidth: '95vw',
          }}
        >
          {brandName.toUpperCase()}
        </div>

        {/* 底部品牌 Logo：赤陶渐变方块 + Route 图标 */}
        <div className="absolute hover:border-foreground duration-400 drop-shadow-[0_0px_20px_rgba(0,0,0,0.5)] dark:drop-shadow-[0_0px_20px_rgba(255,255,255,0.3)] bottom-24 md:bottom-20 backdrop-blur-sm rounded-3xl bg-background/60 left-1/2 border-2 border-border flex items-center justify-center p-3 -translate-x-1/2 z-10">
          <div className="w-12 sm:w-16 md:w-24 h-12 sm:h-16 md:h-24 bg-gradient-to-br from-terracotta-500 to-terracotta-600 rounded-2xl flex items-center justify-center shadow-lg">
            {brandIcon || (
              <RouteIcon className="w-8 sm:w-10 md:w-14 h-8 sm:h-10 md:h-14 text-white drop-shadow-lg" />
            )}
          </div>
        </div>

        {/* 底部渐变线 */}
        <div className="absolute bottom-32 sm:bottom-34 backdrop-blur-sm h-1 bg-gradient-to-r from-transparent via-border to-transparent w-full left-1/2 -translate-x-1/2" />

        {/* 底部渐隐阴影 */}
        <div className="bg-gradient-to-t from-background via-background/80 blur-[1em] to-background/40 absolute bottom-28 w-full h-24" />
      </footer>
    </section>
  );
}
