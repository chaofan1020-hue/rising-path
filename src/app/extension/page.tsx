'use client';

import Link from 'next/link';
import { CheckCircle2, Chrome, Download, Globe2, LockKeyhole, Puzzle, ScanSearch, UserRoundCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Header1 } from '@/components/header1';
import { useLanguage, type Locale } from '@/lib/language-context';

const copy: Record<Locale, Record<string, string>> = {
  'zh-CN': {
    title: '浏览器填写助手', subtitle: '把已确认的求职资料带到招聘官网，减少重复输入。每个字段由你审阅，最终提交仍由你完成。', privacy: '隐私政策', install: '安装浏览器扩展', installHint: '支持 Chrome、Edge、Brave、Arc 等 Chromium 浏览器。', instructions: '查看安装说明', login: '先登录', loginHint: '在 Liorvix 中确认求职档案和本次使用的简历。', scan: '再扫描', scanHint: '进入招聘官网，在扩展中扫描当前表单。', fill: '最后填写', fillHint: '逐项检查建议值，再填写；上传文件和提交需手动完成。', control: '你的控制权', controlHint: '扩展只扫描你主动打开并请求扫描的页面。它不会自动点击提交，也不会在后台收集浏览历史。', notReady: '还没准备好？', notReadyHint: '先从自动网申工作台选择岗位和简历。', autoApply: '自动网申工作台',
  },
  'zh-TW': {
    title: '瀏覽器填寫助手', subtitle: '把已確認的求職資料帶到招聘官網，減少重複輸入。每個欄位由你審閱，最終提交仍由你完成。', privacy: '隱私政策', install: '安裝瀏覽器擴充功能', installHint: '支援 Chrome、Edge、Brave、Arc 等 Chromium 瀏覽器。', instructions: '查看安裝說明', login: '先登入', loginHint: '在 Liorvix 中確認求職檔案和本次使用的履歷。', scan: '再掃描', scanHint: '進入招聘官網，在擴充功能中掃描當前表單。', fill: '最後填寫', fillHint: '逐項檢查建議值，再填寫；上傳檔案和提交需手動完成。', control: '你的控制權', controlHint: '擴充功能只掃描你主動開啟並請求掃描的頁面。它不會自動點擊提交，也不會在背景收集瀏覽紀錄。', notReady: '還沒準備好？', notReadyHint: '先從自動網申工作台選擇職位和履歷。', autoApply: '自動網申工作台',
  },
  en: {
    title: 'Browser filling assistant', subtitle: 'Bring your confirmed profile to employer sites and avoid repetitive typing. Review every field; you always submit yourself.', privacy: 'Privacy policy', install: 'Install browser extension', installHint: 'Works with Chromium browsers including Chrome, Edge, Brave, and Arc.', instructions: 'View installation guide', login: 'Sign in first', loginHint: 'Confirm your application profile and the resume you want to use in Liorvix.', scan: 'Scan next', scanHint: 'Open the employer site and scan the current form in the extension.', fill: 'Fill last', fillHint: 'Review each suggested value before filling; file uploads and submission stay manual.', control: 'You stay in control', controlHint: 'The extension only scans pages you open and explicitly ask it to scan. It never clicks submit or collects browsing history in the background.', notReady: 'Not ready yet?', notReadyHint: 'Choose a role and resume from the application workspace first.', autoApply: 'Application workspace',
  },
};

export default function ExtensionPage() {
  const { locale } = useLanguage();
  const c = copy[locale];
  const chromeStoreUrl = process.env.NEXT_PUBLIC_EXTENSION_CHROME_STORE_URL?.trim()
    || process.env.NEXT_PUBLIC_EXTENSION_STORE_URL?.trim();
  const edgeStoreUrl = process.env.NEXT_PUBLIC_EXTENSION_EDGE_STORE_URL?.trim();
  const hasStoreListing = Boolean(chromeStoreUrl || edgeStoreUrl);

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <Header1 />
      <main className="mx-auto max-w-4xl px-4 pb-16 pt-24 md:px-6 md:pt-28">
        <div className="mb-8 flex flex-col gap-5 border-b border-zinc-200 pb-8 dark:border-zinc-800 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
              <Puzzle className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">Liorvix workflow</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{c.title}</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">{c.subtitle}</p>
            </div>
          </div>
          <Link href="/privacy-policy" className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900 hover:underline dark:text-zinc-300 dark:hover:text-white"><LockKeyhole className="h-3.5 w-3.5" />{c.privacy}</Link>
        </div>

        <section className="mb-5 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="flex flex-col gap-4 border-b border-zinc-200 px-5 py-5 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
            <div><p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{c.install}</p><p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{c.installHint}</p></div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {chromeStoreUrl && <Button asChild className="bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900"><a href={chromeStoreUrl} target="_blank" rel="noreferrer"><Chrome className="mr-2 h-4 w-4" />Chrome</a></Button>}
              {edgeStoreUrl && <Button asChild variant="outline"><a href={edgeStoreUrl} target="_blank" rel="noreferrer"><Globe2 className="mr-2 h-4 w-4" />Edge</a></Button>}
              {!hasStoreListing && <Button asChild variant="outline"><a href="https://liorvix.com/privacy-policy" target="_blank" rel="noreferrer"><Download className="mr-2 h-4 w-4" />{c.instructions}</a></Button>}
            </div>
          </div>
          <div className="grid gap-px bg-zinc-200 dark:bg-zinc-800 sm:grid-cols-3">
            {[
              { icon: UserRoundCheck, title: c.login, text: c.loginHint },
              { icon: ScanSearch, title: c.scan, text: c.scanHint },
              { icon: CheckCircle2, title: c.fill, text: c.fillHint },
            ].map(({ icon: Icon, title, text }) => <div key={title} className="bg-white px-5 py-5 dark:bg-zinc-900/60"><Icon className="h-4 w-4 text-zinc-500 dark:text-zinc-400" /><p className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</p><p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{text}</p></div>)}
          </div>
        </section>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900/50"><p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{c.control}</p><p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{c.controlHint}</p></div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900/50"><p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{c.notReady}</p><p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{c.notReadyHint} <Link href="/auto-apply" className="font-medium text-zinc-900 underline underline-offset-4 dark:text-white">{c.autoApply}</Link></p></div>
        </div>
      </main>
    </div>
  );
}
