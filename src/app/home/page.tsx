'use client';

import FAQs from '@/components/faqs-component';
import { Header1 } from '@/components/header1';
import { HoverEffect } from '@/components/ui/hover-effect';
import { InfiniteMovingCards, type InfiniteMovingCardItem } from '@/components/ui/infinite-moving-cards';
import { LandingAccordionItem } from '@/components/ui/interactive-image-accordion';
import { LoopsPricingSlider } from '@/components/ui/pricing-slider-loops';
import { HaloReel, type HaloReelItem } from '@/components/ui/halo-reel';
import { useLanguage } from '@/lib/language-context';
import { LayoutDashboard, MessageSquare, Search, Send, Sparkles, Wand2 } from 'lucide-react';

export default function Home() {
  const { t } = useLanguage();

  const haloCards: HaloReelItem[] = [
    { src: '/brand/halo/ai-match.jpg', alt: '' },
    { src: '/brand/halo/ats-resume.jpg', alt: '' },
    { src: '/brand/halo/auto-apply.jpg', alt: '' },
    { src: '/brand/halo/global-jobs.jpg', alt: '' },
    { src: '/brand/halo/mock-interview.jpg', alt: '' },
  ];

  const storyRatings = [5, 5, 5, 4, 5];
  const storyCards: InfiniteMovingCardItem[] = storyRatings.map((rating, i) => ({
    id: i + 1,
    title: t(`story${i + 1}.title`),
    description: t(`story${i + 1}.desc`),
    rating,
    tags: t(`story${i + 1}.tags`).split(','),
    name: t(`story${i + 1}.name`),
    role: t(`story${i + 1}.role`),
  }));

  return (
    <div className="min-h-screen bg-white dark:bg-background">
      <Header1 />
      <div className="pt-[4.5rem] md:pt-[4.75rem]">
        <section className="bg-white px-4 pb-4 pt-16">
          <div className="mx-auto max-w-7xl lg:flex lg:items-start lg:gap-8">
            <aside className="relative hidden shrink-0 lg:-mt-12 lg:ml-24 lg:block lg:h-[520px] lg:w-[440px]">
              <HaloReel
                items={haloCards}
                cardWidth={100}
                cardHeight={120}
                minScale={0.4}
                radiusYRatio={0.32}
                className="h-full rounded-3xl"
              />
              <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex lg:-translate-x-24 2xl:-translate-x-44 items-center">
                <svg viewBox="0 0 40 20" fill="currentColor" aria-hidden="true" className="h-8 w-auto shrink-0 text-zinc-950">
                  <path d="M0 0h29a4 4 0 0 1 0 8H0V0z" />
                  <path d="M40 20H11a4 4 0 0 1 0-8h29v8z" />
                </svg>
                <span className="ml-2 text-6xl font-bold tracking-tight text-zinc-950">Liorvix</span>
              </div>
            </aside>
            <div className="min-w-0 flex-1">
              <HoverEffect
                items={[
                  { title: t('feature1.title'), description: t('feature1.desc'), link: '/ai-match', icon: <Sparkles className="h-5 w-5" /> },
                  { title: t('feature2.title'), description: t('feature2.desc'), link: '/optimize', icon: <Wand2 className="h-5 w-5" /> },
                  { title: t('feature3.title'), description: t('feature3.desc'), link: '/auto-apply', icon: <Send className="h-5 w-5" /> },
                  { title: t('feature4.title'), description: t('feature4.desc'), link: '/jobs', icon: <Search className="h-5 w-5" /> },
                  { title: t('feature5.title'), description: t('feature5.desc'), link: '/dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
                  { title: t('feature6.title'), description: t('feature6.desc'), link: '/mock-interview', icon: <MessageSquare className="h-5 w-5" /> },
                ]}
              />
            </div>
          </div>
        </section>
        
        {/* Platform Introduction */}
        <section className="py-16 px-4 bg-white dark:bg-background">
          <div className="max-w-7xl mx-auto text-left space-y-3">
            <p className="text-sm md:text-base text-gray-500 dark:text-gray-400 leading-relaxed">
              {t('intro.greeting')}
            </p>
            <p className="text-sm md:text-base text-gray-500 dark:text-gray-400 leading-relaxed">
              {t('intro.p1')}
            </p>
            <p className="text-sm md:text-base text-gray-500 dark:text-gray-400 leading-relaxed">
              {t('intro.p2')}
            </p>
            <p className="text-sm md:text-base text-gray-500 dark:text-gray-400 leading-relaxed">
              {t('intro.p3')}
            </p>
            <p className="text-sm md:text-base text-gray-500 dark:text-gray-400 leading-relaxed">
              {t('intro.p4')}
            </p>
          </div>
        </section>

        {/* Feature Accordion */}
        <LandingAccordionItem />

        {/* Student Stories */}
        <section aria-label="Student stories" className="bg-white py-16 dark:bg-background">
          <InfiniteMovingCards items={storyCards} speed="normal" direction="left" />
        </section>

        {/* Pricing */}
        <LoopsPricingSlider />

        <FAQs />
      </div>
    </div>
  );
}
