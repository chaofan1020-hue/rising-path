'use client';

import Link from 'next/link';
import { Check, CreditCard, Languages, LogOut, Sparkles, User as UserIcon } from 'lucide-react';
import { useLanguage, type Locale } from '@/lib/language-context';
import type { BillingSnapshot } from '@/lib/billing-types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const languageOptions: Array<{ value: Locale; label: string }> = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
];

function initials(name: string): string {
  const value = name.trim();
  if (!value) return 'U';
  const parts = value.split(/[\s@]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return value.slice(0, 2).toUpperCase();
}

export function AccountMenu({
  displayName,
  billing,
  onLogout,
}: {
  displayName: string;
  billing: BillingSnapshot | null;
  onLogout: () => void;
}) {
  const { t, locale, setLocale } = useLanguage();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors"
        >
          {initials(displayName)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-2">
          <UserIcon className="h-4 w-4 text-zinc-400" />
          <span className="truncate">{displayName}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {billing?.isPro ? (
          <DropdownMenuItem asChild>
            <Link href="/account/billing" className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-zinc-400" />
              <span className="flex-1">{t('nav.planPro')}</span>
              <Check className="h-4 w-4 text-emerald-500" />
            </Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem asChild>
            <Link href="/pricing" className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-zinc-400" />
              <span className="flex-1">{t('nav.upgrade')}</span>
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href="/account/billing" className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-zinc-400" />
            {t('billing.title')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2 text-xs text-zinc-500">
          <Languages className="h-4 w-4" />
          {t('nav.language')}
        </DropdownMenuLabel>
        {languageOptions.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => setLocale(option.value)}
            className="flex items-center gap-2"
          >
            <span className="flex-1">{option.label}</span>
            {locale === option.value && <Check className="h-4 w-4 text-emerald-500" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout} className="flex items-center gap-2 text-red-600 dark:text-red-400">
          <LogOut className="h-4 w-4" />
          {t('nav.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
