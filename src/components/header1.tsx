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
import { Menu, MoveRight, X, LogOut, User } from "lucide-react";
import { useState, useEffect } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/lib/language-context";

function Header1() {
    const { t } = useLanguage();
    const [isOpen, setOpen] = useState(false);
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [accessCodeName, setAccessCodeName] = useState("");

    useEffect(() => {
        // 检查登录状态
        const accessCode = localStorage.getItem('access_code');
        
        if (accessCode) {
            try {
                const data = JSON.parse(accessCode);
                setIsLoggedIn(true);
                setAccessCodeName(data.name || data.code || "");
            } catch {
                setIsLoggedIn(false);
            }
        } else {
            setIsLoggedIn(false);
        }
    }, []);

    const handleLogout = () => {
        localStorage.removeItem('access_code');
        localStorage.removeItem('access_code_id');
        localStorage.removeItem('access_code_data');
        setIsLoggedIn(false);
        setAccessCodeName("");
        window.location.href = '/';
    };

    const navigationItems = [
        {
            title: t("nav.home"),
            href: "/",
            description: "",
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
                    title: t("nav.mockInterview"),
                    href: "/mock-interview",
                },
            ],
        },
        {
            title: t("nav.more"),
            description: "",
            items: [
                {
                    title: t("nav.applications"),
                    href: "/applications",
                },
                {
                    title: t("nav.autoApplication"),
                    href: "/field-mappings",
                },
            ],
        },
    ];

    return (
        <header className="w-full z-40 fixed top-0 left-0 bg-background">
            <div className="container relative mx-auto min-h-14 flex gap-4 flex-row lg:grid lg:grid-cols-3 items-center">
                <div className="justify-start items-center gap-4 lg:flex hidden flex-row">
                    <NavigationMenu className="flex justify-start items-start">
                        <NavigationMenuList className="flex justify-start gap-4 flex-row">
                            {navigationItems.map((item) => (
                                <NavigationMenuItem key={item.title}>
                                    {item.href ? (
                                        <>
                                            <NavigationMenuLink href={item.href}>
                                                <Button variant="ghost" className="text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100">{item.title}</Button>
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
                <div className="flex lg:justify-center">
                    <Link href="/" className="flex items-center gap-2 font-semibold text-lg text-black dark:text-white">
                        <svg viewBox="0 0 40 20" fill="currentColor" aria-hidden="true" className="h-3.5 w-auto shrink-0">
                            <path d="M0 0h29a4 4 0 0 1 0 8H0V0z" />
                            <path d="M40 20H11a4 4 0 0 1 0-8h29v8z" />
                        </svg>
                        Rising Path
                    </Link>
                </div>
                <div className="flex justify-end w-full gap-3 items-center">
                    <LanguageSwitcher />
                    <ThemeToggle />
                    {isLoggedIn ? (
                        <>
                            <div className="hidden md:flex items-center gap-2 text-sm text-black dark:text-white">
                                <User className="w-4 h-4" />
                                <span>{accessCodeName}</span>
                            </div>
                            <Button variant="ghost" onClick={handleLogout} className="hidden md:inline-flex text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100">
                                <LogOut className="w-4 h-4 mr-2" />
                                {t("nav.logout")}
                            </Button>
                        </>
                    ) : (
                        <Button asChild className="bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
                            <Link href="/access-code">{t("nav.getStarted")}</Link>
                        </Button>
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
                                                className="flex justify-between items-center"
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
