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

// 生成简洁岗位描述的 prompt
function buildPrompt(job: Job): string {
  return `Write a concise job description (150-200 words max) for:

Position: ${job.title}
Company: ${job.company}

Format:
**About** (1-2 sentences)
**What you'll do** (3 bullet points, max 10 words each)
**Requirements** (4 bullet points, max 10 words each)
**Nice to have** (2 bullet points, max 10 words each)

Keep it scannable and specific. No fluff.`;
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
    
    // 获取所有岗位
    const { data: allJobs, error } = await supabase
      .from("jobs")
      .select("id, title, company, description")
      .order("id");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`Found ${allJobs?.length || 0} jobs to update`);

    let successCount = 0;
    let failCount = 0;

    for (const job of allJobs || []) {
      console.log(`Processing: ${job.title} @ ${job.company}`);
      
      const newDescription = await updateJobDescription(job);
      
      if (newDescription) {
        const fullDescription = `${job.title}\n${job.company}\n\n${newDescription}`;

        const { error: updateError } = await supabase
          .from("jobs")
          .update({ description: fullDescription })
          .eq("id", job.id);

        if (updateError) {
          console.error(`Failed to update job ${job.id}:`, updateError);
          failCount++;
        } else {
          successCount++;
        }
      } else {
        failCount++;
      }

      await new Promise(resolve => setTimeout(resolve, 300));
    }

    return NextResponse.json({
      message: "Done",
      success: successCount,
      failed: failCount,
      total: allJobs?.length || 0
    });

  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

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

    return NextResponse.json({
      total: jobs?.length || 0,
      avgLength: jobs ? Math.round(jobs.reduce((sum, j) => sum + j.description.length, 0) / jobs.length) : 0
    });

  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
