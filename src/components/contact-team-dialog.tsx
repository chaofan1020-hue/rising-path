'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Mail, X } from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/lib/language-context';
import { cn } from '@/lib/utils';

export const SUPPORT_EMAIL = 'support@liorvix.com';

export type ContactTopic = 'support' | 'enterprise';

const MAIL_SUBJECT: Record<ContactTopic, string> = {
  support: 'Liorvix support',
  enterprise: 'Enterprise pricing',
};

function mailToHref(topic: ContactTopic) {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(MAIL_SUBJECT[topic])}`;
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  }
}

function LiorvixMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 20" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M0 0h29a4 4 0 0 1 0 8H0V0z" />
      <path d="M40 20H11a4 4 0 0 1 0-8h29v8z" />
    </svg>
  );
}

export function ContactTeamDialog({
  open,
  onOpenChange,
  topic = 'support',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topic?: ContactTopic;
}) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    const ok = await copyText(SUPPORT_EMAIL);
    if (ok) setCopied(true);
  };

  const title = topic === 'enterprise' ? t('contact.enterpriseTitle') : t('contact.supportTitle');
  const subtitle = topic === 'enterprise' ? t('contact.enterpriseSubtitle') : t('contact.supportSubtitle');
  const subject = topic === 'enterprise' ? t('contact.enterpriseSubject') : t('contact.supportSubject');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-zinc-950/40 backdrop-blur-md"
        data-contact-dialog="true"
        className="w-[min(100%-1.5rem,420px)] gap-0 overflow-hidden rounded-[28px] border-0 bg-white p-0 text-zinc-950 shadow-[0_24px_80px_rgba(15,15,15,0.22)] sm:max-w-[420px]"
      >
        <div className="relative px-7 pb-7 pt-8 sm:px-8">
          <DialogClose
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
            aria-label={t('contact.close')}
          >
            <X className="h-4 w-4" />
          </DialogClose>

          <div className="flex flex-col items-center text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-950 text-white">
              <LiorvixMark className="h-3.5 w-auto" />
            </div>
            <DialogTitle className="mt-5 text-[1.65rem] font-semibold tracking-tight text-zinc-950">
              {title}
            </DialogTitle>
            <DialogDescription className="mt-2 max-w-[20rem] text-[15px] leading-relaxed text-zinc-500">
              {subtitle}
            </DialogDescription>
          </div>

          <div className="mt-7 rounded-2xl border border-zinc-200/80 bg-zinc-50/90 px-4 py-3.5">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400">
              {t('contact.emailLabel')}
            </p>
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <p className="truncate text-[17px] font-medium tracking-tight text-zinc-950">
                {SUPPORT_EMAIL}
              </p>
              <button
                type="button"
                onClick={handleCopy}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-zinc-700 shadow-[0_1px_2px_rgba(15,15,15,0.08)] ring-1 ring-zinc-200/80 transition-colors hover:text-zinc-950"
                aria-label={copied ? t('contact.copied') : t('contact.copy')}
              >
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 px-1 text-[13px] text-zinc-500">
            <span>{t('contact.subjectLabel')}</span>
            <span className="truncate font-medium text-zinc-800">{subject}</span>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              {copied ? t('contact.copied') : t('contact.copy')}
            </button>
            <a
              href={mailToHref(topic)}
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-zinc-100 px-4 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-200"
            >
              <Mail className="h-4 w-4" />
              {t('contact.openMail')}
            </a>
          </div>

          <p className="mt-5 text-center text-[12px] leading-relaxed text-zinc-400">
            {t('contact.hours')}
            <br />
            {t('contact.hint')}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ContactTeamButton({
  topic = 'support',
  className,
  children,
}: {
  topic?: ContactTopic;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className={cn('cursor-pointer appearance-none', className)} onClick={() => setOpen(true)}>
        {children}
      </button>
      <ContactTeamDialog open={open} onOpenChange={setOpen} topic={topic} />
    </>
  );
}
