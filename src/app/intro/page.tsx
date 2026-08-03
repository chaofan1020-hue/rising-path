'use client';

import Link from 'next/link';
import {
  Route as RouteIcon,
  Search,
  Sparkles,
  FileText,
  Video,
  Send,
  Layers,
  Globe2,
  Building2,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/language-context';
import { Footer } from '@/components/footer';

export default function IntroPage() {
  const { t } = useLanguage();

  const features = [
    {
      icon: Search,
      title: t('nav.jobSearch'),
      desc: t('intro.f1Desc'),
      href: '/jobs',
      gradient: 'from-terracotta-500 to-terracotta-600',
    },
    {
      icon: Sparkles,
      title: t('nav.aiMatch'),
      desc: t('intro.f2Desc'),
      href: '/ai-match',
      gradient: 'from-sage-500 to-sage-600',
    },
    {
      icon: FileText,
      title: t('nav.atsOptimize'),
      desc: t('intro.f3Desc'),
      href: '/optimize',
      gradient: 'from-beige-500 to-beige-600',
    },
    {
      icon: Video,
      title: t('nav.mockInterview'),
      desc: t('intro.f4Desc'),
      href: '/mock-interview',
      gradient: 'from-terracotta-500 to-sage-600',
    },
    {
      icon: Send,
      title: t('nav.autoApplication'),
      desc: t('intro.f5Desc'),
      href: '/applications',
      gradient: 'from-sage-500 to-terracotta-600',
    },
  ];

  const pillars = [
    {
      icon: Layers,
      title: t('intro.d1Title'),
      desc: t('intro.d1Desc'),
    },
    {
      icon: Globe2,
      title: t('intro.d2Title'),
      desc: t('intro.d2Desc'),
    },
    {
      icon: Building2,
      title: t('intro.d3Title'),
      desc: t('intro.d3Desc'),
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Hero：超大渐变背景字 + 悬浮渐变 Logo + 居中排版 */}
      <section className="relative min-h-[92vh] flex flex-col items-center justify-center overflow-hidden px-4">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
          <span
            className="bg-gradient-to-b from-terracotta-500/20 via-sage-500/10 to-transparent bg-clip-text text-transparent font-extrabold tracking-tighter leading-none text-center whitespace-nowrap"
            style={{ fontSize: 'clamp(3rem, 13vw, 12rem)', maxWidth: '96vw' }}
          >
            RISING PATH
          </span>
        </div>

        <div className="relative z-10 flex flex-col items-center text-center">
          <div className="mb-8 w-20 h-20 md:w-24 md:h-24 bg-gradient-to-br from-terracotta-500 to-terracotta-600 rounded-3xl flex items-center justify-center shadow-lg drop-shadow-[0_0px_30px_rgba(196,106,74,0.35)]">
            <RouteIcon className="w-10 h-10 md:w-14 md:h-14 text-white drop-shadow-lg" />
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground">
            Rising Path
          </h1>
          <p className="mt-4 text-lg md:text-xl font-semibold text-muted-foreground max-w-xl">
            {t('footer.tagline')}
          </p>
          <p className="mt-3 text-sm md:text-base text-muted-foreground/80 max-w-md">
            {t('intro.heroSubtitle')}
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center gap-3">
            <Link href="/jobs">
              <Button
                size="lg"
                className="bg-gradient-to-r from-terracotta-500 to-terracotta-600 hover:from-terracotta-600 hover:to-terracotta-700 text-white border-0 shadow-lg px-8"
              >
                {t('intro.cta')}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="/resume">
              <Button size="lg" variant="outline" className="px-8">
                {t('nav.resumeManager')}
              </Button>
            </Link>
          </div>
        </div>

        {/* 底部渐隐阴影（Footer 同源语言） */}
        <div className="bg-gradient-to-t from-background via-background/80 blur-[1em] to-background/40 absolute bottom-0 w-full h-24 pointer-events-none" />
      </section>

      {/* 核心功能 */}
      <section className="relative max-w-6xl mx-auto px-4 py-16 md:py-24">
        <h2 className="text-2xl md:text-4xl font-bold tracking-tight text-center">
          {t('intro.featuresTitle')}
        </h2>
        <div className="mt-10 md:mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {features.map((f) => (
            <Link key={f.href} href={f.href} className="group">
              <div className="h-full rounded-2xl border border-border bg-card/60 backdrop-blur-sm p-6 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-terracotta-300 dark:hover:border-terracotta-800">
                <div
                  className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.gradient} flex items-center justify-center shadow-md`}
                >
                  <f.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="mt-4 text-lg font-semibold flex items-center gap-1.5">
                  {f.title}
                  <ArrowRight className="h-4 w-4 opacity-0 -translate-x-1 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-0 text-terracotta-500" />
                </h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* 底层逻辑：分层 × 地区 × 企业基因 */}
      <section className="relative max-w-6xl mx-auto px-4 pb-20 md:pb-28">
        <div className="rounded-3xl border border-border bg-gradient-to-b from-beige-50/60 to-transparent dark:from-zinc-900/40 p-8 md:p-12">
          <h2 className="text-2xl md:text-4xl font-bold tracking-tight text-center">
            {t('intro.whyTitle')}
          </h2>
          <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-8">
            {pillars.map((p) => (
              <div key={p.title} className="flex flex-col items-center text-center">
                <div className="w-14 h-14 rounded-2xl border-2 border-terracotta-200 dark:border-terracotta-800 bg-background flex items-center justify-center">
                  <p.icon className="w-7 h-7 text-terracotta-500" />
                </div>
                <h3 className="mt-4 text-base md:text-lg font-semibold">{p.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 底部收束（复用 Footer 组件） */}
      <Footer />
    </div>
  );
}
