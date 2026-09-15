import { ADMIN_PERMISSIONS, type AdminPermission } from '@/lib/admin-permission-constants';
import {
  Activity,
  BriefcaseBusiness,
  CreditCard,
  Dna,
  HeartPulse,
  LayoutDashboard,
  Radio,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';

export type AdminNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  permission: AdminPermission;
};

export const adminNavigation: AdminNavItem[] = [
  { label: '工作台', href: '/admin', icon: LayoutDashboard, permission: ADMIN_PERMISSIONS.dashboardRead },
  { label: '学员', href: '/admin/students', icon: Users, permission: ADMIN_PERMISSIONS.usersRead },
  { label: '岗位', href: '/admin/jobs', icon: BriefcaseBusiness, permission: ADMIN_PERMISSIONS.jobsRead },
  { label: '同步', href: '/admin/jobs/sync', icon: Radio, permission: ADMIN_PERMISSIONS.jobsRead },
  { label: '面试基因', href: '/admin/dna', icon: Dna, permission: ADMIN_PERMISSIONS.dnaRead },
  { label: '质量', href: '/admin/quality', icon: Activity, permission: ADMIN_PERMISSIONS.dashboardRead },
  { label: '用量', href: '/admin/usage', icon: Activity, permission: ADMIN_PERMISSIONS.dashboardRead },
  { label: '健康', href: '/admin/health', icon: HeartPulse, permission: ADMIN_PERMISSIONS.dashboardRead },
  { label: '支付', href: '/admin/billing', icon: CreditCard, permission: ADMIN_PERMISSIONS.billingRead },
  { label: '设置', href: '/admin/settings', icon: Settings, permission: ADMIN_PERMISSIONS.configWrite },
  { label: '管理员', href: '/admin/accounts', icon: ShieldCheck, permission: ADMIN_PERMISSIONS.rolesWrite },
];

const TAB_ROUTES: Record<string, string> = {
  jobs: '/admin/jobs',
  'job-submissions': '/admin/jobs/review',
  'prefill-quality': '/admin/quality',
  'ai-usage': '/admin/usage',
  'service-health': '/admin/health',
  configs: '/admin/settings',
  logos: '/admin/settings',
  audit: '/admin/audit',
  analytics: '/admin',
  overview: '/admin',
  resumes: '/admin/students',
  applications: '/admin/students',
};

export function canonicalAdminPath(pathname: string, searchParams?: URLSearchParams): string {
  if (pathname === '/admin/dna-review') return '/admin/dna';
  if (pathname === '/admin/job-sync-dashboard' || pathname === '/admin/job-rotation') return '/admin/jobs/sync';
  if (pathname === '/admin/credits') return '/admin/settings';
  if (pathname === '/admin') {
    const tab = searchParams?.get('tab');
    if (tab && TAB_ROUTES[tab]) return TAB_ROUTES[tab];
    return '/admin';
  }
  return pathname;
}

export function isAdminNavActive(pathname: string, searchParams: URLSearchParams, href: string): boolean {
  const current = canonicalAdminPath(pathname, searchParams);
  if (href === '/admin') return current === '/admin';
  if (href === '/admin/jobs') {
    return current === '/admin/jobs' || current.startsWith('/admin/jobs/review');
  }
  return current === href || current.startsWith(`${href}/`);
}
