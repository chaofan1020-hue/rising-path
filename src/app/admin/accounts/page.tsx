'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, RefreshCw, ShieldCheck, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAdminPermissions } from '@/components/admin-shell';
import { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';

type Role = 'super_admin' | 'content_admin' | 'support_admin';
interface AdminAccount {
  id: string;
  auth_user_id: string;
  role_key: Role;
  status: 'active' | 'suspended';
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

const roleLabels: Record<Role, string> = {
  super_admin: '超级管理员',
  content_admin: '内容管理员',
  support_admin: '支持管理员',
};

export default function AdminAccountsPage() {
  const { loading: permissionsLoading, hasPermission } = useAdminPermissions();
  const canManageRoles = hasPermission(ADMIN_PERMISSIONS.rolesWrite);
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [authUserId, setAuthUserId] = useState('');
  const [role, setRole] = useState<Role>('support_admin');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/accounts', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || '获取管理员账号失败');
      setAccounts(Array.isArray(data.data) ? data.data : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '获取管理员账号失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!permissionsLoading && canManageRoles) void loadAccounts();
  }, [canManageRoles, loadAccounts, permissionsLoading]);

  const bindAccount = async () => {
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authUserId, roleKey: role }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || '绑定管理员账号失败');
      setAuthUserId('');
      setMessage('管理员账号已绑定');
      await loadAccounts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '绑定管理员账号失败');
    } finally {
      setSaving(false);
    }
  };

  const updateAccount = async (account: AdminAccount, updates: Partial<Pick<AdminAccount, 'role_key' | 'status'>>) => {
    const response = await fetch('/api/admin/accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: account.id, ...updates }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error?.message || '更新管理员账号失败');
      return;
    }
    setAccounts((current) => current.map((item) => item.id === account.id ? data.data : item));
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      {permissionsLoading ? <div className="flex min-h-80 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : !canManageRoles ? <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">当前管理员角色无权管理管理员账号</div> : <>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold">管理员账号</h1>
            <p className="text-xs text-muted-foreground">绑定 Supabase Auth 用户并分配后台角色</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadAccounts()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新
        </Button>
      </div>

      <section className="mb-6 rounded-lg border bg-background p-4">
        <div className="mb-3 flex items-center gap-2 font-medium"><UserPlus className="h-4 w-4" />绑定新账号</div>
        <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
          <div>
            <Label htmlFor="auth-user-id">Supabase Auth 用户 ID</Label>
            <Input id="auth-user-id" value={authUserId} onChange={(event) => setAuthUserId(event.target.value)} placeholder="UUID" />
          </div>
          <div>
            <Label>角色</Label>
            <Select value={role} onValueChange={(value) => setRole(value as Role)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(roleLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button onClick={() => void bindAccount()} disabled={saving || !authUserId.trim()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}绑定
          </Button>
        </div>
        {message && <p className="mt-3 text-sm text-muted-foreground">{message}</p>}
      </section>

      <section className="overflow-hidden rounded-lg border bg-background">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-muted/40"><tr><th className="px-4 py-3 text-left">Auth 用户 ID</th><th className="px-4 py-3 text-left">角色</th><th className="px-4 py-3 text-left">状态</th><th className="px-4 py-3 text-left">最近登录</th><th className="px-4 py-3 text-right">操作</th></tr></thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{account.auth_user_id}</td>
                  <td className="px-4 py-3"><Select value={account.role_key} onValueChange={(value) => void updateAccount(account, { role_key: value as Role })}><SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(roleLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></td>
                  <td className="px-4 py-3">{account.status === 'active' ? '启用' : '已停用'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{account.last_login_at ? new Date(account.last_login_at).toLocaleString('zh-CN') : '未登录'}</td>
                  <td className="px-4 py-3 text-right"><Button variant="outline" size="sm" onClick={() => void updateAccount(account, { status: account.status === 'active' ? 'suspended' : 'active' })}>{account.status === 'active' ? '停用' : '启用'}</Button></td>
                </tr>
              ))}
              {!loading && accounts.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">暂无绑定账号</td></tr>}
              {loading && <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">加载中...</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      </>}
    </main>
  );
}
