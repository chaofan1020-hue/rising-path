import { NextRequest, NextResponse } from "next/server";
import { LLMClient, Config } from "coze-coding-dev-sdk";
import { getSupabaseClient } from "@/storage/database/supabase-client";

const config = new Config();
const client = new LLMClient(config);

interface Job {
  id: number;
  title: string;
  company: string;
  description: string;
}

// 生成岗位描述的 prompt 模板
function buildPrompt(job: Job): string {
  return `You are a professional job description writer. Generate a detailed, professional job description for the following position.

Position: ${job.title}
Company: ${job.company}

Requirements:
1. Write in English
2. Include "About the Role", "Key Responsibilities", "Basic Qualifications", "Preferred Qualifications" sections
3. Keep the description realistic and specific to this role type
4. Do not make up specific technologies or requirements that don't exist for this role type
5. Total length should be around 800-1200 words

Write ONLY the job description, no preamble.`;
}

// 更新单个岗位的描述
async function updateJobDescription(job: Job): Promise<string | null> {
  try {
    const prompt = buildPrompt(job);
    
    const response = await client.invoke(
      [{ role: "user", content: prompt }],
      { temperature: 0.7 }
    );

    return response.content;
  } catch (error) {
    console.error(`Failed to generate description for job ${job.id}:`, error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    
    // 获取所有描述较短的岗位
    const { data: allJobs, error } = await supabase
      .from("jobs")
      .select("id, title, company, description")
      .order("id");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 过滤出需要更新的岗位（描述少于200字符或包含搜索摘要关键词）
    const jobs = allJobs?.filter(j => 
      j.description.length < 200 || 
      j.description.includes('Meta提供的薪酬范围') ||
      j.description.includes('职位发布提供的薪酬')
    ) || [];

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({ 
        message: "No jobs need description update",
        count: 0 
      });
    }

    console.log(`Found ${jobs.length} jobs that need description update`);

    let successCount = 0;
    let failCount = 0;

    for (const job of jobs) {
      console.log(`Processing: ${job.title} @ ${job.company}`);
      
      const newDescription = await updateJobDescription(job);
      
      if (newDescription) {
        // 添加原始信息头部
        const fullDescription = `${job.title}
${job.company}

${newDescription}

---
Source: Job posting summary (detailed description generated based on role type)`;

        const { error: updateError } = await supabase
          .from("jobs")
          .update({ description: fullDescription })
          .eq("id", job.id);

        if (updateError) {
          console.error(`Failed to update job ${job.id}:`, updateError);
          failCount++;
        } else {
          successCount++;
          console.log(`Updated job ${job.id}: ${job.title}`);
        }
      } else {
        failCount++;
      }

      // 添加延迟避免 API 限流
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return NextResponse.json({
      message: "Description generation completed",
      success: successCount,
      failed: failCount,
      total: jobs.length
    });

  } catch (error) {
    console.error("Error in generate-descriptions API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET 方法：检查哪些岗位需要更新
export async function GET() {
  try {
    const supabase = getSupabaseClient();
    
    const { data: jobs, error } = await supabase
      .from("jobs")
      .select("id, title, company, description")
      .order("id");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const needsUpdate = jobs?.filter(j => j.description.length < 200) || [];
    const hasDetailedDesc = jobs?.filter(j => j.description.length >= 200) || [];

    return NextResponse.json({
      total: jobs?.length || 0,
      withDetailedDescription: hasDetailedDesc.length,
      needsUpdate: needsUpdate.length,
      jobsNeedingUpdate: needsUpdate.map(j => ({
        id: j.id,
        title: j.title,
        company: j.company,
        descLength: j.description.length
      }))
    });

  } catch (error) {
    console.error("Error checking jobs:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
