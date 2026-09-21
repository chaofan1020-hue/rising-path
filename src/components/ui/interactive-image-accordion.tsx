'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/language-context';
import { cn } from '@/lib/utils';

const R2 = 'https://pub-940ccf6255b54fa799a9b01050e6c227.r2.dev';

const fallbackImage = `${R2}/gradients/hero_gradient/hero-gradients-01.png`;

const accordionItems = [
  { id: 1, titleKey: 'accordion.item1', imageUrl: '/brand/ai-match.jpg' },
  { id: 2, titleKey: 'accordion.item2', imageUrl: '/brand/ats-resume.jpg' },
  { id: 3, titleKey: 'accordion.item3', imageUrl: '/brand/auto-apply.jpg' },
  { id: 4, titleKey: 'accordion.item4', imageUrl: '/brand/global-jobs.jpg' },
  { id: 5, titleKey: 'accordion.item5', imageUrl: '/brand/mock-interview.jpg' },
];

function AccordionItem({
  title,
  imageUrl,
  isActive,
  onMouseEnter,
}: {
  title: string;
  imageUrl: string;
  isActive: boolean;
  onMouseEnter: () => void;
}) {
  return (
    <div
      className={cn(
        'relative h-[450px] cursor-pointer overflow-hidden rounded-2xl transition-all duration-700 ease-in-out',
        isActive ? 'w-[400px]' : 'w-[60px]',
      )}
      onMouseEnter={onMouseEnter}
    >
      <img
        src={imageUrl}
        alt={title}
        className="absolute inset-0 h-full w-full object-cover"
        onError={(e) => {
          e.currentTarget.onerror = null;
          e.currentTarget.src = fallbackImage;
        }}
      />
      <div className="absolute inset-0 bg-black/40" />
      <span
        className={cn(
          'absolute whitespace-nowrap text-lg font-semibold text-white transition-all duration-300 ease-in-out',
          isActive
            ? 'bottom-6 left-1/2 -translate-x-1/2 rotate-0'
            : 'bottom-24 left-1/2 -translate-x-1/2 rotate-90',
        )}
      >
        {title}
      </span>
    </div>
  );
}

export function LandingAccordionItem() {
  const { t } = useLanguage();
  const [activeIndex, setActiveIndex] = useState(4);

  return (
    <section aria-label={t('accordion.title')} className="px-4 py-12 md:py-24">
      <div className="container mx-auto flex flex-col items-center justify-between gap-12 md:flex-row">
        <div className="w-full text-center md:w-1/2 md:text-left">
          <h1 className="text-4xl font-bold leading-tight tracking-tighter text-gray-900 dark:text-white md:text-6xl">
            {t('accordion.title')}
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-gray-600 dark:text-gray-400 md:mx-0">
            {t('accordion.desc')}
          </p>
          <div className="mt-8">
            <Link
              href="/login"
              className="inline-block rounded-lg bg-zinc-900 px-8 py-3 font-semibold text-white shadow-lg transition-colors duration-300 hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {t('accordion.cta')}
            </Link>
          </div>
        </div>

        <div className="w-full md:w-1/2">
          <div className="flex flex-row items-center justify-center gap-4 overflow-x-auto p-4">
            {accordionItems.map((item, index) => (
              <AccordionItem
                key={item.id}
                title={t(item.titleKey)}
                imageUrl={item.imageUrl}
                isActive={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default LandingAccordionItem;
