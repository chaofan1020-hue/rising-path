'use client';

import { useState, useEffect } from 'react';
import { Briefcase, TrendingUp, Calendar } from 'lucide-react';

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
    <div className="flex items-center justify-center gap-4 text-sm">
      <span className="text-muted-foreground">岗位开放</span>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">今日更新</span>
        <span className="font-bold text-foreground">{stats.today}</span>
      </div>
      <div className="w-px h-4 bg-border" />
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">本周更新</span>
        <span className="font-bold text-foreground">{stats.thisWeek}</span>
      </div>
      <div className="w-px h-4 bg-border" />
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">本月更新</span>
        <span className="font-bold text-foreground">{stats.thisMonth}</span>
      </div>
    </div>
  );
}
