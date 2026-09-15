'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, RefreshCw, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useAdminPermissions } from '@/components/admin-shell';
import { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';

type Role = 'super_admin' | 'content_admin' | 'support_admin';
interface AdminAccount {
  id: string;
  auth_user_id: string;
  email?: string | null;
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
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('super_admin');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [pendingDelete, setPendingDelete] = useState<AdminAccount | null>(null);
  const [deleting, setDeleting] = useState(false);

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
        body: JSON.stringify({ email, roleKey: role }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || '绑定管理员账号失败');
      setEmail('');
      setMessage('管理员邮箱已绑定，对方可用该邮箱收取验证码登录后台');
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
      body: JSON.stringify({ id: account.id, roleKey: updates.role_key, status: updates.status }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error?.message || '更新管理员账号失败');
      return;
    }
    setAccounts((current) => current.map((item) => item.id === account.id ? data.data : item));
  };

  const deleteAccount = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pendingDelete.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || '删除管理员账号失败');
      setAccounts((current) => current.filter((item) => item.id !== pendingDelete.id));
      setPendingDelete(null);
      setMessage('管理员账号已删除');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除管理员账号失败');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      {permissionsLoading ? <div className="flex min-h-80 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : !canManageRoles ? <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">当前管理员角色无权管理管理员账号</div> : <>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-zinc-900 dark:text-white" />
          <div>
            <h1 className="text-lg font-semibold">管理员账号</h1>
            <p className="text-xs text-muted-foreground">直接填写邮箱即可绑定。还没有平台账号时会自动创建，之后用验证码登录后台。</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="border-zinc-200 dark:border-zinc-800" onClick={() => void loadAccounts()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新
        </Button>
      </div>

      <section className="mb-6 rounded-lg border bg-background p-4">
        <div className="mb-3 flex items-center gap-2 font-medium"><UserPlus className="h-4 w-4" />新增管理员邮箱</div>
        <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
          <div>
            <Label htmlFor="admin-email">管理员邮箱</Label>
            <Input id="admin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@company.com" />
          </div>
          <div>
            <Label>角色</Label>
            <Select value={role} onValueChange={(value) => setRole(value as Role)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(roleLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button onClick={() => void bindAccount()} disabled={saving || !email.trim()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}绑定
          </Button>
        </div>
        {message && <p className="mt-3 text-sm text-muted-foreground">{message}</p>}
      </section>

      <section className="overflow-hidden rounded-lg border bg-background">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-muted/40"><tr><th className="px-4 py-3 text-left">邮箱</th><th className="px-4 py-3 text-left">角色</th><th className="px-4 py-3 text-left">状态</th><th className="px-4 py-3 text-left">最近登录</th><th className="px-4 py-3 text-right">操作</th></tr></thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id} className="border-b last:border-0">
                  <td className="px-4 py-3 text-sm">{account.email || '已绑定账号'}</td>
                  <td className="px-4 py-3"><Select value={account.role_key} onValueChange={(value) => void updateAccount(account, { role_key: value as Role })}><SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(roleLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></td>
                  <td className="px-4 py-3">{account.status === 'active' ? '启用' : '已停用'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{account.last_login_at ? new Date(account.last_login_at).toLocaleString('zh-CN') : '未登录'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => void updateAccount(account, { status: account.status === 'active' ? 'suspended' : 'active' })}>{account.status === 'active' ? '停用' : '启用'}</Button>
                      <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setPendingDelete(account)}>
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />删除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && accounts.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">暂无绑定账号</td></tr>}
              {loading && <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">加载中...</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => { if (!open && !deleting) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除管理员账号</AlertDialogTitle>
            <AlertDialogDescription>
              将解除 {pendingDelete?.email || '该账号'} 的后台权限，对方不能再登录运营后台。不会删除其学员数据。最后一名超级管理员不能删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleting} onClick={(event) => { event.preventDefault(); void deleteAccount(); }}>
              {deleting ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </>}
    </main>
  );
}
