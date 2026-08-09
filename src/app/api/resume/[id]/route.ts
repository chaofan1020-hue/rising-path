import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { SegmentationOverrides, deriveMajorMatch } from '@/lib/user-segmentation';
import { resolveRegionKey } from '@/lib/region-dna';

// PATCH /api/resume/[id] —— 用户手动修正分层（分层透明可纠偏）
// body: { overrides: { careerStage?, schoolTier?, majorMatch?, regions? }, targetRole? }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const { id } = await params;
    const body = await request.json();
    const { overrides, targetRole } = body as {
      overrides?: SegmentationOverrides;
      targetRole?: string;
    };

    if (!overrides || typeof overrides !== 'object') {
      return NextResponse.json({ error: '缺少修正内容' }, { status: 400 });
    }

    // 校验枚举合法性
    const validStages = ['junior', 'senior', 'experienced', 'returning_intern'];
    if (overrides.careerStage && !validStages.includes(overrides.careerStage)) {
      return NextResponse.json({ error: '无效的求职阶段' }, { status: 400 });
    }
    if (overrides.schoolTier && ![1, 2, 3].includes(overrides.schoolTier)) {
      return NextResponse.json({ error: '无效的院校层级' }, { status: 400 });
    }
    if (overrides.majorMatch && !['aligned', 'related', 'unrelated'].includes(overrides.majorMatch)) {
      return NextResponse.json({ error: '无效的专业匹配度' }, { status: 400 });
    }
    if (overrides.regions) {
      if (!Array.isArray(overrides.regions) || overrides.regions.some((r) => !resolveRegionKey(r) && !['us', 'uk', 'sg', 'cn_t1', 'cn_t2'].includes(r))) {
        return NextResponse.json({ error: '无效的地区' }, { status: 400 });
      }
      // 归一化地区为 RegionKey
      overrides.regions = overrides.regions
        .map((r) => (['us', 'uk', 'sg', 'cn_t1', 'cn_t2'].includes(r) ? r : resolveRegionKey(r)))
        .filter((r): r is NonNullable<typeof r> => !!r) as SegmentationOverrides['regions'];
    }

    // 校验归属并读取当前分层
    const { data: resume, error: fetchError } = await client
      .from('resumes')
      .select('id, segmentation, profile')
      .eq('id', id)
      .eq('user_id', auth.user.id)
      .single();

    if (fetchError || !resume) {
      return NextResponse.json({ error: '简历不存在或无权访问' }, { status: 404 });
    }

    // 应用覆盖生成生效分层（summary 同步更新）
    const current = resume.segmentation;
    const next = current ? { ...current } : null;
    if (next) {
      if (overrides.careerStage) {
        next.careerStage = overrides.careerStage;
        next.careerStageReason = '用户手动修正';
      }
      if (overrides.schoolTier) next.schoolTier = overrides.schoolTier;
      if (overrides.majorMatch) next.majorMatch = overrides.majorMatch;
      if (overrides.regions && overrides.regions.length > 0) {
        next.regions = overrides.regions;
        next.regionSource = 'intention';
      }
      // 目标岗位变化时重算专业匹配
      if (targetRole && resume.profile?.education?.[0]?.major) {
        const mm = deriveMajorMatch(resume.profile.education[0].major, targetRole);
        if (mm) {
          next.majorMatch = mm.match;
          next.majorMatchNote = mm.note;
        }
      }
      const stageLabel: Record<string, string> = {
        junior: '低年级（实习预备）', senior: '高年级（校招全职）',
        experienced: '社招（在职跳槽）', returning_intern: '实习转正',
      };
      next.summary = `${stageLabel[next.careerStage] || next.careerStage} × Tier${next.schoolTier}院校 × ${(next.regions || []).length}个目标地区${next.experienceQuality?.internshipCount ? ` × ${next.experienceQuality.internshipCount}段实习` : ''}（已确认）`;
    }

    const updatePayload: Record<string, unknown> = {
      segmentation_overrides: overrides,
      segmentation_confirmed: true,
      updated_at: new Date().toISOString(),
    };
    if (next) updatePayload.segmentation = next;

    const { error: updateError } = await client
      .from('resumes')
      .update(updatePayload)
      .eq('id', id)
      .eq('user_id', auth.user.id);

    if (updateError) {
      throw new Error(`更新分层失败: ${updateError.message}`);
    }

    return NextResponse.json({ success: true, segmentation: next });
  } catch (error) {
    console.error('Error updating segmentation:', error);
    return NextResponse.json({ error: '更新分层失败' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const { id } = await params;

    // 先删除关联的 ai_matches 记录
    const { error: matchError } = await client
      .from('ai_matches')
      .delete()
      .eq('resume_id', id)
      .eq('user_id', auth.user.id);

    if (matchError) {
      console.error('Error deleting ai_matches:', matchError);
    }

    // 删除关联的 applications 记录
    const { error: appError } = await client
      .from('applications')
      .delete()
      .eq('resume_id', id)
      .eq('user_id', auth.user.id);

    if (appError) {
      console.error('Error deleting applications:', appError);
    }

    // 最后删除简历本身
    const { error } = await client
      .from('resumes')
      .delete()
      .eq('id', id)
      .eq('user_id', auth.user.id);

    if (error) {
      throw new Error(`删除简历失败: ${error.message}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting resume:', error);
    return NextResponse.json(
      { error: '删除简历失败' },
      { status: 500 }
    );
  }
}
