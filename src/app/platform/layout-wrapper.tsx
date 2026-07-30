"use client";

import React, { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Sidebar,
  SidebarBody,
  SidebarLink,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  Briefcase,
  Brain,
  FileText,
  Wand2,
  ClipboardList,
  Puzzle,
  Settings,
  LogOut,
} from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

interface PlatformLayoutProps {
  children: React.ReactNode;
}

export function PlatformLayout({ children }: PlatformLayoutProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const links = [
    {
      label: "Dashboard",
      href: "/platform",
      icon: (
        <LayoutDashboard className="text-neutral-200 h-5 w-5 flex-shrink-0" />
      ),
    },
    {
      label: "岗位查询",
      href: "/platform/jobs",
      icon: <Briefcase className="text-neutral-200 h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "AI 选岗",
      href: "/platform/ai-match",
      icon: <Brain className="text-neutral-200 h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "简历管理",
      href: "/platform/resume",
      icon: <FileText className="text-neutral-200 h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "简历优化",
      href: "/platform/optimize",
      icon: <Wand2 className="text-neutral-200 h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "网申管理",
      href: "/platform/applications",
      icon: <ClipboardList className="text-neutral-200 h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "扩展程序",
      href: "/platform/extension",
      icon: <Puzzle className="text-neutral-200 h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "设置",
      href: "/platform/settings",
      icon: <Settings className="text-neutral-200 h-5 w-5 flex-shrink-0" />,
    },
  ];

  const handleLogout = () => {
    localStorage.removeItem("access_code");
    localStorage.removeItem("access_code_id");
    router.push("/");
  };

  return (
    <div className="flex h-screen bg-[#0f0f14]">
      <Sidebar open={open} setOpen={setOpen}>
        <SidebarBody className="justify-between gap-10">
          <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
            {open ? <Logo /> : <LogoIcon />}
            <div className="mt-8 flex flex-col gap-2">
              {links.map((link, idx) => (
                <SidebarLink
                  key={idx}
                  link={link}
                  className={
                    pathname === link.href
                      ? "bg-[#8b5cf6]/10 rounded-lg px-2 text-[#8b5cf6]"
                      : "hover:bg-white/5 rounded-lg px-2"
                  }
                />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={handleLogout}
              className="flex items-center justify-start gap-2 group/sidebar py-2 hover:bg-white/5 rounded-lg px-2"
            >
              <LogOut className="text-neutral-200 h-5 w-5 flex-shrink-0" />
              {open && (
                <span className="text-neutral-200 text-sm group-hover/sidebar:translate-x-1 transition duration-150 whitespace-pre">
                  退出登录
                </span>
              )}
            </button>
          </div>
        </SidebarBody>
      </Sidebar>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}

export const Logo = () => {
  return (
    <Link
      href="/platform"
      className="font-normal flex space-x-2 items-center text-sm text-white py-1 relative z-20"
    >
      <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#8b5cf6] to-[#6366f1] flex items-center justify-center flex-shrink-0">
        <span className="text-white font-bold text-sm">RP</span>
      </div>
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="font-medium text-white whitespace-pre"
      >
        Rising Path
      </motion.span>
    </Link>
  );
};

export const LogoIcon = () => {
  return (
    <Link
      href="/platform"
      className="font-normal flex space-x-2 items-center text-sm text-white py-1 relative z-20"
    >
      <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#8b5cf6] to-[#6366f1] flex items-center justify-center flex-shrink-0">
        <span className="text-white font-bold text-sm">RP</span>
      </div>
    </Link>
  );
};
