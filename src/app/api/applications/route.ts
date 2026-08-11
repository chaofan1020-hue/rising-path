import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { hasValidAdminSession } from '@/lib/admin-auth';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { isApplicationStatus } from '@/lib/application-status';

export async function GET(request: NextRequest) {
  try {
    const isAdmin = hasValidAdminSession(request);
    const auth = isAdmin ? null : await getAuthContext(request);
    if (!isAdmin && !auth) return unauthorizedResponse();
    const client = isAdmin ? getSupabaseClient() : auth!.client;
    
    let query = client.from('applications').select(`
      *,
      jobs (title, company, region, direction),
      resumes (file_name)
    `);
    
    if (auth) query = query.eq('user_id', auth.user.id);
    
    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      throw new Error(`查询网申记录失败: ${error.message}`);
    }

    return NextResponse.json({ applications: data });
  } catch (error) {
    console.error('Error fetching applications:', error);
    return NextResponse.json(
      { error: '获取网申记录失败' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const body = await request.json();
    if (body.status !== undefined && !isApplicationStatus(body.status)) {
      return NextResponse.json({ error: '无效的网申状态' }, { status: 400 });
    }
    const writableFields = ['job_id', 'resume_id', 'status', 'notes', 'submitted_at'] as const;
    const applicationData = Object.fromEntries(
      writableFields
        .filter((field) => body[field] !== undefined)
        .map((field) => [field, body[field]])
    );

    const { data, error } = await client
      .from('applications')
      .insert({
        ...applicationData,
        user_id: auth.user.id,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`创建网申记录失败: ${error.message}`);
    }

    return NextResponse.json({ application: data });
  } catch (error) {
    console.error('Error creating application:', error);
    return NextResponse.json(
      { error: '创建网申记录失败' },
      { status: 500 }
    );
  }
}
