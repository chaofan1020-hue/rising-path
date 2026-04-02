import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { S3Storage, LLMClient, Config } from 'coze-coding-dev-sdk';
import PDFParser from 'pdf2json';
import mammoth from 'mammoth';

const storage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
  accessKey: '',
  secretKey: '',
  bucketName: process.env.COZE_BUCKET_NAME,
  region: 'cn-beijing',
});

// 从PDF提取文本（带错误处理）
async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const pdfParser = new (PDFParser as any)(null, 1);
    
    pdfParser.on('pdfParser_dataError', (errData: any) => {
      console.error('PDF extraction error:', errData.parserError);
      reject(new Error('PDF解析失败'));
    });
    
    pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
      const text: string[] = [];
      for (const page of pdfData.Pages || []) {
        for (const textItem of page.Texts || []) {
          try {
            const rawText = textItem.R?.[0]?.T || '';
            if (rawText) {
              let decodedText: string;
              try {
                decodedText = decodeURIComponent(rawText);
              } catch {
                decodedText = rawText;
              }
              text.push(decodedText);
            }
          } catch (e) {
            console.error('Failed to decode text item:', e);
          }
        }
        text.push('\n');
      }
      resolve(text.join(' '));
    });
    
    pdfParser.parseBuffer(buffer);
  });
}

async function extractTextFromWord(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error) {
    console.error('Word extraction error:', error);
    throw new Error('Word文档解析失败');
  }
}

async function parseResumeContent(content: string) {
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
    console.error('LLM parsing error:', error);
    return {
      parsed_content: content,
      user_info: {},
    };
  }
}

// POST /api/resume/reparse - 重新解析简历
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { resumeId, accessCodeId } = await request.json();

    if (!accessCodeId) {
      return NextResponse.json({ error: '未授权的访问' }, { status: 401 });
    }

    // 获取简历信息
    const { data: resume, error: fetchError } = await client
      .from('resumes')
      .select('*')
      .eq('id', resumeId)
      .eq('access_code_id', accessCodeId)
      .single();

    if (fetchError || !resume) {
      return NextResponse.json({ error: '简历不存在或无权访问' }, { status: 404 });
    }

    // 从 S3 下载文件
    console.log('Downloading file from S3:', resume.file_key);
    const fileBuffer = await storage.readFile({ fileKey: resume.file_key });

    // 更新状态为解析中
    await client
      .from('resumes')
      .update({ parsed_content: '正在解析简历内容...' })
      .eq('id', resumeId);

    // 提取文本
    let textContent = '';
    const fileName = resume.file_name;
    const contentType = fileName.endsWith('.pdf') ? 'application/pdf' : 
                        fileName.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
                        'text/plain';

    if (contentType === 'application/pdf') {
      console.log('Parsing PDF file:', fileName);
      textContent = await extractTextFromPDF(fileBuffer);
    } else if (contentType.includes('word')) {
      console.log('Parsing Word file:', fileName);
      textContent = await extractTextFromWord(fileBuffer);
    } else {
      textContent = fileBuffer.toString('utf-8');
    }

    console.log('Extracted text length:', textContent.length);

    // 解析简历
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
      throw new Error(`更新简历失败: ${updateError.message}`);
    }

    console.log('Resume re-parsed successfully:', resumeId);
    return NextResponse.json({ success: true, resume: { ...resume, ...parsed } });
  } catch (error) {
    console.error('Re-parse error:', error);
    return NextResponse.json(
      { error: '重新解析失败' },
      { status: 500 }
    );
  }
}
