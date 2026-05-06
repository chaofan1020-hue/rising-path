import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { JobStatsWidget } from '@/components/job-stats-widget';
import {
  FileText,
  Brain,
  CheckCircle,
  Send,
  Mail,
  ArrowRight,
  Zap,
  Rocket,
  Sparkles,
} from 'lucide-react';

const steps = [
  {
    step: '01',
    title: '提供简历',
    description: '上传 PDF 或 Word 简历，AI 自动解析关键信息，支持手动编辑',
    icon: FileText,
    href: '/resume',
    gradient: 'from-blue-600 via-blue-500 to-cyan-500',
  },
  {
    step: '02',
    title: 'AI选岗',
    description: '基于简历深度分析，精准匹配最适合你的岗位',
    icon: Brain,
    href: '/ai-match',
    gradient: 'from-violet-600 via-purple-500 to-fuchsia-500',
  },
  {
    step: '03',
    title: '确认岗位',
    description: 'AI 自动优化简历适配 ATS 系统，确认后一键生成投递清单',
    icon: CheckCircle,
    href: '/confirm',
    gradient: 'from-emerald-600 via-green-500 to-teal-500',
  },
  {
    step: '04',
    title: '投递',
    description: '浏览器扩展自动填表 或 跳转官网手动提交，实时跟踪进度',
    icon: Send,
    href: '/submit',
    gradient: 'from-orange-600 via-amber-500 to-yellow-500',
  },
  {
    step: '05',
    title: '邮箱回执',
    description: '每次投递后邮箱收到确认邮件，汇总页展示所有投递记录',
    icon: Mail,
    href: '/applications',
    gradient: 'from-pink-600 via-rose-500 to-red-500',
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Background Decoration */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-gradient-to-r from-pink-500/10 to-orange-500/10 rounded-full blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808005_1px,transparent_1px),linear-gradient(to_bottom,#80808005_1px,transparent_1px)] bg-[size:32px_32px]" />
      </div>

      {/* Navigation */}
      <nav className="border-b/40 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 md:gap-3 group">
            <Image src="/logo.svg" alt="Rising Path" width={36} height={36} className="rounded-lg" />
            <span className="font-bold text-lg md:text-xl">Rising Path</span>
          </Link>
          
          <div className="flex items-center gap-2">
            <Link href="/jobs">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                浏览岗位
              </Button>
            </Link>
            <Link href="/login">
              <Button size="sm" className="bg-gradient-to-r from-primary to-primary/80 hover:opacity-90 shadow-lg shadow-primary/20">
                登录使用
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="container mx-auto px-4 md:px-6 pt-12 pb-10 md:pt-20 md:pb-16">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 md:px-4 md:py-2 rounded-full bg-primary/5 border border-primary/10 mb-6 md:mb-10">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-xs md:text-sm font-medium text-primary">专为海外留学生打造的智能求职平台</span>
          </div>
          
          <h1 className="text-3xl sm:text-4xl md:text-6xl font-bold tracking-tight mb-4 md:mb-6 leading-[1.1]">
            <span className="block mb-1 md:mb-2">上传简历，五步搞定</span>
            <span className="bg-gradient-to-r from-primary via-primary/80 to-primary/60 bg-clip-text text-transparent">
              从选岗到投递全自动化
            </span>
          </h1>
          
          <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto mb-6 leading-relaxed">
            AI 驱动的求职助手：智能匹配岗位 → ATS优化简历 → 一键投递 → 邮箱回执
            <br className="hidden sm:block" />
            让你的求职效率提升10倍
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-8">
            <Link href="/resume">
              <Button size="lg" className="h-14 px-10 text-lg bg-gradient-to-r from-primary to-primary/80 hover:opacity-90 shadow-2xl shadow-primary/20 rounded-2xl group">
                <FileText className="mr-2 h-5 w-5" />
                从上传简历开始
                <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <Link href="/jobs">
              <Button size="lg" variant="outline" className="h-14 px-10 text-lg rounded-2xl border-2">
                先看看岗位
              </Button>
            </Link>
          </div>

          <div className="max-w-xl mx-auto">
            <JobStatsWidget />
          </div>
        </div>
      </section>

      {/* 5-Step Flow Section */}
      <section className="container mx-auto px-4 md:px-6 py-10 md:py-20">
        <div className="text-center mb-8 md:mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 md:px-4 md:py-2 rounded-full bg-primary/5 border border-primary/10 mb-3 md:mb-8">
            <Zap className="h-4 w-4 md:h-5 md:w-5 text-primary" />
            <span className="text-sm md:text-base font-medium">五步流程</span>
          </div>
          <h2 className="text-2xl sm:text-3xl md:text-5xl font-bold mb-2 md:mb-6">
            从简历到Offer，<span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent ml-1 md:ml-3">一站直达</span>
          </h2>
          <p className="text-muted-foreground text-sm md:text-lg max-w-xl mx-auto">
            每一步都有AI助力，让求职不再是漫漫长路
          </p>
        </div>

        {/* Steps Timeline */}
        <div className="max-w-5xl mx-auto">
          <div className="relative">
            {/* Connector line - Desktop */}
            <div className="hidden md:block absolute top-12 left-[10%] right-[10%] h-[2px] bg-gradient-to-r from-primary/20 via-primary/40 to-primary/20" />

            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 md:gap-6">
              {steps.map((item, index) => (
                <Link
                  key={item.step}
                  href={item.href}
                  className="group relative"
                >
                  {/* Mobile connector line */}
                  {index < steps.length - 1 && (
                    <div className="md:hidden absolute left-[31px] top-[68px] w-[2px] h-[calc(100%+4px)] bg-gradient-to-b from-primary/30 to-transparent" />
                  )}

                  <div className="flex md:flex-col items-start md:items-center gap-4 md:gap-0 p-4 md:p-0 rounded-xl md:rounded-none bg-muted/20 md:bg-transparent hover:bg-muted/30 md:hover:bg-transparent transition-colors">
                    {/* Step circle */}
                    <div className="relative flex-shrink-0 md:mb-4">
                      <div className={`w-16 h-16 md:w-20 md:h-20 rounded-xl md:rounded-2xl bg-gradient-to-br ${item.gradient} flex items-center justify-center shadow-lg md:shadow-2xl group-hover:scale-105 transition-transform duration-300`}>
                        <item.icon className="h-7 w-7 md:h-8 md:w-8 text-white" />
                      </div>
                      <div className="absolute -top-1.5 -right-1.5 md:-top-2 md:-right-2 w-6 h-6 md:w-7 md:h-7 rounded-full bg-background border-2 border-primary flex items-center justify-center text-[10px] md:text-xs font-bold text-primary">
                        {item.step}
                      </div>
                    </div>
                    
                    {/* Text */}
                    <div className="flex-1 md:text-center pt-1">
                      <h3 className="font-semibold text-lg md:text-xl mb-1 md:mb-2 group-hover:text-primary transition-colors">
                        {item.title}
                      </h3>
                      <p className="text-muted-foreground text-sm md:text-base leading-relaxed">
                        {item.description}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-6 py-16 md:py-24">
        <div className="relative text-center">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-[400px] h-[400px] bg-gradient-to-r from-primary/10 to-purple-500/10 rounded-full blur-3xl" />
          </div>
          
          <div className="relative">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/5 border border-primary/10 mb-6">
              <Rocket className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">开始你的求职之旅</span>
            </div>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              准备好开始了吗？
            </h2>
            <p className="text-muted-foreground text-base md:text-lg mb-8 max-w-md mx-auto">
              加入 Rising Path，五步从简历到Offer
            </p>
            <Link href="/resume">
              <Button size="lg" className="h-16 px-12 text-lg bg-gradient-to-r from-primary to-primary/80 hover:opacity-90 shadow-2xl shadow-primary/20 rounded-2xl group">
                <Sparkles className="mr-2 h-5 w-5" />
                立即开始
                <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-muted/30 bg-muted/10">
        <div className="container mx-auto px-6 py-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2.5">
              <Image src="/logo.svg" alt="Rising Path" width={32} height={32} className="rounded-lg" />
              <span className="font-semibold text-lg">Rising Path</span>
            </Link>
            <p className="text-sm text-muted-foreground">
              © 2024 Rising Path. 专为海外留学生打造
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
