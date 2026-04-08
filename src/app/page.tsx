import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Briefcase,
  FileText,
  Sparkles,
  Send,
  Search,
  Brain,
  Upload,
  ArrowRight,
  Zap,
  Crosshair,
  Rocket,
  Layers,
  Wand2,
  Puzzle,
  Star,
  Shield,
  TrendingUp,
  Clock,
  Target,
} from 'lucide-react';

const coreFeatures = [
  {
    title: 'AI智能选岗',
    description: '基于简历深度分析，精准匹配最适合你的岗位',
    icon: Brain,
    href: '/ai-match',
    gradient: 'from-violet-600 via-purple-500 to-fuchsia-500',
  },
  {
    title: 'ATS简历优化',
    description: '针对招聘系统优化，大幅提升简历通过率',
    icon: Wand2,
    href: '/optimize',
    gradient: 'from-orange-600 via-amber-500 to-yellow-500',
  },
  {
    title: 'AutoFill 自动填写',
    description: '一键填充网申表单，告别重复填写',
    icon: Puzzle,
    href: '/extension',
    gradient: 'from-cyan-600 via-teal-500 to-emerald-500',
  },
  {
    title: '岗位智能查询',
    description: '海量海外岗位，多维度精准筛选',
    icon: Search,
    href: '/jobs',
    gradient: 'from-blue-600 via-cyan-500 to-sky-500',
  },
  {
    title: '简历管理',
    description: '智能解析多格式简历，统一管理',
    icon: FileText,
    href: '/resume',
    gradient: 'from-emerald-600 via-green-500 to-teal-500',
  },
  {
    title: '网申追踪',
    description: '记录每次投递，掌握求职进度',
    icon: Send,
    href: '/applications',
    gradient: 'from-pink-600 via-rose-500 to-red-500',
  },
];

const workflow = [
  {
    step: '01',
    title: '上传简历',
    desc: '上传 PDF 或 Word，AI 自动解析关键信息',
    icon: Upload,
  },
  {
    step: '02',
    title: 'AI 智能匹配',
    desc: '基于简历内容，精准推荐高匹配岗位',
    icon: Brain,
  },
  {
    step: '03',
    title: '优化 & 投递',
    desc: 'ATS优化 + 自动填写，高效完成网申',
    icon: Send,
  },
];

const stats = [
  { value: '10K+', label: '精选岗位' },
  { value: '95%', label: '简历通过率提升' },
  { value: '3min', label: '完成一份网申' },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Background Decoration - 高级感背景 */}
      <div className="absolute inset-0 -z-10">
        {/* 主光晕 */}
        <div className="absolute top-0 left-1/4 w-[700px] h-[700px] bg-gradient-to-r from-blue-500/20 via-purple-500/15 to-pink-500/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[600px] h-[600px] bg-gradient-to-r from-pink-500/15 via-orange-500/10 to-yellow-500/15 rounded-full blur-[100px]" />
        {/* 网格背景 */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:40px_40px]" />
      </div>

      {/* Navigation */}
      <nav className="border-b/40 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 md:gap-3 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/25 group-hover:scale-105 transition-transform">
              <Briefcase className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-xl">PathUp</span>
          </Link>
          
          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-1">
            <Link href="/ai-match">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground hover:bg-primary/5">
                AI选岗
              </Button>
            </Link>
            <Link href="/jobs">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground hover:bg-primary/5">
                岗位查询
              </Button>
            </Link>
            <Link href="/optimize">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground hover:bg-primary/5">
                简历优化
              </Button>
            </Link>
            <Link href="/login" className="ml-2">
              <Button size="sm" className="bg-gradient-to-r from-primary to-primary/80 hover:opacity-90 shadow-lg shadow-primary/20">
                登录使用
              </Button>
            </Link>
          </div>
          
          {/* Mobile Nav */}
          <div className="flex md:hidden items-center gap-2">
            <Link href="/login">
              <Button size="sm" className="bg-gradient-to-r from-primary to-primary/80 hover:opacity-90">
                登录
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="container mx-auto px-4 md:px-6 pt-16 pb-16 md:pt-28 md:pb-24">
        <div className="max-w-4xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/5 border border-primary/10 mb-8 md:mb-12">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-sm font-medium text-primary">专为海外留学生打造的智能求职平台</span>
          </div>
          
          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight mb-6 md:mb-10 leading-[1.05]">
            <span className="block mb-2 md:mb-3">智能求职</span>
            <span className="bg-gradient-to-r from-primary via-violet-500 to-primary bg-clip-text text-transparent">
              一步到位
            </span>
          </h1>
          
          {/* Subtitle */}
          <p className="text-lg md:text-2xl text-muted-foreground max-w-2xl mx-auto mb-10 md:mb-14 leading-relaxed">
            AI驱动的求职助手，从简历优化到岗位匹配
            <br className="hidden sm:block" />
            让每一步都更精准、更高效
          </p>
          
          {/* Quick Start Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-14 md:mb-20">
            <Link href="/ai-match" className="w-full sm:w-auto">
              <Button size="lg" className="w-full sm:w-auto h-14 px-10 text-lg bg-gradient-to-r from-primary to-primary/80 hover:opacity-90 shadow-2xl shadow-primary/25 rounded-2xl group">
                <Sparkles className="mr-2 h-5 w-5" />
                AI智能选岗
                <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <Link href="/resume" className="w-full sm:w-auto">
              <Button size="lg" variant="outline" className="w-full sm:w-auto h-14 px-10 text-lg rounded-2xl border-2 hover:bg-primary/5">
                <Upload className="mr-2 h-5 w-5" />
                上传简历
              </Button>
            </Link>
          </div>
          
          {/* Stats */}
          <div className="flex flex-wrap justify-center gap-8 md:gap-16">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl md:text-5xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent tracking-tight">
                  {stat.value}
                </div>
                <div className="text-sm md:text-base text-muted-foreground mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Core Features - Bento Grid Style */}
      <section className="container mx-auto px-4 md:px-6 py-16 md:py-28">
        <div className="text-center mb-12 md:mb-20">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted/50 border border-muted mb-6">
            <Layers className="h-5 w-5 text-primary" />
            <span className="text-base font-medium">六大核心能力</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-4">
            为求职而生的
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent"> 超级工具</span>
          </h2>
          <p className="text-muted-foreground text-lg md:text-xl max-w-xl mx-auto hidden md:block">
            每一个功能都经过精心设计，让求职之路更加顺畅
          </p>
        </div>
        
        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 max-w-6xl mx-auto">
          {coreFeatures.map((feature) => (
            <Link 
              href={feature.href} 
              key={feature.title}
              className="group"
            >
              <div className="relative h-full p-6 md:p-8 rounded-2xl md:rounded-3xl bg-gradient-to-br from-muted/50 to-muted/20 border border-muted/50 hover:border-primary/20 transition-all duration-500 hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/5 overflow-hidden">
                {/* Gradient Background on Hover */}
                <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-[0.08] transition-opacity duration-500`} />
                
                {/* Icon */}
                <div className={`relative w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center shadow-lg mb-6 group-hover:scale-110 group-hover:rotate-3 transition-all duration-500`}>
                  <feature.icon className="h-7 w-7 md:h-8 md:w-8 text-white" />
                </div>
                
                {/* Text */}
                <div className="relative">
                  <h3 className="font-bold text-xl md:text-2xl mb-2 group-hover:text-primary transition-colors flex items-center gap-2">
                    {feature.title}
                    <ArrowRight className="h-5 w-5 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                  </h3>
                  <p className="text-muted-foreground text-sm md:text-base leading-relaxed">
                    {feature.description}
                  </p>
                </div>
                
                {/* Decorative Arrow - Desktop */}
                <div className="hidden md:block absolute bottom-8 right-8 w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 group-hover:translate-x-1">
                  <ArrowRight className="h-6 w-6 text-primary" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* How it works - Premium Style */}
      <section className="container mx-auto px-4 md:px-6 py-16 md:py-28">
        <div className="relative rounded-3xl md:rounded-[48px] bg-neutral-950 text-white overflow-hidden p-8 md:p-16 lg:p-20">
          {/* Gradient Overlays */}
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-br from-purple-500/20 via-purple-600/10 to-transparent rounded-full blur-[100px]" />
          <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-gradient-to-tr from-blue-500/20 via-blue-600/10 to-transparent rounded-full blur-[80px]" />
          
          <div className="relative">
            <div className="text-center mb-12 md:mb-16">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 mb-6">
                <Zap className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium text-white/80">简单三步</span>
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-4">
                开启求职之旅
              </h2>
              <p className="text-white/50 text-lg md:text-xl max-w-md mx-auto">
                让AI帮你找到理想工作
              </p>
            </div>
            
            {/* Steps */}
            <div className="flex flex-col md:grid md:grid-cols-3 gap-8 md:gap-12">
              {workflow.map((item, index) => (
                <div key={item.step} className="relative group">
                  {/* Connector Line */}
                  {index < 2 && (
                    <div className="hidden md:block absolute top-12 left-[60%] w-[80%] h-px bg-gradient-to-r from-white/20 to-transparent" />
                  )}
                  
                  <div className="flex md:flex-col items-start md:items-center gap-4 md:gap-0">
                    {/* Step Icon */}
                    <div className="relative flex-shrink-0">
                      <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/30 group-hover:scale-105 transition-transform duration-300">
                        <item.icon className="h-7 w-7 md:h-8 md:w-8 text-primary-foreground" />
                      </div>
                      <div className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-white text-neutral-950 flex items-center justify-center text-sm font-bold">
                        {item.step}
                      </div>
                    </div>
                    
                    {/* Text */}
                    <div className="flex-1 md:text-center md:pt-6">
                      <h3 className="font-semibold text-xl md:text-2xl mb-2">{item.title}</h3>
                      <p className="text-white/50 text-sm md:text-base leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            {/* CTA */}
            <div className="text-center mt-12 md:mt-16">
              <Link href="/resume">
                <Button size="lg" className="h-12 px-10 text-base bg-gradient-to-r from-primary to-primary/80 hover:opacity-90 shadow-lg shadow-primary/20 rounded-xl group">
                  立即开始
                  <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Why PathUp - Benefits Grid */}
      <section className="container mx-auto px-4 md:px-6 py-16 md:py-24">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 max-w-5xl mx-auto">
          {[
            { icon: Target, title: '精准匹配', desc: 'AI 深度分析简历与岗位匹配度' },
            { icon: Clock, title: '效率提升', desc: '节省 70% 网申时间' },
            { icon: TrendingUp, title: '通过率高', desc: 'ATS 系统优化，简历脱颖而出' },
            { icon: Shield, title: '安全可靠', desc: '数据加密存储，隐私保护' },
          ].map((item) => (
            <div key={item.title} className="group p-5 md:p-8 rounded-2xl bg-gradient-to-br from-muted/60 to-muted/30 border border-muted/50 hover:border-primary/20 transition-all duration-300 hover:-translate-y-0.5">
              <div className="w-12 h-12 md:w-14 md:h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <item.icon className="h-6 w-6 md:h-7 md:w-7 text-primary" />
              </div>
              <h3 className="font-semibold text-base md:text-lg mb-1">{item.title}</h3>
              <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Section - Premium */}
      <section className="container mx-auto px-6 py-20 md:py-32">
        <div className="relative text-center">
          {/* Background Glow */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-[600px] h-[600px] bg-gradient-to-r from-primary/15 via-purple-500/10 to-pink-500/15 rounded-full blur-[120px]" />
          </div>
          
          <div className="relative">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/5 border border-primary/10 mb-6">
              <Star className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-primary">免费使用</span>
            </div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-4">
              准备好开始了吗？
            </h2>
            <p className="text-muted-foreground text-lg md:text-xl mb-10 max-w-md mx-auto">
              加入 PathUp，让求职变得更简单
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/resume">
                <Button size="lg" className="h-14 px-10 text-lg bg-gradient-to-r from-primary to-primary/80 hover:opacity-90 shadow-2xl shadow-primary/25 rounded-2xl group">
                  <Upload className="mr-2 h-5 w-5" />
                  上传简历开始
                  <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
              <Link href="/ai-match">
                <Button size="lg" variant="outline" className="h-14 px-10 text-lg rounded-2xl border-2 hover:bg-primary/5">
                  <Sparkles className="mr-2 h-5 w-5" />
                  AI 选岗
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-muted/30 bg-muted/5">
        <div className="container mx-auto px-6 py-10 md:py-12">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/20">
                <Briefcase className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="font-bold text-lg">PathUp</span>
            </Link>
            <p className="text-sm text-muted-foreground">
              © 2024 PathUp · 专为海外留学生打造
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
