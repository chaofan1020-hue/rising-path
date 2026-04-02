import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { S3Storage, LLMClient, Config } from 'coze-coding-dev-sdk';

const storage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
  accessKey: '',
  secretKey: '',
  bucketName: process.env.COZE_BUCKET_NAME,
  region: 'cn-beijing',
});

// 解析简历内容的函数
async function parseResumeContent(content: string): Promise<{
  parsed_content: string;
  user_info: {
    name?: string;
    email?: string;
    phone?: string;
    education?: string[];
    experience?: string[];
    skills?: string[];
  };
}> {
  try {
    const llmClient = new LLMClient(new Config());
    
    const prompt = `请分析以下简历内容，提取关键信息并以JSON格式返回。

简历内容：
${content}

请提取以下信息并返回JSON格式：
{
  "name": "姓名",
  "email": "邮箱地址",
  "phone": "电话号码",
  "education": ["教育经历1", "教育经历2"],
  "experience": ["工作经历1", "工作经历2"],
  "skills": ["技能1", "技能2", "技能3"]
}

只返回JSON，不要其他说明文字。如果某项信息不存在，返回null或空数组。`;

    const response = await llmClient.invoke([
      { role: 'system', content: '你是一个专业的简历解析助手，擅长从简历中提取结构化信息。' },
      { role: 'user', content: prompt },
    ], { temperature: 0.3 });

    let userInfo = {
      name: undefined as string | undefined,
      email: undefined as string | undefined,
      phone: undefined as string | undefined,
      education: [] as string[],
      experience: [] as string[],
      skills: [] as string[],
    };

    try {
      // 尝试解析JSON
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        userInfo = {
          name: parsed.name || undefined,
          email: parsed.email || undefined,
          phone: parsed.phone || undefined,
          education: parsed.education || [],
          experience: parsed.experience || [],
          skills: parsed.skills || [],
        };
      }
    } catch (e) {
      console.error('Failed to parse LLM response:', e);
    }

    return {
      parsed_content: content,
      user_info: userInfo,
    };
  } catch (error) {
    console.error('Parse resume error:', error);
    return {
      parsed_content: content,
      user_info: {},
    };
  }
}

export async function GET() {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('resumes')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`查询简历失败: ${error.message}`);
    }

    return NextResponse.json({ resumes: data });
  } catch (error) {
    console.error('Error fetching resumes:', error);
    return NextResponse.json(
      { error: '获取简历列表失败' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: '未提供文件' }, { status: 400 });
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to S3
    const fileKey = await storage.uploadFile({
      fileContent: buffer,
      fileName: `resumes/${Date.now()}_${file.name}`,
      contentType: file.type,
    });

    // Create initial resume record
    const { data: resumeData, error: insertError } = await client
      .from('resumes')
      .insert({
        file_key: fileKey,
        file_name: file.name,
        parsed_content: '正在解析简历内容...',
        user_info: {},
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`创建简历记录失败: ${insertError.message}`);
    }

    // 异步解析简历（不阻塞响应）
    parseResumeInBackground(resumeData.id, buffer, file.type, file.name);

    return NextResponse.json({ resume: resumeData });
  } catch (error) {
    console.error('Error uploading resume:', error);
    return NextResponse.json(
      { error: '上传简历失败' },
      { status: 500 }
    );
  }
}

// 后台解析简历
async function parseResumeInBackground(
  resumeId: number,
  buffer: Buffer,
  contentType: string,
  fileName: string
) {
  try {
    const client = getSupabaseClient();
    
    // 提取文本内容
    let textContent = '';
    
    if (contentType === 'text/plain' || fileName.endsWith('.txt')) {
      // 直接读取文本文件
      textContent = buffer.toString('utf-8');
    } else if (contentType === 'application/pdf' || fileName.endsWith('.pdf')) {
      // PDF文件 - 简化处理，提示需要文本格式
      textContent = `[PDF文件: ${fileName}]\n\n提示：系统暂不支持PDF自动解析，请上传TXT格式的简历文本，或手动输入简历信息。`;
    } else if (
      contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      fileName.endsWith('.docx')
    ) {
      // Word文档
      textContent = `[Word文档: ${fileName}]\n\n提示：系统暂不支持Word自动解析，请上传TXT格式的简历文本。`;
    } else {
      // 尝试作为文本读取
      textContent = buffer.toString('utf-8');
    }

    // 使用LLM解析简历
    const parsed = await parseResumeContent(textContent);

    // 更新数据库
    const { error: updateError } = await client
      .from('resumes')
      .update({
        parsed_content: parsed.parsed_content,
        user_info: parsed.user_info,
        updated_at: new Date().toISOString(),
      })
      .eq('id', resumeId);

    if (updateError) {
      console.error('Failed to update parsed resume:', updateError);
    }
  } catch (error) {
    console.error('Background parsing error:', error);
  }
}
