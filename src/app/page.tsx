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
  ChevronRight,
  MapPin,
  ArrowRight,
  Zap,
  Crosshair,
  Rocket,
  Layers,
  Wand2,
  Puzzle,
} from 'lucide-react';

const features = [
  {
    title: '岗位开放',
    description: '按地区、方向、受众筛选海量海外岗位',
    detail: '支持多维度筛选，一键收藏心仪机会',
    icon: Search,
    href: '/jobs',
    gradient: 'from-blue-600 via-blue-500 to-cyan-500',
    pattern: 'dots',

  },
  {
    title: 'AI智能选岗',
    description: '基于简历深度分析，精准匹配岗位',
    detail: 'AI驱动智能推荐，找到最适合你的机会',
    icon: Brain,
    href: '/ai-match',
    gradient: 'from-violet-600 via-purple-500 to-fuchsia-500',
    pattern: 'grid',

  },
  {
    title: '简历管理',
    description: '智能解析简历，一键管理',
    detail: '支持 PDF、Word 多格式上传',
    icon: FileText,
    href: '/resume',
    gradient: 'from-emerald-600 via-green-500 to-teal-500',
    pattern: 'dots',

  },
  {
    title: 'ATS简历优化',
    description: '针对招聘系统优化简历',
    detail: '提高简历通过率，让 HR 更容易看到你',
    icon: Wand2,
    href: '/optimize',
    gradient: 'from-orange-600 via-amber-500 to-yellow-500',
    pattern: 'grid',

  },
  {
    title: '自动网申',
    description: '智能填写企业网申表单',
    detail: '学习记录填写规则，高效完成投递',
    icon: Send,
    href: '/applications',
    gradient: 'from-pink-600 via-rose-500 to-red-500',
    pattern: 'dots',

  },
  {
    title: '浏览器扩展',
    description: '一键自动填充网申表单',
    detail: '智能识别表单字段，快速完成申请',
    icon: Puzzle,
    href: '/extension',
    gradient: 'from-cyan-600 via-teal-500 to-emerald-500',
    pattern: 'grid',

  },
];

const advantages = [
  {
    icon: MapPin,
    title: '全球岗位覆盖',
    description: '覆盖美国、英国、新加坡、香港等主流留学地区',
    iconBg: 'bg-sky-100',
    iconColor: 'text-sky-600',
  },
  {
    icon: Crosshair,
    title: '精准智能匹配',
    description: 'AI深度分析简历与岗位匹配度',
    iconBg: 'bg-violet-100',
    iconColor: 'text-violet-600',
  },
  {
    icon: Rocket,
    title: '高效求职工具',
    description: '一站式完成简历优化、岗位筛选、网申投递',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
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
                岗位开放
              </Button>
            </Link>
            <Link href="/resume">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                简历管理
              </Button>
            </Link>
            <Link href="/extension">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                <Puzzle className="h-4 w-4 mr-1" />
                浏览器扩展
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
      <section className="container mx-auto px-6 pt-28 pb-24">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/5 border border-primary/10 mb-10">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-sm font-medium text-primary">专为海外留学生打造的智能求职平台</span>
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-8 leading-[1.1]">
            <span className="block mb-2">智能求职</span>
            <span className="bg-gradient-to-r from-primary via-primary/80 to-primary/60 bg-clip-text text-transparent">
              一步到位
            </span>
          </h1>
          
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-12 leading-relaxed">
            AI驱动的求职助手，从简历优化到岗位匹配<br className="hidden md:block" />
            让每一步都更精准、更高效
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/login">
              <Button size="lg" className="h-14 px-10 bg-gradient-to-r from-primary to-primary/80 hover:opacity-90 shadow-2xl shadow-primary/20 rounded-2xl group">
                <Search className="mr-2 h-5 w-5" />
                开始使用
                <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <Link href="/resume">
              <Button size="lg" variant="outline" className="h-14 px-10 rounded-2xl border-2 hover:bg-muted/50">
                <Upload className="mr-2 h-5 w-5" />
                上传简历
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Advantages Section - Premium Style */}
      <section className="container mx-auto px-6 py-20">
        <div className="grid md:grid-cols-3 gap-8">
          {advantages.map((item) => (
            <div
              key={item.title}
              className="group"
            >
              <div className="relative p-10 rounded-[32px] bg-neutral-950 text-white overflow-hidden hover:-translate-y-3 transition-all duration-500">
                {/* Gradient overlay - more visible */}
                <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 ${item.iconColor === 'text-sky-600' ? 'bg-gradient-to-br from-blue-500/30 via-blue-600/10 to-transparent' : item.iconColor === 'text-violet-600' ? 'bg-gradient-to-br from-purple-500/30 via-purple-600/10 to-transparent' : 'bg-gradient-to-br from-orange-500/30 via-orange-600/10 to-transparent'}`} />
                
                {/* Icon */}
                <div className="relative mb-8">
                  <div className="w-10 h-10 rounded-full border border-white/20 flex items-center justify-center group-hover:border-white/60 group-hover:bg-white/10 transition-all duration-300">
                    <item.icon className="h-5 w-5 text-white/80 group-hover:text-white transition-colors" />
                  </div>
                </div>
                
                {/* Text */}
                <h3 className="relative font-medium text-lg mb-3 tracking-tight">{item.title}</h3>
                <p className="relative text-white/50 text-sm leading-relaxed font-light">{item.description}</p>
                
                {/* Bottom line accent - brighter on hover */}
                <div className={`absolute bottom-0 left-0 right-0 h-px ${item.iconColor === 'text-sky-600' ? 'bg-gradient-to-r from-transparent via-blue-400 to-transparent' : item.iconColor === 'text-violet-600' ? 'bg-gradient-to-r from-transparent via-purple-400 to-transparent' : 'bg-gradient-to-r from-transparent via-orange-400 to-transparent'} opacity-50 group-hover:opacity-100 transition-opacity duration-300`} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features Section - Bento Grid Style */}
      <section className="container mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 border border-muted/50 mb-6">
            <Layers className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">五大核心能力</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            为求职而生的
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent ml-2">超级工具</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            每一个功能都经过精心设计，让求职之路更加顺畅
          </p>
        </div>
        
        {/* Bento Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((feature) => (
            <Link 
              href={feature.href} 
              key={feature.title}
              className="group relative overflow-hidden rounded-3xl transition-all duration-500 hover:-translate-y-1"
            >
              {/* Background */}
              <div className="absolute inset-0 bg-gradient-to-br from-muted/30 to-muted/10" />
              
              {/* Pattern */}
              <div className="absolute inset-0 opacity-30">
                {feature.pattern === 'dots' && (
                  <div className="w-full h-full bg-[radial-gradient(circle,_hsl(var(--muted-foreground))_1px,_transparent_1px)] bg-[size:16px_16px]" />
                )}
                {feature.pattern === 'grid' && (
                  <div className="w-full h-full bg-[linear-gradient(to_right,_hsl(var(--muted-foreground))_1px,_transparent_1px),linear-gradient(to_bottom,_hsl(var(--muted-foreground))_1px,_transparent_1px)] bg-[size:24px_24px]" />
                )}
              </div>
              
              {/* Gradient overlay on hover */}
              <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-500`} />
              
              {/* Content */}
              <div className="relative h-full p-7 flex flex-col min-h-[200px]">
                {/* Icon */}
                <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center mb-auto shadow-xl group-hover:scale-110 group-hover:rotate-3 transition-all duration-500`}>
                  <feature.icon className="h-7 w-7 text-white" />
                </div>
                
                {/* Text */}
                <div>
                  <h3 className="font-bold text-xl mb-2 group-hover:text-primary transition-colors">
                    {feature.title}
                  </h3>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-1">
                    {feature.description}
                  </p>
                  <p className="text-muted-foreground/70 text-sm">
                    {feature.detail}
                  </p>
                </div>
                
                {/* Arrow */}
                <div className="absolute bottom-7 right-7 w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 group-hover:translate-x-1">
                  <ArrowRight className="h-5 w-5 text-primary" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="container mx-auto px-6 py-20">
        <div className="relative rounded-3xl bg-gradient-to-br from-muted/60 via-muted/30 to-muted/10 border border-muted/30 p-12 md:p-16 overflow-hidden">
          {/* Decorative elements */}
          <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-br from-primary/5 to-transparent rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-60 h-60 bg-gradient-to-tr from-purple-500/5 to-transparent rounded-full blur-3xl" />
          
          <div className="relative">
            <div className="text-center mb-14">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/5 border border-primary/10 mb-6">
                <Zap className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">简单三步</span>
              </div>
              <h2 className="text-4xl font-bold mb-4">开启求职之旅</h2>
              <p className="text-muted-foreground text-lg">让AI帮你找到理想工作</p>
            </div>
            
            <div className="grid md:grid-cols-3 gap-10">
              {[
                { step: '01', title: '上传简历', desc: '上传 PDF 或 Word 简历\n系统自动解析关键信息', icon: Upload },
                { step: '02', title: '智能匹配', desc: 'AI 分析简历内容\n精准推荐匹配岗位', icon: Brain },
                { step: '03', title: '一键投递', desc: '优化简历并自动填写\n高效完成网申投递', icon: Send },
              ].map((item, index) => (
                <div key={item.step} className="relative group">
                  {/* Connector line */}
                  {index < 2 && (
                    <div className="hidden md:block absolute top-10 left-[60%] w-[80%] h-[2px] bg-gradient-to-r from-primary/30 to-transparent" />
                  )}
                  
                  <div className="flex flex-col items-center text-center">
                    {/* Step number with icon */}
                    <div className="relative mb-6">
                      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-2xl shadow-primary/20 group-hover:scale-105 transition-transform duration-300">
                        <item.icon className="h-8 w-8 text-primary-foreground" />
                      </div>
                      <div className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-background border-2 border-primary flex items-center justify-center text-xs font-bold text-primary">
                        {item.step}
                      </div>
                    </div>
                    
                    <h3 className="font-semibold text-xl mb-3">{item.title}</h3>
                    <p className="text-muted-foreground text-sm leading-relaxed whitespace-pre-line">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-6 py-24">
        <div className="relative text-center">
          {/* Background glow */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-[400px] h-[400px] bg-gradient-to-r from-primary/10 to-purple-500/10 rounded-full blur-3xl" />
          </div>
          
          <div className="relative">
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              准备好开始了吗？
            </h2>
            <p className="text-muted-foreground text-lg mb-10 max-w-md mx-auto">
              加入 PathUp，让求职变得更简单
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/resume">
                <Button size="lg" className="h-14 px-12 text-lg bg-gradient-to-r from-primary to-primary/80 hover:opacity-90 shadow-2xl shadow-primary/20 rounded-2xl group">
                  免费开始
                  <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
              <Link href="/jobs">
                <Button size="lg" variant="outline" className="h-14 px-10 rounded-2xl border-2">
                  浏览岗位
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-muted/30 bg-muted/10">
        <div className="container mx-auto px-6 py-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-md shadow-primary/10">
                <Briefcase className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-semibold text-lg">PathUp</span>
            </Link>
            <p className="text-sm text-muted-foreground">
              © 2024 PathUp. 专为海外留学生打造
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
