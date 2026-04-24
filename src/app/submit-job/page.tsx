'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Send, CheckCircle, AlertCircle } from 'lucide-react';

const DIRECTIONS = [
  { value: 'SDE', label: 'SDE / 软件工程' },
  { value: 'Quant', label: 'Quant / 量化' },
  { value: 'Data', label: 'Data / 数据' },
  { value: 'ML/AI', label: 'ML/AI / 机器学习' },
  { value: 'PM', label: 'PM / 产品经理' },
  { value: 'Risk', label: 'Risk / 风控' },
  { value: 'Finance', label: 'Finance / 金融' },
  { value: 'Other', label: 'Other / 其他' },
];

const JOB_TYPES = [
  { value: '实习', label: '实习 Internship' },
  { value: '校招', label: '校招 New Grad' },
  { value: '社招', label: '社招 Experienced' },
];

const REGIONS = [
  { value: 'New York, NY', label: 'New York, NY' },
  { value: 'San Francisco, CA', label: 'San Francisco, CA' },
  { value: 'Boston, MA', label: 'Boston, MA' },
  { value: 'Chicago, IL', label: 'Chicago, IL' },
  { value: 'Seattle, WA', label: 'Seattle, WA' },
  { value: 'Austin, TX', label: 'Austin, TX' },
  { value: 'Remote - United States', label: 'Remote / 远程' },
  { value: 'London, UK', label: 'London, UK' },
  { value: 'Hong Kong', label: 'Hong Kong' },
  { value: 'Singapore', label: 'Singapore' },
  { value: 'Other', label: 'Other / 其他' },
];

export default function SubmitJobPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    company: '',
    region: 'New York, NY',
    direction: 'SDE',
    job_type: '社招',
    job_url: '',
    description: '',
    salary_range: '',
  });

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.title.trim() || !formData.company.trim()) {
      setError('请填写必填项：岗位标题和公司名称');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/jobs/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setSubmitted(true);
      } else {
        setError(data.error || '提交失败，请重试');
      }
    } catch (error) {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="container mx-auto py-8 px-4 max-w-2xl">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="flex justify-center mb-4">
              <CheckCircle className="h-16 w-16 text-green-500" />
            </div>
            <h2 className="text-2xl font-bold mb-2">提交成功</h2>
            <p className="text-muted-foreground mb-6">
              感谢你为 Rising Path 社区贡献岗位信息！<br />
              我们会在 24 小时内审核，审核结果会通过邮件通知你。
            </p>
            <div className="flex gap-4 justify-center">
              <Button variant="outline" onClick={() => router.push('/jobs')}>
                查看岗位列表
              </Button>
              <Button onClick={() => {
                setSubmitted(false);
                setFormData({
                  title: '',
                  company: '',
                  region: 'New York, NY',
                  direction: 'SDE',
                  job_type: '社招',
                  job_url: '',
                  description: '',
                  salary_range: '',
                });
              }}>
                再提交一个
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>贡献岗位信息</CardTitle>
          <CardDescription>
            你看到的心仪岗位还没在 Rising Path 上？快告诉我们，让更多留学生看到！
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="title">岗位名称 <span className="text-red-500">*</span></Label>
                <Input
                  id="title"
                  placeholder="例如：Software Engineer"
                  value={formData.title}
                  onChange={(e) => handleChange('title', e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company">公司名称 <span className="text-red-500">*</span></Label>
                <Input
                  id="company"
                  placeholder="例如：Goldman Sachs"
                  value={formData.company}
                  onChange={(e) => handleChange('company', e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>地区</Label>
                <Select value={formData.region} onValueChange={(v) => handleChange('region', v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REGIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>方向</Label>
                <Select value={formData.direction} onValueChange={(v) => handleChange('direction', v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIRECTIONS.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>岗位类型</Label>
                <Select value={formData.job_type} onValueChange={(v) => handleChange('job_type', v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {JOB_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="job_url">岗位链接</Label>
              <Input
                id="job_url"
                type="url"
                placeholder="https://..."
                value={formData.job_url}
                onChange={(e) => handleChange('job_url', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                尽量提供官方招聘页面的链接，这样其他同学可以直接申请
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">岗位描述（可选）</Label>
              <Textarea
                id="description"
                placeholder="复制粘贴岗位描述的关键信息..."
                rows={4}
                value={formData.description}
                onChange={(e) => handleChange('description', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="salary_range">薪资范围（可选）</Label>
              <Input
                id="salary_range"
                placeholder="$150,000 - $200,000 / year"
                value={formData.salary_range}
                onChange={(e) => handleChange('salary_range', e.target.value)}
              />
            </div>

            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
                {error}
              </div>
            )}

            <div className="flex items-start gap-3 p-3 bg-muted rounded-lg">
              <AlertCircle className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground">温馨提示：</p>
                <ul className="list-disc list-inside mt-1 space-y-1">
                  <li>请确保信息真实有效</li>
                  <li>优先提供官网招聘链接</li>
                  <li>我们会在 24 小时内审核</li>
                </ul>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="ml-2">提交中...</span>
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  <span className="ml-2">提交岗位</span>
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
