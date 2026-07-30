"use client";

import { PlatformLayout } from "@/app/platform/layout-wrapper";
import { Briefcase, Users, TrendingUp, Target } from "lucide-react";

const stats = [
  {
    label: "总岗位数",
    value: "10,234",
    change: "+12%",
    icon: Briefcase,
    color: "from-gray-400 to-gray-500",
  },
  {
    label: "已匹配",
    value: "1,429",
    change: "+8%",
    icon: Target,
    color: "from-gray-500 to-gray-600",
  },
  {
    label: "简历优化",
    value: "856",
    change: "+23%",
    icon: TrendingUp,
    color: "from-gray-300 to-gray-400",
  },
  {
    label: "网申提交",
    value: "342",
    change: "+5%",
    icon: Users,
    color: "from-gray-400 to-gray-500",
  },
];

const recentActivity = [
  { action: "AI 匹配岗位", target: "Software Engineer @ Google", time: "2小时前" },
  { action: "简历优化完成", target: "张三 - 前端工程师", time: "5小时前" },
  { action: "网申提交", target: "Data Scientist @ Microsoft", time: "1天前" },
  { action: "新岗位添加", target: "Product Manager @ Meta", time: "2天前" },
];

export default function PlatformPage() {
  return (
    <PlatformLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 mt-1">欢迎使用 Rising Path 求职平台</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="bg-gray-100 rounded-xl p-6 border border-gray-200 hover:border-gray-200 transition-colors"
            >
              <div className="flex items-center justify-between mb-4">
                <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${stat.color} flex items-center justify-center`}>
                  <stat.icon className="h-6 w-6 text-white" />
                </div>
                <span className="text-sm font-medium text-gray-400">{stat.change}</span>
              </div>
              <div className="text-3xl font-bold text-gray-900 mb-1">{stat.value}</div>
              <div className="text-sm text-gray-500">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Activity Chart */}
          <div className="bg-gray-100 rounded-xl p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">活动趋势</h3>
            <div className="h-64 flex items-end justify-between gap-2">
              {[40, 65, 45, 80, 55, 90, 70, 85, 60, 95, 75, 88].map((height, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-2">
                  <div
                    className="w-full bg-gradient-to-t from-gray-300 to-gray-200 rounded-t-sm transition-all hover:opacity-80"
                    style={{ height: `${height}%` }}
                  />
                  <span className="text-xs text-gray-400">{i + 1}月</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Activity */}
          <div className="bg-gray-100 rounded-xl p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">最近活动</h3>
            <div className="space-y-4">
              {recentActivity.map((activity, i) => (
                <div key={i} className="flex items-start gap-3 pb-4 border-b border-gray-200 last:border-0 last:pb-0">
                  <div className="w-2 h-2 rounded-full bg-gray-300 mt-2 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900 font-medium">{activity.action}</div>
                    <div className="text-sm text-gray-500 truncate">{activity.target}</div>
                  </div>
                  <div className="text-xs text-gray-400 flex-shrink-0">{activity.time}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-gray-100 rounded-xl p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">快速操作</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "上传简历", color: "from-gray-400 to-gray-500" },
              { label: "AI 选岗", color: "from-gray-500 to-gray-600" },
              { label: "优化简历", color: "from-gray-300 to-gray-400" },
              { label: "查看岗位", color: "from-gray-400 to-gray-500" },
            ].map((action) => (
              <button
                key={action.label}
                className={`px-4 py-3 rounded-lg bg-gradient-to-r ${action.color} text-white text-sm font-medium hover:opacity-90 transition-opacity`}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </PlatformLayout>
  );
}
