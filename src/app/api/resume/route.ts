import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { LLMClient, Config } from 'coze-coding-dev-sdk';
import PDFParser from 'pdf2json';
import mammoth from 'mammoth';
import { deriveSegmentation, ResumeProfile } from '@/lib/user-segmentation';

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
    // 新增：用户画像字段
    region?: string;       // 留学地区/目标求职地区
    school?: string;       // 学校名称
    degree?: string;       // 学历（本科/硕士/博士）
    major?: string;        // 专业
    universities?: Array<{  // 结构化教育经历
      school: string;
      degree: string;
      major: string;
      region?: string;
    }>;
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
  "skills": ["技能1", "技能2", "技能3"],
  "region": "留学地区或求职目标地区（如：美国、英国、新加坡、香港等）",
  "school": "最高学历所在学校名称",
  "degree": "最高学历（本科/硕士/博士）",
  "major": "专业名称",
  "universities": [
    {
      "school": "学校名称",
      "degree": "学历",
      "major": "专业",
      "region": "学校所在地区"
    }
  ]
}

只返回JSON，不要其他说明文字。如果某项信息不存在，返回null或空数组。对于地区，优先提取留学目的地或求职意向地区。`;

    const response = await llmClient.invoke([
      { role: 'system', content: '你是一个专业的简历解析助手，擅长从简历中提取结构化信息，特别是教育背景相关的地区、学校、学历等信息。' },
      { role: 'user', content: prompt },
    ], { temperature: 0.3 });

    let userInfo = {
      name: undefined as string | undefined,
      email: undefined as string | undefined,
      phone: undefined as string | undefined,
      education: [] as string[],
      experience: [] as string[],
      skills: [] as string[],
      region: undefined as string | undefined,
      school: undefined as string | undefined,
      degree: undefined as string | undefined,
      major: undefined as string | undefined,
      universities: [] as Array<{ school: string; degree: string; major: string; region?: string }>,
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
          region: parsed.region || undefined,
          school: parsed.school || undefined,
          degree: parsed.degree || undefined,
          major: parsed.major || undefined,
          universities: parsed.universities || [],
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
    const isAdmin = request.headers.get('x-admin-request') === 'true';
    
    let query = client.from('resumes').select('*');
    
    // 管理员可以查看所有简历，普通用户需要 access_code_id
    if (!accessCodeId && !isAdmin) {
      return NextResponse.json({ resumes: [] });
    }
    
    if (accessCodeId) {
      query = query.eq('access_code_id', parseInt(accessCodeId));
    }
    
    const { data, error } = await query.order('created_at', { ascending: false });

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

// 使用LLM提取完整简历画像（用于用户分层）
// 提取字段清单：教育（含入学/毕业时间推断年级）、实习（含时长/转正）、工作（含职级）、项目、技能证书、求职意向、篇幅、语言版本
async function extractResumeProfile(content: string, meta: { pages?: number }): Promise<ResumeProfile | null> {
  try {
    const llmClient = new LLMClient(new Config());
    const prompt = `你是简历结构化专家。请从以下简历中提取完整画像，严格以 JSON 返回。

简历内容：
${content.slice(0, 12000)}

返回 JSON 结构（不存在的信息用 null 或空数组，不要编造）：
{
  "education": [
    { "school": "学校全称", "degree": "本科/硕士/博士/MBA", "major": "专业", "startYear": 2021, "endYear": 2025, "gpa": "GPA或学位等级(如First/2:1)", "qsEstimate": 50 }
  ],
  "internships": [
    { "company": "公司", "role": "岗位", "months": 3, "convertedToFulltime": false, "highlights": ["量化成果1"] }
  ],
  "workExperience": [
    { "company": "公司", "role": "岗位", "months": 24, "level": "职级(如P6/ Senior)", "isInternship": false, "highlights": ["量化成果"] }
  ],
  "projects": [
    { "name": "项目名", "role": "角色", "techStack": ["技术"], "outcomes": ["量化结果"] }
  ],
  "skills": ["技能1", "技能2"],
  "certificates": ["证书1"],
  "languages": ["IELTS 7.5", "TOEFL 110"],
  "intention": {
    "roles": ["意向岗位"],
    "locations": ["意向城市/国家，如'上海'、'新加坡'"],
    "industries": ["意向行业"]
  },
  "meta": {
    "pages": ${meta.pages || 1},
    "wordDensity": "sparse/normal/dense",
    "resumeLanguage": "zh/en/bilingual"
  }
}

提取要点：
1. endYear 是毕业年份（推断年级的关键），在读学生按预计毕业年份填；
2. qsEstimate：你对该校 QS 世界排名的大致估计（不确定给 null）；
3. months 为时长月数（起止时间推算）；实习放 internships，全职放 workExperience；
4. highlights/outcomes 优先保留含数字的量化描述；
5. intention 仅在简历明确写出时提取（如"求职意向：上海"），否则 null；
6. wordDensity 按简历内容密度判断；resumeLanguage 判断简历语言版本。
只返回 JSON，不要任何说明文字。`;

    const response = await llmClient.invoke([
      { role: 'system', content: '你是专业的简历结构化引擎，只输出合法 JSON。' },
      { role: 'user', content: prompt },
    ], { temperature: 0.2 });

    const raw = response.content || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[profile] LLM 未返回 JSON');
      return null;
    }
    const parsed = JSON.parse(jsonMatch[0]);
    // 宽松校验：education 必须为数组
    if (!Array.isArray(parsed.education)) {
      console.error('[profile] 结构校验失败：education 非数组');
      return null;
    }
    return {
      education: parsed.education || [],
      internships: parsed.internships || [],
      workExperience: parsed.workExperience || [],
      projects: parsed.projects || [],
      skills: parsed.skills || [],
      certificates: parsed.certificates || [],
      languages: parsed.languages || [],
      intention: parsed.intention || undefined,
      meta: parsed.meta || undefined,
    } as ResumeProfile;
  } catch (error) {
    console.error('[profile] 画像提取失败:', error);
    return null;
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

    // 用户分层：提取完整画像 → 规则推导分层（地区为第一权重）
    const profile = await extractResumeProfile(textContent, { pages: 1 });
    const segmentation = profile ? deriveSegmentation(profile) : null;

    // 更新数据库
    const { error: updateError } = await client
      .from('resumes')
      .update({
        parsed_content: parsed.parsed_content,
        user_info: parsed.user_info,
        profile: profile || null,
        segmentation: segmentation || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', resumeId);

    if (updateError) {
      console.error('Failed to update parsed resume:', updateError);
    } else {
      console.log('Resume parsed successfully:', resumeId, segmentation ? `[分层] ${segmentation.summary}` : '[分层] 画像提取失败，仅基础解析');
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
