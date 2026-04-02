import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { LLMClient, Config } from 'coze-coding-dev-sdk';
import PDFParser from 'pdf2json';
import mammoth from 'mammoth';

// 从PDF提取文本
async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const pdfParser = new (PDFParser as any)(null, 1);
    
    pdfParser.on('pdfParser_dataError', (errData: any) => {
      console.error('PDF extraction error:', errData.parserError);
      reject(new Error('PDF解析失败'));
    });
    
    pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
      // 提取所有页面的文本
      const text: string[] = [];
      for (const page of pdfData.Pages || []) {
        for (const textItem of page.Texts || []) {
          try {
            // 解码URI编码的文本，添加错误处理
            const rawText = textItem.R?.[0]?.T || '';
            if (rawText) {
              // 使用 try-catch 处理可能的 URI 错误
              let decodedText: string;
              try {
                decodedText = decodeURIComponent(rawText);
              } catch {
                // 如果 decodeURIComponent 失败，直接使用原始文本
                decodedText = rawText;
              }
              text.push(decodedText);
            }
          } catch (e) {
            // 跳过有问题的文本项
            console.error('Failed to decode text item:', e);
          }
        }
        text.push('\n'); // 页面之间添加换行
      }
      resolve(text.join(' '));
    });
    
    // 解析Buffer
    pdfParser.parseBuffer(buffer);
  });
}

// 从Word文档提取文本
async function extractTextFromWord(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error) {
    console.error('Word extraction error:', error);
    throw new Error('Word文档解析失败');
  }
}

// 使用LLM解析简历内容
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

export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { searchParams } = new URL(request.url);
    const accessCodeId = searchParams.get('access_code_id');
    
    // 必须提供 access_code_id，否则返回空列表
    if (!accessCodeId) {
      return NextResponse.json({ resumes: [] });
    }
    
    const { data, error } = await client
      .from('resumes')
      .select('*')
      .eq('access_code_id', parseInt(accessCodeId))
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
    const accessCodeId = formData.get('access_code_id') as string;

    if (!file) {
      return NextResponse.json({ error: '未提供文件' }, { status: 400 });
    }

    // 必须提供 access_code_id
    if (!accessCodeId) {
      return NextResponse.json({ error: '未授权的访问' }, { status: 401 });
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Create initial resume record (将文件存储为 base64)
    const fileBase64 = buffer.toString('base64');
    const { data: resumeData, error: insertError } = await client
      .from('resumes')
      .insert({
        file_key: `local://${file.name}`,
        file_name: file.name,
        parsed_content: '正在解析简历内容...',
        user_info: { file_base64: fileBase64, file_type: file.type },
        access_code_id: accessCodeId ? parseInt(accessCodeId) : null,
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`创建简历记录失败: ${insertError.message}`);
    }

    // 异步解析简历
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
    
    let textContent = '';
    
    // 根据文件类型提取文本
    if (contentType === 'application/pdf' || fileName.endsWith('.pdf')) {
      console.log('Parsing PDF file:', fileName);
      textContent = await extractTextFromPDF(buffer);
    } else if (
      contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      fileName.endsWith('.docx')
    ) {
      console.log('Parsing Word file:', fileName);
      textContent = await extractTextFromWord(buffer);
    } else if (contentType === 'application/msword' || fileName.endsWith('.doc')) {
      // 旧版.doc格式
      console.log('Parsing old Word file:', fileName);
      textContent = await extractTextFromWord(buffer);
    } else if (contentType === 'text/plain' || fileName.endsWith('.txt')) {
      textContent = buffer.toString('utf-8');
    } else {
      // 尝试作为文本读取
      try {
        textContent = buffer.toString('utf-8');
      } catch {
        textContent = `[不支持的文件格式: ${fileName}]`;
      }
    }

    console.log('Extracted text length:', textContent.length);

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
    } else {
      console.log('Resume parsed successfully:', resumeId);
    }
  } catch (error) {
    console.error('Background parsing error:', error);
    
    // 更新错误状态
    const client = getSupabaseClient();
    await client
      .from('resumes')
      .update({
        parsed_content: '简历解析失败，请检查文件格式是否正确',
        updated_at: new Date().toISOString(),
      })
      .eq('id', resumeId);
  }
}
