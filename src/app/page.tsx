'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { JobStatsWidget } from '@/components/job-stats-widget';
import { AuroraBackground } from '@/components/ui/aurora-background';
import { motion } from 'framer-motion';
import {
  Briefcase,
  FileText,
  Sparkles,
  Send,
  Search,
  Brain,
  Upload,
  ChevronRight,
  MapPin,
  ArrowRight,
  Zap,
  Crosshair,
  Rocket,
  Layers,
  Wand2,
  Puzzle,
  Star,
  TrendingUp,
  Globe,
  Target,
} from 'lucide-react';
import { ScrollCard } from '@/components/scroll-card';

const features = [
  {
    title: '岗位开放',
    description: '按地区、方向、受众筛选海量海外岗位',
    detail: '支持多维度筛选，一键收藏心仪机会',
    icon: Search,
    href: '/jobs',
    gradient: 'from-indigo-500 via-violet-500 to-purple-500',
    iconBg: 'bg-indigo-500',
  },
  {
    title: 'AI智能选岗',
    description: '基于简历深度分析，精准匹配岗位',
    detail: 'AI驱动智能推荐，找到最适合你的机会',
    icon: Brain,
    href: '/ai-match',
    gradient: 'from-violet-500 via-purple-500 to-indigo-500',
    iconBg: 'bg-violet-500',
  },
  {
    title: '简历管理',
    description: '智能解析简历，一键管理',
    detail: '支持 PDF、Word 多格式上传',
    icon: FileText,
    href: '/resume',
    gradient: 'from-purple-500 via-indigo-500 to-violet-500',
    iconBg: 'bg-purple-500',
  },
  {
    title: 'ATS简历优化',
    description: '针对招聘系统优化简历',
    detail: '提高简历通过率，让 HR 更容易看到你',
    icon: Wand2,
    href: '/optimize',
    gradient: 'from-indigo-500 via-purple-500 to-violet-500',
    iconBg: 'bg-indigo-500',
  },
  {
    title: '投递数据',
    description: '追踪网申进度，管理投递状态',
    detail: '实时查看投递记录，掌握求职进展',
    icon: Send,
    href: '/applications',
    gradient: 'from-violet-500 via-indigo-500 to-purple-500',
    iconBg: 'bg-violet-500',
  },
  {
    title: 'AutoFill一键填写',
    description: '智能填写企业网申表单',
    detail: '浏览器扩展一键填充，高效完成投递',
    icon: Puzzle,
    href: '/extension',
    gradient: 'from-purple-500 via-violet-500 to-indigo-500',
    iconBg: 'bg-purple-500',
  },
];

const advantages = [
  {
    icon: Globe,
    title: '全球岗位覆盖',
    description: '覆盖美国、英国、新加坡、香港等主流留学地区',
    iconBg: 'bg-indigo-500',
    iconColor: 'text-white',
  },
  {
    icon: Target,
    title: '精准智能匹配',
    description: 'AI深度分析简历与岗位匹配度',
    iconBg: 'bg-violet-500',
    iconColor: 'text-white',
  },
  {
    icon: Zap,
    title: '高效求职工具',
    description: '一站式完成简历优化、岗位筛选、网申投递',
    iconBg: 'bg-purple-500',
    iconColor: 'text-white',
  },
];

export default function Home() {
  return (
    <AuroraBackground className="h-auto min-h-screen">
      <div className="min-h-screen relative overflow-hidden w-full">
      {/* Animated Background Blobs */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[800px] h-[800px] bg-gradient-to-br from-indigo-500/30 via-violet-500/20 to-transparent rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[600px] h-[600px] bg-gradient-to-tr from-purple-500/40 via-indigo-500/20 to-transparent rounded-full blur-3xl animate-pulse [animation-delay:2s]" />
        <div className="absolute top-1/2 left-1/2 w-[500px] h-[500px] bg-gradient-to-r from-violet-500/25 to-purple-500/20 rounded-full blur-3xl animate-pulse [animation-delay:4s]" />
      </div>

      {/* Navigation - Glass Effect */}
      <nav className="sticky top-0 z-50 border-b border-white/40 bg-white/30 backdrop-blur-2xl">
        <div className="container mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 md:gap-3 group">
            <Image src="/logo.svg" alt="Rising Path" width={36} height={36} className="rounded-lg transition-transform group-hover:scale-110" />
            <span className="font-bold text-lg md:text-xl bg-gradient-to-r from-indigo-400 via-violet-400 to-purple-400 bg-clip-text text-transparent">Rising Path</span>
          </Link>
          
          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-2">
            <Link href="/jobs">
              <Button variant="ghost" size="sm" className="text-white/80 hover:text-white hover:bg-white/10 transition-all">
                岗位开放
              </Button>
            </Link>
            <Link href="/submit-job">
              <Button variant="ghost" size="sm" className="text-white/80 hover:text-white hover:bg-white/10 transition-all">
                <span className="mr-1">+</span>
                贡献岗位
              </Button>
            </Link>
            <Link href="/resume">
              <Button variant="ghost" size="sm" className="text-white/80 hover:text-white hover:bg-white/10 transition-all">
                简历管理
              </Button>
            </Link>
            <Link href="/extension">
              <Button variant="ghost" size="sm" className="text-white/80 hover:text-white hover:bg-white/10 transition-all">
                <Puzzle className="h-4 w-4 mr-1" />
                AutoFill一键填写
              </Button>
            </Link>
            <Link href="/login">
              <Button size="sm" className="bg-white/20 hover:bg-white/30 backdrop-blur-xl border border-white/30 text-white font-medium transition-all hover:scale-105">
                登录使用
              </Button>
            </Link>
          </div>
          
          {/* Mobile Nav */}
          <div className="flex md:hidden items-center gap-2">
            <Link href="/jobs">
              <Button variant="ghost" size="sm" className="text-white/80 hover:text-white px-2">
                岗位
              </Button>
            </Link>
            <Link href="/login">
              <Button size="sm" className="bg-white/20 hover:bg-white/30 backdrop-blur-xl border border-white/30 text-white">
                登录
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="container mx-auto px-4 md:px-6 pt-16 pb-16 md:pt-28 md:pb-24">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.8, ease: "easeInOut" }}
          className="max-w-5xl mx-auto text-center"
        >
          {/* Badge - Glass Effect */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/40 backdrop-blur-2xl border border-white/60 mb-8">
            <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            <span className="text-sm font-medium text-white/90">专为海外留学生打造的<span className="text-indigo-300">y</span><span className="text-violet-300">e</span><span className="text-purple-300">s</span><span className="text-blue-300">！</span>求职平台</span>
          </div>
          
          {/* Main Heading */}
          <h1 className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight mb-6 md:mb-8 leading-[1.1]">
            <span className="block mb-2 text-white"><span className="text-indigo-300">y</span><span className="text-violet-300">e</span><span className="text-purple-300">s</span><span className="text-blue-300">！</span>求职</span>
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-purple-400 bg-clip-text text-transparent">
              一步到位
            </span>
          </h1>
          
          {/* Subtitle */}
          <p className="text-lg md:text-2xl text-white/70 max-w-3xl mx-auto mb-8 leading-relaxed">
            AI驱动的求职助手，从简历优化到岗位匹配
            <br className="hidden sm:block" />
            让每一步都更精准、更高效
          </p>
          
          {/* Stats Widget */}
          <div className="max-w-xl mx-auto mb-12">
            <JobStatsWidget />
          </div>
          
          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/resume">
              <Button size="lg" className="h-14 px-8 text-lg bg-white/20 hover:bg-white/30 backdrop-blur-xl border border-white/30 text-white font-medium rounded-xl group transition-all hover:scale-105">
                从上传简历开始
                <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <Link href="/jobs">
              <Button size="lg" variant="outline" className="h-14 px-8 text-lg rounded-xl border-2 border-white/30 hover:border-white/50 hover:bg-white/10 text-white transition-all">
                浏览岗位
              </Button>
            </Link>
          </div>
        </motion.div>
      </section>

      {/* Advantages Section - Glass Cards */}
      <section className="container mx-auto px-4 md:px-6 mb-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-8">
          {advantages.map((adv, index) => (
            <div key={adv.title} className="group relative overflow-hidden rounded-2xl bg-white/40 backdrop-blur-2xl border border-white/60 p-6 md:p-8 hover:bg-white/50 transition-all duration-300 hover:-translate-y-1">
              <div className={`w-12 h-12 md:w-14 md:h-14 rounded-xl ${adv.iconBg} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
                <adv.icon className={`h-6 w-6 md:h-7 md:w-7 ${adv.iconColor}`} />
              </div>
              <h3 className="font-bold text-lg md:text-xl mb-2 text-white">{adv.title}</h3>
              <p className="text-white/60 text-sm md:text-base leading-relaxed">{adv.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features Section - Glass Cards */}
      <section id="features" className="container mx-auto px-4 md:px-6 py-12 md:py-24">
        <div className="text-center mb-12 md:mb-20">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/40 backdrop-blur-2xl border border-white/60 mb-6">
            <Layers className="h-5 w-5 text-indigo-400" />
            <span className="text-sm md:text-base font-medium text-white/90">六大核心能力</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-6xl font-bold mb-4 md:mb-6 text-white">
            为求职而生的
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-purple-400 bg-clip-text text-transparent ml-2 md:ml-3">超级工具</span>
          </h2>
          <p className="text-white/60 text-base md:text-xl max-w-2xl mx-auto">
            每一个功能都经过精心设计，让求职之路更加顺畅
          </p>
        </div>
        
        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {features.map((feature) => (
            <Link 
              href={feature.href} 
              key={feature.title}
              className="group relative overflow-hidden rounded-2xl md:rounded-3xl transition-all duration-300 md:duration-500 hover:-translate-y-2 hover:shadow-2xl hover:shadow-indigo-500/20 active:scale-[0.98]"
            >
              {/* Glass Background */}
              <div className="absolute inset-0 bg-white/40 backdrop-blur-2xl border border-white/60 rounded-2xl md:rounded-3xl" />
              
              {/* Gradient overlay on hover */}
              <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-20 transition-opacity duration-500 rounded-2xl md:rounded-3xl`} />
              
              {/* Content */}
              <div className="relative h-full p-6 md:p-8 flex flex-col items-start gap-4 min-h-[200px]">
                {/* Icon */}
                <div className={`w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:rotate-3 transition-all duration-300`}>
                  <feature.icon className="h-7 w-7 md:h-8 md:w-8 text-white" />
                </div>
                
                {/* Text */}
                <div className="flex-1">
                  <h3 className="font-bold text-xl md:text-2xl mb-2 text-white group-hover:text-[#a5b4fc] transition-colors">
                    {feature.title}
                  </h3>
                  <p className="text-white/60 text-sm md:text-base leading-relaxed">
                    {feature.description}
                  </p>
                </div>
                
                {/* Arrow */}
                <div className="flex items-center gap-2 text-[#a5b4fc] opacity-0 group-hover:opacity-100 transition-all duration-300 group-hover:translate-x-1">
                  <span className="text-sm font-medium">了解更多</span>
                  <ArrowRight className="h-4 w-4" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* How it works - Glass Container */}
      <section className="container mx-auto px-4 md:px-6 py-12 md:py-20">
        <div className="relative rounded-3xl bg-white/40 backdrop-blur-2xl border border-white/60 p-8 md:p-12 lg:p-16 overflow-hidden">
          {/* Decorative elements */}
          <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-br from-[#6366f1]/20 to-transparent rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-60 h-60 bg-gradient-to-tr from-[#8b5cf6]/20 to-transparent rounded-full blur-3xl" />
          
          <div className="relative">
            <div className="text-center mb-12 md:mb-16">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/40 backdrop-blur-2xl border border-white/60 mb-6">
                <Zap className="h-5 w-5 text-[#6366f1]" />
                <span className="text-sm md:text-base font-medium text-white/90">简单三步</span>
              </div>
              <h2 className="text-3xl md:text-5xl lg:text-6xl font-bold mb-4 text-white">开启求职之旅</h2>
              <p className="text-white/60 text-lg md:text-xl">让AI帮你找到理想工作</p>
            </div>
            
            {/* Steps */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
              {[
                { step: '01', title: '上传简历', desc: '上传 PDF 或 Word 简历，系统自动解析关键信息', icon: Upload },
                { step: '02', title: '智能匹配', desc: 'AI 分析简历内容，精准推荐匹配岗位', icon: Brain },
                { step: '03', title: '一键投递', desc: '优化简历并自动填写，高效完成网申投递', icon: Send },
              ].map((item, index) => (
                <div key={item.step} className="relative group">
                  {/* Connector line */}
                  {index < 2 && (
                    <div className="hidden md:block absolute top-12 left-[60%] w-[80%] h-[2px] bg-gradient-to-r from-white/30 to-transparent" />
                  )}
                  
                  <div className="flex flex-col items-center text-center">
                    {/* Step number with icon */}
                    <div className="relative mb-6">
                      <div className="w-20 h-20 md:w-24 md:h-24 rounded-2xl bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center shadow-xl group-hover:scale-110 transition-transform duration-300">
                        <item.icon className="h-9 w-9 md:h-10 md:w-10 text-white" />
                      </div>
                      <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-white/20 backdrop-blur-xl border border-white/30 flex items-center justify-center text-sm font-bold text-white">
                        {item.step}
                      </div>
                    </div>
                    
                    {/* Text */}
                    <h3 className="font-bold text-xl md:text-2xl mb-3 text-white">{item.title}</h3>
                    <p className="text-white/60 text-sm md:text-base leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section id="cta" className="container mx-auto px-6 py-24">
        <div className="relative text-center">
          {/* Background glow */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-[600px] h-[600px] bg-gradient-to-r from-indigo-500/20 via-purple-500/15 to-blue-500/20 rounded-full blur-3xl" />
          </div>
          
          <div className="relative">
            <h2 className="text-4xl md:text-6xl font-bold mb-6 text-white">
              准备好开始了吗？
            </h2>
            <p className="text-white/60 text-lg md:text-xl mb-10 max-w-lg mx-auto">
              加入 Rising Path，让求职变得更简单
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/resume">
                <Button size="lg" className="h-16 px-12 text-lg bg-white/20 hover:bg-white/30 backdrop-blur-xl border border-white/30 text-white font-medium rounded-2xl group transition-all hover:scale-105">
                  从上传简历开始
                  <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
              <Link href="/jobs">
                <Button size="lg" variant="outline" className="h-16 px-12 text-lg rounded-2xl border-2 border-white/30 hover:border-white/50 hover:bg-white/10 text-white transition-all">
                  浏览岗位
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer - Glass Effect */}
      <footer className="border-t border-white/20 bg-white/5 backdrop-blur-xl">
        <div className="container mx-auto px-6 py-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2.5">
              <Image src="/logo.svg" alt="Rising Path" width={32} height={32} className="rounded-lg" />
              <span className="font-semibold text-lg bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">Rising Path</span>
            </Link>
            <p className="text-white/50 text-sm">
              © 2025 Rising Path. 专为海外留学生打造的<span className="text-indigo-400">y</span><span className="text-purple-400">e</span><span className="text-blue-400">s</span><span className="text-slate-400">！</span>求职平台
            </p>
          </div>
        </div>
      </footer>
    </div>
    </AuroraBackground>
  );
}
