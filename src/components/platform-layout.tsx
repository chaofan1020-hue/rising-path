"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase,
  Brain,
  FileText,
  Sparkles,
  ClipboardList,
  Key,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PlatformLayoutProps {
  children: React.ReactNode;
}

const navigation = [
  { name: "岗位查询", href: "/platform/jobs", icon: Briefcase },
  { name: "AI 选岗", href: "/platform/ai-match", icon: Brain },
  { name: "简历管理", href: "/platform/resume", icon: FileText },
  { name: "简历优化", href: "/platform/optimize", icon: Sparkles },
  { name: "网申管理", href: "/platform/applications", icon: ClipboardList },
  { name: "访问码", href: "/platform/access-code", icon: Key },
];

export default function PlatformLayout({ children }: PlatformLayoutProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem("accessCodeId");
    localStorage.removeItem("accessCode");
    window.location.href = "/access-code";
  };

  return (
    <div className="min-h-screen bg-background">
      {/* 移动端侧边栏遮罩 */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* 侧边栏 */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-50 h-full w-64 bg-card border-r border-border transform transition-transform duration-300 ease-in-out lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo 区域 */}
        <div className="flex items-center justify-between h-16 px-6 border-b border-border">
          <Link href="/platform" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Briefcase className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-lg text-foreground">Rising Path</span>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 导航菜单 */}
        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* 底部退出按钮 */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-border">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <LogOut className="h-5 w-5" />
            退出登录
          </button>
        </div>
      </aside>

      {/* 主内容区域 */}
      <div className="lg:pl-64">
        {/* 顶部导航栏 */}
        <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-4 bg-background border-b border-border lg:px-8">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-muted-foreground hover:text-foreground"
          >
            <Menu className="h-6 w-6" />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              访问码：{localStorage.getItem("accessCode") || "未登录"}
            </span>
          </div>
        </header>

        {/* 页面内容 */}
        <main className="p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
