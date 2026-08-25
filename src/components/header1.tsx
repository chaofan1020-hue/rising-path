"use client";

import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Menu, MoveRight, X, LogOut, LayoutDashboard, Search, FileText, Send, Sparkles, Wand2, MessageSquare, ChevronDown } from "lucide-react";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/lib/language-context";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { User as SupabaseUser, AuthChangeEvent, Session } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import { AccountCenter } from "@/components/account-center";

let headerSessionCache: Session | null | undefined;

function getDisplayName(user: SupabaseUser | null): string {
    if (!user) return "";
    const meta = user.user_metadata || {};
    if (meta.username) return meta.username;
    if (meta.full_name) return meta.full_name;
    if (meta.first_name || meta.last_name) {
        return `${meta.first_name || ""} ${meta.last_name || ""}`.trim();
    }
    return user.email || "";
}

function Header1() {
    const { t } = useLanguage();
    const pathname = usePathname();
    const [isOpen, setOpen] = useState(false);
    const [toolsOpen, setToolsOpen] = useState(false);
    const [session, setSession] = useState<Session | null | undefined>(() => headerSessionCache);
    const isLoggedIn = Boolean(session);
    const currentUser = session?.user ?? null;
    const displayName = getDisplayName(currentUser);

    useEffect(() => {
        let mounted = true;
        const applySession = (nextSession: Session | null) => {
            headerSessionCache = nextSession;
            if (mounted) setSession(nextSession);
        };

        getSupabaseBrowserClient().then(supabase => {
            supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
                applySession(session);
            });
            const { data: { subscription } } = supabase.auth.onAuthStateChange(
                (_event: AuthChangeEvent, session: Session | null) => {
                    applySession(session);
                }
            );
            return () => subscription.unsubscribe();
        });

        return () => {
            mounted = false;
        };
    }, []);

    useEffect(() => {
        setOpen(false);
        setToolsOpen(false);
    }, [pathname]);

    const handleLogout = async () => {
        const supabase = await getSupabaseBrowserClient();
        await supabase.auth.signOut();
        headerSessionCache = null;
        setSession(null);
        window.location.href = '/';
    };

    const navigationItems: Array<{
        title: string;
        href: string;
        icon: typeof LayoutDashboard;
    }> = [
        {
            title: t("nav.dashboard"),
            href: "/dashboard",
            icon: LayoutDashboard,
        },
        {
            title: t("nav.jobSearch"),
            href: "/jobs",
            icon: Search,
        },
        {
            title: t("nav.resumeManager"),
            href: "/resume",
            icon: FileText,
        },
        {
            title: t("nav.applications"),
            href: "/field-mappings?tab=applications",
            icon: Send,
        },
    ];

    const toolItems = [
        { title: t("nav.aiMatch"), href: "/ai-match", icon: Sparkles },
        { title: t("nav.atsOptimize"), href: "/optimize", icon: Wand2 },
        { title: t("nav.mockInterview"), href: "/mock-interview", icon: MessageSquare },
    ];

    const isActive = (href: string) => {
        const basePath = href.split('?')[0];
        return pathname === basePath || pathname.startsWith(`${basePath}/`);
    };

    return (
        <header className="w-full z-40 fixed top-0 left-0 border-b border-zinc-200/80 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 dark:border-zinc-800/80">
            <div className="container relative mx-auto min-h-16 flex gap-4 flex-row items-center px-4">
                <div className="flex min-w-0 items-center gap-6">
                    <Link href={isLoggedIn ? "/home" : "/"} className="flex shrink-0 items-center gap-2 font-semibold text-lg text-black dark:text-white">
                        <svg viewBox="0 0 40 20" fill="currentColor" aria-hidden="true" className="h-2.5 w-auto shrink-0">
                            <path d="M0 0h29a4 4 0 0 1 0 8H0V0z" />
                            <path d="M40 20H11a4 4 0 0 1 0-8h29v8z" />
                        </svg>
                        Liorvix
                    </Link>
                    {isLoggedIn && <nav aria-label="Primary" className="hidden xl:flex items-center gap-1">
                        {navigationItems.map((item) => {
                            const Icon = item.icon;
                            const active = isActive(item.href);
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    aria-current={active ? "page" : undefined}
                                    className={cn(
                                        "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
                                        active
                                            ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                                            : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white",
                                    )}
                                >
                                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                                    <span>{item.title}</span>
                                </Link>
                            );
                        })}
                        <DropdownMenu open={toolsOpen} onOpenChange={setToolsOpen}>
                            <DropdownMenuTrigger asChild>
                                <button type="button" aria-expanded={toolsOpen} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 data-[state=open]:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white dark:data-[state=open]:bg-zinc-800">
                                    {t("nav.tools")}
                                    <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${toolsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" sideOffset={8} className="w-[280px] p-2 data-[state=closed]:animate-none data-[state=open]:animate-none">
                                {toolItems.map((item) => {
                                    const Icon = item.icon;
                                    return (
                                        <Link key={item.href} href={item.href} onClick={() => setToolsOpen(false)} className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800">
                                            <Icon className="h-4 w-4 text-zinc-500" aria-hidden="true" />
                                            <span>{item.title}</span>
                                            <MoveRight className="ml-auto h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                                        </Link>
                                    );
                                })}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </nav>}
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <LanguageSwitcher />
                    <ThemeToggle />
                    {isLoggedIn ? (
                        <>
                            {currentUser && <AccountCenter user={currentUser} displayName={displayName} onLogout={handleLogout} />}
                            <Button variant="ghost" onClick={handleLogout} className="hidden xl:inline-flex text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100">
                                <LogOut className="w-4 h-4 mr-2" />
                                {t("nav.logout")}
                            </Button>
                        </>
                    ) : (
                        <Button asChild className="bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
                            <Link href="/login">{t("nav.getStarted")}</Link>
                        </Button>
                    )}
                </div>
                    {isLoggedIn && <Button aria-label={isOpen ? "Close navigation" : "Open navigation"} variant="ghost" className="xl:hidden h-9 w-9 p-0" onClick={() => setOpen(!isOpen)}>
                        {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </Button>}
                    {isLoggedIn && isOpen && (
                        <div className="absolute left-0 right-0 top-16 border-t border-zinc-200 bg-background px-4 py-4 shadow-xl dark:border-zinc-800 xl:hidden">
                            <div className="container mx-auto space-y-1">
                            {navigationItems.map((item) => (
                                <Link key={item.href} href={item.href} onClick={() => setOpen(false)} aria-current={isActive(item.href) ? "page" : undefined} className={cn("flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium", isActive(item.href) ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-700 dark:text-zinc-200")}>
                                    <item.icon className="h-4 w-4" aria-hidden="true" />
                                    <span>{item.title}</span>
                                    <MoveRight className="ml-auto h-4 w-4 opacity-50" aria-hidden="true" />
                                </Link>
                            ))}
                            <div className="my-3 border-t border-zinc-200 dark:border-zinc-800" />
                            {toolItems.map((item) => (
                                <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-zinc-600 dark:text-zinc-300">
                                    <item.icon className="h-4 w-4" aria-hidden="true" />
                                    <span>{item.title}</span>
                                    <MoveRight className="ml-auto h-4 w-4 opacity-50" aria-hidden="true" />
                                </Link>
                            ))}
                            {isLoggedIn && (
                                <Button variant="ghost" onClick={handleLogout} className="mt-2 w-full justify-start px-3 text-zinc-600 dark:text-zinc-300">
                                    <LogOut className="mr-3 h-4 w-4" />
                                    {t("nav.logout")}
                                </Button>
                            )}
                            </div>
                        </div>
                    )}
            </div>
        </header>
    );
}

export { Header1 };
