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
  Target,
  Clock,
  TrendingUp,
  Shield,
  Star,
} from 'lucide-react';

const coreFeatures = [
  {
    title: 'AI智能选岗',
    description: '基于简历深度分析，精准匹配最适合你的岗位',
    icon: Brain,
    href: '/ai-match',
    color: 'violet',
  },
  {
    title: 'ATS简历优化',
    description: '针对招聘系统优化，大幅提升简历通过率',
    icon: Wand2,
    href: '/optimize',
    color: 'orange',
  },
  {
    title: 'AutoFill 自动填写',
    description: '一键填充网申表单，告别重复填写',
    icon: Puzzle,
    href: '/extension',
    color: 'cyan',
  },
  {
    title: '岗位智能查询',
    description: '海量海外岗位，多维度精准筛选',
    icon: Search,
    href: '/jobs',
    color: 'blue',
  },
  {
    title: '简历管理',
    description: '智能解析多格式简历，统一管理',
    icon: FileText,
    href: '/resume',
    color: 'green',
  },
  {
    title: '网申追踪',
    description: '记录每次投递，掌握求职进度',
    icon: Send,
    href: '/applications',
    color: 'pink',
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
            <div className="w-8 h-8 md:w-9 md:h-9 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/20">
              <Briefcase className="h-4 w-4 md:h-5 md:w-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg md:text-xl">PathUp</span>
          </Link>
          
          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-2">
            <Link href="/ai-match">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                AI选岗
              </Button>
            </Link>
            <Link href="/jobs">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                岗位查询
              </Button>
            </Link>
            <Link href="/optimize">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                简历优化
              </Button>
            </Link>
            <Link href="/login">
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
      <section className="container mx-auto px-4 md:px-6 pt-12 pb-10 md:pt-20 md:pb-16">
        <div className="max-w-4xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 md:px-4 md:py-2 rounded-full bg-primary/5 border border-primary/10 mb-6 md:mb-8">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-xs md:text-sm font-medium text-primary">专为海外留学生 · 智能求职平台</span>
          </div>
          
          {/* Headline */}
          <h1 className="text-3xl sm:text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-4 md:mb-6 leading-[1.1]">
            <span className="block mb-1 md:mb-2">让求职</span>
            <span className="bg-gradient-to-r from-primary via-violet-500 to-primary bg-clip-text text-transparent">
              更精准、更高效
            </span>
          </h1>
          
          {/* Subtitle */}
          <p className="text-base md:text-xl text-muted-foreground max-w-2xl mx-auto mb-6 md:mb-10 leading-relaxed px-4">
            从简历优化到岗位匹配，AI 帮你找到最适合的机会
          </p>
          
          {/* Quick Start Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 md:gap-4 justify-center mb-8 md:mb-12">
            <Link href="/ai-match" className="w-full sm:w-auto">
              <Button size="lg" className="w-full sm:w-auto h-12 md:h-14 px-6 md:px-10 text-base md:text-lg bg-gradient-to-r from-primary to-primary/80 hover:opacity-90 shadow-2xl shadow-primary/20 rounded-xl group">
                <Sparkles className="mr-2 h-4 w-4 md:h-5 md:w-5" />
                AI智能选岗
                <ArrowRight className="ml-2 h-4 w-4 md:h-5 md:w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <Link href="/resume" className="w-full sm:w-auto">
              <Button size="lg" variant="outline" className="w-full sm:w-auto h-12 md:h-14 px-6 md:px-10 text-base md:text-lg rounded-xl border-2 hover:bg-muted/50">
                <Upload className="mr-2 h-4 w-4 md:h-5 md:w-5" />
                上传简历
              </Button>
            </Link>
          </div>
          
          {/* Stats */}
          <div className="flex flex-wrap justify-center gap-6 md:gap-12">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-2xl md:text-4xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                  {stat.value}
                </div>
                <div className="text-xs md:text-sm text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Core Features - 6 Cards in 2 Rows */}
      <section className="container mx-auto px-4 md:px-6 py-8 md:py-16">
        <div className="text-center mb-6 md:mb-10">
          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold mb-2">
            一站式求职<span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">超级工具</span>
          </h2>
          <p className="text-sm md:text-base text-muted-foreground">
            六大核心能力，让求职效率提升 10 倍
          </p>
        </div>
        
        {/* Feature Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-5 max-w-5xl mx-auto">
          {coreFeatures.map((feature, index) => (
            <Link 
              href={feature.href} 
              key={feature.title}
              className="group"
            >
              <div className="relative h-full p-5 md:p-6 rounded-xl md:rounded-2xl bg-gradient-to-br from-muted/40 to-muted/20 border border-muted/40 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 hover:-translate-y-0.5">
                {/* Icon */}
                <div className={`w-12 h-12 md:w-14 md:h-14 rounded-xl mb-4 flex items-center justify-center ${
                  feature.color === 'violet' ? 'bg-violet-100 text-violet-600' :
                  feature.color === 'orange' ? 'bg-orange-100 text-orange-600' :
                  feature.color === 'cyan' ? 'bg-cyan-100 text-cyan-600' :
                  feature.color === 'blue' ? 'bg-blue-100 text-blue-600' :
                  feature.color === 'green' ? 'bg-green-100 text-green-600' :
                  'bg-pink-100 text-pink-600'
                }`}>
                  <feature.icon className="h-6 w-6 md:h-7 md:w-7" />
                </div>
                
                {/* Text */}
                <div>
                  <h3 className="font-semibold text-base md:text-lg mb-1.5 group-hover:text-primary transition-colors flex items-center gap-1.5">
                    {feature.title}
                    <ArrowRight className="h-3.5 w-3.5 md:h-4 md:w-4 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                  </h3>
                  <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </div>
                
                {/* Index Badge */}
                <div className="absolute top-3 right-3 text-[10px] md:text-xs font-medium text-muted-foreground/50">
                  {String(index + 1).padStart(2, '0')}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* How it works - Simplified */}
      <section className="container mx-auto px-4 md:px-6 py-10 md:py-16">
        <div className="relative rounded-2xl md:rounded-3xl bg-gradient-to-br from-muted/50 via-muted/30 to-muted/10 border border-muted/30 p-6 md:p-10 lg:p-12 overflow-hidden">
          {/* Decorative */}
          <div className="absolute top-0 right-0 w-60 md:w-80 h-60 md:h-80 bg-gradient-to-br from-primary/5 to-transparent rounded-full blur-3xl" />
          
          <div className="relative">
            <div className="text-center mb-8 md:mb-10">
              <h2 className="text-xl sm:text-2xl md:text-3xl font-bold mb-2">
                简单<span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">三步</span>开启求职之旅
              </h2>
              <p className="text-sm md:text-base text-muted-foreground hidden sm:block">
                从上传简历到完成投递，全程 AI 驱动
              </p>
            </div>
            
            {/* Steps */}
            <div className="flex flex-col md:grid md:grid-cols-3 gap-6 md:gap-8">
              {workflow.map((item, index) => (
                <div key={item.step} className="relative flex md:flex-col items-start md:items-center gap-4 md:gap-4">
                  {/* Connector */}
                  {index < 2 && (
                    <div className="hidden md:block absolute top-10 left-[60%] w-[80%] h-[2px] bg-gradient-to-r from-primary/30 to-transparent" />
                  )}
                  
                  {/* Step Card */}
                  <div className="flex-1 md:flex-none flex items-start md:items-center gap-3 md:gap-0">
                    <div className="relative flex-shrink-0">
                      <div className="w-12 h-12 md:w-14 md:h-14 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/20">
                        <item.icon className="h-5 w-5 md:h-6 md:w-6 text-primary-foreground" />
                      </div>
                      <div className="absolute -top-1 -right-1 w-5 h-5 md:w-6 md:h-6 rounded-full bg-background border-2 border-primary flex items-center justify-center text-[10px] md:text-xs font-bold text-primary">
                        {item.step}
                      </div>
                    </div>
                    
                    <div className="flex-1 md:text-center md:pt-3">
                      <h3 className="font-semibold text-base md:text-lg mb-0.5 md:mb-1">{item.title}</h3>
                      <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            {/* CTA */}
            <div className="text-center mt-8 md:mt-10">
              <Link href="/resume">
                <Button size="lg" className="h-11 md:h-12 px-8 md:px-10 bg-gradient-to-r from-primary to-primary/80 hover:opacity-90 shadow-lg shadow-primary/20 rounded-xl group">
                  立即开始
                  <ArrowRight className="ml-2 h-4 w-4 md:h-5 md:w-5 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Why PathUp - Quick Benefits */}
      <section className="container mx-auto px-4 md:px-6 py-10 md:py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 max-w-4xl mx-auto">
          {[
            { icon: Target, title: '精准匹配', desc: 'AI 深度分析' },
            { icon: Clock, title: '效率提升', desc: '节省 70% 时间' },
            { icon: TrendingUp, title: '通过率高', desc: 'ATS 优化' },
            { icon: Shield, title: '安全可靠', desc: '数据加密' },
          ].map((item) => (
            <div key={item.title} className="flex items-center gap-2 md:gap-3 p-3 md:p-4 rounded-xl bg-muted/30 border border-muted/30">
              <div className="w-9 h-9 md:w-11 md:h-11 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <item.icon className="h-4 w-4 md:h-5 md:w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-sm md:text-base truncate">{item.title}</div>
                <div className="text-[10px] md:text-xs text-muted-foreground">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-6 py-16 md:py-24">
        <div className="relative text-center">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-[400px] h-[400px] bg-gradient-to-r from-primary/10 to-purple-500/10 rounded-full blur-3xl" />
          </div>
          
          <div className="relative">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/5 border border-primary/10 mb-4 md:mb-6">
              <Star className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-primary">免费使用</span>
            </div>
            <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold mb-3 md:mb-4">
              准备好开启求职之旅了吗？
            </h2>
            <p className="text-muted-foreground text-base md:text-lg mb-6 md:mb-8 max-w-md mx-auto">
              上传简历，AI 帮你找到理想工作
            </p>
            <div className="flex flex-col sm:flex-row gap-3 md:gap-4 justify-center">
              <Link href="/resume">
                <Button size="lg" className="h-12 md:h-14 px-8 md:px-10 text-base md:text-lg bg-gradient-to-r from-primary to-primary/80 hover:opacity-90 shadow-2xl shadow-primary/20 rounded-xl group">
                  <Upload className="mr-2 h-4 w-4 md:h-5 md:w-5" />
                  上传简历开始
                  <ArrowRight className="ml-2 h-4 w-4 md:h-5 md:w-5 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
              <Link href="/ai-match">
                <Button size="lg" variant="outline" className="h-12 md:h-14 px-8 md:px-10 text-base md:text-lg rounded-xl border-2 hover:bg-muted/50">
                  <Sparkles className="mr-2 h-4 w-4 md:h-5 md:w-5" />
                  AI 选岗
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-muted/30 bg-muted/10">
        <div className="container mx-auto px-6 py-8 md:py-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-md shadow-primary/10">
                <Briefcase className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-semibold text-lg">PathUp</span>
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
