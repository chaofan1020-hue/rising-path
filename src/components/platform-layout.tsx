"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
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
  ChevronLeft,
  ChevronRight,
  Search,
  Bell,
} from "lucide-react";

interface PlatformLayoutProps {
  children: React.ReactNode;
}

const navigation = [
  { name: "Dashboard", href: "/platform", icon: LayoutDashboard },
  { name: "岗位查询", href: "/platform/jobs", icon: Briefcase },
  { name: "AI 选岗", href: "/platform/ai-match", icon: Brain },
  { name: "简历管理", href: "/platform/resume", icon: FileText },
  { name: "简历优化", href: "/platform/optimize", icon: Wand2 },
  { name: "网申管理", href: "/platform/applications", icon: ClipboardList },
  { name: "扩展程序", href: "/platform/extension", icon: Puzzle },
  { name: "设置", href: "/platform/settings", icon: Settings },
];

export function PlatformLayout({ children }: PlatformLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = () => {
    localStorage.removeItem("access_code");
    localStorage.removeItem("access_code_id");
    router.push("/");
  };

  return (
    <div className="flex h-screen bg-[#0f0f14]">
      {/* Sidebar */}
      <aside
        className={cn(
          "relative flex flex-col bg-[#1a1a24] border-r border-white/5 transition-all duration-300",
          collapsed ? "w-20" : "w-64"
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-between px-4 border-b border-white/5">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#8b5cf6] to-[#6366f1] flex items-center justify-center">
                <span className="text-white font-bold text-sm">RP</span>
              </div>
              <span className="text-white font-semibold">Rising Path</span>
            </div>
          )}
          {collapsed && (
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#8b5cf6] to-[#6366f1] flex items-center justify-center mx-auto">
              <span className="text-white font-bold text-sm">RP</span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-[#8b5cf6]/10 text-[#8b5cf6]"
                    : "text-gray-400 hover:bg-white/5 hover:text-white"
                )}
              >
                <item.icon className="h-5 w-5 flex-shrink-0" />
                {!collapsed && <span>{item.name}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Upgrade Button */}
        {!collapsed && (
          <div className="px-3 pb-4">
            <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-[#8b5cf6] to-[#6366f1] text-white text-sm font-medium hover:opacity-90 transition-opacity">
              <span>Upgrade Plan</span>
            </button>
          </div>
        )}

        {/* Collapse Toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-[#1a1a24] border border-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="h-16 flex items-center justify-between px-6 bg-[#0f0f14] border-b border-white/5">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <input
                type="text"
                placeholder="Search..."
                className="w-full h-9 pl-10 pr-4 rounded-lg bg-[#1a1a24] border border-white/5 text-white text-sm placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-[#8b5cf6]"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button className="relative p-2 rounded-lg hover:bg-white/5 transition-colors">
              <Bell className="h-5 w-5 text-gray-400" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#8b5cf6]"></span>
            </button>

            <div className="flex items-center gap-3 pl-4 border-l border-white/5">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#8b5cf6] to-[#6366f1] flex items-center justify-center">
                <span className="text-white text-sm font-medium">U</span>
              </div>
              <button
                onClick={handleLogout}
                className="p-2 rounded-lg hover:bg-white/5 transition-colors"
                title="退出登录"
              >
                <LogOut className="h-4 w-4 text-gray-400" />
              </button>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
