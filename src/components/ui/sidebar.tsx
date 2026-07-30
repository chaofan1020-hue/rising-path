'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Briefcase,
  Brain,
  FileText,
  Sparkles,
  Send,
  Puzzle,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Crown,
} from 'lucide-react'

interface SidebarProps {
  children: React.ReactNode
}

interface NavItem {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

const navItems: NavItem[] = [
  { title: 'Dashboard', href: '/platform', icon: LayoutDashboard },
  { title: 'Jobs', href: '/platform/jobs', icon: Briefcase },
  { title: 'AI Match', href: '/platform/ai-match', icon: Brain },
  { title: 'Resume', href: '/platform/resume', icon: FileText },
  { title: 'Optimize', href: '/platform/optimize', icon: Sparkles },
  { title: 'Applications', href: '/platform/applications', icon: Send },
  { title: 'Extension', href: '/platform/extension', icon: Puzzle },
  { title: 'Settings', href: '/platform/settings', icon: Settings },
]

export function Sidebar({ children }: SidebarProps) {
  const [collapsed, setCollapsed] = React.useState(false)
  const pathname = usePathname()

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-gray-800 bg-[#1a1a24] transition-all duration-300',
          collapsed ? 'w-20' : 'w-64'
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b border-gray-800 px-4">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600">
                <span className="text-sm font-bold text-white">RP</span>
              </div>
              <span className="text-lg font-semibold text-white">Rising Path</span>
            </div>
          )}
          {collapsed && (
            <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600">
              <span className="text-sm font-bold text-white">RP</span>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white',
                  collapsed && 'justify-center'
                )}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                {!collapsed && <span>{item.title}</span>}
              </Link>
            )
          })}
        </nav>

        {/* Upgrade Button */}
        {!collapsed && (
          <div className="px-3 pb-4">
            <button className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:from-purple-700 hover:to-indigo-700">
              <Crown className="h-4 w-4" />
              Upgrade Plan
            </button>
          </div>
        )}

        {/* Logout */}
        <div className="border-t border-gray-800 px-3 py-4">
          <button
            onClick={() => {
              localStorage.removeItem('access_code')
              window.location.href = '/'
            }}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white',
              collapsed && 'justify-center'
            )}
          >
            <LogOut className="h-5 w-5 flex-shrink-0" />
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className={cn('flex-1 transition-all duration-300', collapsed ? 'ml-20' : 'ml-64')}>
        {children}
      </main>
    </div>
  )
}
