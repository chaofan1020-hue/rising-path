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
  Globe,
  ArrowRight,
  Zap,
  Target,
} from 'lucide-react';

const features = [
  {
    title: '岗位查询',
    description: '按地区、方向、受众筛选海量海外岗位，一键收藏心仪机会',
    icon: Search,
    href: '/jobs',
    gradient: 'from-blue-500 to-cyan-500',
  },
  {
    title: '简历管理',
    description: '智能解析简历关键信息，支持PDF、Word多格式上传',
    icon: FileText,
    href: '/resume',
    gradient: 'from-emerald-500 to-teal-500',
  },
  {
    title: 'AI智能选岗',
    description: '基于简历深度分析，精准匹配最适合的岗位机会',
    icon: Brain,
    href: '/ai-match',
    gradient: 'from-violet-500 to-purple-500',
  },
  {
    title: 'ATS简历优化',
    description: '针对企业招聘系统优化，显著提高简历通过率',
    icon: Sparkles,
    href: '/optimize',
    gradient: 'from-orange-500 to-amber-500',
  },
  {
    title: '自动网申',
    description: '智能学习填写规则，自动完成企业网申表单',
    icon: Send,
    href: '/applications',
    gradient: 'from-pink-500 to-rose-500',
  },
];

const advantages = [
  {
    icon: Globe,
    title: '全球岗位覆盖',
    description: '覆盖美国、英国、新加坡、香港等主流留学地区，实时同步优质岗位',
    gradient: 'from-blue-500 to-indigo-500',
  },
  {
    icon: Target,
    title: '精准智能匹配',
    description: 'AI深度分析简历与岗位匹配度，推荐最适合的机会',
    gradient: 'from-purple-500 to-pink-500',
  },
  {
    icon: Zap,
    title: '高效求职工具',
    description: '一站式完成简历优化、岗位筛选、网申投递全流程',
    gradient: 'from-amber-500 to-orange-500',
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Background Decoration */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-full blur-3xl opacity-30" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-gradient-to-r from-pink-500/20 to-orange-500/20 rounded-full blur-3xl opacity-30" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:24px_24px]" />
      </div>

      {/* Navigation */}
      <nav className="border-b/50 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/25 group-hover:shadow-primary/40 transition-shadow">
              <Briefcase className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-xl bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">PathUp</span>
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
            <Link href="/ai-match">
              <Button size="sm" className="bg-gradient-to-r from-primary to-primary/80 hover:opacity-90 shadow-lg shadow-primary/25">
                开始使用
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="container mx-auto px-6 pt-24 pb-20">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted/50 border border-muted/50 mb-8">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">专为海外留学生打造的智能求职平台</span>
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-8 leading-tight">
            <span className="bg-gradient-to-r from-foreground via-foreground to-foreground/70 bg-clip-text">
              智能求职
            </span>
            <br />
            <span className="bg-gradient-to-r from-primary via-primary/80 to-primary/60 bg-clip-text text-transparent">
              一步到位
            </span>
          </h1>
          
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-12 leading-relaxed">
            AI驱动的求职助手，从简历优化到岗位匹配，让每一步都更精准、更高效
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/jobs">
              <Button size="lg" className="h-12 px-8 bg-gradient-to-r from-primary to-primary/80 hover:opacity-90 shadow-xl shadow-primary/25 rounded-xl group">
                <Search className="mr-2 h-5 w-5" />
                探索岗位
                <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <Link href="/resume">
              <Button size="lg" variant="outline" className="h-12 px-8 rounded-xl border-2 hover:bg-muted/50">
                <Upload className="mr-2 h-5 w-5" />
                上传简历
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Advantages Section */}
      <section className="container mx-auto px-6 py-20">
        <div className="grid md:grid-cols-3 gap-6">
          {advantages.map((item) => (
            <div
              key={item.title}
              className="relative group"
            >
              <div className="absolute inset-0 bg-gradient-to-r opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-2xl blur-xl -z-10"
                style={{ background: `linear-gradient(to right, var(--tw-gradient-stops))` }}
              />
              <div className="p-8 rounded-2xl bg-muted/30 border border-muted/50 hover:border-muted/80 transition-all duration-300 hover:-translate-y-1">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${item.gradient} flex items-center justify-center mb-5 shadow-lg`}>
                  <item.icon className="h-6 w-6 text-white" />
                </div>
                <h3 className="font-semibold text-xl mb-3">{item.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">核心功能</h2>
          <p className="text-muted-foreground text-lg">
            全方位求职工具，让求职之路更加顺畅
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <Link href={feature.href} key={feature.title}>
              <div className="group relative h-full">
                {/* Gradient border effect */}
                <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 p-[1px]`}>
                  <div className="w-full h-full bg-background rounded-2xl" />
                </div>
                
                {/* Card content */}
                <div className="relative p-8 rounded-2xl bg-muted/20 border border-muted/50 group-hover:border-transparent transition-all duration-300 h-full flex flex-col">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center mb-5 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                    <feature.icon className="h-6 w-6 text-white" />
                  </div>
                  <h3 className="font-semibold text-xl mb-3 group-hover:text-primary transition-colors">
                    {feature.title}
                  </h3>
                  <p className="text-muted-foreground leading-relaxed flex-1">
                    {feature.description}
                  </p>
                  <div className="flex items-center text-sm text-muted-foreground mt-4 group-hover:text-primary transition-colors">
                    <span>立即体验</span>
                    <ChevronRight className="h-4 w-4 ml-1 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="container mx-auto px-6 py-20">
        <div className="relative rounded-3xl bg-gradient-to-br from-muted/50 to-muted/30 border border-muted/50 p-12 md:p-16 overflow-hidden">
          {/* Decorative elements */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-primary/10 to-transparent rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-purple-500/10 to-transparent rounded-full blur-3xl" />
          
          <div className="relative">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold mb-4">三步开启求职之旅</h2>
              <p className="text-muted-foreground text-lg">简单几步，让AI帮你找到理想工作</p>
            </div>
            
            <div className="grid md:grid-cols-3 gap-8">
              {[
                { step: '01', title: '上传简历', desc: '上传PDF或Word简历，系统自动解析关键信息' },
                { step: '02', title: '智能匹配', desc: 'AI分析简历内容，精准推荐匹配岗位' },
                { step: '03', title: '一键投递', desc: '优化简历并自动填写网申，高效完成投递' },
              ].map((item, index) => (
                <div key={item.step} className="relative">
                  {index < 2 && (
                    <div className="hidden md:block absolute top-8 left-full w-full h-[1px] bg-gradient-to-r from-muted-foreground/20 to-transparent" />
                  )}
                  <div className="flex flex-col items-center text-center">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-white font-bold text-lg mb-6 shadow-xl shadow-primary/20">
                      {item.step}
                    </div>
                    <h3 className="font-semibold text-xl mb-3">{item.title}</h3>
                    <p className="text-muted-foreground leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-6 py-20">
        <div className="text-center">
          <h2 className="text-4xl font-bold mb-4">准备好开始了吗？</h2>
          <p className="text-muted-foreground text-lg mb-8">
            加入PathUp，让求职变得更简单
          </p>
          <Link href="/resume">
            <Button size="lg" className="h-14 px-10 text-lg bg-gradient-to-r from-primary to-primary/80 hover:opacity-90 shadow-xl shadow-primary/25 rounded-xl group">
              免费开始
              <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-muted/50">
        <div className="container mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                <Briefcase className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-semibold">PathUp</span>
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
