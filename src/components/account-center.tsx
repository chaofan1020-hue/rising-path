'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { ArrowRight, Coins, FileText, History, LogOut, UserRound } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { apiFetch } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/lib/language-context';
import { ACCOUNT_COPY } from '@/lib/account-copy';

type AccountCenterProps = {
  user: User;
  displayName: string;
  onLogout: () => Promise<void>;
};

type Profile = { displayName: string | null; avatarUrl: string | null; email: string | null };
type Credits = { balance: number };

const number = (value: number | string | null | undefined, locale: string) => new Intl.NumberFormat(locale === 'en' ? 'en-US' : locale === 'zh-TW' ? 'zh-TW' : 'zh-CN', { maximumFractionDigits: 2 }).format(Number(value || 0));
function fallbackName(user: User, displayName: string, fallback: string) {
  return displayName || user.email?.split('@')[0] || fallback;
}

export function AccountCenter({ user, displayName, onLogout }: AccountCenterProps) {
  const { locale } = useLanguage();
  const copy = ACCOUNT_COPY[locale];
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<Profile>({
    displayName: displayName || null,
    avatarUrl: typeof user.user_metadata?.avatar_url === 'string' ? user.user_metadata.avatar_url : null,
    email: user.email || null,
  });
  const [credits, setCredits] = useState<Credits>({ balance: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      apiFetch('/api/account/profile', { cache: 'no-store' }).then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error?.message || '读取账户资料失败');
        return json.data as Profile;
      }),
      apiFetch('/api/credits', { cache: 'no-store' }).then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error?.message || '读取积分失败');
        return json.data as Credits;
      }),
    ]).then(([nextProfile, nextCredits]) => {
      if (!mounted) return;
      setProfile(nextProfile);
      setCredits(nextCredits);
    }).catch((error: unknown) => {
      if (mounted) console.error('[Account Center] Failed to load:', error);
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, [user.id]);

  const name = fallbackName(user, profile.displayName || displayName, copy.accountFallback);
  const avatarUrl = profile.avatarUrl || (typeof user.user_metadata?.avatar_url === 'string' ? user.user_metadata.avatar_url : null);
  const initials = name.slice(0, 1).toUpperCase();

  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild>
      <button type="button" className="group flex h-10 min-w-10 items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 xl:w-44" aria-label={copy.profileSettings}>
        <Avatar className="h-8 w-8 border border-zinc-200 dark:border-zinc-700"><AvatarImage src={avatarUrl || undefined} alt="" /><AvatarFallback className="bg-zinc-900 text-xs text-white dark:bg-white dark:text-zinc-900">{initials}</AvatarFallback></Avatar>
        <span className="hidden max-w-36 truncate text-sm font-medium text-black dark:text-white xl:block">{name}</span>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" sideOffset={8} onCloseAutoFocus={(event) => event.preventDefault()} className="w-[330px] p-0 data-[state=closed]:animate-none data-[state=open]:animate-none">
      <div className="border-b px-4 py-4"><div className="flex items-center gap-3"><Avatar className="h-11 w-11 border border-zinc-200 dark:border-zinc-700"><AvatarImage src={avatarUrl || undefined} alt="" /><AvatarFallback className="bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">{initials}</AvatarFallback></Avatar><div className="min-w-0"><p className="truncate font-semibold">{name}</p><p className="truncate text-xs text-muted-foreground">{profile?.email || user.email}</p></div></div></div>
      <div className="p-3"><div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900"><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">{copy.aiCredits}</p><p className="mt-1 text-2xl font-semibold tracking-tight">{loading ? '...' : number(credits.balance, locale)} <span className="text-xs font-normal text-muted-foreground">{locale === 'en' ? 'credits' : '分'}</span></p></div><Coins className="h-5 w-5 text-amber-600" /></div><p className="mt-2 text-xs text-muted-foreground">{copy.balanceDescription}</p><Link href="/account/credits" onClick={() => setOpen(false)} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">{copy.viewCreditHistory}<ArrowRight className="h-3.5 w-3.5" /></Link></div></div>
      <div className="px-2 pb-2"><Link href="/account" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-md px-2.5 py-2.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"><UserRound className="h-4 w-4 text-muted-foreground" /><span>{copy.profileSettings}</span><ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" /></Link><Link href="/resume" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-md px-2.5 py-2.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"><FileText className="h-4 w-4 text-muted-foreground" /><span>{copy.myResume}</span><ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" /></Link><Link href="/account/credits" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-md px-2.5 py-2.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"><History className="h-4 w-4 text-muted-foreground" /><span>{copy.viewCreditHistory}</span><ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" /></Link></div>
      <DropdownMenuSeparator /><div className="p-2"><Button variant="ghost" className={cn('w-full justify-start gap-3 px-2.5 text-sm text-muted-foreground hover:text-foreground')} onClick={() => void onLogout()}><LogOut className="h-4 w-4" />退出登录</Button></div>
    </DropdownMenuContent>
  </DropdownMenu>;
}
