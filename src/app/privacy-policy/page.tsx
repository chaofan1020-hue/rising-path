import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Privacy Policy | Liorvix',
  description: 'Privacy policy for Liorvix and the Liorvix Auto Apply browser extension.',
  alternates: {
    canonical: 'https://liorvix.com/privacy-policy',
  },
};

const sections = [
  {
    title: '1. Scope',
    paragraphs: [
      'This Privacy Policy explains how Liorvix ("Liorvix", "we", "us", or "our") handles information when you use the Liorvix website, account services, and the Liorvix Auto Apply browser extension (the "Extension").',
      'The Extension is an assistive tool. It helps you review and fill supported job application fields using information from your Liorvix profile. It does not automatically submit job applications.',
    ],
  },
  {
    title: '2. Information we process',
    paragraphs: [
      'Account information may include your email address, display name, authentication data, and account activity needed to provide the service.',
      'Career information may include resume content, education, work and project history, skills, links, work authorization or visa information, application records, and field mappings that you choose to save.',
      'When you use the Extension, it may process the active page URL and hostname, the job context you selected in Liorvix, and the labels, types, options, and selector information for visible application fields that you ask it to scan. It does not scan or upload the contents of a page merely because the Extension is installed.',
      'The Extension temporarily stores session information, such as an authentication token, selected job context, and scan results, in the browser session storage so it can work between the Liorvix page and the active application page.',
    ],
  },
  {
    title: '3. How we use information',
    paragraphs: [
      'We use information to authenticate you, generate or retrieve application profile suggestions, fill fields that you explicitly select, save application status and field feedback, maintain security, prevent abuse, and improve matching and prefill quality.',
      'Some fields may be identified as uncertain or may require an AI-generated suggestion. You are responsible for reviewing every value before using it. The Extension does not make decisions about whether you should apply and does not submit an application on your behalf.',
    ],
  },
  {
    title: '4. Sharing and service providers',
    paragraphs: [
      'We do not sell personal information and we do not use resume or application information for advertising. We share information only as needed to provide the service, protect the service, comply with law, or at your direction.',
      'Liorvix uses infrastructure and service providers such as Supabase for authentication and database hosting, compatible object storage for uploaded files, and Alibaba Model Studio for certain AI text-generation features. Data sent to an AI provider is limited to the information needed for that requested feature and is processed under the provider terms applicable to Liorvix.',
      'The Extension can interact with third-party employer application pages because that interaction is the purpose of the Extension. Field values are written into the page only after you select the fields and choose the fill action. The employer website receives the information when you use its page and submit or otherwise save its form according to your own actions and that website\'s practices.',
    ],
  },
  {
    title: '5. Permissions used by the Extension',
    paragraphs: [
      'The Extension uses browser storage to keep short-lived session state, tabs and the activeTab permission to identify the active application page, scripting to scan and fill supported form controls after your request, and access to HTTP and HTTPS pages so it can work on employer career sites. It does not use these permissions to run advertising, sell data, or collect browsing history unrelated to an application workflow.',
    ],
  },
  {
    title: '6. Retention and deletion',
    paragraphs: [
      'Browser session data used by the Extension is intended to be temporary and is cleared when the browser session or account session is cleared. Liorvix retains account, resume, and application information for as long as needed to provide the service and maintain legitimate business and security records, unless you delete it or request deletion.',
      'You can delete resumes and application records through available account features. For an account-level deletion or privacy request, contact us at support@liorvix.com. We will verify the request and handle it subject to applicable law, security requirements, and information that must be retained for legal purposes.',
    ],
  },
  {
    title: '7. Security',
    paragraphs: [
      'We use access controls and authenticated API requests to help protect account data. No online service can guarantee absolute security. Do not use the Extension on a device or browser profile that you do not trust, and review values before submitting any application.',
    ],
  },
  {
    title: '8. Children and changes',
    paragraphs: [
      'The service is intended for adults and is not directed to children under 13. We may update this policy when our services or legal obligations change. The effective date at the top of this page shows when this version took effect.',
    ],
  },
];

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <article className="mx-auto max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
        <header className="border-b border-zinc-200 pb-8 dark:border-zinc-800">
          <Link href="/extension" className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            返回扩展说明
          </Link>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Liorvix</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Privacy Policy</h1>
          <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">Effective date: August 28, 2026</p>
        </header>

        <div className="space-y-8 pt-8 text-[15px] leading-7 text-zinc-700 dark:text-zinc-300">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{section.title}</h2>
              <div className="mt-3 space-y-3">
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </section>
          ))}
        </div>

        <footer className="mt-10 border-t border-zinc-200 pt-6 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Liorvix Auto Apply is published by Liorvix. Privacy requests: support@liorvix.com
        </footer>
      </article>
    </main>
  );
}
