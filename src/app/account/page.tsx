'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, KeyRound, Loader2, Mail, Save, UserRound } from 'lucide-react';
import { AuthGuard, useAuth } from '@/components/auth-guard';
import { Header1 } from '@/components/header1';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api-client';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { useLanguage } from '@/lib/language-context';
import { ACCOUNT_COPY } from '@/lib/account-copy';

type Profile = { id: string | null; email: string | null; displayName: string | null; avatarUrl: string | null; updatedAt: string | null };

function AccountSettings() {
  const { user } = useAuth();
  const { locale } = useLanguage();
  const copy = ACCOUNT_COPY[locale];
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    void apiFetch('/api/account/profile', { cache: 'no-store' }).then(async (response) => {
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || copy.profileLoadFailed);
      if (!mounted) return;
      const nextProfile = json.data as Profile;
      setProfile(nextProfile);
      setDisplayName(nextProfile.displayName || '');
      setAvatarUrl(nextProfile.avatarUrl || '');
    }).catch((reason: unknown) => {
      if (mounted) setError(reason instanceof Error ? reason.message : copy.profileLoadFailed);
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, [copy.profileLoadFailed]);

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true); setMessage(''); setError('');
    try {
      if (avatarFile) {
        const uploadData = new FormData();
        uploadData.append('file', avatarFile);
        const avatarResponse = await apiFetch('/api/account/avatar', { method: 'POST', body: uploadData });
        const avatarJson = await avatarResponse.json();
        if (!avatarResponse.ok) throw new Error(avatarJson.error?.message || copy.avatarUploadFailed);
        setAvatarUrl(avatarJson.data.avatarUrl || '');
        setAvatarFile(null);
      }
      const response = await apiFetch('/api/account/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || copy.profileSaveFailed);
      setProfile(json.data as Profile);
      setMessage(copy.profileSaved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.profileSaveFailed);
    } finally { setSaving(false); }
  };

  const updatePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordSaving(true); setMessage(''); setError('');
    try {
      if (newPassword.length < 8) throw new Error('新密码至少需要 8 位');
      const client = await getSupabaseBrowserClient();
      const { error: updateError } = await client.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      setNewPassword('');
      setMessage(copy.passwordUpdated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.passwordUpdateFailed);
    } finally { setPasswordSaving(false); }
  };

  const name = displayName || user?.email?.split('@')[0] || copy.accountFallback;
  const initials = name.slice(0, 1).toUpperCase();

  if (loading) return <div className="flex min-h-72 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return <main className="mx-auto max-w-5xl px-4 pb-12 pt-24 sm:px-6"><header className="mb-6"><div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-primary"><UserRound className="h-3.5 w-3.5" />{copy.accountCenter}</div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{copy.personalProfile}</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{copy.profileDescription}</p></header>{(message || error) && <div className={`mb-5 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${error ? 'border-destructive/25 bg-destructive/5 text-destructive' : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300'}`}>{error ? <span>{error}</span> : <><Check className="h-4 w-4" />{message}</>}</div>}<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"><div className="space-y-5"><Card className="shadow-sm"><CardHeader><CardTitle className="text-base">{copy.personalProfile}</CardTitle><CardDescription>{copy.profileCardDescription}</CardDescription></CardHeader><CardContent><form className="space-y-5" onSubmit={(event) => void saveProfile(event)}><div className="flex items-center gap-4"><Avatar className="h-16 w-16 border"><AvatarImage src={avatarUrl || undefined} alt="" /><AvatarFallback className="bg-zinc-900 text-lg text-white dark:bg-white dark:text-zinc-900">{initials}</AvatarFallback></Avatar><div><p className="font-medium">{name}</p><Label htmlFor="avatar-file" className="mt-1 inline-flex cursor-pointer text-xs text-primary hover:underline">{avatarFile ? avatarFile.name : copy.chooseAvatar}</Label><Input id="avatar-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={(event) => setAvatarFile(event.target.files?.[0] || null)} /><p className="mt-1 text-xs text-muted-foreground">{avatarFile ? copy.avatarUploading : copy.avatarHint}</p></div></div><div className="space-y-2"><Label htmlFor="display-name">{copy.displayName}</Label><Input id="display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={copy.displayNamePlaceholder} maxLength={120} /></div><div className="space-y-2"><Label>{copy.loginEmail}</Label><div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground"><Mail className="h-4 w-4" />{profile?.email || user?.email || '-'}</div></div><Button type="submit" disabled={saving}><Save className="mr-2 h-4 w-4" />{saving ? copy.savingProfile : copy.saveProfile}</Button></form></CardContent></Card><Card className="shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4 text-primary" />{copy.updatePassword}</CardTitle><CardDescription>{copy.profileDescription}</CardDescription></CardHeader><CardContent><form className="space-y-4" onSubmit={(event) => void updatePassword(event)}><div className="space-y-2"><Label htmlFor="new-password">{copy.newPassword}</Label><Input id="new-password" type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder={copy.passwordPlaceholder} /></div><Button type="submit" variant="outline" disabled={passwordSaving || !newPassword}>{passwordSaving ? copy.updatingPassword : copy.updatePassword}</Button></form></CardContent></Card></div><aside className="space-y-5"><Card className="border-primary/20 bg-primary/[0.04] shadow-sm"><CardHeader><CardTitle className="text-base">{copy.aiCredits}</CardTitle><CardDescription>{copy.aiCreditsDescription}</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">{copy.balanceDescription}</p><Link href="/account/credits" className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">{copy.viewCreditHistory}<ArrowRight className="h-4 w-4" /></Link></CardContent></Card><Card className="shadow-sm"><CardHeader><CardTitle className="text-base">{copy.commonEntries}</CardTitle></CardHeader><CardContent className="space-y-1"><Link href="/resume" className="flex items-center justify-between rounded-md px-2 py-2.5 text-sm hover:bg-muted"><span>{copy.myResume}</span><ArrowRight className="h-4 w-4 text-muted-foreground" /></Link><Link href="/dashboard" className="flex items-center justify-between rounded-md px-2 py-2.5 text-sm hover:bg-muted"><span>{copy.cockpit}</span><ArrowRight className="h-4 w-4 text-muted-foreground" /></Link></CardContent></Card></aside></div></main>;
}

export default function AccountPage() {
  return <AuthGuard showAccountBar={false}><div className="min-h-screen bg-muted/20"><Header1 /><AccountSettings /></div></AuthGuard>;
}
