'use client';

import FeaturesCards from '@/components/features-cards';
import FAQs from '@/components/faqs-component';
import { Footer } from '@/components/ui/footer';

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      <FeaturesCards />
      <FAQs />
      <Footer
        logo={<img src="/logo.svg" alt="Rising Path" className="h-8 w-8" />}
        brandName="Rising Path"
        socialLinks={[]}
        mainLinks={[]}
        legalLinks={[]}
        copyright={{
          text: "© 2026 Rising Path",
          license: "All rights reserved",
        }}
      />
    </div>
  );
}
