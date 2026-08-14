import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { createTextProviderClient } from '@/lib/ai/text-provider';
import {
  OPTIMIZATION_SCORE_RESPONSE_SCHEMA,
  parseOptimizationScoreComparison,
} from '@/lib/optimization-score-contract';

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();

    const body = await request.json();
    const optimizationId = positiveInteger(body?.optimizationId);
    if (optimizationId === null) {
      return NextResponse.json({ error: '优化版本 ID 无效' }, { status: 400 });
    }

    const { data: optimization, error: optimizationError } = await auth.client
      .from('resume_optimizations')
      .select('id, resume_id, job_id, resume_profile_version, original_content, optimized_content, reviewed_content, target_company, target_position, target_region')
      .eq('id', optimizationId)
      .eq('user_id', auth.user.id)
      .single();
    if (optimizationError || !optimization) {
      return NextResponse.json({ error: '优化版本不存在或无权访问' }, { status: 404 });
    }
    let jobContent: string;
    if (optimization.job_id) {
      const { data: job, error: jobError } = await auth.client
        .from('jobs')
        .select('id, title, company, region, description, requirements')
        .eq('id', optimization.job_id)
        .maybeSingle();
      if (jobError) throw new Error(`查询评分岗位失败: ${jobError.message}`);
      if (!job) return NextResponse.json({ error: '目标岗位不存在' }, { status: 404 });
      jobContent = JSON.stringify({
        title: job.title,
        company: job.company,
        region: job.region,
        description: job.description,
        requirements: job.requirements,
      }, null, 2);
    } else {
      jobContent = JSON.stringify({
        title: optimization.target_position,
        company: optimization.target_company,
        region: optimization.target_region,
      }, null, 2);
    }

    const client = createTextProviderClient({ requestHeaders: request.headers });
    const prompt = `请用完全相同的评分标准，对比同一候选人的原始简历和优化后简历与目标岗位的匹配度。

目标岗位：
${jobContent}

原始简历：
${optimization.original_content}

优化后简历：
${JSON.stringify(optimization.reviewed_content || optimization.optimized_content, null, 2)}

规则：
1. 只根据简历中真实存在的内容评分，不因为表达更华丽就推断不存在的经历。
2. 原始和优化版本必须使用同一套六个维度和同一岗位要求。
3. 分数必须是 0 到 100 的整数，评分维度为 ats、keywords、experience、evidence、region、profile_fit。
4. summary 解释优化是否带来真实、可验证的提升；如果没有提升也要明确说明。
5. key_changes 只写优化前后实际可见且与岗位相关的变化。
6. 只输出评分结果对象，不要输出 original_resume、optimized_resume 或任何简历原文内容。

只返回 JSON，不要其他说明文字。`;

    const stream = client.stream([
      { role: 'system', content: '你是严格、保守的简历评估专家。必须输出有效 JSON。' },
      { role: 'user', content: prompt },
    ], {
      temperature: 0.2,
      responseFormat: {
        name: 'optimization_score_comparison',
        schema: OPTIMIZATION_SCORE_RESPONSE_SCHEMA,
      },
    });

    let raw = '';
    for await (const chunk of stream) {
      if (chunk.content) raw += chunk.content;
    }

    let comparison;
    try {
      comparison = parseOptimizationScoreComparison(raw);
    } catch (error) {
      console.error('Invalid optimization score comparison raw:', raw);
      console.error('Invalid optimization score comparison:', error);
      return NextResponse.json({ error: 'AI返回的评分对比格式无效，请重试' }, { status: 502 });
    }

    const { data: updated, error: updateError } = await auth.client
      .from('resume_optimizations')
      .update({
        score_comparison: comparison,
        original_score: comparison.original.match_score,
        optimized_score: comparison.optimized.match_score,
        updated_at: new Date().toISOString(),
      })
      .eq('id', optimizationId)
      .eq('user_id', auth.user.id)
      .select('id, job_id, resume_profile_version, score_comparison, original_score, optimized_score, updated_at')
      .single();
    if (updateError || !updated) throw new Error(`保存评分对比失败: ${updateError?.message || '未返回记录'}`);

    return NextResponse.json({
      optimization_id: updated.id,
      job_id: updated.job_id,
      resume_profile_version: updated.resume_profile_version,
      comparison,
    });
  } catch (error) {
    console.error('Optimization score comparison error:', error);
    return NextResponse.json({ error: '计算优化前后评分失败' }, { status: 500 });
  }
}
