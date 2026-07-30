'use client';

import FeaturesCards from '@/components/features-cards';
import FAQs from '@/components/faqs-component';
import { Footer } from '@/components/ui/footer';
import { Github, Mail, Globe } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      <FeaturesCards />
      <FAQs />
      <Footer
        logo={<img src="/logo.svg" alt="Rising Path" className="h-8 w-8" />}
        brandName="Rising Path"
        socialLinks={[
          {
            icon: <Github className="h-5 w-5" />,
            href: "https://github.com",
            label: "GitHub",
          },
          {
            icon: <Mail className="h-5 w-5" />,
            href: "mailto:contact@risingpath.com",
            label: "Email",
          },
          {
            icon: <Globe className="h-5 w-5" />,
            href: "https://risingpath.com",
            label: "Website",
          },
        ]}
        mainLinks={[
          { href: "/jobs", label: "Jobs" },
          { href: "/resume", label: "Resume" },
          { href: "/ai-match", label: "AI Match" },
          { href: "/optimize", label: "ATS Optimize" },
          { href: "/applications", label: "Applications" },
        ]}
        legalLinks={[
          { href: "/privacy", label: "Privacy" },
          { href: "/terms", label: "Terms" },
        ]}
        copyright={{
          text: "© 2024 Rising Path",
          license: "All rights reserved",
        }}
      />
    </div>
  );
}
