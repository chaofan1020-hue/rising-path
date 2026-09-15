'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Loader2, ImageIcon, Pencil, X, RefreshCw, Building2, Upload } from 'lucide-react';
import { LogoUploadDialog } from '@/components/logo-upload-dialog';
import { AdminPageShell } from '@/components/admin/page-shell';
import { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';

interface CompanyLogoCatalogEntry {
  id: number | null;
  company_name: string;
  logo_url: string | null;
  fallback_logo_url: string | null;
  source: 'uploaded' | 'imported' | 'configured' | 'automatic';
  job_count: number;
  updated_at: string | null;
}

function getCompanyInitial(company: string): string {
  const words = company.trim().split(/[\s&-]+/).filter(Boolean);
  if (/[^\x00-\x7F]/.test(company)) return company.trim().charAt(0) || '?';
  return words.length > 1
    ? `${words[0].charAt(0)}${words[1].charAt(0)}`.toUpperCase()
    : (words[0]?.charAt(0) || '?').toUpperCase();
}

function AdminLogoPreview({ logo }: { logo: CompanyLogoCatalogEntry }) {
  const [source, setSource] = useState<'primary' | 'fallback' | 'initial'>(logo.logo_url ? 'primary' : 'fallback');

  useEffect(() => {
    setSource(logo.logo_url ? 'primary' : logo.fallback_logo_url ? 'fallback' : 'initial');
  }, [logo.logo_url, logo.fallback_logo_url]);

  const imageUrl = source === 'primary'
    ? logo.logo_url
    : source === 'fallback'
      ? logo.fallback_logo_url
      : null;

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={`${logo.company_name} logo`}
        className="h-16 w-16 object-contain"
        loading="lazy"
        onError={() => setSource(source === 'primary' && logo.fallback_logo_url ? 'fallback' : 'initial')}
      />
    );
  }

  return (
    <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-zinc-900 text-base font-semibold text-white dark:bg-white dark:text-zinc-900">
      {getCompanyInitial(logo.company_name)}
    </span>
  );
}


interface JobConfig {
  id: number;
  config_type: string;
  config_value: string;
  sort_order: number;
  is_active: boolean;
}

interface CompanyConfig {
  id: number;
  company_name: string;
  short_desc?: string;
  full_desc?: string;
  industry?: string;
  headquarters?: string;
  founded_year?: string;
  employees?: string;
  careers_page: string;
  ats_type?: string;
  ats_id?: string;
  logo_url: string;
}

export function AdminSettingsPanel() {
  const [configs, setConfigs] = useState<Record<string, JobConfig[]>>({ region: [], direction: [], audience: [] });
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [configForm, setConfigForm] = useState({ type: 'region', value: '' });
  const [companies, setCompanies] = useState<CompanyConfig[]>([]);
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);
  const [companyForm, setCompanyForm] = useState({ company_name: '', short_desc: '', full_desc: '', industry: '', headquarters: '', founded_year: '', employees: '', careers_page: '', logo_url: '' });
  const [editingCompany, setEditingCompany] = useState<CompanyConfig | null>(null);
  const [companyLogos, setCompanyLogos] = useState<CompanyLogoCatalogEntry[]>([]);
  const [logoDialogOpen, setLogoDialogOpen] = useState(false);
  const [logoDialogCompanyName, setLogoDialogCompanyName] = useState('');
  const [logosLoading, setLogosLoading] = useState(false);
  const [logosError, setLogosError] = useState('');
  const [logoSearch, setLogoSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const openLogoEditor = (companyName = '') => {
    setLogoDialogCompanyName(companyName);
    setLogoDialogOpen(true);
  };

  const fetchLogos = async () => {
    setLogosLoading(true);
    setLogosError('');
    try {
      const response = await fetch('/api/admin/company-logos');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '获取图标库失败');
      }
      if (Array.isArray(data.logos)) {
        setCompanyLogos(data.logos);
      }
    } catch (error) {
      console.error('Error fetching logos:', error);
      setLogosError(error instanceof Error ? error.message : '获取图标库失败');
    } finally {
      setLogosLoading(false);
    }
  };
  const handleLogoDelete = async (companyName: string) => {
    if (!confirm(`确定删除 ${companyName} 的 logo？`)) return;

    try {
      const response = await fetch(`/api/admin/company-logos?company_name=${encodeURIComponent(companyName)}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      if (data.success) {
        alert('删除成功');
        fetchLogos();
      } else {
        alert(data.error || '删除失败');
      }
    } catch (error) {
      alert('删除失败');
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [configsRes, companiesRes] = await Promise.all([
        fetch('/api/admin/configs?page=1&pageSize=100'),
        fetch('/api/admin/company-config'),
      ]);
      const configsData = await configsRes.json();
      const companiesData = await companiesRes.json();
      if (!configsRes.ok) throw new Error(configsData.error?.message || '配置加载失败');
      if (!companiesRes.ok) throw new Error(companiesData.error || '企业配置加载失败');
      setConfigs(configsData.configs || {});
      setCompanies(companiesData.companies || []);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateConfig = async () => {
    if (!configForm.value.trim()) return;
    
    try {
      const response = await fetch('/api/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config_type: configForm.type,
          config_value: configForm.value.trim(),
        }),
      });
      const data = await response.json();
      if (data.config) {
        setConfigs(prev => ({
          ...prev,
          [configForm.type]: [...(prev[configForm.type] || []), data.config],
        }));
        setConfigForm({ type: configForm.type, value: '' });
        setConfigDialogOpen(false);
      }
    } catch (error) {
      console.error('Failed to create config:', error);
    }
  };

  const handleDeleteConfig = async (id: number, type: string) => {
    try {
      const response = await fetch(`/api/configs?id=${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '删除配置失败');
      setConfigs(prev => ({
        ...prev,
        [type]: prev[type].filter(c => c.id !== id),
      }));
    } catch (error) {
      console.error('Failed to delete config:', error);
      alert(error instanceof Error ? error.message : '删除配置失败');
    }
  };

  // Company Config CRUD
  const handleSaveCompany = async () => {
    if (!companyForm.company_name) {
      alert('请输入公司名称');
      return;
    }
    try {
      const response = await fetch('/api/admin/company-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(companyForm),
      });
      const data = await response.json();
      if (data.success) {
        setCompanyDialogOpen(false);
        // Refresh company list
        const res = await fetch('/api/admin/company-config');
        const data = await res.json();
        setCompanies(data.companies || []);
        setCompanyForm({ 
          company_name: '', 
          short_desc: '',
          full_desc: '',
          industry: '',
          headquarters: '',
          founded_year: '',
          employees: '',
          careers_page: '',
          logo_url: '',
        });
        setEditingCompany(null);
      } else {
        alert(data.error || '保存失败');
      }
    } catch (error) {
      console.error('Failed to save company:', error);
      alert('保存失败');
    }
  };

  const handleEditCompany = (company: CompanyConfig) => {
    setEditingCompany(company);
    setCompanyForm({
      company_name: company.company_name,
      short_desc: (company as { short_desc?: string }).short_desc || '',
      full_desc: (company as { full_desc?: string }).full_desc || '',
      industry: (company as { industry?: string }).industry || '',
      headquarters: (company as { headquarters?: string }).headquarters || '',
      founded_year: (company as { founded_year?: string }).founded_year || '',
      employees: (company as { employees?: string }).employees || '',
      careers_page: (company as { careers_page?: string }).careers_page || '',
      logo_url: company.logo_url || '',
    });
    setCompanyDialogOpen(true);
  };

  const handleDeleteCompany = async (id: number) => {
    if (!confirm('确定要删除这家企业吗？')) return;
    try {
      const response = await fetch(`/api/admin/company-config?id=${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '删除企业失败');
      setCompanies(prev => prev.filter(c => c.id !== id));
    } catch (error) {
      console.error('Failed to delete company:', error);
      alert(error instanceof Error ? error.message : '删除企业失败');
    }
  };

  const filteredCompanyLogos = companyLogos.filter((logo) =>
    !logoSearch.trim() || logo.company_name.toLowerCase().includes(logoSearch.trim().toLowerCase()),
  );
  const uploadedLogoCount = companyLogos.filter((logo) => logo.source === 'uploaded').length;
  const importedLogoCount = companyLogos.filter((logo) => logo.source === 'imported').length;
  const configuredLogoCount = companyLogos.filter((logo) => logo.source === 'configured').length;
  const automaticLogoCount = companyLogos.filter((logo) => logo.source === 'automatic').length;

  useEffect(() => {
    void fetchData();
    void fetchLogos();
  }, []);

  return (
    <AdminPageShell title="岗位与企业配置" description="维护地区、方向、受众、企业资料和图标" permission={ADMIN_PERMISSIONS.configWrite}>
      {loading ? (
        <div className="py-16 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" /><p className="mt-2 text-sm text-muted-foreground">加载配置...</p></div>
      ) : (
        <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                {/* Region Config */}
                <Card>
                  <CardHeader className="pb-3 md:pb-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base md:text-lg">地区配置</CardTitle>
                        <CardDescription className="text-xs md:text-sm">管理岗位地区选项</CardDescription>
                      </div>
                      <Button
                        size="sm"
                        className="h-8 w-8 md:w-auto"
                        onClick={() => {
                          setConfigForm({ type: 'region', value: '' });
                          setConfigDialogOpen(true);
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {configs.region?.map((config) => (
                        <div key={config.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                          <span className="text-xs md:text-sm" translate="no">{config.config_value}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive h-7 w-7 p-0"
                            onClick={() => handleDeleteConfig(config.id, 'region')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      {configs.region?.length === 0 && (
                        <p className="text-xs md:text-sm text-muted-foreground text-center py-4">暂无配置</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Direction Config */}
                <Card>
                  <CardHeader className="pb-3 md:pb-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base md:text-lg">方向配置</CardTitle>
                        <CardDescription className="text-xs md:text-sm">管理岗位方向选项</CardDescription>
                      </div>
                      <Button
                        size="sm"
                        className="h-8 w-8 md:w-auto"
                        onClick={() => {
                          setConfigForm({ type: 'direction', value: '' });
                          setConfigDialogOpen(true);
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {configs.direction?.map((config) => (
                        <div key={config.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                          <span className="text-xs md:text-sm" translate="no">{config.config_value}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive h-7 w-7 p-0"
                            onClick={() => handleDeleteConfig(config.id, 'direction')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      {configs.direction?.length === 0 && (
                        <p className="text-xs md:text-sm text-muted-foreground text-center py-4">暂无配置</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Audience Config */}
                <Card>
                  <CardHeader className="pb-3 md:pb-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base md:text-lg">受众配置</CardTitle>
                        <CardDescription className="text-xs md:text-sm">管理岗位受众选项</CardDescription>
                      </div>
                      <Button
                        size="sm"
                        className="h-8 w-8 md:w-auto"
                        onClick={() => {
                          setConfigForm({ type: 'audience', value: '' });
                          setConfigDialogOpen(true);
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {configs.audience?.map((config) => (
                        <div key={config.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                          <span className="text-xs md:text-sm" translate="no">{config.config_value}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive h-7 w-7 p-0"
                            onClick={() => handleDeleteConfig(config.id, 'audience')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      {configs.audience?.length === 0 && (
                        <p className="text-xs md:text-sm text-muted-foreground text-center py-4">暂无配置</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Company Config - 企业配置 */}
              <Card className="mt-4 md:mt-6">
                <CardHeader className="pb-3 md:pb-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base md:text-lg">企业配置</CardTitle>
                      <CardDescription className="text-xs md:text-sm">管理公司基本信息，岗位自动关联</CardDescription>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditingCompany(null);
                        setCompanyForm({ 
                          company_name: '', 
                          short_desc: '',
                          full_desc: '',
                          industry: '',
                          headquarters: '',
                          founded_year: '',
                          employees: '',
                          careers_page: '',
                          logo_url: '',
                        });
                        setCompanyDialogOpen(true);
                      }}
                    >
                      <Plus className="h-4 w-4 md:mr-2" />
                      <span>添加企业</span>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {companies.length > 0 ? (
                    <div className="border rounded-lg overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[700px]">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium">企业名称</th>
                              <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium hidden sm:table-cell">ATS类型</th>
                              <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium hidden md:table-cell">ATS ID</th>
                              <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium">招聘页面</th>
                              <th className="px-3 md:px-4 py-2 md:py-3 text-right text-xs md:text-sm font-medium">操作</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {companies.map((company) => (
                              <tr key={company.id} className="hover:bg-muted/30">
                                <td className="px-3 md:px-4 py-2 md:py-3">
                                  <span className="text-xs md:text-sm font-medium">{company.company_name}</span>
                                </td>
                                <td className="px-3 md:px-4 py-2 md:py-3 hidden sm:table-cell">
                                  <Badge variant="outline" className="text-xs">
                                    {company.ats_type === 'greenhouse' ? 'Greenhouse' : 
                                     company.ats_type === 'lever' ? 'Lever' : 
                                     company.ats_type === 'builtin' ? 'BuiltIn' : '手动'}
                                  </Badge>
                                </td>
                                <td className="px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm text-muted-foreground hidden md:table-cell">
                                  {company.ats_id || '-'}
                                </td>
                                <td className="px-3 md:px-4 py-2 md:py-3">
                                  {company.careers_page ? (
                                    <a 
                                      href={company.careers_page} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="text-xs md:text-sm text-blue-600 hover:underline"
                                    >
                                      查看
                                    </a>
                                  ) : (
                                    <span className="text-xs md:text-sm text-muted-foreground">-</span>
                                  )}
                                </td>
                                <td className="px-3 md:px-4 py-2 md:py-3">
                                  <div className="flex items-center justify-end gap-1">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0"
                                      onClick={() => handleEditCompany(company)}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-destructive h-7 w-7 p-0"
                                      onClick={() => handleDeleteCompany(company.id)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Building2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p className="text-sm">暂无企业配置</p>
                      <p className="text-xs mt-1">点击上方按钮添加企业</p>
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3 md:pb-6">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle className="text-base md:text-lg">企业图标库</CardTitle>
                      <CardDescription className="text-xs md:text-sm">查看当前岗位使用的图标，并上传自定义图标覆盖自动图标</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" className="h-8 text-xs md:text-sm" onClick={() => void fetchLogos()} disabled={logosLoading}>
                        <RefreshCw className={`h-4 w-4 md:mr-2 ${logosLoading ? 'animate-spin' : ''}`} />
                        <span className="hidden md:inline">刷新</span>
                      </Button>
                      <Button size="sm" className="h-8 text-xs md:text-sm" onClick={() => openLogoEditor()}>
                        <Plus className="h-4 w-4 md:mr-2" />
                        <span className="hidden md:inline">上传图标</span>
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <Input
                      value={logoSearch}
                      onChange={(event) => setLogoSearch(event.target.value)}
                      placeholder="搜索公司名称"
                      className="h-9 w-full sm:max-w-xs"
                    />
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">共 {companyLogos.length} 家</Badge>
                      <Badge variant="outline">自定义 {uploadedLogoCount}</Badge>
                      <Badge variant="outline">已导入 {importedLogoCount}</Badge>
                      <Badge variant="outline">企业配置 {configuredLogoCount}</Badge>
                      <Badge variant="outline">自动 {automaticLogoCount}</Badge>
                    </div>
                  </div>

                  {logosError ? (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-6 text-center text-sm text-destructive">
                      <p>{logosError}</p>
                      <Button variant="outline" size="sm" className="mt-3" onClick={() => void fetchLogos()}>重新加载</Button>
                    </div>
                  ) : logosLoading && companyLogos.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />正在读取当前图标...
                    </div>
                  ) : filteredCompanyLogos.length === 0 ? (
                    <div className="py-12 text-center text-muted-foreground">
                      <ImageIcon className="mx-auto mb-3 h-12 w-12 opacity-50" />
                      <p>{companyLogos.length === 0 ? '暂无公司图标数据' : '没有匹配的公司'}</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
                      {filteredCompanyLogos.map((logo) => (
                        <div
                          key={logo.company_name}
                          role="button"
                          tabIndex={0}
                          onClick={() => openLogoEditor(logo.company_name)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              openLogoEditor(logo.company_name);
                            }
                          }}
                          className="group relative cursor-pointer rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <div className="flex aspect-square items-center justify-center rounded-md bg-white dark:bg-zinc-950">
                            <AdminLogoPreview logo={logo} />
                          </div>
                          <div className="mt-2 min-w-0">
                            <p className="truncate text-center text-sm font-medium" title={logo.company_name}>{logo.company_name}</p>
                            <div className="mt-1 flex items-center justify-center gap-1">
                              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                {logo.source === 'uploaded' ? '自定义' : logo.source === 'imported' ? '已导入' : logo.source === 'configured' ? '企业配置' : '自动'}
                              </Badge>
                              {logo.job_count > 0 && <span className="text-[10px] text-muted-foreground">{logo.job_count} 岗位</span>}
                            </div>
                          </div>
                          {logo.source === 'uploaded' && (
                            <Button
                              variant="destructive"
                              size="sm"
                              aria-label={`删除 ${logo.company_name} 自定义图标`}
                              title="删除自定义图标"
                              className="absolute right-1 top-1 h-7 w-7 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleLogoDelete(logo.company_name);
                              }}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Pencil className="pointer-events-none absolute bottom-2 right-2 h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
        </div>
      )}
      {/* Add Config Dialog */}
      <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              添加{configForm.type === 'region' ? '地区' : configForm.type === 'direction' ? '方向' : '受众'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>名称</Label>
              <Input
                value={configForm.value}
                onChange={(e) => setConfigForm({ ...configForm, value: e.target.value })}
                placeholder={`输入${configForm.type === 'region' ? '地区' : configForm.type === 'direction' ? '方向' : '受众'}名称`}
                translate="no"
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateConfig} disabled={!configForm.value.trim()}>
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Company Config Dialog */}
      <Dialog open={companyDialogOpen} onOpenChange={setCompanyDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingCompany ? '编辑企业' : '添加企业'}
            </DialogTitle>
            <DialogDescription>
              配置企业信息，公司信息独立维护，岗位自动关联
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>公司名称 *</Label>
                <Input
                  value={companyForm.company_name}
                  onChange={(e) => setCompanyForm({ ...companyForm, company_name: e.target.value })}
                  placeholder="如：Amazon"
                  disabled={!!editingCompany}
                />
              </div>
              <div>
                <Label>总部</Label>
                <Input
                  value={companyForm.headquarters}
                  onChange={(e) => setCompanyForm({ ...companyForm, headquarters: e.target.value })}
                  placeholder="如：美国西雅图"
                />
              </div>
            </div>
            
            <div>
              <Label>一句话简介</Label>
              <Input
                value={companyForm.short_desc}
                onChange={(e) => setCompanyForm({ ...companyForm, short_desc: e.target.value })}
                placeholder="如：全球云计算和电商巨头，正全面转向AI优先"
              />
            </div>
            
            <div>
              <Label>公司介绍</Label>
              <Textarea
                value={companyForm.full_desc}
                onChange={(e) => setCompanyForm({ ...companyForm, full_desc: e.target.value })}
                placeholder="详细介绍公司背景、业务、文化等..."
                className="min-h-[100px]"
              />
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>行业</Label>
                <Input
                  value={companyForm.industry}
                  onChange={(e) => setCompanyForm({ ...companyForm, industry: e.target.value })}
                  placeholder="如：科技/电商"
                />
              </div>
              <div>
                <Label>成立年份</Label>
                <Input
                  value={companyForm.founded_year}
                  onChange={(e) => setCompanyForm({ ...companyForm, founded_year: e.target.value })}
                  placeholder="如：1994"
                />
              </div>
              <div>
                <Label>员工规模</Label>
                <Input
                  value={companyForm.employees}
                  onChange={(e) => setCompanyForm({ ...companyForm, employees: e.target.value })}
                  placeholder="如：150万+"
                />
              </div>
            </div>
            
            <div>
              <Label>招聘页面</Label>
              <Input
                value={companyForm.careers_page}
                onChange={(e) => setCompanyForm({ ...companyForm, careers_page: e.target.value })}
                placeholder="https://www.amazon.jobs"
              />
            </div>
            
            <div>
              <div className="flex items-center justify-between">
                <Label>Logo</Label>
                {companyLogos.length > 0 && (
                  <Select 
                    value={companyForm.logo_url || '__custom__'} 
                    onValueChange={(value) => {
                      if (value === '__custom__') {
                        setCompanyForm({ ...companyForm, logo_url: '' });
                      } else {
                        setCompanyForm({ ...companyForm, logo_url: value });
                      }
                    }}
                  >
                    <SelectTrigger className="h-7 w-auto text-xs">
                      <SelectValue placeholder="选择已有Logo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__custom__">+ 自定义URL</SelectItem>
                      {companyLogos
                        .filter((logo): logo is CompanyLogoCatalogEntry & { logo_url: string } => Boolean(logo.logo_url))
                        .map(logo => (
                        <SelectItem key={`${logo.company_name}-${logo.source}`} value={logo.logo_url}>
                          <div className="flex items-center gap-2">
                            <img src={logo.logo_url} alt="" className="h-4 w-4 rounded" />
                            {logo.company_name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <Input
                  value={companyForm.logo_url}
                  onChange={(e) => setCompanyForm({ ...companyForm, logo_url: e.target.value })}
                  placeholder="https://example.com/logo.png"
                  className="flex-1"
                />
                {companyForm.logo_url && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => openLogoEditor(companyForm.company_name)}
                    className="px-2"
                  >
                    <Upload className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {companyForm.logo_url && (
                <div className="mt-2 flex items-center gap-2">
                  <img src={companyForm.logo_url} alt="" className="h-8 w-8 rounded border bg-white" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCompanyForm({ ...companyForm, logo_url: '' })}
                  >
                    <X className="h-4 w-4 mr-1" />
                    移除
                  </Button>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompanyDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSaveCompany} disabled={!companyForm.company_name.trim()}>
              {editingCompany ? '保存' : '添加'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <LogoUploadDialog
        open={logoDialogOpen}
        initialCompanyName={logoDialogCompanyName}
        onOpenChange={(open) => {
          setLogoDialogOpen(open);
          if (!open) setLogoDialogCompanyName('');
        }}
        onSuccess={fetchLogos}
      />
    </AdminPageShell>
  );
}
