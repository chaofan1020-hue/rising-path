'use client';

import FeaturesCards from '@/components/features-cards';
import FAQs from '@/components/faqs-component';
import { Header1 } from '@/components/header1';
import AboutSection3 from '@/components/about-section';
import { useLanguage } from '@/lib/language-context';
import { useRef } from 'react';

export default function Home() {
  const { t } = useLanguage();
  const featuresRef = useRef<HTMLDivElement>(null);

  const scrollToFeatures = () => {
    featuresRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <Header1 />
      <div className="pt-20">
        <div className="min-h-screen flex items-center justify-center">
          <AboutSection3 onStartClick={scrollToFeatures} />
        </div>
        <div ref={featuresRef}>
          <FeaturesCards />
        </div>
        
        {/* Platform Introduction */}
        <section className="py-16 px-4 bg-white dark:bg-black">
          <div className="max-w-7xl mx-auto text-left space-y-6">
            <p className="text-lg text-gray-500 dark:text-gray-400 leading-relaxed">
              {t('intro.greeting')}
            </p>
            <p className="text-lg text-gray-500 dark:text-gray-400 leading-relaxed">
              {t('intro.p1')}
            </p>
            <p className="text-lg text-gray-500 dark:text-gray-400 leading-relaxed">
              {t('intro.p2')}
            </p>
            <p className="text-lg text-gray-500 dark:text-gray-400 leading-relaxed">
              {t('intro.p3')}
            </p>
            <p className="text-lg text-gray-500 dark:text-gray-400 leading-relaxed">
              {t('intro.p4')}
            </p>
          </div>
        </section>

        <FAQs />
      </div>
    </div>
  );
}
