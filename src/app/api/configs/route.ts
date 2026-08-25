import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { hasValidAdminSession } from '@/lib/admin-auth';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';

const RESERVED_CONFIG_TYPE = 'admin_password_hash';
const PUBLIC_CONFIG_TYPES = ['region', 'direction', 'audience', 'job_type'] as const;

function fallbackConfigs(configType: 'region' | 'direction', values: string[], idOffset: number) {
  return values.map((config_value, index) => ({
    id: -(idOffset + index + 1),
    config_type: configType,
    config_value,
    sort_order: index + 1,
    is_active: true,
  }));
}

const FALLBACK_REGION_CONFIGS = fallbackConfigs('region', [
  '北美',
  '美国',
  '加拿大',
  '英国',
  '澳大利亚',
  '香港',
  '新加坡',
], 0);

const FALLBACK_DIRECTION_CONFIGS = fallbackConfigs('direction', [
  'SDE',
  'ML/AI',
  'Data',
  'PM',
  'Quant',
  'Finance',
  'IBD/S&T',
  'Consulting',
  'Risk',
  'MKT',
  'Legal',
], 100);

// 获取所有配置
export async function GET(request: NextRequest) {
  try {
    const isAdmin = hasValidAdminSession(request);
    const client = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    const configType = searchParams.get('type');

    let query = client
      .from('job_configs')
      .select('id, config_type, config_value, sort_order, is_active')
      .eq('is_active', true)
      .neq('config_type', RESERVED_CONFIG_TYPE)
      .order('sort_order', { ascending: true });

    if (!isAdmin && configType && !PUBLIC_CONFIG_TYPES.includes(configType as typeof PUBLIC_CONFIG_TYPES[number])) {
      return NextResponse.json({ error: '无权读取该配置类型' }, { status: 403 });
    }
    if (!isAdmin) {
      query = query.in('config_type', [...PUBLIC_CONFIG_TYPES]);
    }
    if (configType) query = query.eq('config_type', configType);

    const { data, error } = await query;

    if (error) {
      throw new Error(`查询配置失败: ${error.message}`);
    }

    // 按类型分组返回
    const grouped = (data || []).reduce((acc, item) => {
      if (!acc[item.config_type]) {
        acc[item.config_type] = [];
      }
      acc[item.config_type].push(item);
      return acc;
    }, {} as Record<string, typeof data>);

    // A fresh database often has jobs before an administrator has populated
    // job_configs. The user-facing job filters must remain usable in that
    // state, so provide stable market labels and actual directions from jobs.
    if (!isAdmin && !configType && !(grouped.region?.length)) {
      grouped.region = FALLBACK_REGION_CONFIGS;
    }
    if (!isAdmin && !configType && !(grouped.direction?.length)) {
      grouped.direction = FALLBACK_DIRECTION_CONFIGS;
    }

    return NextResponse.json({ configs: grouped, list: Object.values(grouped).flat() });
  } catch (error) {
    console.error('Error fetching configs:', error);
    return NextResponse.json(
      { error: '获取配置失败' },
      { status: 500 }
    );
  }
}

// 添加配置
export async function POST(request: NextRequest) {
  try {
    const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.configWrite);
    if (permissionError) return permissionError;

    const client = getSupabaseClient();
    const body = await request.json();
    const { config_type, config_value, sort_order } = body;

    if (!config_type || !config_value) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }
    if (config_type === RESERVED_CONFIG_TYPE) {
      return NextResponse.json({ error: '该配置类型由专用接口管理' }, { status: 400 });
    }

    // 获取当前最大排序值
    const { data: existing } = await client
      .from('job_configs')
      .select('sort_order')
      .eq('config_type', config_type)
      .order('sort_order', { ascending: false })
      .limit(1);

    const nextOrder = sort_order ?? (existing?.[0]?.sort_order ?? 0) + 1;

    const { data, error } = await client
      .from('job_configs')
      .insert({
        config_type,
        config_value,
        sort_order: nextOrder,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`添加配置失败: ${error.message}`);
    }

    await recordAdminAuditEvent({
      request,
      action: 'config.create',
      resourceType: 'job_config',
      resourceId: data.id,
      afterData: data,
    });

    return NextResponse.json({ config: data });
  } catch (error) {
    console.error('Error creating config:', error);
    await recordAdminAuditFailure({ request, action: 'config.create', resourceType: 'job_config', error });
    return NextResponse.json(
      { error: '添加配置失败' },
      { status: 500 }
    );
  }
}

// 更新配置
export async function PUT(request: NextRequest) {
  try {
    const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.configWrite);
    if (permissionError) return permissionError;

    const client = getSupabaseClient();
    const body = await request.json();
    const { id, config_value, sort_order, is_active } = body;

    if (!id) {
      return NextResponse.json(
        { error: '缺少配置ID' },
        { status: 400 }
      );
    }

    const { data: existingConfig, error: existingError } = await client
      .from('job_configs')
      .select('*')
      .eq('id', id)
      .single();
    if (existingError) {
      return NextResponse.json({ error: '配置不存在' }, { status: 404 });
    }
    if (existingConfig.config_type === RESERVED_CONFIG_TYPE) {
      return NextResponse.json({ error: '该配置类型由专用接口管理' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};
    if (config_value !== undefined) updateData.config_value = config_value;
    if (sort_order !== undefined) updateData.sort_order = sort_order;
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data, error } = await client
      .from('job_configs')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`更新配置失败: ${error.message}`);
    }

    await recordAdminAuditEvent({
      request,
      action: 'config.update',
      resourceType: 'job_config',
      resourceId: id,
      beforeData: existingConfig,
      afterData: data,
    });

    return NextResponse.json({ config: data });
  } catch (error) {
    console.error('Error updating config:', error);
    await recordAdminAuditFailure({ request, action: 'config.update', resourceType: 'job_config', error });
    return NextResponse.json(
      { error: '更新配置失败' },
      { status: 500 }
    );
  }
}

// 删除配置
export async function DELETE(request: NextRequest) {
  try {
    const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.configWrite);
    if (permissionError) return permissionError;

    const client = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: '缺少配置ID' },
        { status: 400 }
      );
    }

    const { data: existingConfig, error: existingError } = await client
      .from('job_configs')
      .select('*')
      .eq('id', id)
      .single();
    if (existingError) {
      return NextResponse.json({ error: '配置不存在' }, { status: 404 });
    }
    if (existingConfig.config_type === RESERVED_CONFIG_TYPE) {
      return NextResponse.json({ error: '该配置类型由专用接口管理' }, { status: 400 });
    }

    const { error } = await client
      .from('job_configs')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`删除配置失败: ${error.message}`);
    }

    await recordAdminAuditEvent({
      request,
      action: 'config.delete',
      resourceType: 'job_config',
      resourceId: id,
      beforeData: existingConfig,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting config:', error);
    await recordAdminAuditFailure({ request, action: 'config.delete', resourceType: 'job_config', error });
    return NextResponse.json(
      { error: '删除配置失败' },
      { status: 500 }
    );
  }
}
