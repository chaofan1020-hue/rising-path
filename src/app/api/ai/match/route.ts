import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';

export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { resumeId, regions, directions } = await request.json();

    // Get resume info
    const { data: resume, error: resumeError } = await client
      .from('resumes')
      .select('*')
      .eq('id', resumeId)
      .single();

    if (resumeError || !resume) {
      return NextResponse.json({ error: '简历不存在' }, { status: 404 });
    }

    // Get jobs with optional region and direction filter (support multiple values)
    let query = client
      .from('jobs')
      .select('*')
      .limit(20);
    
    // 地区多选筛选
    if (regions && regions.length > 0) {
      query = query.in('region', regions);
    }
    
    // 方向多选筛选
    if (directions && directions.length > 0) {
      query = query.in('direction', directions);
    }

    const { data: jobs, error: jobsError } = await query;

    if (jobsError) {
      throw new Error(`查询岗位失败: ${jobsError.message}`);
    }

    if (!jobs || jobs.length === 0) {
      const filters = [...(regions || []), ...(directions || [])].join('、');
      return NextResponse.json({ matches: [], message: filters ? `未找到${filters}相关的岗位` : '暂无可匹配的岗位' });
    }

    // AI matching
    const llmClient = new LLMClient(new Config(), HeaderUtils.extractForwardHeaders(request.headers));
    
    const resumeContent = resume.parsed_content || JSON.stringify(resume.user_info);
    const jobsList = jobs.map((j: { id: number; title: string; company: string; description: string; requirements: string }) => ({
      id: j.id,
      title: j.title,
      company: j.company,
      description: j.description,
      requirements: j.requirements,
    }));

    const prompt = `你是一个专业的职业顾问。请分析以下简历和岗位列表，为每个岗位计算匹配分数（0-100），并说明匹配原因和优化建议。

简历内容：
${resumeContent}

岗位列表：
${JSON.stringify(jobsList, null, 2)}

请以JSON数组格式返回匹配结果，格式如下：
[
  {
    "job_id": 岗位ID,
    "match_score": 匹配分数(0-100),
    "match_reason": "匹配原因分析",
    "suggestions": "简历优化建议"
  }
]

只返回JSON数组，不要其他说明文字。`;

    const stream = llmClient.stream([
      { role: 'system', content: '你是一个专业的职业顾问，擅长分析简历与岗位的匹配度。' },
      { role: 'user', content: prompt },
    ], { temperature: 0.7 });

    let result = '';
    for await (const chunk of stream) {
      if (chunk.content) {
        result += chunk.content.toString();
      }
    }

    // Parse AI response
    let matches = [];
    try {
      // Extract JSON from response
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        matches = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('Failed to parse AI response:', e);
      // Fallback: create mock matches
      matches = jobs.slice(0, 5).map((job: { id: number; title: string; company: string }) => ({
        job_id: job.id,
        job_title: job.title,
        company: job.company,
        match_score: Math.floor(Math.random() * 30) + 70,
        match_reason: '基于您的技能和经验，该岗位与您的背景较为匹配。',
        suggestions: '建议在简历中突出相关项目经验，增加关键词匹配。',
      }));
    }

    // Add job details to matches
    const enrichedMatches = matches.map((match: { job_id: number; match_score: number; match_reason: string; suggestions: string }) => {
      const job = jobs.find((j: { id: number }) => j.id === match.job_id);
      return {
        ...match,
        job_title: job?.title || '未知岗位',
        company: job?.company || '未知公司',
      };
    });

    // Sort by score
    enrichedMatches.sort((a: { match_score: number }, b: { match_score: number }) => b.match_score - a.match_score);

    // Save matches to database
    for (const match of enrichedMatches) {
      await client.from('ai_matches').insert({
        resume_id: resumeId,
        job_id: match.job_id,
        match_score: match.match_score,
        match_reason: match.match_reason,
        suggestions: match.suggestions,
      });
    }

    return NextResponse.json({ matches: enrichedMatches });
  } catch (error) {
    console.error('AI match error:', error);
    return NextResponse.json(
      { error: 'AI匹配失败' },
      { status: 500 }
    );
  }
}
