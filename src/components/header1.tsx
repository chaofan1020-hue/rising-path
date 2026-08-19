"use client";

import { Button } from "@/components/ui/button";
import {
    NavigationMenu,
    NavigationMenuContent,
    NavigationMenuItem,
    NavigationMenuLink,
    NavigationMenuList,
    NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import { Menu, MoveRight, X } from "lucide-react";
import { useState, useEffect } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { AccountMenu } from "@/components/account-menu";
import { useLanguage } from "@/lib/language-context";
import { apiFetch } from "@/lib/api-client";
import type { BillingSnapshot } from "@/lib/billing-types";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { User as SupabaseUser, AuthChangeEvent, Session } from "@supabase/supabase-js";

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
    const [isOpen, setOpen] = useState(false);
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [displayName, setDisplayName] = useState("");
    const [billing, setBilling] = useState<BillingSnapshot | null>(null);

    useEffect(() => {
        let mounted = true;
        getSupabaseBrowserClient().then(supabase => {
            supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
                if (mounted) {
                    setIsLoggedIn(!!session);
                    setDisplayName(getDisplayName(session?.user ?? null));
                }
            });
            const { data: { subscription } } = supabase.auth.onAuthStateChange(
                (_event: AuthChangeEvent, session: Session | null) => {
                    if (mounted) {
                        setIsLoggedIn(!!session);
                        setDisplayName(getDisplayName(session?.user ?? null));
                    }
                }
            );
            return () => subscription.unsubscribe();
        });

        return () => {
            mounted = false;
        };
    }, []);

    const handleLogout = async () => {
        const supabase = await getSupabaseBrowserClient();
        await supabase.auth.signOut();
        setIsLoggedIn(false);
        setDisplayName("");
        window.location.href = '/';
    };

    useEffect(() => {
        if (!isLoggedIn) {
            setBilling(null);
            return;
        }
        let cancelled = false;
        apiFetch("/api/billing/status")
            .then((response) => (response.ok ? response.json() : { billing: null }))
            .then((json) => {
                if (!cancelled && json.billing) setBilling(json.billing);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [isLoggedIn]);

    const navigationItems: Array<{
        title: string;
        href?: string;
        description?: string;
        highlighted?: boolean;
        items?: Array<{ title: string; href: string }>;
    }> = isLoggedIn
        ? [
            {
                title: t("nav.dashboard"),
                href: "/dashboard",
                description: "",
            },
            {
                title: t("nav.mockInterview"),
                href: "/mock-interview",
                highlighted: false,
            },
            {
                title: t("nav.jobSearch"),
                href: "/jobs",
                description: "",
            },
            {
                title: t("nav.features"),
                description: t("features.subtitle"),
                items: [
                    {
                        title: t("nav.resumeManager"),
                        href: "/resume",
                    },
                    {
                        title: t("nav.aiMatch"),
                        href: "/ai-match",
                    },
                    {
                        title: t("nav.atsOptimize"),
                        href: "/optimize",
                    },
                    {
                        title: t("nav.autoApplication"),
                        href: "/field-mappings",
                    },
                ],
            },
        ]
        : [
            {
                title: t("nav.mockInterview"),
                href: "/mock-interview",
                highlighted: false,
            },
            {
                title: t("nav.features"),
                description: t("features.subtitle"),
                items: [
                    {
                        title: t("nav.jobSearch"),
                        href: "/jobs",
                    },
                    {
                        title: t("nav.resumeManager"),
                        href: "/resume",
                    },
                    {
                        title: t("nav.aiMatch"),
                        href: "/ai-match",
                    },
                    {
                        title: t("nav.atsOptimize"),
                        href: "/optimize",
                    },
                    {
                        title: t("nav.dashboard"),
                        href: "/dashboard",
                    },
                ],
            },
            {
                title: t("nav.more"),
                description: "",
                items: [
                    {
                        title: t("nav.autoApplication"),
                        href: "/field-mappings",
                    },
                ],
            },
        ];

    return (
        <header className="w-full z-40 fixed top-0 left-0 bg-background">
            <div className="container relative mx-auto min-h-14 flex gap-4 flex-row lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center">
                <div className="justify-start items-center gap-4 lg:flex hidden flex-row min-w-0">
                    <NavigationMenu className="flex justify-start items-start">
                        <NavigationMenuList className="flex justify-start gap-1 flex-row">
                            {navigationItems.map((item) => (
                                <NavigationMenuItem key={item.title}>
                                    {item.href ? (
                                        <>
                                            <NavigationMenuLink href={item.href}>
                                                <Button
                                                    variant={item.highlighted ? "default" : "ghost"}
                                                    className={item.highlighted
                                                        ? "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 px-2.5"
                                                        : "text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 px-2.5"}
                                                >
                                                    {item.title}
                                                </Button>
                                            </NavigationMenuLink>
                                        </>
                                    ) : (
                                        <>
                                            <NavigationMenuTrigger className="font-medium text-sm text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 data-[state=open]:bg-zinc-100 dark:data-[state=open]:bg-zinc-800">
                                                {item.title}
                                            </NavigationMenuTrigger>
                                            <NavigationMenuContent className="!w-[450px] p-4">
                                                <div className="flex flex-col lg:grid grid-cols-2 gap-4">
                                                    <div className="flex flex-col h-full justify-between">
                                                        <div className="flex flex-col">
                                                            <p className="text-base text-black dark:text-white">{item.title}</p>
                                                            {item.description && (
                                                                <p className="text-black/60 dark:text-white/60 text-sm">
                                                                    {item.description}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col text-sm h-full justify-end">
                                                        {item.items?.map((subItem) => (
                                                            <NavigationMenuLink
                                                                href={subItem.href}
                                                                key={subItem.title}
                                                                className="flex flex-row justify-between items-center hover:bg-zinc-100 dark:hover:bg-zinc-800 py-2 px-4 rounded"
                                                            >
                                                                <span className="text-black dark:text-white">{subItem.title}</span>
                                                                <MoveRight className="w-4 h-4 text-black/60 dark:text-white/60" />
                                                            </NavigationMenuLink>
                                                        ))}
                                                    </div>
                                                </div>
                                            </NavigationMenuContent>
                                        </>
                                    )}
                                </NavigationMenuItem>
                            ))}
                        </NavigationMenuList>
                    </NavigationMenu>
                </div>
                <div className="flex lg:justify-center shrink-0">
                    <Link href="/" className="flex items-center gap-2 font-semibold text-lg text-black dark:text-white">
                        <svg viewBox="0 0 40 20" fill="currentColor" aria-hidden="true" className="h-2.5 w-auto shrink-0">
                            <path d="M0 0h29a4 4 0 0 1 0 8H0V0z" />
                            <path d="M40 20H11a4 4 0 0 1 0-8h29v8z" />
                        </svg>
                        Liorvix
                    </Link>
                </div>
                <div className="flex justify-end w-full gap-3 items-center min-w-0">
                    {isLoggedIn ? (
                        <>
                            <ThemeToggle />
                            <AccountMenu displayName={displayName} billing={billing} onLogout={handleLogout} />
                        </>
                    ) : (
                        <>
                            <LanguageSwitcher />
                            <ThemeToggle />
                            <Button asChild className="bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
                                <Link href="/login">{t("nav.getStarted")}</Link>
                            </Button>
                        </>
                    )}
                </div>
                <div className="flex w-12 shrink lg:hidden justify-end items-center">
                    <Button variant="ghost" onClick={() => setOpen(!isOpen)}>
                        {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </Button>
                    {isOpen && (
                        <div className="absolute top-14 border-t flex flex-col w-full right-0 bg-background shadow-lg py-4 container gap-8">
                            {navigationItems.map((item) => (
                                <div key={item.title}>
                                    <div className="flex flex-col gap-2">
                                        {item.href ? (
                                            <Link
                                                href={item.href}
                                                className={`flex justify-between items-center ${
                                                    item.highlighted
                                                        ? "text-white bg-zinc-900 dark:bg-white dark:text-zinc-900 px-3 py-2 rounded-md"
                                                        : ""
                                                }`}
                                            >
                                                <span className="text-lg text-black dark:text-white">{item.title}</span>
                                            </Link>
                                        ) : (
                                            <p className="text-lg text-black dark:text-white">{item.title}</p>
                                        )}
                                        {item.items &&
                                            item.items.map((subItem) => (
                                                <Link
                                                    key={subItem.title}
                                                    href={subItem.href}
                                                    className="flex justify-between items-center"
                                                >
                                                    <span className="text-black/70 dark:text-white/70">
                                                        {subItem.title}
                                                    </span>
                                                    <MoveRight className="w-4 h-4" />
                                                </Link>
                                            ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}

export { Header1 };
