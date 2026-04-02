'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Briefcase,
  FileText,
  Sparkles,
  Send,
  Search,
  Brain,
  Upload,
  Target,
  ChevronRight,
  Globe,
  GraduationCap,
  Users,
} from 'lucide-react';

const features = [
  {
    title: '岗位查询',
    description: '按地区、方向、受众筛选海量海外岗位',
    icon: Search,
    href: '/jobs',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 dark:bg-blue-950',
  },
  {
    title: '简历管理',
    description: '上传简历，智能解析，一键管理',
    icon: FileText,
    href: '/resume',
    color: 'text-green-600',
    bgColor: 'bg-green-50 dark:bg-green-950',
  },
  {
    title: 'AI智能选岗',
    description: '基于简历智能匹配最合适的岗位',
    icon: Brain,
    href: '/ai-match',
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 dark:bg-purple-950',
  },
  {
    title: 'ATS简历优化',
    description: '针对ATS系统优化，提高通过率',
    icon: Sparkles,
    href: '/optimize',
    color: 'text-orange-600',
    bgColor: 'bg-orange-50 dark:bg-orange-950',
  },
  {
    title: '自动网申',
    description: '学习记录，自动填写企业网申表单',
    icon: Send,
    href: '/applications',
    color: 'text-cyan-600',
    bgColor: 'bg-cyan-50 dark:bg-cyan-950',
  },
];

const stats = [
  { label: '覆盖地区', value: '30+', icon: Globe },
  { label: '合作企业', value: '5000+', icon: Briefcase },
  { label: '留学生用户', value: '10万+', icon: GraduationCap },
  { label: '成功案例', value: '5万+', icon: Users },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      {/* Navigation */}
      <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Briefcase className="h-6 w-6 text-primary" />
            <span className="font-bold text-xl">CareerPath</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/jobs">
              <Button variant="ghost" size="sm">
                岗位查询
              </Button>
            </Link>
            <Link href="/resume">
              <Button variant="ghost" size="sm">
                简历管理
              </Button>
            </Link>
            <Link href="/ai-match">
              <Button size="sm">AI选岗</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 text-center">
        <Badge className="mb-4" variant="secondary">
          专为海外留学生打造
        </Badge>
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
          智能求职，一步到位
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
          岗位查询、AI选岗、简历优化、自动网申，一站式助力留学生成功就业
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/jobs">
            <Button size="lg" className="w-full sm:w-auto">
              <Search className="mr-2 h-4 w-4" />
              开始搜索岗位
            </Button>
          </Link>
          <Link href="/resume">
            <Button size="lg" variant="outline" className="w-full sm:w-auto">
              <Upload className="mr-2 h-4 w-4" />
              上传简历
            </Button>
          </Link>
        </div>
      </section>

      {/* Stats Section */}
      <section className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((stat) => (
            <Card key={stat.label}>
              <CardContent className="pt-6 text-center">
                <stat.icon className="h-8 w-8 mx-auto mb-2 text-primary" />
                <div className="text-3xl font-bold">{stat.value}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">核心功能</h2>
          <p className="text-muted-foreground">
            全方位求职工具，让求职之路更加顺畅
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature) => (
            <Link href={feature.href} key={feature.title}>
              <Card className="h-full hover:shadow-lg transition-all hover:scale-[1.02] cursor-pointer group">
                <CardHeader>
                  <div className={`p-3 rounded-lg ${feature.bgColor} w-fit mb-3`}>
                    <feature.icon className={`h-6 w-6 ${feature.color}`} />
                  </div>
                  <CardTitle className="flex items-center justify-between">
                    {feature.title}
                    <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                  </CardTitle>
                  <CardDescription>{feature.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="container mx-auto px-4 py-16 bg-muted/50 rounded-2xl">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">如何使用</h2>
          <p className="text-muted-foreground">三步开启你的求职之旅</p>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xl font-bold mx-auto mb-4">
              1
            </div>
            <h3 className="font-semibold text-lg mb-2">上传简历</h3>
            <p className="text-muted-foreground text-sm">
              上传你的简历，系统自动解析关键信息
            </p>
          </div>
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xl font-bold mx-auto mb-4">
              2
            </div>
            <h3 className="font-semibold text-lg mb-2">AI智能匹配</h3>
            <p className="text-muted-foreground text-sm">
              AI分析简历，推荐最适合的岗位机会
            </p>
          </div>
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xl font-bold mx-auto mb-4">
              3
            </div>
            <h3 className="font-semibold text-lg mb-2">一键网申</h3>
            <p className="text-muted-foreground text-sm">
              自动填写网申表单，高效投递申请
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t mt-16">
        <div className="container mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-primary" />
              <span className="font-semibold">CareerPath</span>
            </div>
            <p className="text-sm text-muted-foreground">
              © 2024 CareerPath. 专为海外留学生打造
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
