'use client';

import FeaturesCards from '@/components/features-cards';
import FAQs from '@/components/faqs-component';

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      <FeaturesCards />
      <FAQs />
    </div>
  );
}
