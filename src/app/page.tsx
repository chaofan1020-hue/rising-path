import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { JobStatsWidget } from '@/components/job-stats-widget';
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
  Zap,
} from 'lucide-react';
import { ScrollCard } from '@/components/scroll-card';

const features = [
  {
    title: '岗位开放',
    description: '按地区、方向、受众筛选海量海外岗位',
    detail: '支持多维度筛选，一键收藏心仪机会',
    icon: Search,
    href: '/jobs',
    gradient: 'from-[#C46A4A] via-[#B5BEB0] to-[#E2D0B8]',
    iconBg: 'bg-[#C46A4A]',
    pattern: 'dots',
  },
  {
    title: 'AI智能选岗',
    description: '基于简历深度分析，精准匹配岗位',
    detail: 'AI驱动智能推荐，找到最适合你的机会',
    icon: Brain,
    href: '/ai-match',
    gradient: 'from-[#B5BEB0] via-[#E2D0B8] to-[#C46A4A]',
    iconBg: 'bg-[#B5BEB0]',
    pattern: 'grid',
  },
  {
    title: '简历管理',
    description: '智能解析简历，一键管理',
    detail: '支持 PDF、Word 多格式上传',
    icon: FileText,
    href: '/resume',
    gradient: 'from-[#E2D0B8] via-[#C46A4A] to-[#B5BEB0]',
    iconBg: 'bg-[#E2D0B8]',
    pattern: 'dots',
  },
  {
    title: 'ATS简历优化',
    description: '针对招聘系统优化简历',
    detail: '提高简历通过率，让 HR 更容易看到你',
    icon: Wand2,
    href: '/optimize',
    gradient: 'from-[#C46A4A] via-[#E2D0B8] to-[#B5BEB0]',
    iconBg: 'bg-[#C46A4A]',
    pattern: 'grid',
  },
  {
    title: '投递数据',
    description: '追踪网申进度，管理投递状态',
    detail: '实时查看投递记录，掌握求职进展',
    icon: Send,
    href: '/applications',
    gradient: 'from-[#B5BEB0] via-[#C46A4A] to-[#E2D0B8]',
    iconBg: 'bg-[#B5BEB0]',
    pattern: 'dots',
  },
  {
    title: 'AutoFill一键填写',
    description: '智能填写企业网申表单',
    detail: '浏览器扩展一键填充，高效完成投递',
    icon: Puzzle,
    href: '/extension',
    gradient: 'from-[#E2D0B8] via-[#B5BEB0] to-[#C46A4A]',
    iconBg: 'bg-[#E2D0B8]',
    pattern: 'grid',
  },
];

const advantages = [
  {
    icon: Globe,
    title: '全球岗位覆盖',
    description: '覆盖美国、英国、新加坡、香港等主流留学地区',
    iconBg: 'bg-[#C46A4A]',
    iconColor: 'text-white',
  },
  {
    icon: Target,
    title: '精准智能匹配',
    description: 'AI深度分析简历与岗位匹配度',
    iconBg: 'bg-[#B5BEB0]',
    iconColor: 'text-white',
  },
  {
    icon: Zap,
    title: '高效求职工具',
    description: '一站式完成简历优化、岗位筛选、网申投递',
    iconBg: 'bg-[#E2D0B8]',
    iconColor: 'text-[#C46A4A]',
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-[#F5F0EB] relative overflow-hidden">
      {/* Animated Background */}
      <div className="absolute inset-0 -z-10">
        {/* Large gradient blobs */}
        <div className="absolute top-0 left-1/4 w-[800px] h-[800px] bg-gradient-to-br from-[#C46A4A]/20 via-[#B5BEB0]/10 to-transparent rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[600px] h-[600px] bg-gradient-to-tr from-[#E2D0B8]/30 via-[#C46A4A]/10 to-transparent rounded-full blur-3xl animate-pulse [animation-delay:2s]" />
        <div className="absolute top-1/2 left-1/2 w-[500px] h-[500px] bg-gradient-to-r from-[#B5BEB0]/15 to-[#E2D0B8]/10 rounded-full blur-3xl animate-pulse [animation-delay:4s]" />
        
        {/* Grid pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#C46A4A08_1px,transparent_1px),linear-gradient(to_bottom,#C46A4A08_1px,transparent_1px)] bg-[size:40px_40px]" />
        
        {/* Floating shapes */}
        <div className="absolute top-20 left-10 w-20 h-20 bg-[#C46A4A]/10 rounded-full blur-xl animate-bounce [animation-duration:8s]" />
        <div className="absolute top-40 right-20 w-16 h-16 bg-[#B5BEB0]/15 rounded-full blur-xl animate-bounce [animation-duration:10s] [animation-delay:1s]" />
        <div className="absolute bottom-40 left-1/3 w-24 h-24 bg-[#E2D0B8]/20 rounded-full blur-xl animate-bounce [animation-duration:12s] [animation-delay:2s]" />
      </div>

      {/* Navigation */}
      <nav className="border-b border-[#C46A4A]/10 bg-white/60 backdrop-blur-2xl sticky top-0 z-50">
        <div className="container mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 md:gap-3 group">
            <Image src="/logo.svg" alt="Rising Path" width={36} height={36} className="rounded-lg transition-transform group-hover:scale-110" />
            <span className="font-bold text-lg md:text-xl bg-gradient-to-r from-[#C46A4A] via-[#B5BEB0] to-[#E2D0B8] bg-clip-text text-transparent">Rising Path</span>
          </Link>
          
          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-2">
            <Link href="/jobs">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-[#C46A4A] hover:bg-[#C46A4A]/5 transition-all">
                岗位开放
              </Button>
            </Link>
            <Link href="/submit-job">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-[#C46A4A] hover:bg-[#C46A4A]/5 transition-all">
                <span className="mr-1">+</span>
                贡献岗位
              </Button>
            </Link>
            <Link href="/resume">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-[#C46A4A] hover:bg-[#C46A4A]/5 transition-all">
                简历管理
              </Button>
            </Link>
            <Link href="/extension">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-[#C46A4A] hover:bg-[#C46A4A]/5 transition-all">
                <Puzzle className="h-4 w-4 mr-1" />
                AutoFill一键填写
              </Button>
            </Link>
            <Link href="/login">
              <Button size="sm" className="bg-gradient-to-r from-[#C46A4A] to-[#B5BEB0] hover:opacity-90 shadow-lg shadow-[#C46A4A]/25 text-white font-medium transition-all hover:scale-105">
                登录使用
              </Button>
            </Link>
          </div>
          
          {/* Mobile Nav - Simplified */}
          <div className="flex md:hidden items-center gap-2">
            <Link href="/jobs">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-[#C46A4A] px-2">
                岗位
              </Button>
            </Link>
            <Link href="/login">
              <Button size="sm" className="bg-gradient-to-r from-[#C46A4A] to-[#B5BEB0] hover:opacity-90 text-white">
                登录
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="container mx-auto px-4 md:px-6 pt-16 pb-16 md:pt-28 md:pb-24">
        <div className="max-w-5xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-[#C46A4A]/10 to-[#B5BEB0]/10 border border-[#C46A4A]/20 mb-8 backdrop-blur-sm">
            <div className="w-2 h-2 rounded-full bg-[#C46A4A] animate-pulse" />
            <span className="text-sm font-medium text-[#C46A4A]">专为海外留学生打造的智能求职平台</span>
          </div>
          
          {/* Main Heading */}
          <h1 className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight mb-6 md:mb-8 leading-[1.1]">
            <span className="block mb-2">智能求职</span>
            <span className="bg-gradient-to-r from-[#C46A4A] via-[#B5BEB0] to-[#E2D0B8] bg-clip-text text-transparent">
              一步到位
            </span>
          </h1>
          
          {/* Subtitle */}
          <p className="text-lg md:text-2xl text-muted-foreground max-w-3xl mx-auto mb-8 leading-relaxed">
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
              <Button size="lg" className="h-14 px-8 text-lg bg-gradient-to-r from-[#C46A4A] to-[#B5BEB0] hover:opacity-90 shadow-2xl shadow-[#C46A4A]/30 text-white font-medium rounded-xl group transition-all hover:scale-105">
                从上传简历开始
                <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <Link href="/jobs">
              <Button size="lg" variant="outline" className="h-14 px-8 text-lg rounded-xl border-2 border-[#C46A4A]/20 hover:border-[#C46A4A]/40 hover:bg-[#C46A4A]/5 transition-all">
                浏览岗位
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Advantages Section */}
      <section className="container mx-auto px-4 md:px-6 mb-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-8">
          {advantages.map((adv, index) => (
            <div key={adv.title} className="group relative overflow-hidden rounded-2xl bg-white/60 backdrop-blur-sm border border-[#C46A4A]/10 p-6 md:p-8 hover:shadow-xl hover:shadow-[#C46A4A]/10 transition-all duration-300 hover:-translate-y-1">
              <div className={`w-12 h-12 md:w-14 md:h-14 rounded-xl ${adv.iconBg} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
                <adv.icon className={`h-6 w-6 md:h-7 md:w-7 ${adv.iconColor}`} />
              </div>
              <h3 className="font-bold text-lg md:text-xl mb-2">{adv.title}</h3>
              <p className="text-muted-foreground text-sm md:text-base leading-relaxed">{adv.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="container mx-auto px-4 md:px-6 py-12 md:py-24">
        <div className="text-center mb-12 md:mb-20">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-[#C46A4A]/10 to-[#B5BEB0]/10 border border-[#C46A4A]/20 mb-6">
            <Layers className="h-5 w-5 text-[#C46A4A]" />
            <span className="text-sm md:text-base font-medium text-[#C46A4A]">六大核心能力</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-6xl font-bold mb-4 md:mb-6">
            为求职而生的
            <span className="bg-gradient-to-r from-[#C46A4A] via-[#B5BEB0] to-[#E2D0B8] bg-clip-text text-transparent ml-2 md:ml-3">超级工具</span>
          </h2>
          <p className="text-muted-foreground text-base md:text-xl max-w-2xl mx-auto">
            每一个功能都经过精心设计，让求职之路更加顺畅
          </p>
        </div>
        
        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {features.map((feature) => (
            <Link 
              href={feature.href} 
              key={feature.title}
              className="group relative overflow-hidden rounded-2xl md:rounded-3xl transition-all duration-300 md:duration-500 hover:-translate-y-2 hover:shadow-2xl hover:shadow-[#C46A4A]/15 active:scale-[0.98]"
            >
              {/* Background */}
              <div className="absolute inset-0 bg-gradient-to-br from-white/80 to-white/40 backdrop-blur-sm" />
              
              {/* Pattern */}
              <div className="absolute inset-0 opacity-20">
                {feature.pattern === 'dots' && (
                  <div className="w-full h-full bg-[radial-gradient(circle,_#C46A4A_1px,_transparent_1px)] bg-[size:20px_20px]" />
                )}
                {feature.pattern === 'grid' && (
                  <div className="w-full h-full bg-[linear-gradient(to_right,_#B5BEB0_1px,_transparent_1px),linear-gradient(to_bottom,_#B5BEB0_1px,_transparent_1px)] bg-[size:28px_28px]" />
                )}
              </div>
              
              {/* Gradient overlay on hover */}
              <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-10 transition-opacity duration-500`} />
              
              {/* Content */}
              <div className="relative h-full p-6 md:p-8 flex flex-col items-start gap-4 min-h-[200px]">
                {/* Icon */}
                <div className={`w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:rotate-3 transition-all duration-300`}>
                  <feature.icon className="h-7 w-7 md:h-8 md:w-8 text-white" />
                </div>
                
                {/* Text */}
                <div className="flex-1">
                  <h3 className="font-bold text-xl md:text-2xl mb-2 group-hover:text-[#C46A4A] transition-colors">
                    {feature.title}
                  </h3>
                  <p className="text-muted-foreground text-sm md:text-base leading-relaxed">
                    {feature.description}
                  </p>
                </div>
                
                {/* Arrow */}
                <div className="flex items-center gap-2 text-[#C46A4A] opacity-0 group-hover:opacity-100 transition-all duration-300 group-hover:translate-x-1">
                  <span className="text-sm font-medium">了解更多</span>
                  <ArrowRight className="h-4 w-4" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="container mx-auto px-4 md:px-6 py-12 md:py-20">
        <div className="relative rounded-3xl bg-gradient-to-br from-white/80 via-[#F5F0EB]/50 to-white/60 backdrop-blur-sm border border-[#C46A4A]/10 p-8 md:p-12 lg:p-16 overflow-hidden">
          {/* Decorative elements */}
          <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-br from-[#C46A4A]/10 to-transparent rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-60 h-60 bg-gradient-to-tr from-[#B5BEB0]/10 to-transparent rounded-full blur-3xl" />
          
          <div className="relative">
            <div className="text-center mb-12 md:mb-16">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-[#C46A4A]/10 to-[#B5BEB0]/10 border border-[#C46A4A]/20 mb-6">
                <Zap className="h-5 w-5 text-[#C46A4A]" />
                <span className="text-sm md:text-base font-medium text-[#C46A4A]">简单三步</span>
              </div>
              <h2 className="text-3xl md:text-5xl lg:text-6xl font-bold mb-4">开启求职之旅</h2>
              <p className="text-muted-foreground text-lg md:text-xl">让AI帮你找到理想工作</p>
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
                    <div className="hidden md:block absolute top-12 left-[60%] w-[80%] h-[2px] bg-gradient-to-r from-[#C46A4A]/30 to-transparent" />
                  )}
                  
                  <div className="flex flex-col items-center text-center">
                    {/* Step number with icon */}
                    <div className="relative mb-6">
                      <div className="w-20 h-20 md:w-24 md:h-24 rounded-2xl bg-gradient-to-br from-[#C46A4A] to-[#B5BEB0] flex items-center justify-center shadow-xl shadow-[#C46A4A]/20 group-hover:scale-110 transition-transform duration-300">
                        <item.icon className="h-9 w-9 md:h-10 md:w-10 text-white" />
                      </div>
                      <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-white border-2 border-[#C46A4A] flex items-center justify-center text-sm font-bold text-[#C46A4A]">
                        {item.step}
                      </div>
                    </div>
                    
                    {/* Text */}
                    <h3 className="font-bold text-xl md:text-2xl mb-3">{item.title}</h3>
                    <p className="text-muted-foreground text-sm md:text-base leading-relaxed">{item.desc}</p>
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
            <div className="w-[600px] h-[600px] bg-gradient-to-r from-[#C46A4A]/15 via-[#B5BEB0]/10 to-[#E2D0B8]/15 rounded-full blur-3xl" />
          </div>
          
          <div className="relative">
            <h2 className="text-4xl md:text-6xl font-bold mb-6">
              准备好开始了吗？
            </h2>
            <p className="text-muted-foreground text-lg md:text-xl mb-10 max-w-lg mx-auto">
              加入 Rising Path，让求职变得更简单
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/resume">
                <Button size="lg" className="h-16 px-12 text-lg bg-gradient-to-r from-[#C46A4A] to-[#B5BEB0] hover:opacity-90 shadow-2xl shadow-[#C46A4A]/30 text-white font-medium rounded-2xl group transition-all hover:scale-105">
                  从上传简历开始
                  <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
              <Link href="/jobs">
                <Button size="lg" variant="outline" className="h-16 px-12 text-lg rounded-2xl border-2 border-[#C46A4A]/20 hover:border-[#C46A4A]/40 hover:bg-[#C46A4A]/5 transition-all">
                  浏览岗位
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#C46A4A]/10 bg-white/40 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2.5">
              <Image src="/logo.svg" alt="Rising Path" width={32} height={32} className="rounded-lg" />
              <span className="font-semibold text-lg bg-gradient-to-r from-[#C46A4A] to-[#B5BEB0] bg-clip-text text-transparent">Rising Path</span>
            </Link>
            <p className="text-muted-foreground text-sm">
              © 2025 Rising Path. 专为海外留学生打造的智能求职平台
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
