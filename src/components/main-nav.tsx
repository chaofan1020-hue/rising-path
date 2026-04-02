'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Briefcase } from 'lucide-react';
import { UserNav } from './user-nav';

export function MainNav() {
  return (
    <nav className="border-b/40 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
      <div className="container mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/20">
            <Briefcase className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-bold text-xl">PathUp</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/jobs">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
              岗位查询
            </Button>
          </Link>
          <Link href="/resume">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
              简历管理
            </Button>
          </Link>
          <UserNav />
        </div>
      </div>
    </nav>
  );
}
