'use client';

import FeaturesCards from '@/components/features-cards';
import FAQs from '@/components/faqs-component';
import { ResponseStream } from '@/components/ui/response-stream';
import { Header1 } from '@/components/header1';

export default function Home() {
  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <Header1 />
      <div className="pt-20">
        <FeaturesCards />
        
        {/* Platform Introduction with Typewriter Effect */}
        <section className="py-16 px-4 bg-white dark:bg-black">
          <div className="max-w-4xl mx-auto text-center">
            <ResponseStream
              textStream="Rising Path is your one-stop career platform for overseas job seekers. Discover opportunities, optimize your resume with AI, and streamline your application process."
              mode="typewriter"
              speed={30}
              className="text-xl md:text-2xl text-gray-700 dark:text-gray-300 leading-relaxed"
            />
          </div>
        </section>

        <FAQs />
      </div>
    </div>
  );
}
