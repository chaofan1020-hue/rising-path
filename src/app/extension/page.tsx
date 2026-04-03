'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Download, 
  Chrome,
  FileText,
  Settings,
  Shield,
  Zap,
  CheckCircle,
} from 'lucide-react';
import Link from 'next/link';
import { AccessGuard } from '@/components/access-guard';

function ExtensionContent() {
  const features = [
    {
      icon: Zap,
      title: '智能填充',
      description: '自动识别表单字段，快速填写姓名、邮箱、电话等信息'
    },
    {
      icon: Settings,
      title: '灵活映射',
      description: '支持按公司配置特定字段映射规则'
    },
    {
      icon: Shield,
      title: '隐私安全',
      description: '数据仅存储在本地，不会上传到任何服务器'
    },
  ];

  const supportedFields = [
    '姓名 (name)',
    '邮箱 (email)',
    '电话 (phone)',
    '地址 (location)',
    '学校 (school)',
    '学位 (degree)',
    '专业 (major)',
    '公司 (company)',
    '职位 (job_title)',
    '技能 (skills)',
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white">
        <div className="container mx-auto px-4 py-16">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 bg-white/20 px-4 py-2 rounded-full text-sm mb-6">
              <Chrome className="h-4 w-4" />
              Chrome 扩展
            </div>
            <h1 className="text-4xl font-bold mb-4">PathUp AutoFill</h1>
            <p className="text-xl text-white/90 mb-8">
              智能网申表单自动填写浏览器扩展，节省你的申请时间
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <a 
                href="/PathUp-AutoFill.tgz"
                download="PathUp-AutoFill.tgz"
                className="inline-flex items-center gap-2 bg-white text-purple-600 px-6 py-3 rounded-lg font-semibold hover:bg-white/90 transition-colors"
              >
                <Download className="h-5 w-5" />
                下载扩展压缩包
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12">
        <Tabs defaultValue="install" className="max-w-4xl mx-auto">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="install">安装指南</TabsTrigger>
            <TabsTrigger value="features">功能特点</TabsTrigger>
            <TabsTrigger value="fields">支持的字段</TabsTrigger>
          </TabsList>

          <TabsContent value="install" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>安装步骤</CardTitle>
                <CardDescription>
                  按照以下步骤在 Chrome 浏览器中安装 PathUp AutoFill 扩展
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center font-bold flex-shrink-0">
                    1
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">下载扩展压缩包</h4>
                    <p className="text-sm text-muted-foreground mb-2">
                      点击上方「下载扩展压缩包」按钮下载 <code className="bg-muted px-1 rounded">PathUp-AutoFill.tgz</code>
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center font-bold flex-shrink-0">
                    2
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">解压文件</h4>
                    <p className="text-sm text-muted-foreground">
                      使用解压工具（如 WinRAR、7-Zip）解压 <code className="bg-muted px-1 rounded">PathUp-AutoFill.tgz</code>，会得到一个 <code className="bg-muted px-1 rounded">extension</code> 文件夹
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center font-bold flex-shrink-0">
                    3
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">打开扩展管理页面</h4>
                    <p className="text-sm text-muted-foreground">
                      在 Chrome/Edge 地址栏输入：<code className="bg-muted px-1 rounded">chrome://extensions/</code> 或 <code className="bg-muted px-1 rounded">edge://extensions/</code>
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center font-bold flex-shrink-0">
                    4
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">开启开发者模式</h4>
                    <p className="text-sm text-muted-foreground">
                      在扩展页面右上角开启「开发者模式」开关
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center font-bold flex-shrink-0">
                    5
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">加载扩展</h4>
                    <p className="text-sm text-muted-foreground">
                      点击「加载已解压的扩展程序」按钮，<strong>直接选择解压出来的 <code className="bg-muted px-1 rounded">extension</code> 文件夹</strong>（不要选择上级目录）
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center font-bold flex-shrink-0">
                    6
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">配置并使用</h4>
                    <p className="text-sm text-muted-foreground">
                      点击扩展图标，输入 PathUp 平台地址，点击「同步简历数据」即可开始使用
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="features" className="mt-6">
            <div className="grid md:grid-cols-3 gap-6">
              {features.map((feature, index) => (
                <Card key={index}>
                  <CardContent className="pt-6">
                    <div className="w-12 h-12 rounded-lg bg-purple-100 flex items-center justify-center mb-4">
                      <feature.icon className="h-6 w-6 text-purple-600" />
                    </div>
                    <h4 className="font-semibold mb-2">{feature.title}</h4>
                    <p className="text-sm text-muted-foreground">
                      {feature.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
            
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>使用流程</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-4">
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-sm font-medium">1</span>
                    <div>
                      <p className="font-medium">上传并解析简历</p>
                      <p className="text-sm text-muted-foreground">在 PathUp 平台上传简历，系统自动解析内容</p>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-sm font-medium">2</span>
                    <div>
                      <p className="font-medium">提取结构化字段</p>
                      <p className="text-sm text-muted-foreground">点击「提取字段」，AI 智能提取姓名、邮箱等结构化数据</p>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-sm font-medium">3</span>
                    <div>
                      <p className="font-medium">配置字段映射</p>
                      <p className="text-sm text-muted-foreground">设置简历字段与目标表单字段的映射关系</p>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-sm font-medium">4</span>
                    <div>
                      <p className="font-medium">自动填写表单</p>
                      <p className="text-sm text-muted-foreground">访问招聘网站，系统自动检测并填写表单字段</p>
                    </div>
                  </li>
                </ol>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="fields" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>支持的表单字段</CardTitle>
                <CardDescription>
                  扩展支持自动识别和填写以下类型的表单字段
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {supportedFields.map((field, index) => (
                    <Badge key={index} variant="secondary" className="px-3 py-1">
                      <CheckCircle className="h-3 w-3 mr-1 text-green-500" />
                      {field}
                    </Badge>
                  ))}
                </div>
                
                <div className="mt-6 p-4 bg-muted rounded-lg">
                  <h5 className="font-medium mb-2">支持的表单字段名称</h5>
                  <p className="text-sm text-muted-foreground mb-2">
                    内容脚本会自动识别以下常见的表单字段名称：
                  </p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li><code className="bg-background px-1 rounded">name</code>, <code className="bg-background px-1 rounded">full_name</code>, <code className="bg-background px-1 rounded">fullname</code></li>
                    <li><code className="bg-background px-1 rounded">email</code>, <code className="bg-background px-1 rounded">email_address</code></li>
                    <li><code className="bg-background px-1 rounded">phone</code>, <code className="bg-background px-1 rounded">phone_number</code></li>
                    <li><code className="bg-background px-1 rounded">school</code>, <code className="bg-background px-1 rounded">university</code></li>
                    <li><code className="bg-background px-1 rounded">company</code>, <code className="bg-background px-1 rounded">employer</code></li>
                    <li>...以及更多常见字段名称</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Quick Access */}
        <div className="mt-8 flex justify-center gap-4">
          <Link href="/resume">
            <Button variant="outline">
              <FileText className="h-4 w-4 mr-2" />
              简历管理
            </Button>
          </Link>
          <Link href="/field-mappings">
            <Button variant="outline">
              <Settings className="h-4 w-4 mr-2" />
              字段映射
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ExtensionPage() {
  return (
    <AccessGuard>
      <ExtensionContent />
    </AccessGuard>
  );
}
