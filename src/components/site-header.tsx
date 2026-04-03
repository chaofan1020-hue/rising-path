'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Briefcase } from 'lucide-react';

export function SiteHeader() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Briefcase className="h-5 w-5 md:h-6 md:w-6 text-primary" />
          <span className="font-bold text-lg md:text-xl">PathUp</span>
        </Link>
        <nav className="flex items-center gap-2 md:gap-4">
          {isMobile ? (
            <>
              <Link href="/jobs">
                <Button variant="ghost" size="sm" className="text-xs px-2">岗位</Button>
              </Link>
              <Link href="/ai-match">
                <Button size="sm" className="text-xs">AI选岗</Button>
              </Link>
            </>
          ) : (
            <>
              <Link href="/jobs">
                <Button variant="ghost" size="sm">岗位查询</Button>
              </Link>
              <Link href="/resume">
                <Button variant="ghost" size="sm">简历管理</Button>
              </Link>
              <Link href="/ai-match">
                <Button size="sm">AI选岗</Button>
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
