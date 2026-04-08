'use client';

import { useState, useEffect } from 'react';
import { Briefcase, TrendingUp, Calendar, Sparkles } from 'lucide-react';

interface JobStats {
  today: number;
  thisWeek: number;
  thisMonth: number;
  total: number;
  regionBreakdown: Record<string, number>;
}

export function JobStatsWidget() {
  const [stats, setStats] = useState<JobStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
    // 每分钟刷新一次
    const interval = setInterval(fetchStats, 60000);
    return () => clearInterval(interval);
  }, []);

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/jobs/stats');
      const data = await response.json();
      setStats(data);
    } catch (error) {
      console.error('Failed to fetch job stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-pulse text-muted-foreground">加载中...</div>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  return (
    <div className="space-y-2">
      {/* 今日更新 - 主数据 */}
      <div className="text-center">
        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20 mb-2">
          <Sparkles className="h-3 w-3 text-primary animate-pulse" />
          <span className="text-xs font-medium text-primary">实时更新</span>
        </div>
        <div className="flex items-baseline justify-center gap-1">
          <span className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            {stats.today}
          </span>
          <span className="text-sm text-muted-foreground">个</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">今日新增可投递岗位</p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/20 rounded-lg p-2 text-center">
          <Calendar className="h-3 w-3 mx-auto mb-0.5 text-blue-600" />
          <div className="text-lg font-bold text-blue-700 dark:text-blue-400">
            {stats.thisWeek}
          </div>
          <div className="text-[10px] text-blue-600/70">本周</div>
        </div>
        
        <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/30 dark:to-purple-900/20 rounded-lg p-2 text-center">
          <TrendingUp className="h-3 w-3 mx-auto mb-0.5 text-purple-600" />
          <div className="text-lg font-bold text-purple-700 dark:text-purple-400">
            {stats.thisMonth}
          </div>
          <div className="text-[10px] text-purple-600/70">本月</div>
        </div>
        
        <div className="bg-gradient-to-br from-green-50 to-green-100/50 dark:from-green-950/30 dark:to-green-900/20 rounded-lg p-2 text-center">
          <Briefcase className="h-3 w-3 mx-auto mb-0.5 text-green-600" />
          <div className="text-lg font-bold text-green-700 dark:text-green-400">
            {stats.total}
          </div>
          <div className="text-[10px] text-green-600/70">总计</div>
        </div>
      </div>

      {/* 地区分布 */}
      {Object.keys(stats.regionBreakdown).length > 0 && (
        <div className="mt-2">
          <p className="text-[10px] text-muted-foreground mb-1 text-center">地区分布</p>
          <div className="flex flex-wrap justify-center gap-1">
            {Object.entries(stats.regionBreakdown)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 6)
              .map(([region, count]) => (
                <div 
                  key={region}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-muted/50 text-[10px]"
                >
                  <span>{region}</span>
                  <span className="font-medium text-primary">+{count}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
