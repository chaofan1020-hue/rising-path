'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  Briefcase,
  FileText,
  Sparkles,
  Send,
  Search,
  Brain,
  Upload,
  ChevronRight,
  ArrowRight,
  Zap,
  Star,
  TrendingUp,
  Globe,
  Target,
  Wand2,
  Puzzle,
  Menu,
  X,
} from 'lucide-react';
import { useState } from 'react';

const features = [
  {
    title: '岗位查询',
    description: '按地区、方向、受众筛选海量海外岗位',
    icon: Search,
    href: '/jobs',
  },
  {
    title: 'AI 智能选岗',
    description: '基于简历深度分析，精准匹配岗位',
    icon: Brain,
    href: '/ai-match',
  },
  {
    title: '简历管理',
    description: '智能解析简历，一键管理多份简历',
    icon: FileText,
    href: '/resume',
  },
  {
    title: 'ATS 简历优化',
    description: '针对招聘系统优化简历内容',
    icon: Wand2,
    href: '/optimize',
  },
  {
    title: '投递追踪',
    description: '追踪网申进度，管理投递状态',
    icon: Send,
    href: '/applications',
  },
  {
    title: 'AutoFill 扩展',
    description: '浏览器扩展一键填充网申表单',
    icon: Puzzle,
    href: '/extension',
  },
];

export default function Home() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-[hsl(var(--border))] bg-[hsl(var(--background))]/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
                <Briefcase className="h-4 w-4 text-white" />
              </div>
              <span className="font-bold text-lg">Rising Path</span>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-8">
              <Link href="/jobs" className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">
                岗位查询
              </Link>
              <Link href="/ai-match" className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">
                AI 选岗
              </Link>
              <Link href="/resume" className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">
                简历管理
              </Link>
              <Link href="/optimize" className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">
                简历优化
              </Link>
            </div>

            {/* Theme Toggle */}
            <ThemeToggle />

            {/* Desktop Buttons */}
            <div className="hidden md:flex items-center gap-3">
              <Link href="/login">
                <Button variant="ghost" className="text-[hsl(var(--foreground))] hover:text-white hover:bg-[hsl(var(--card-hover))]">
                  登录
                </Button>
              </Link>
              <Link href="/login">
                <Button className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white border-0">
                  开始使用
                </Button>
              </Link>
            </div>

            {/* Mobile Menu Button */}
            <button
              className="md:hidden text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-[hsl(var(--border))] bg-[#0a0a0f]/95 backdrop-blur-xl">
            <div className="px-6 py-4 space-y-3">
              <Link href="/jobs" className="block text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] py-2">
                岗位查询
              </Link>
              <Link href="/ai-match" className="block text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] py-2">
                AI 选岗
              </Link>
              <Link href="/resume" className="block text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] py-2">
                简历管理
              </Link>
              <Link href="/optimize" className="block text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] py-2">
                简历优化
              </Link>
              <div className="pt-3 border-t border-[hsl(var(--border))] space-y-2">
                <Link href="/login">
                  <Button variant="ghost" className="w-full text-[hsl(var(--foreground))] hover:text-white hover:bg-[hsl(var(--card-hover))]">
                    登录
                  </Button>
                </Link>
                <Link href="/login">
                  <Button className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white border-0">
                    开始使用
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-6 overflow-hidden">
        {/* Background Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />
        
        {/* Gradient Orbs */}
        <div className="absolute top-20 left-1/4 w-96 h-96 bg-violet-600/20 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-1/4 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl" />

        <div className="relative mx-auto max-w-7xl">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left Content */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              {/* Badge */}
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-violet-600/20 to-indigo-600/20 border border-violet-500/30 mb-8">
                <Sparkles className="h-4 w-4 text-violet-400" />
                <span className="text-sm text-violet-300">专为海外留学生打造</span>
              </div>

              {/* Title */}
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold leading-tight mb-6">
                让求职
                <span className="bg-gradient-to-r from-violet-400 via-purple-400 to-indigo-400 bg-clip-text text-transparent">
                  更简单
                </span>
              </h1>

              {/* Subtitle */}
              <p className="text-lg md:text-xl text-[hsl(var(--muted-foreground))] mb-8 max-w-lg">
                一站式求职平台，AI 智能选岗、简历优化、自动网申，助力海外留学生拿到理想 Offer
              </p>

              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row gap-4">
                <Link href="/login">
                  <Button size="lg" className="w-full sm:w-auto bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white border-0 px-8 py-6 text-base">
                    免费开始
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </Link>
                <Link href="/jobs">
                  <Button size="lg" variant="outline" className="w-full sm:w-auto border-white/20 text-white hover:bg-[hsl(var(--card-hover))] px-8 py-6 text-base">
                    浏览岗位
                  </Button>
                </Link>
              </div>

              {/* Stats */}
              <div className="mt-12 flex items-center gap-8">
                <div>
                  <div className="text-3xl font-bold text-white">10K+</div>
                  <div className="text-sm text-gray-500">海外岗位</div>
                </div>
                <div className="w-px h-12 bg-[hsl(var(--card-hover))]" />
                <div>
                  <div className="text-3xl font-bold text-white">5K+</div>
                  <div className="text-sm text-gray-500">成功匹配</div>
                </div>
                <div className="w-px h-12 bg-[hsl(var(--card-hover))]" />
                <div>
                  <div className="text-3xl font-bold text-white">98%</div>
                  <div className="text-sm text-gray-500">用户满意</div>
                </div>
              </div>
            </motion.div>

            {/* Right Visual */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="relative"
            >
              <div className="relative aspect-square max-w-lg mx-auto">
                {/* Main Card */}
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-violet-600/30 to-indigo-600/30 border border-[hsl(var(--border))] backdrop-blur-sm overflow-hidden">
                  {/* Inner Content */}
                  <div className="absolute inset-4 rounded-2xl bg-[#0a0a0f]/80 border border-[hsl(var(--border))] p-6">
                    {/* Mock UI */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
                          <Briefcase className="h-5 w-5 text-white" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-white">Software Engineer</div>
                          <div className="text-xs text-gray-500">Google · 美国</div>
                        </div>
                      </div>
                      <div className="h-px bg-[hsl(var(--card-hover))]" />
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-green-500" />
                          <span className="text-xs text-[hsl(var(--muted-foreground))]">匹配度 95%</span>
                        </div>
                        <div className="h-2 rounded-full bg-[hsl(var(--card-hover))] overflow-hidden">
                          <div className="h-full w-[95%] rounded-full bg-gradient-to-r from-violet-500 to-indigo-500" />
                        </div>
                      </div>
                      <div className="space-y-2 pt-2">
                        <div className="h-2 w-3/4 rounded-full bg-[hsl(var(--card-hover))]" />
                        <div className="h-2 w-1/2 rounded-full bg-[hsl(var(--card-hover))]" />
                        <div className="h-2 w-2/3 rounded-full bg-[hsl(var(--card-hover))]" />
                      </div>
                      <div className="pt-4">
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-500/20 border border-violet-500/30">
                          <Sparkles className="h-3 w-3 text-violet-400" />
                          <span className="text-xs text-violet-300">AI 推荐</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Floating Elements */}
                <motion.div
                  animate={{ y: [0, -10, 0] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute -top-4 -right-4 w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 border border-white/20 flex items-center justify-center shadow-xl"
                >
                  <Brain className="h-8 w-8 text-white" />
                </motion.div>

                <motion.div
                  animate={{ y: [0, 10, 0] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                  className="absolute -bottom-4 -left-4 w-16 h-16 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 border border-white/20 flex items-center justify-center shadow-xl"
                >
                  <FileText className="h-6 w-6 text-white" />
                </motion.div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="relative py-20 px-6">
        <div className="mx-auto max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              一站式求职解决方案
            </h2>
            <p className="text-[hsl(var(--muted-foreground))] text-lg max-w-2xl mx-auto">
              从岗位查询到自动网申，覆盖求职全流程
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
              >
                <Link href={feature.href}>
                  <div className="group relative h-full rounded-2xl bg-[hsl(var(--card))] border border-[hsl(var(--border))] p-6 hover:bg-[hsl(var(--card-hover))] hover:border-white/20 transition-all duration-300">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                      <feature.icon className="h-6 w-6 text-white" />
                    </div>
                    <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
                    <p className="text-[hsl(var(--muted-foreground))] text-sm">{feature.description}</p>
                    <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity">
                      <ArrowRight className="h-5 w-5 text-violet-400" />
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[hsl(var(--border))] py-12 px-6">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
                <Briefcase className="h-4 w-4 text-white" />
              </div>
              <span className="font-bold text-lg">Rising Path</span>
            </div>
            <div className="text-sm text-gray-500">
              © 2024 Rising Path. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
