'use client';

import FeaturesCards from '@/components/features-cards';
import FAQs from '@/components/faqs-component';
import { Header1 } from '@/components/header1';
import { FirstRunPath } from '@/components/first-run-path';
import { useLanguage } from '@/lib/language-context';

export default function Home() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <Header1 />
      <div className="pt-[4.5rem] md:pt-[4.75rem]">
        <FirstRunPath />
        <FeaturesCards />
        
        {/* Platform Introduction */}
        <section className="bg-white px-4 py-20 dark:bg-black sm:px-6 md:py-24">
          <div className="mx-auto max-w-2xl">
            <p className="text-lg font-medium text-gray-900 dark:text-gray-100 md:text-xl">
              {t('intro.greeting')}
            </p>
            <div className="mt-8 space-y-6">
              {t('intro.body').split(/\n\n+/).map((stanza, index) => (
                <p
                  key={index}
                  className="whitespace-pre-line text-base leading-[2] text-gray-500 indent-[2em] dark:text-gray-400 md:text-[1.0625rem] md:leading-[2.1]"
                >
                  {stanza}
                </p>
              ))}
            </div>
            <div className="mt-12 text-right">
              <p className="text-base text-gray-600 dark:text-gray-300 md:text-[1.0625rem]">{t('intro.signoff')}</p>
              <p className="mt-2 text-sm text-gray-400 dark:text-gray-500">{t('intro.valediction')}</p>
            </div>
          </div>
        </section>

        <FAQs />
      </div>
    </div>
  );
}
