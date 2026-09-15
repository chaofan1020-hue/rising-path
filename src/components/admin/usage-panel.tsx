'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Plus, Loader2, Download, ChevronLeft, ChevronRight, RefreshCw, Activity, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useAdminPermissions } from '@/components/admin-shell';
import { AdminPageShell } from '@/components/admin/page-shell';
import { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';
import { AI_FEATURE_LABELS, formatAiFeature, formatAudioBytes, formatAudioMinutes, formatAudioSeconds, formatCount as formatTokenCount, formatEstimatedCosts } from '@/components/admin/format';

interface AiUsageSummary {
  call_count: number;
  successful_calls: number;
  failed_calls: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  actual_calls: number;
  estimated_calls: number;
  unknown_calls: number;
  audio_calls: number;
  input_audio_seconds: number;
  output_audio_seconds: number;
  input_audio_bytes: number;
  output_audio_bytes: number;
  audio_tokens: number;
  text_characters: number;
  billing_units: number;
  priced_calls: number;
  unpriced_calls: number;
  estimated_costs: Record<string, number | string>;
}

interface AiUsageFeatureSummary extends AiUsageSummary {
  feature: string;
}

interface AiUsageEvent {
  id: number;
  request_id: string;
  user_id: string | null;
  feature: string;
  provider: string;
  model: string | null;
  status: 'success' | 'error';
  usage_source: 'actual' | 'estimated' | 'unknown';
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  modality: 'text' | 'audio';
  input_audio_seconds: number | null;
  output_audio_seconds: number | null;
  input_audio_bytes: number | null;
  output_audio_bytes: number | null;
  audio_tokens: number | null;
  text_characters: number | null;
  measurement_source: string;
  error_message: string | null;
  duration_ms: number | null;
  estimated_cost: number | string | null;
  currency: string;
  cost_source: 'priced' | 'unpriced';
  interview_session_id?: number | null;
  billing_unit?: string | null;
  billing_units?: number | string | null;
  phase?: string | null;
  fallback?: boolean;
  retry_count?: number | null;
  metadata?: Record<string, unknown> | null;
  error_code?: string | null;
  created_at: string;
}

interface AiUsageStudentSummary extends AiUsageSummary {
  user_id: string;
  display_name: string;
}

interface AiUsageData {
  summary: AiUsageSummary;
  features: AiUsageFeatureSummary[];
  events: AiUsageEvent[];
}

interface AiModelPrice {
  id: number;
  provider: string;
  model: string;
  currency: string;
  input_token_price_per_million: number | string | null;
  output_token_price_per_million: number | string | null;
  audio_second_price: number | string | null;
  billing_unit_price: number | string | null;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  notes: string | null;
}


const aiFeatureOptions = Object.keys(AI_FEATURE_LABELS);

function formatModelPrice(price: AiModelPrice): string {
  if (price.input_token_price_per_million !== null || price.output_token_price_per_million !== null) {
    return `输入 ${price.input_token_price_per_million ?? '-'} / 输出 ${price.output_token_price_per_million ?? '-'} 每百万 Token`;
  }
  if (price.audio_second_price !== null) return `${price.audio_second_price} / 音频秒`;
  return `${price.billing_unit_price ?? '-'} / 自定义计费单位`;
}

function getAiUsageDateRange(range: '7d' | '30d' | '90d' | 'all'): { from?: string; to: string } {
  const to = new Date().toISOString();
  if (range === 'all') return { to };
  const from = new Date();
  from.setDate(from.getDate() - Number(range.slice(0, -1)));
  return { from: from.toISOString(), to };
}

export function AdminUsagePanel() {
  const { hasPermission } = useAdminPermissions();
  const canReadUsers = hasPermission(ADMIN_PERMISSIONS.usersRead);
  const canExportUsage = hasPermission(ADMIN_PERMISSIONS.usageExport);
  const canWriteConfig = hasPermission(ADMIN_PERMISSIONS.configWrite);
  const [aiUsage, setAiUsage] = useState<AiUsageData | null>(null);
  const [aiUsageStudents, setAiUsageStudents] = useState<AiUsageStudentSummary[]>([]);
  const [aiUsageLoading, setAiUsageLoading] = useState(false);
  const [aiUsageError, setAiUsageError] = useState('');
  const [aiUsageExporting, setAiUsageExporting] = useState(false);
  const [aiUsageRange, setAiUsageRange] = useState<'7d' | '30d' | '90d' | 'all'>('7d');
  const [aiUsageFeature, setAiUsageFeature] = useState('all');
  const [aiUsageProvider, setAiUsageProvider] = useState('all');
  const [aiUsageStatus, setAiUsageStatus] = useState('all');
  const [aiUsageSource, setAiUsageSource] = useState('all');
  const [aiUsagePage, setAiUsagePage] = useState(1);
  const [aiUsageStudentPage, setAiUsageStudentPage] = useState(1);
  const [aiUsageTotal, setAiUsageTotal] = useState(0);
  const [aiUsageStudentTotal, setAiUsageStudentTotal] = useState(0);
  const [aiModelPrices, setAiModelPrices] = useState<AiModelPrice[]>([]);
  const [aiPricesLoading, setAiPricesLoading] = useState(false);
  const [aiPricesError, setAiPricesError] = useState('');
  const [aiPriceDialogOpen, setAiPriceDialogOpen] = useState(false);
  const [aiPriceSaving, setAiPriceSaving] = useState(false);
  const [aiPriceForm, setAiPriceForm] = useState({ provider: 'alibaba', model: '', currency: 'USD', inputTokenPricePerMillion: '', outputTokenPricePerMillion: '', audioSecondPrice: '', billingUnitPrice: '', effectiveFrom: '', notes: '' });
  const aiUsagePageSize = 10;
  const aiUsageStudentPageSize = 10;

  const fetchAiUsage = useCallback(async () => {
    setAiUsageLoading(true);
    setAiUsageError('');
    const dateRange = getAiUsageDateRange(aiUsageRange);
    const commonParams = new URLSearchParams({ pageSize: String(aiUsagePageSize) });
    if (aiUsageFeature !== 'all') commonParams.set('feature', aiUsageFeature);
    if (aiUsageProvider !== 'all') commonParams.set('provider', aiUsageProvider);
    if (aiUsageStatus !== 'all') commonParams.set('status', aiUsageStatus);
    if (aiUsageSource !== 'all') commonParams.set('usageSource', aiUsageSource);
    if (dateRange.from) commonParams.set('from', dateRange.from);
    commonParams.set('to', dateRange.to);

    const eventParams = new URLSearchParams(commonParams);
    eventParams.set('page', String(aiUsagePage));

    try {
      const usageResponse = await fetch(`/api/admin/ai-usage?${eventParams.toString()}`, { cache: 'no-store' });
      const usageJson = await usageResponse.json();
      if (!usageResponse.ok) {
        const required = Array.isArray(usageJson.error?.requiredMigrations) ? `（所需迁移：${usageJson.error.requiredMigrations.join('、')}）` : '';
        throw new Error(`${usageJson.error?.message || 'AI 用量加载失败'}${required}`);
      }

      setAiUsage(usageJson.data || null);
      setAiUsageTotal(Number(usageJson.meta?.total || 0));
    } catch (error) {
      console.error('Failed to fetch AI usage:', error);
      setAiUsageError(error instanceof Error ? error.message : 'AI 用量加载失败');
      setAiUsage(null);
    } finally {
      setAiUsageLoading(false);
    }
  }, [aiUsageFeature, aiUsagePage, aiUsageProvider, aiUsageRange, aiUsageSource, aiUsageStatus]);

  const fetchAiUsageStudents = useCallback(async () => {
    const dateRange = getAiUsageDateRange(aiUsageRange);
    const params = new URLSearchParams({ page: String(aiUsageStudentPage), pageSize: String(aiUsageStudentPageSize) });
    if (aiUsageFeature !== 'all') params.set('feature', aiUsageFeature);
    if (aiUsageProvider !== 'all') params.set('provider', aiUsageProvider);
    if (aiUsageStatus !== 'all') params.set('status', aiUsageStatus);
    if (aiUsageSource !== 'all') params.set('usageSource', aiUsageSource);
    if (dateRange.from) params.set('from', dateRange.from);
    params.set('to', dateRange.to);
    try {
      const response = await fetch(`/api/admin/ai-usage/students?${params.toString()}`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '学生用量加载失败');
      setAiUsageStudents(json.data?.students || []);
      setAiUsageStudentTotal(Number(json.meta?.total || 0));
    } catch (error) {
      console.error('Failed to fetch AI usage students:', error);
      setAiUsageStudents([]);
      setAiUsageStudentTotal(0);
    }
  }, [aiUsageFeature, aiUsageProvider, aiUsageRange, aiUsageSource, aiUsageStatus, aiUsageStudentPage]);

  const handleAiUsageExport = async () => {
    setAiUsageExporting(true);
    try {
      const dateRange = getAiUsageDateRange(aiUsageRange);
      const params = new URLSearchParams();
      if (aiUsageFeature !== 'all') params.set('feature', aiUsageFeature);
      if (aiUsageProvider !== 'all') params.set('provider', aiUsageProvider);
      if (aiUsageStatus !== 'all') params.set('status', aiUsageStatus);
      if (aiUsageSource !== 'all') params.set('usageSource', aiUsageSource);
      if (dateRange.from) params.set('from', dateRange.from);
      params.set('to', dateRange.to);
      const response = await fetch(`/api/admin/ai-usage/export?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.error?.message || '导出 AI 使用量失败');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `liorvix-ai-usage-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(error instanceof Error ? error.message : '导出 AI 使用量失败');
    } finally {
      setAiUsageExporting(false);
    }
  };

  const fetchAiModelPrices = useCallback(async () => {
    setAiPricesLoading(true);
    setAiPricesError('');
    try {
      const response = await fetch('/api/admin/ai-prices?page=1&pageSize=100', { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) {
        const required = Array.isArray(json.error?.requiredMigrations) ? `（所需迁移：${json.error.requiredMigrations.join('、')}）` : '';
        throw new Error(`${json.error?.message || '模型价格加载失败'}${required}`);
      }
      setAiModelPrices(json.data || []);
    } catch (error) {
      console.error('Failed to fetch AI model prices:', error);
      setAiPricesError(error instanceof Error ? error.message : '模型价格加载失败');
      setAiModelPrices([]);
    } finally {
      setAiPricesLoading(false);
    }
  }, []);

  const handleCreateAiPrice = async () => {
    setAiPriceSaving(true);
    try {
      const response = await fetch('/api/admin/ai-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiPriceForm),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '创建模型价格失败');
      setAiPriceDialogOpen(false);
      setAiPriceForm({
        provider: 'alibaba', model: '', currency: 'USD', inputTokenPricePerMillion: '', outputTokenPricePerMillion: '',
        audioSecondPrice: '', billingUnitPrice: '', effectiveFrom: '', notes: '',
      });
      await Promise.all([fetchAiModelPrices(), fetchAiUsage()]);
    } catch (error) {
      alert(error instanceof Error ? error.message : '创建模型价格失败');
    } finally {
      setAiPriceSaving(false);
    }
  };

  const handleAiPriceStatus = async (price: AiModelPrice) => {
    try {
      const response = await fetch('/api/admin/ai-prices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: price.id, isActive: !price.is_active }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '更新模型价格失败');
      await fetchAiModelPrices();
    } catch (error) {
      alert(error instanceof Error ? error.message : '更新模型价格失败');
    }
  };

  useEffect(() => { void fetchAiUsage(); }, [fetchAiUsage]);
  useEffect(() => { if (canReadUsers) void fetchAiUsageStudents(); }, [canReadUsers, fetchAiUsageStudents]);
  useEffect(() => { if (canWriteConfig) void fetchAiModelPrices(); }, [canWriteConfig, fetchAiModelPrices]);
  useEffect(() => { setAiUsagePage(1); setAiUsageStudentPage(1); }, [aiUsageRange, aiUsageFeature, aiUsageProvider, aiUsageStatus, aiUsageSource]);

  return (
    <AdminPageShell title="AI 用量与成本" description="按功能、学生和模型查看用量" permission={ADMIN_PERMISSIONS.dashboardRead}>
      <>
      <Dialog open={aiPriceDialogOpen} onOpenChange={setAiPriceDialogOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>添加模型价格</DialogTitle>
              <DialogDescription>同一模型只能采用 Token、音频秒或自定义计费单位的一种口径。</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2 sm:grid-cols-2">
              <div><Label>供应商</Label><Input value={aiPriceForm.provider} onChange={(event) => setAiPriceForm((form) => ({ ...form, provider: event.target.value }))} placeholder="alibaba / cartesia" /></div>
              <div><Label>模型</Label><Input value={aiPriceForm.model} onChange={(event) => setAiPriceForm((form) => ({ ...form, model: event.target.value }))} placeholder="qwen3.7-plus" /></div>
              <div><Label>币种</Label><Input value={aiPriceForm.currency} maxLength={3} onChange={(event) => setAiPriceForm((form) => ({ ...form, currency: event.target.value.toUpperCase() }))} placeholder="USD" /></div>
              <div><Label>生效时间（可选）</Label><Input type="datetime-local" value={aiPriceForm.effectiveFrom} onChange={(event) => setAiPriceForm((form) => ({ ...form, effectiveFrom: event.target.value }))} /></div>
              <div><Label>输入单价 / 百万 Token</Label><Input inputMode="decimal" value={aiPriceForm.inputTokenPricePerMillion} onChange={(event) => setAiPriceForm((form) => ({ ...form, inputTokenPricePerMillion: event.target.value }))} placeholder="仅文本模型" /></div>
              <div><Label>输出单价 / 百万 Token</Label><Input inputMode="decimal" value={aiPriceForm.outputTokenPricePerMillion} onChange={(event) => setAiPriceForm((form) => ({ ...form, outputTokenPricePerMillion: event.target.value }))} placeholder="仅文本模型" /></div>
              <div><Label>音频单价 / 秒</Label><Input inputMode="decimal" value={aiPriceForm.audioSecondPrice} onChange={(event) => setAiPriceForm((form) => ({ ...form, audioSecondPrice: event.target.value }))} placeholder="仅音频模型" /></div>
              <div><Label>自定义单价 / 单位</Label><Input inputMode="decimal" value={aiPriceForm.billingUnitPrice} onChange={(event) => setAiPriceForm((form) => ({ ...form, billingUnitPrice: event.target.value }))} placeholder="仅特殊计费模型" /></div>
              <div className="sm:col-span-2"><Label>备注</Label><Textarea value={aiPriceForm.notes} onChange={(event) => setAiPriceForm((form) => ({ ...form, notes: event.target.value }))} placeholder="价格来源、合同或版本说明" /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAiPriceDialogOpen(false)} disabled={aiPriceSaving}>取消</Button>
              <Button onClick={() => void handleCreateAiPrice()} disabled={aiPriceSaving || !aiPriceForm.provider.trim() || !aiPriceForm.model.trim()}>
                {aiPriceSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}保存价格
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
              <div className="space-y-4 md:space-y-6">
                {canWriteConfig && <Card>
                  <CardHeader className="pb-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <CardTitle className="text-lg">模型价格</CardTitle>
                        <CardDescription>新调用按生效时价格写入成本快照。价格变更请新增记录并停用旧记录。</CardDescription>
                      </div>
                      <Button size="sm" onClick={() => setAiPriceDialogOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />添加价格
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px] text-sm">
                        <thead>
                          <tr className="border-b text-muted-foreground">
                            <th className="py-2 text-left font-medium">供应商 / 模型</th>
                            <th className="py-2 text-left font-medium">价格</th>
                            <th className="py-2 text-left font-medium">生效时间</th>
                            <th className="py-2 text-left font-medium">状态</th>
                            <th className="py-2 text-right font-medium">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {aiModelPrices.map((price) => (
                            <tr key={price.id} className="border-b last:border-0">
                              <td className="py-3">{price.provider} / {price.model}<span className="ml-2 text-xs text-muted-foreground">{price.currency}</span></td>
                              <td className="py-3 text-xs">{formatModelPrice(price)}</td>
                              <td className="py-3 text-xs text-muted-foreground">{new Date(price.effective_from).toLocaleString('zh-CN')}</td>
                              <td className="py-3"><Badge variant={price.is_active ? 'secondary' : 'outline'}>{price.is_active ? '启用' : '已停用'}</Badge></td>
                              <td className="py-3 text-right">
                                <Button variant="outline" size="sm" onClick={() => void handleAiPriceStatus(price)}>
                                  {price.is_active ? '停用' : '启用'}
                                </Button>
                              </td>
                            </tr>
                          ))}
                          {aiModelPrices.length === 0 && (
                            <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">{aiPricesLoading ? '加载中...' : aiPricesError || '尚未配置模型价格，成本会显示为未定价'}</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Activity className="h-5 w-5 text-primary" />
                          AI 用量看板
                        </CardTitle>
                        <CardDescription>
                          按功能和调用状态核算 AI token。未知 token 不会被当作 0 计入。
                        </CardDescription>
                      </div>
                      <div className="flex gap-2">
                        {canExportUsage && <Button variant="outline" size="sm" onClick={() => void handleAiUsageExport()} disabled={aiUsageExporting}>
                          <Download className={`mr-2 h-4 w-4 ${aiUsageExporting ? 'animate-pulse' : ''}`} />导出
                        </Button>}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void Promise.all([fetchAiUsage(), canReadUsers ? fetchAiUsageStudents() : Promise.resolve()])}
                          disabled={aiUsageLoading}
                        >
                          <RefreshCw className={`h-4 w-4 mr-2 ${aiUsageLoading ? 'animate-spin' : ''}`} />
                          刷新
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-muted-foreground">时间：</span>
                      {(['7d', '30d', '90d', 'all'] as const).map((range) => (
                        <Button
                          key={range}
                          variant={aiUsageRange === range ? 'default' : 'outline'}
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => setAiUsageRange(range)}
                        >
                          {range === '7d' ? '近7天' : range === '30d' ? '近30天' : range === '90d' ? '近90天' : '全部'}
                        </Button>
                      ))}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <Label className="text-xs text-muted-foreground">功能</Label>
                        <Select value={aiUsageFeature} onValueChange={setAiUsageFeature}>
                          <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">全部功能</SelectItem>
                            {aiFeatureOptions.map((feature) => (
                              <SelectItem key={feature} value={feature}>{formatAiFeature(feature)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">供应商</Label>
                        <Select value={aiUsageProvider} onValueChange={setAiUsageProvider}>
                          <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">全部供应商</SelectItem>
                            <SelectItem value="alibaba">Alibaba</SelectItem>
                            <SelectItem value="cartesia">Cartesia</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">状态</Label>
                        <Select value={aiUsageStatus} onValueChange={setAiUsageStatus}>
                          <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">全部状态</SelectItem>
                            <SelectItem value="success">成功</SelectItem>
                            <SelectItem value="error">失败</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Token 来源</Label>
                        <Select value={aiUsageSource} onValueChange={setAiUsageSource}>
                          <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">全部来源</SelectItem>
                            <SelectItem value="actual">实际返回</SelectItem>
                            <SelectItem value="estimated">估算</SelectItem>
                            <SelectItem value="unknown">未知</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {aiUsageLoading ? (
                  <div className="text-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                    <p className="mt-2 text-muted-foreground">加载 AI 用量...</p>
                  </div>
                ) : aiUsageError ? (
                  <Card>
                    <CardContent className="py-10 text-center">
                      <XCircle className="h-8 w-8 mx-auto text-destructive" />
                      <p className="mt-2 text-sm text-destructive">{aiUsageError}</p>
                      <Button className="mt-4" variant="outline" onClick={() => void fetchAiUsage()}>重试</Button>
                    </CardContent>
                  </Card>
                ) : aiUsage ? (
                  <>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <Card>
                        <CardContent className="pt-5">
                          <p className="text-xs text-muted-foreground">AI 调用次数</p>
                          <p className="mt-1 text-2xl font-bold">{formatTokenCount(aiUsage.summary.call_count)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">成功 {formatTokenCount(aiUsage.summary.successful_calls)} / 失败 {formatTokenCount(aiUsage.summary.failed_calls)}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-5">
                          <p className="text-xs text-muted-foreground">总 Token</p>
                          <p className="mt-1 text-2xl font-bold">{formatTokenCount(aiUsage.summary.total_tokens)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">输入 {formatTokenCount(aiUsage.summary.input_tokens)}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-5">
                          <p className="text-xs text-muted-foreground">输出 Token</p>
                          <p className="mt-1 text-2xl font-bold">{formatTokenCount(aiUsage.summary.output_tokens)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">实际 {formatTokenCount(aiUsage.summary.actual_calls)} 次</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-5">
                          <p className="text-xs text-muted-foreground">数据可信度</p>
                          <p className="mt-1 text-2xl font-bold">{formatTokenCount(aiUsage.summary.actual_calls)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">估算 {formatTokenCount(aiUsage.summary.estimated_calls)} / 未知 {formatTokenCount(aiUsage.summary.unknown_calls)}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-5">
                          <p className="text-xs text-muted-foreground">预计成本</p>
                          <p className="mt-1 text-lg font-bold" title={formatEstimatedCosts(aiUsage.summary.estimated_costs)}>{formatEstimatedCosts(aiUsage.summary.estimated_costs)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">已定价 {formatTokenCount(aiUsage.summary.priced_calls)} / 未定价 {formatTokenCount(aiUsage.summary.unpriced_calls)}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-5">
                          <p className="text-xs text-muted-foreground">音频调用</p>
                          <p className="mt-1 text-2xl font-bold">{formatTokenCount(aiUsage.summary.audio_calls)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">音频 Token {formatTokenCount(aiUsage.summary.audio_tokens)}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-5">
                          <p className="text-xs text-muted-foreground">ASR 输入</p>
                          <p className="mt-1 text-2xl font-bold">{formatAudioMinutes(aiUsage.summary.input_audio_seconds)} 分钟</p>
                          <p className="mt-1 text-xs text-muted-foreground">{formatAudioBytes(aiUsage.summary.input_audio_bytes)}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-5">
                          <p className="text-xs text-muted-foreground">TTS 输出</p>
                          <p className="mt-1 text-2xl font-bold">{formatAudioMinutes(aiUsage.summary.output_audio_seconds)} 分钟</p>
                          <p className="mt-1 text-xs text-muted-foreground">{formatAudioBytes(aiUsage.summary.output_audio_bytes)}</p>
                        </CardContent>
                      </Card>
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">功能用量分布</CardTitle>
                          <CardDescription>文本显示 Token，音频显示 ASR/TTS 分钟数；成本仅统计已配置价格的调用</CardDescription>
                        </CardHeader>
                        <CardContent>
                          {aiUsage.features.length > 0 ? (
                            <div className="space-y-4">
                              {aiUsage.features.slice(0, 10).map((feature) => {
                                 const maxCalls = Math.max(...aiUsage.features.map((item) => item.call_count), 1);
                                 const percent = Math.max(2, Math.round((feature.call_count / maxCalls) * 100));
                                return (
                                  <div key={feature.feature} className="space-y-1">
                                    <div className="flex items-center justify-between gap-3 text-sm">
                                      <span className="truncate">{formatAiFeature(feature.feature)}</span>
                                       <span className="shrink-0 text-muted-foreground">{feature.audio_calls > 0 ? `${formatAudioMinutes(Number(feature.input_audio_seconds) + Number(feature.output_audio_seconds))} 分钟` : `${formatTokenCount(feature.total_tokens)} tokens`}</span>
                                    </div>
                                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
                                    </div>
                                    <div className="flex justify-between text-xs text-muted-foreground">
                                       <span>{formatTokenCount(feature.call_count)} 次调用，音频 {formatTokenCount(feature.audio_calls)} 次</span>
                                      <span>{formatEstimatedCosts(feature.estimated_costs)}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="py-8 text-center text-sm text-muted-foreground">暂无功能用量数据</p>
                          )}
                        </CardContent>
                      </Card>

                      {canReadUsers && <Card>
                        <CardHeader>
                          <CardTitle className="text-base">学生 AI 用量排行</CardTitle>
                          <CardDescription>共 {formatTokenCount(aiUsageStudentTotal)} 名学生，文本按 Token，音频按分钟</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[760px] text-sm">
                              <thead>
                                <tr className="border-b text-muted-foreground">
                                  <th className="py-2 text-left font-medium">学生</th>
                                   <th className="py-2 text-right font-medium">文本 Token</th>
                                  <th className="py-2 text-right font-medium">音频分钟</th>
                                  <th className="py-2 text-right font-medium">预计成本</th>
                                  <th className="py-2 text-right font-medium">调用</th>
                                  <th className="py-2 text-right font-medium">实际/估算/未知</th>
                                </tr>
                              </thead>
                              <tbody>
                                {aiUsageStudents.map((student, index) => (
                                  <tr key={student.user_id} className="border-b last:border-0">
                                    <td className="max-w-[220px] truncate py-3 pr-3">
                                      <span className="mr-2 text-xs text-muted-foreground">{(aiUsageStudentPage - 1) * aiUsageStudentPageSize + index + 1}</span>
                                      <Link className="hover:text-primary hover:underline" href={`/admin/students/${student.user_id}`}>{student.display_name || '未设置姓名'}</Link>
                                    </td>
                                     <td className="py-3 text-right font-medium">{formatTokenCount(student.total_tokens)}</td>
                                     <td className="py-3 text-right">ASR {formatAudioMinutes(student.input_audio_seconds)} / TTS {formatAudioMinutes(student.output_audio_seconds)}</td>
                                     <td className="py-3 text-right text-xs" title={`已定价 ${student.priced_calls} / 未定价 ${student.unpriced_calls}`}>{formatEstimatedCosts(student.estimated_costs)}</td>
                                     <td className="py-3 text-right">{formatTokenCount(student.call_count)}</td>
                                    <td className="py-3 text-right text-xs text-muted-foreground">{student.actual_calls}/{student.estimated_calls}/{student.unknown_calls}</td>
                                  </tr>
                                ))}
                                {aiUsageStudents.length === 0 && (
                                   <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">暂无学生用量数据</td></tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                          {aiUsageStudentTotal > aiUsageStudentPageSize && (
                            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                              <span>第 {aiUsageStudentPage} / {Math.ceil(aiUsageStudentTotal / aiUsageStudentPageSize)} 页</span>
                              <div className="flex gap-1">
                                <Button variant="outline" size="icon" className="h-7 w-7" disabled={aiUsageStudentPage <= 1} onClick={() => setAiUsageStudentPage((page) => page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                                <Button variant="outline" size="icon" className="h-7 w-7" disabled={aiUsageStudentPage >= Math.ceil(aiUsageStudentTotal / aiUsageStudentPageSize)} onClick={() => setAiUsageStudentPage((page) => page + 1)}><ChevronRight className="h-4 w-4" /></Button>
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>}
                    </div>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">最近 AI 调用</CardTitle>
                        <CardDescription>当前筛选条件下的最新事件，共 {formatTokenCount(aiUsageTotal)} 条</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[1320px] text-sm">
                            <thead>
                              <tr className="border-b text-muted-foreground">
                                <th className="py-2 text-left font-medium">时间</th>
                                <th className="py-2 text-left font-medium">功能</th>
                                <th className="py-2 text-left font-medium">供应商 / 模型</th>
                                <th className="py-2 text-left font-medium">会话 / 路由</th>
                                <th className="py-2 text-right font-medium">文本 Token</th>
                                <th className="py-2 text-right font-medium">音频</th>
                                <th className="py-2 text-right font-medium">计量来源</th>
                                <th className="py-2 text-right font-medium">预计成本</th>
                                <th className="py-2 text-center font-medium">状态</th>
                                <th className="py-2 text-left font-medium">原因 / metadata</th>
                              </tr>
                            </thead>
                            <tbody>
                              {aiUsage.events.map((event) => (
                                <tr key={event.id} className="border-b last:border-0">
                                  <td className="py-3 pr-3 text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString('zh-CN')}</td>
                                  <td className="py-3">{formatAiFeature(event.feature)}</td>
                                  <td className="py-3 text-xs">{event.provider}{event.model ? ` / ${event.model}` : ''}</td>
                                  <td className="py-3 text-xs">{event.interview_session_id ? `#${event.interview_session_id}` : '非面试'}{event.metadata?.voice_route ? <><br /><span className="text-muted-foreground">{String(event.metadata.voice_route)}</span></> : null}</td>
                                   <td className="py-3 text-right">{formatTokenCount(event.total_tokens)}</td>
                                   <td className="py-3 text-right">{event.modality === 'audio' ? <><span>ASR {formatAudioSeconds(event.input_audio_seconds)}</span><br /><span>TTS {formatAudioSeconds(event.output_audio_seconds)}</span></> : '文本'}</td>
                                   <td className="py-3 text-right text-xs">{event.usage_source === 'actual' ? '实际' : event.usage_source === 'estimated' ? '估算' : '未测量'}<br />{event.measurement_source || '未测量'}</td>
                                   <td className="py-3 text-right text-xs" title={event.cost_source === 'priced' ? `${event.currency} ${event.estimated_cost}` : '该调用尚无有效价格'}>{event.cost_source === 'priced' ? `${event.currency} ${Number(event.estimated_cost || 0).toFixed(4)}` : '未定价'}</td>
                                  <td className="py-3 text-center">
                                    <Badge variant={event.status === 'success' ? 'secondary' : 'destructive'}>
                                      {event.status === 'success' ? '成功' : '失败'}
                                    </Badge>
                                  </td>
                                  <td className="max-w-[300px] py-3 text-xs text-muted-foreground"><div>{event.error_message || (event.status === 'success' ? '完成' : '调用失败')}</div><details className="mt-1"><summary className="cursor-pointer text-primary">查看明细</summary><pre className="mt-1 max-w-[300px] overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-[10px]">{JSON.stringify({ request_id: event.request_id, phase: event.phase, fallback: event.fallback, retry_count: event.retry_count, billing_unit: event.billing_unit, billing_units: event.billing_units, metadata: event.metadata || {} }, null, 2)}</pre></details></td>
                                </tr>
                              ))}
                              {aiUsage.events.length === 0 && (
                                 <tr><td colSpan={10} className="py-8 text-center text-muted-foreground">暂无调用事件</td></tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                        {aiUsageTotal > aiUsagePageSize && (
                          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                            <span>第 {aiUsagePage} / {Math.ceil(aiUsageTotal / aiUsagePageSize)} 页</span>
                            <div className="flex gap-1">
                              <Button variant="outline" size="icon" className="h-7 w-7" disabled={aiUsagePage <= 1} onClick={() => setAiUsagePage((page) => page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                              <Button variant="outline" size="icon" className="h-7 w-7" disabled={aiUsagePage >= Math.ceil(aiUsageTotal / aiUsagePageSize)} onClick={() => setAiUsagePage((page) => page + 1)}><ChevronRight className="h-4 w-4" /></Button>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </>
                ) : (
                  <Card><CardContent className="py-12 text-center text-muted-foreground">暂无 AI 用量数据</CardContent></Card>
                )}
              </div>
      </>
    </AdminPageShell>
  );
}
