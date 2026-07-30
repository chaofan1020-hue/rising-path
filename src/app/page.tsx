'use client';

import FeaturesCards from '@/components/features-cards';
import FAQs from '@/components/faqs-component';
import { Header1 } from '@/components/header1';

export default function Home() {
  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <Header1 />
      <div className="pt-20">
        <FeaturesCards />
        <FAQs />
      </div>
    </div>
  );
}
