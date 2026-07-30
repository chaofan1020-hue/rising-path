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
        <LayoutDashboard className="text-neutral-400 h-5 w-5 flex-shrink-0" />
      ),
    },
    {
      label: "岗位查询",
      href: "/platform/jobs",
      icon: <Briefcase className="text-neutral-400 h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "AI 选岗",
      href: "/platform/ai-match",
      icon: <Brain className="text-neutral-400 h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "简历管理",
      href: "/platform/resume",
      icon: <FileText className="text-neutral-400 h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "简历优化",
      href: "/platform/optimize",
      icon: <Wand2 className="text-neutral-400 h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "网申管理",
      href: "/platform/applications",
      icon: <ClipboardList className="text-neutral-400 h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "扩展程序",
      href: "/platform/extension",
      icon: <Puzzle className="text-neutral-400 h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "设置",
      href: "/platform/settings",
      icon: <Settings className="text-neutral-400 h-5 w-5 flex-shrink-0" />,
    },
  ];

  const handleLogout = () => {
    localStorage.removeItem("access_code");
    localStorage.removeItem("access_code_id");
    router.push("/");
  };

  return (
    <div className="flex h-screen bg-[#1a1a1a]">
      <Sidebar open={open} setOpen={setOpen} animate={false}>
        <SidebarBody className="justify-between gap-10 py-6">
          <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
            <LogoIcon />
            <div className="mt-8 flex flex-col gap-4 items-center">
              {links.map((link, idx) => (
                <SidebarLink
                  key={idx}
                  link={link}
                  className={
                    pathname === link.href
                      ? "p-2 rounded-lg bg-neutral-800"
                      : "p-2 rounded-lg hover:bg-neutral-800/50"
                  }
                />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-4 items-center">
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-neutral-800/50"
            >
              <LogOut className="text-neutral-400 h-5 w-5 flex-shrink-0" />
            </button>
            <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center overflow-hidden">
              <img
                src="https://api.dicebear.com/7.x/avataaars/svg?seed=user"
                alt="User"
                className="w-full h-full"
              />
            </div>
          </div>
        </SidebarBody>
      </Sidebar>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}

export const LogoIcon = () => {
  return (
    <Link
      href="/platform"
      className="font-normal flex items-center justify-center py-1 relative z-20"
    >
      <div className="h-8 w-8 rounded-lg bg-white flex items-center justify-center flex-shrink-0">
        <span className="text-black font-bold text-sm">RP</span>
      </div>
    </Link>
  );
};
