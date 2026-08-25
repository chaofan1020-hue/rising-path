import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';
import { adminMigrationUnavailable } from '@/lib/admin-dependency-status';

function validUserId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
}

function buildAlerts(
  accounts: Array<{ user_id: string; balance: number | string; lifetime_spent: number | string }>,
  reservations: Array<{ user_id: string; status: string; expires_at: string; credits: number | string }>,
  ledger: Array<{ user_id: string; entry_type: string; delta: number | string; created_at: string }>,
) {
  const spent24h = new Map<string, number>();
  for (const entry of ledger) {
    if (entry.entry_type !== 'reserve') continue;
    const amount = Number(entry.delta || 0);
    spent24h.set(entry.user_id, (spent24h.get(entry.user_id) || 0) + Math.abs(amount));
  }
  const alerts: Array<{ userId: string; type: string; severity: 'warning' | 'critical'; value: number; message: string }> = [];
  for (const account of accounts) {
    const amount = spent24h.get(account.user_id) || 0;
    if (amount >= 200) alerts.push({ userId: account.user_id, type: 'high_spend', severity: 'critical', value: amount, message: '过去 24 小时积分消耗超过 200 分' });
    else if (amount >= 100) alerts.push({ userId: account.user_id, type: 'high_spend', severity: 'warning', value: amount, message: '过去 24 小时积分消耗超过 100 分' });
  }
  for (const reservation of reservations) {
    if (reservation.status === 'reserved' && Date.parse(reservation.expires_at) <= Date.now()) {
      alerts.push({ userId: reservation.user_id, type: 'stale_reservation', severity: 'warning', value: Number(reservation.credits || 0), message: '存在已过期但未结算的积分预留' });
    }
  }
  return alerts.sort((a, b) => (b.severity === 'critical' ? 1 : 0) - (a.severity === 'critical' ? 1 : 0) || b.value - a.value).slice(0, 100);
}

function buildCreditTrend(ledger: Array<{ metric: string | null; entry_type: string; delta: number | string; created_at: string }>) {
  const points = new Map<string, { date: string; interview_turn: number; asr_minutes: number; tts_minutes: number; other: number; credits: number }>();
  for (const entry of ledger) {
    if (entry.entry_type !== 'reserve') continue;
    const day = entry.created_at.slice(0, 10);
    const point = points.get(day) || { date: day, interview_turn: 0, asr_minutes: 0, tts_minutes: 0, other: 0, credits: 0 };
    const amount = Math.abs(Number(entry.delta || 0));
    point.credits += amount;
    if (entry.metric === 'interview_turn') point.interview_turn += amount;
    else if (entry.metric === 'asr_minutes') point.asr_minutes += amount;
    else if (entry.metric === 'tts_minutes') point.tts_minutes += amount;
    else point.other += amount;
    points.set(day, point);
  }
  return Array.from(points.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.usersRead);
  if (permissionError) return permissionError;
  const client = getSupabaseClient();
  const userId = request.nextUrl.searchParams.get('userId')?.trim() || null;
  if (userId && !validUserId(userId)) return NextResponse.json({ data: null, error: { code: 'INVALID_USER_ID', message: '用户 ID 无效' } }, { status: 400 });
  if (userId) {
    const [{ data: account, error: accountError }, { data: ledger, error: ledgerError }, { data: reservations, error: reservationError }] = await Promise.all([
      client.from('credit_accounts').select('user_id,balance,lifetime_granted,lifetime_spent,version,updated_at').eq('user_id', userId).maybeSingle(),
      client.from('credit_ledger').select('id,entry_type,delta,balance_after,metric,reason,metadata,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(100),
      client.from('credit_reservations').select('id,metric,units,credits,status,idempotency_key,expires_at,created_at,settled_at,metadata').eq('user_id', userId).order('created_at', { ascending: false }).limit(100),
    ]);
    if (accountError || ledgerError || reservationError) return NextResponse.json({ data: null, error: { code: 'ADMIN_CREDIT_DETAIL_FAILED', message: '读取用户积分详情失败' } }, { status: 500 });
    return NextResponse.json({ data: { account, ledger: ledger || [], reservations: reservations || [] }, error: null });
  }
  const [{ data: accounts, error: accountError }, { data: prices, error: priceError }, { data: enforcementSetting, error: settingError }] = await Promise.all([
    client.from('credit_accounts').select('user_id,balance,lifetime_granted,lifetime_spent,updated_at').order('updated_at', { ascending: false }).limit(500),
    client.from('credit_price_rules').select('metric,display_name,unit_name,credit_cost,enabled,max_units_per_request,notes').order('id'),
    client.from('platform_settings').select('setting_value,updated_at').eq('setting_key', 'credits_enforced').maybeSingle(),
  ]);
  if (accountError || priceError || settingError) return NextResponse.json({ data: null, error: { code: 'ADMIN_CREDIT_QUERY_FAILED', message: '读取积分管理数据失败' } }, { status: 500 });
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const trendSince = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: reservations, error: reservationError }, { data: ledger, error: ledgerError }, { data: trendLedger, error: trendError }] = await Promise.all([
    client.from('credit_reservations').select('user_id,status,expires_at,credits').gte('created_at', since).limit(5000),
    client.from('credit_ledger').select('user_id,entry_type,delta,created_at').gte('created_at', since).limit(5000),
    client.from('credit_ledger').select('metric,entry_type,delta,created_at').gte('created_at', trendSince).order('created_at', { ascending: true }).limit(20000),
  ]);
  if (reservationError || ledgerError || trendError) return NextResponse.json({ data: null, error: { code: 'ADMIN_CREDIT_ALERT_QUERY_FAILED', message: '读取积分告警失败' } }, { status: 500 });
  const normalizedAccounts = (accounts || []).map((account) => ({ ...account, balance: Number(account.balance || 0), lifetime_granted: Number(account.lifetime_granted || 0), lifetime_spent: Number(account.lifetime_spent || 0) }));
  const alerts = buildAlerts(normalizedAccounts, reservations || [], ledger || []);
  return NextResponse.json({
    data: {
      accounts: normalizedAccounts,
      prices: prices || [],
      enforcement: {
        enabled: Boolean(enforcementSetting?.setting_value && typeof enforcementSetting.setting_value === 'object' && !Array.isArray(enforcementSetting.setting_value) && enforcementSetting.setting_value.enabled === true),
        updatedAt: enforcementSetting?.updated_at || null,
      },
      trend: buildCreditTrend(trendLedger || []),
      summary: {
        accountCount: normalizedAccounts.length,
        totalBalance: normalizedAccounts.reduce((sum, account) => sum + account.balance, 0),
        totalGranted: normalizedAccounts.reduce((sum, account) => sum + account.lifetime_granted, 0),
        totalSpent: normalizedAccounts.reduce((sum, account) => sum + account.lifetime_spent, 0),
        spent24h: (ledger || []).filter((entry) => entry.entry_type === 'reserve').reduce((sum, entry) => sum + Math.abs(Number(entry.delta || 0)), 0),
        alerts,
      },
    },
    error: null,
  });
}

export async function POST(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.configWrite);
  if (permissionError) return permissionError;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.action === 'release_reservation') {
      const reservationId = Number(body.reservationId);
      if (!Number.isInteger(reservationId) || reservationId <= 0) {
        return NextResponse.json({ data: null, error: { code: 'INVALID_RESERVATION_ID', message: '预留 ID 无效' } }, { status: 400 });
      }
      const { data, error } = await getSupabaseClient().rpc('settle_credits', { p_reservation_id: reservationId, p_status: 'released' });
      if (error) throw new Error(error.message);
      await recordAdminAuditEvent({ request, action: 'credits.reservation.release', resourceType: 'credit_reservation', resourceId: reservationId, metadata: { result: data } });
      return NextResponse.json({ data: { released: Boolean(data) }, error: null });
    }
    if (!validUserId(body.userId)) return NextResponse.json({ data: null, error: { code: 'INVALID_USER_ID', message: '用户 ID 无效' } }, { status: 400 });
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1_000_000) {
      return NextResponse.json({ data: null, error: { code: 'INVALID_CREDIT_AMOUNT', message: '积分数量无效' } }, { status: 400 });
    }
    const entryType = body.entryType === 'adjustment' ? 'adjustment' : 'grant';
    if (amount < 0 && entryType !== 'adjustment') {
      return NextResponse.json({ data: null, error: { code: 'NEGATIVE_GRANT_NOT_ALLOWED', message: '扣减积分必须使用调整类型' } }, { status: 400 });
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : null;
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim().slice(0, 120) : null;
    const { data, error } = await getSupabaseClient().rpc('grant_credits', {
      p_user_id: body.userId,
      p_amount: amount,
      p_entry_type: entryType,
      p_idempotency_key: idempotencyKey,
      p_reason: reason,
      p_metadata: { source: 'admin_console' },
    });
    if (error) throw new Error(error.message);
    const result = Array.isArray(data) ? data[0] : data;
    await recordAdminAuditEvent({ request, action: 'credits.adjust', resourceType: 'credit_account', subjectUserId: body.userId, metadata: { amount, entryType, reason } });
    return NextResponse.json({ data: result || null, error: null }, { status: 201 });
  } catch (error) {
    await recordAdminAuditFailure({ request, action: 'credits.adjust', resourceType: 'credit_account', error });
    const migrationResponse = adminMigrationUnavailable(error, ['0064_unified_credits.sql', '0065_fix_grant_credits_ambiguity.sql'], '积分账本依赖数据库迁移，当前环境尚未部署');
    if (migrationResponse) return migrationResponse;
    console.error('[Admin Credits] adjustment failed:', error);
    return NextResponse.json({ data: null, error: { code: 'ADMIN_CREDIT_UPDATE_FAILED', message: '调整积分失败' } }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.configWrite);
  if (permissionError) return permissionError;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.action === 'set_enforcement') {
      if (typeof body.enabled !== 'boolean') {
        return NextResponse.json({ data: null, error: { code: 'INVALID_CREDIT_ENFORCEMENT', message: '积分开关参数无效' } }, { status: 400 });
      }
      const client = getSupabaseClient();
      const { data: before } = await client
        .from('platform_settings')
        .select('setting_value,updated_at')
        .eq('setting_key', 'credits_enforced')
        .maybeSingle();
      const settingValue = { enabled: body.enabled };
      const { data, error } = await client
        .from('platform_settings')
        .upsert({ setting_key: 'credits_enforced', setting_value: settingValue, updated_at: new Date().toISOString(), updated_by: 'admin_session' }, { onConflict: 'setting_key' })
        .select('setting_value,updated_at')
        .single();
      if (error) throw new Error(error.message);
      await recordAdminAuditEvent({
        request,
        action: 'credits.enforcement.update',
        resourceType: 'platform_setting',
        resourceId: 'credits_enforced',
        beforeData: before || null,
        afterData: data,
      });
      return NextResponse.json({ data: { enabled: body.enabled, updatedAt: data.updated_at }, error: null });
    }
    const metric = typeof body.metric === 'string' ? body.metric.trim() : '';
    const creditCost = Number(body.creditCost);
    if (!metric || !Number.isFinite(creditCost) || creditCost <= 0) {
      return NextResponse.json({ data: null, error: { code: 'INVALID_PRICE_RULE', message: '积分价格无效' } }, { status: 400 });
    }
    const update = {
      credit_cost: creditCost,
      enabled: body.enabled !== false,
      max_units_per_request: body.maxUnitsPerRequest === null || body.maxUnitsPerRequest === undefined ? null : Number(body.maxUnitsPerRequest),
      notes: typeof body.notes === 'string' ? body.notes.trim().slice(0, 300) : null,
      updated_at: new Date().toISOString(),
    };
    if (update.max_units_per_request !== null && (!Number.isFinite(update.max_units_per_request) || update.max_units_per_request <= 0)) {
      return NextResponse.json({ data: null, error: { code: 'INVALID_REQUEST_LIMIT', message: '单次上限无效' } }, { status: 400 });
    }
    const { data, error } = await getSupabaseClient().from('credit_price_rules').update(update).eq('metric', metric).select().single();
    if (error) throw new Error(error.message);
    await recordAdminAuditEvent({ request, action: 'credits.price_rule.update', resourceType: 'credit_price_rule', metadata: { metric, update } });
    return NextResponse.json({ data, error: null });
  } catch (error) {
    await recordAdminAuditFailure({ request, action: 'credits.price_rule.update', resourceType: 'credit_price_rule', error });
    return NextResponse.json({ data: null, error: { code: 'ADMIN_PRICE_RULE_UPDATE_FAILED', message: '更新积分价格失败' } }, { status: 500 });
  }
}
