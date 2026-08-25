import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Chrome, Download, Globe2, Puzzle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Header1 } from '@/components/header1';

export default function ExtensionPage() {
  const chromeStoreUrl = process.env.NEXT_PUBLIC_EXTENSION_CHROME_STORE_URL?.trim()
    || process.env.NEXT_PUBLIC_EXTENSION_STORE_URL?.trim();
  const edgeStoreUrl = process.env.NEXT_PUBLIC_EXTENSION_EDGE_STORE_URL?.trim();
  const hasStoreListing = Boolean(chromeStoreUrl || edgeStoreUrl);

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <Header1 />
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-24">
        <Button asChild variant="ghost" className="mb-5 -ml-3">
          <Link href="/jobs"><ArrowLeft className="mr-2 h-4 w-4" />返回岗位</Link>
        </Button>
        <div className="mb-8 flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
            <Puzzle className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">自动填写助手</h1>
            <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">用于在招聘官网扫描并填写已确认的求职资料，提交动作始终由你本人完成。</p>
          </div>
        </div>

        {hasStoreListing ? (
          <Card className="mb-4 rounded-2xl border-zinc-200 shadow-none dark:border-zinc-800">
            <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-zinc-900 dark:text-zinc-100">浏览器扩展</p>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Chrome、Edge、Brave、Arc 等 Chromium 浏览器均可使用。安装后回到岗位详情页，网站会自动显示连接状态。</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {chromeStoreUrl && (
                  <Button asChild className="bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900">
                    <a href={chromeStoreUrl} target="_blank" rel="noreferrer"><Chrome className="mr-2 h-4 w-4" />Chrome</a>
                  </Button>
                )}
                {edgeStoreUrl && (
                  <Button asChild variant="outline" className="border-zinc-200 dark:border-zinc-700">
                    <a href={edgeStoreUrl} target="_blank" rel="noreferrer"><Globe2 className="mr-2 h-4 w-4" />Edge</a>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="mb-4 rounded-2xl border-zinc-200 shadow-none dark:border-zinc-800">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Download className="h-4 w-4" />Chromium 浏览器开发版安装</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-zinc-600 dark:text-zinc-300">
              <p>当前还未配置商店地址。Chrome 可打开 <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">chrome://extensions</code>，Edge 可打开 <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">edge://extensions</code>。</p>
              <ol className="list-decimal space-y-2 pl-5">
                <li>打开右上角的“开发者模式”。</li>
                <li>选择“加载已解压的扩展程序”。</li>
                <li>选择项目中的 <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">extension</code> 文件夹。</li>
                <li>回到岗位详情页，看到“已连接”后再打开招聘官网。</li>
              </ol>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">正式上线时，分别发布到 Chrome Web Store 和 Edge Add-ons，并配置 NEXT_PUBLIC_EXTENSION_CHROME_STORE_URL、NEXT_PUBLIC_EXTENSION_EDGE_STORE_URL。</p>
            </CardContent>
          </Card>
        )}

        <Card className="rounded-2xl border-zinc-200 shadow-none dark:border-zinc-800">
          <CardHeader className="pb-3"><CardTitle className="text-base">使用流程</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {[
              '在岗位详情页选择要使用的简历，点击“自动网申”。',
              '进入招聘官网后，在对应浏览器中打开扩展并扫描表单。',
              '检查字段内容，确认后点击填写；文件上传和最终提交需要手动完成。',
            ].map((item) => (
              <div key={item} className="flex items-start gap-2.5 text-sm text-zinc-600 dark:text-zinc-300">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                <span>{item}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
