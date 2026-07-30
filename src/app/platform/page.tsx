"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Brain, FileText, Sparkles, ClipboardList, Key } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const features = [
  {
    name: "岗位查询",
    description: "浏览海量海外岗位，按地区、方向筛选",
    href: "/platform/jobs",
    icon: Briefcase,
    color: "from-indigo-500 to-purple-600",
  },
  {
    name: "AI 选岗",
    description: "基于简历智能匹配最适合的岗位",
    href: "/platform/ai-match",
    icon: Brain,
    color: "from-purple-500 to-pink-600",
  },
  {
    name: "简历管理",
    description: "上传和管理多份简历",
    href: "/platform/resume",
    icon: FileText,
    color: "from-blue-500 to-indigo-600",
  },
  {
    name: "简历优化",
    description: "AI 针对性优化简历，提高通过率",
    href: "/platform/optimize",
    icon: Sparkles,
    color: "from-amber-500 to-orange-600",
  },
  {
    name: "网申管理",
    description: "追踪所有网申进度和状态",
    href: "/platform/applications",
    icon: ClipboardList,
    color: "from-green-500 to-emerald-600",
  },
  {
    name: "访问码管理",
    description: "查看和管理访问码信息",
    href: "/platform/access-code",
    icon: Key,
    color: "from-rose-500 to-red-600",
  },
];

export default function PlatformHome() {
  const router = useRouter();
  const [accessCode, setAccessCode] = useState("");

  useEffect(() => {
    const code = localStorage.getItem("accessCode");
    if (!code) {
      router.push("/access-code");
    } else {
      setAccessCode(code);
    }
  }, [router]);

  return (
    <div className="space-y-8">
      {/* 欢迎区域 */}
      <div className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 rounded-2xl p-8 border border-indigo-500/20">
        <h1 className="text-3xl font-bold text-foreground mb-2">欢迎使用 Rising Path</h1>
        <p className="text-muted-foreground">
          访问码：{accessCode} | 一站式求职平台，助力海外留学生拿到理想 Offer
        </p>
      </div>

      {/* 功能卡片网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {features.map((feature) => (
          <Link
            key={feature.name}
            href={feature.href}
            className={cn(
              "group relative overflow-hidden rounded-xl border border-border bg-card p-6 transition-all hover:shadow-lg hover:-translate-y-1"
            )}
          >
            <div className={cn("inline-flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br text-white mb-4", feature.color)}>
              <feature.icon className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">{feature.name}</h3>
            <p className="text-sm text-muted-foreground">{feature.description}</p>
            <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
