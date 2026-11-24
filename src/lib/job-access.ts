import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { hasValidAdminSession } from '@/lib/admin-auth';

/**
 * 岗位数据属于“登录后权益”。
 *
 * 未登录访客（以及直接打接口的爬虫）不应该能拉到完整岗位列表、详情、公司清单，
 * 否则前端的登录门槛形同虚设：页面被挡住，接口却把 23 万条岗位原样吐出来。
 *
 * 放行条件：
 *   1) 合法用户 Bearer token（前端登录后的正常调用）；
 *   2) 有效管理员 cookie 会话（/admin/jobs 运营后台用普通 fetch 调同一批接口）。
 * 其余一律 401 + `code: AUTH_REQUIRED`，文案走英文，避免英文界面里蹦出中文提示。
 */
export async function requireJobAccess(request: NextRequest | Request): Promise<NextResponse | null> {
  const auth = await getAuthContext(request as NextRequest);
  if (auth) return null;
  if (await hasValidAdminSession(request)) return null;
  return unauthorizedResponse();
}
