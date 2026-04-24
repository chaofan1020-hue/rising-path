'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  Settings, 
  Plus, 
  Trash2, 
  Loader2,
  FileText,
  Save,
  RefreshCw,
  Map,
} from 'lucide-react';
import Link from 'next/link';
import { AccessGuard, useAccessCode } from '@/components/access-guard';

interface FieldMapping {
  id?: number;
  company_pattern: string;
  field_name: string;
  target_field: string;
}

// 常用简历字段
const COMMON_RESUME_FIELDS = [
  { name: 'name', label: '姓名' },
  { name: 'email', label: '邮箱' },
  { name: 'phone', label: '电话' },
  { name: 'location', label: '地址' },
  { name: 'education', label: '教育背景' },
  { name: 'experience', label: '工作经验' },
  { name: 'skills', label: '技能' },
  { name: 'summary', label: '自我介绍' },
];

// 常用网申表单字段
const COMMON_TARGET_FIELDS = [
  { name: 'first_name', label: '名' },
  { name: 'last_name', label: '姓' },
  { name: 'full_name', label: '全名' },
  { name: 'email', label: '邮箱' },
  { name: 'phone', label: '电话' },
  { name: 'address', label: '地址' },
  { name: 'city', label: '城市' },
  { name: 'state', label: '州/省' },
  { name: 'zip_code', label: '邮编' },
  { name: 'country', label: '国家' },
  { name: 'school', label: '学校' },
  { name: 'degree', label: '学位' },
  { name: 'major', label: '专业' },
  { name: 'graduation_date', label: '毕业日期' },
  { name: 'gpa', label: 'GPA' },
  { name: 'company', label: '公司' },
  { name: 'job_title', label: '职位' },
  { name: 'work_experience', label: '工作经验' },
  { name: 'skills', label: '技能' },
  { name: 'linkedin', label: 'LinkedIn' },
  { name: 'github', label: 'GitHub' },
  { name: 'portfolio', label: '作品集' },
  { name: 'cover_letter', label: '求职信' },
];

// 内部组件
function FieldMappingsContent() {
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingMapping, setEditingMapping] = useState<FieldMapping | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  
  const { accessCodeId } = useAccessCode();

  useEffect(() => {
    if (accessCodeId) {
      fetchMappings();
    }
  }, [accessCodeId]);

  const fetchMappings = async () => {
    if (!accessCodeId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/field-mappings?access_code_id=${accessCodeId}`);
      const data = await response.json();
      setMappings(data.mappings || []);
    } catch (error) {
      console.error('Failed to fetch mappings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!accessCodeId) return;
    setSaving(true);
    try {
      const response = await fetch('/api/field-mappings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_code_id: accessCodeId,
          mappings: mappings,
        }),
      });
      
      if (response.ok) {
        setEditingMapping(null);
        setIsDialogOpen(false);
      } else {
        alert('保存失败');
      }
    } catch (error) {
      console.error('Failed to save mappings:', error);
      alert('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleAddMapping = () => {
    setEditingMapping({
      company_pattern: '',
      field_name: 'name',
      target_field: 'full_name',
    });
    setIsDialogOpen(true);
  };

  const handleEditMapping = (mapping: FieldMapping) => {
    setEditingMapping({ ...mapping });
    setIsDialogOpen(true);
  };

  const handleDeleteMapping = (index: number) => {
    setMappings(mappings.filter((_, i) => i !== index));
  };

  const handleSaveMapping = () => {
    if (!editingMapping) return;
    
    if (editingMapping.id) {
      // 更新
      setMappings(mappings.map(m => m.id === editingMapping.id ? editingMapping : m));
    } else {
      // 新增
      setMappings([...mappings, { ...editingMapping, id: Date.now() }]);
    }
    setEditingMapping(null);
    setIsDialogOpen(false);
  };

  // 按公司分组显示映射
  const groupedMappings = mappings.reduce((acc, mapping) => {
    const key = mapping.company_pattern || '默认';
    if (!acc[key]) acc[key] = [];
    acc[key].push(mapping);
    return acc;
  }, {} as Record<string, FieldMapping[]>);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Settings className="h-6 w-6 text-primary" />
            <span className="font-bold text-xl">Rising Path</span>
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/resume">
              <Button variant="ghost" size="sm">简历管理</Button>
            </Link>
            <Link href="/jobs">
              <Button variant="ghost" size="sm">岗位查询</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Page Title */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
            <Map className="h-8 w-8 text-primary" />
            字段映射管理
          </h1>
          <p className="text-muted-foreground">
            配置简历字段与网申表单字段的映射关系，用于自动填写
          </p>
        </div>

        <Tabs defaultValue="mappings" className="space-y-6">
          <TabsList>
            <TabsTrigger value="mappings">映射列表</TabsTrigger>
            <TabsTrigger value="guide">使用指南</TabsTrigger>
          </TabsList>

          <TabsContent value="mappings">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>字段映射</CardTitle>
                    <CardDescription>
                      配置简历中的字段如何映射到网申表单的字段
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={fetchMappings} disabled={loading}>
                      <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                      刷新
                    </Button>
                    <Button onClick={handleAddMapping}>
                      <Plus className="h-4 w-4 mr-2" />
                      添加映射
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                    <p className="text-muted-foreground">加载中...</p>
                  </div>
                ) : mappings.length === 0 ? (
                  <div className="text-center py-12">
                    <Map className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                    <p className="text-muted-foreground mb-4">暂无字段映射配置</p>
                    <Button onClick={handleAddMapping}>
                      <Plus className="h-4 w-4 mr-2" />
                      添加第一个映射
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {Object.entries(groupedMappings).map(([company, companyMappings]) => (
                      <div key={company}>
                        <h3 className="font-medium mb-3 flex items-center gap-2">
                          <Badge variant="outline">{companyMappings.length} 个映射</Badge>
                          <span className="text-sm text-muted-foreground">公司: {company}</span>
                        </h3>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>简历字段</TableHead>
                              <TableHead>映射</TableHead>
                              <TableHead>目标表单字段</TableHead>
                              <TableHead className="w-20">操作</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {companyMappings.map((mapping, index) => (
                              <TableRow key={index}>
                                <TableCell>
                                  <Badge variant="secondary">
                                    {mapping.field_name}
                                  </Badge>
                                </TableCell>
                                <TableCell>→</TableCell>
                                <TableCell>
                                  <Badge variant="default">
                                    {mapping.target_field}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <div className="flex gap-1">
                                    <Button 
                                      variant="ghost" 
                                      size="sm"
                                      onClick={() => handleEditMapping(mapping)}
                                    >
                                      编辑
                                    </Button>
                                    <Button 
                                      variant="ghost" 
                                      size="sm"
                                      onClick={() => handleDeleteMapping(mappings.indexOf(mapping))}
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ))}
                    
                    {mappings.length > 0 && (
                      <div className="flex justify-end pt-4 border-t">
                        <Button onClick={handleSave} disabled={saving}>
                          {saving ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              保存中...
                            </>
                          ) : (
                            <>
                              <Save className="h-4 w-4 mr-2" />
                              保存所有更改
                            </>
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="guide">
            <Card>
              <CardHeader>
                <CardTitle>自动网申使用指南</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <h4 className="font-medium">第一步：上传并解析简历</h4>
                  <p className="text-sm text-muted-foreground">
                    在简历管理页面上传您的简历，系统会自动解析简历内容。
                  </p>
                  <Link href="/resume">
                    <Button variant="outline" size="sm">
                      <FileText className="h-4 w-4 mr-2" />
                      去上传简历
                    </Button>
                  </Link>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium">第二步：提取结构化字段</h4>
                  <p className="text-sm text-muted-foreground">
                    使用 AI 从简历文本中提取姓名、邮箱、电话、教育背景等结构化信息。
                  </p>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium">第三步：配置字段映射</h4>
                  <p className="text-sm text-muted-foreground">
                    配置您的简历字段如何映射到目标公司的网申表单字段。例如：
                  </p>
                  <ul className="list-disc list-inside text-sm text-muted-foreground ml-4">
                    <li>姓名 → full_name 或 first_name + last_name</li>
                    <li>邮箱 → email 或 email_address</li>
                    <li>电话 → phone 或 phone_number</li>
                  </ul>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium">第四步：浏览器扩展自动填写</h4>
                  <p className="text-sm text-muted-foreground">
                    安装浏览器扩展后，访问目标公司网申页面，扩展会自动检测表单字段并使用配置的映射进行填充。
                  </p>
                  <div className="bg-muted p-4 rounded-lg">
                    <p className="text-sm font-medium mb-2">浏览器扩展开发中...</p>
                    <p className="text-xs text-muted-foreground">
                      扩展将支持 Chrome、Firefox 等主流浏览器，可从设置页面下载安装。
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* 编辑映射对话框 */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingMapping?.id ? '编辑映射' : '添加映射'}</DialogTitle>
            <DialogDescription>
              配置简历字段到目标表单字段的映射关系
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">公司名称</label>
              <Input
                placeholder="支持模糊匹配，如 Amazon、*amazon*"
                value={editingMapping?.company_pattern || ''}
                onChange={(e) => setEditingMapping(prev => prev ? { ...prev, company_pattern: e.target.value } : null)}
              />
              <p className="text-xs text-muted-foreground">
                留空表示适用于所有公司
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">简历字段</label>
              <select
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                value={editingMapping?.field_name || ''}
                onChange={(e) => setEditingMapping(prev => prev ? { ...prev, field_name: e.target.value } : null)}
              >
                <option value="">选择简历字段</option>
                {COMMON_RESUME_FIELDS.map(field => (
                  <option key={field.name} value={field.name}>
                    {field.label} ({field.name})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">目标表单字段</label>
              <Input
                placeholder="输入目标表单字段名"
                value={editingMapping?.target_field || ''}
                onChange={(e) => setEditingMapping(prev => prev ? { ...prev, target_field: e.target.value } : null)}
              />
              <p className="text-xs text-muted-foreground">
                常见字段: full_name, email, phone, address, school, degree, major, company, job_title, skills
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSaveMapping} disabled={!editingMapping?.field_name || !editingMapping?.target_field}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// 主组件
export default function FieldMappingsPage() {
  return (
    <AccessGuard>
      <FieldMappingsContent />
    </AccessGuard>
  );
}
