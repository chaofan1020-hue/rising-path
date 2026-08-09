// 企业面试基因获取服务：精调库 → DB 缓存 → LLM 动态生成（写回缓存）
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { CompanyDNA, findCuratedDNA, normalizeCompanyName } from './company-dna';

export type DNASource = 'curated' | 'cached' | 'generated' | 'manual';

export interface DNAResult {
  dna: CompanyDNA;
  source: DNASource;
  version: number;
}

// LLM 生成基因的 JSON 结构校验（宽松：关键字段存在即可，缺省补默认值）
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeGeneratedDNA(raw: unknown, company: string): CompanyDNA | null {
  if (!isRecord(raw)) return null;
  const arr = (value: unknown): string[] => (
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : []
  );
  const focusAreas = Array.isArray(raw.focusAreas)
    ? raw.focusAreas.flatMap((item) => {
        if (!isRecord(item) || typeof item.dimension !== 'string' || !item.dimension.trim()) return [];
        return [{
          dimension: item.dimension,
          weight: item.weight === 'core' ? 'core' as const : 'important' as const,
          probes: arr(item.probes),
        }];
      })
    : [];
  if (focusAreas.length === 0) return null;
  const style = isRecord(raw.style) ? raw.style : {};
  return {
    company,
    aliases: arr(raw.aliases),
    tagline: typeof raw.tagline === 'string' ? raw.tagline : `${company} 面试基因`,
    focusAreas,
    style: {
      tone: typeof style.tone === 'string' ? style.tone : '专业、结构化',
      openingPatterns: arr(style.openingPatterns),
      followupPatterns: arr(style.followupPatterns),
      taboos: arr(style.taboos),
    },
    drilldownRules: Array.isArray(raw.drilldownRules)
      ? raw.drilldownRules.flatMap((item) => {
          if (!isRecord(item) || typeof item.trigger !== 'string' || !item.trigger.trim()) return [];
          return [{ trigger: item.trigger, followups: arr(item.followups) }];
        })
      : [],
    vocabulary: arr(raw.vocabulary),
    cultureKeywords: arr(raw.cultureKeywords),
    signatureQuestions: arr(raw.signatureQuestions),
  };
}

async function generateDNAWithLLM(company: string, headers: Headers): Promise<CompanyDNA | null> {
  const llmClient = new LLMClient(new Config(), HeaderUtils.extractForwardHeaders(headers));
  const prompt = `你是面试研究专家，精通各大公司真实的面试文化（基于公开面经、员工分享与行业共识）。

请为「${company}」生成面试基因，严格输出一个 JSON 对象（不要 markdown 代码块，不要任何其他文字），结构如下：
{
  "aliases": ["该公司的常见别名/英文名/简称"],
  "tagline": "一句话基因画像，如：数据驱动·AB实验思维·第一性原理",
  "focusAreas": [
    { "dimension": "考察维度", "weight": "core 或 important", "probes": ["具体考察点1", "考察点2", "考察点3"] }
  ],
  "style": {
    "tone": "整体语气与节奏（一句话）",
    "openingPatterns": ["典型开场方式1", "方式2"],
    "followupPatterns": ["追问模式1", "追问模式2", "追问模式3"],
    "taboos": ["该公司面试官绝不会用的问法1", "问法2"]
  },
  "drilldownRules": [
    { "trigger": "候选人提到某类内容时", "followups": ["追问1", "追问2", "追问3"] }
  ],
  "vocabulary": ["该公司内部术语/黑话1", "术语2"],
  "cultureKeywords": ["文化关键词1", "关键词2"],
  "signatureQuestions": ["面经中真实流传的经典题1", "题2", "题3"]
}

硬性要求：
1. focusAreas 3-4 个，按权重排序；drilldownRules 3 条；vocabulary 5-8 个；signatureQuestions 3-5 道。
2. 所有内容必须体现「${company}」区别于其他公司的真实面试风格——同样考察"项目经历"，不同公司的问法、追问角度、切入点必须不同。
3. 禁止放之四海皆准的通用内容（如"考察沟通能力"这种任何公司都适用的描述）。
4. 如果该公司公开信息不足，则参照其所在行业头部公司的典型风格，并贴合其业务特点生成。
5. 全部用中文（公司专有名词可保留英文）。`;

  try {
    const response = await llmClient.invoke([{ role: 'user', content: prompt }], {
      temperature: 0.4,
    });
    const content = String(response.content || '').trim();
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;
    const start = jsonStr.indexOf('{');
    if (start === -1) {
      console.error('[company-dna] LLM 响应无 JSON:', content.slice(0, 200));
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(jsonStr.slice(start));
      const dna = sanitizeGeneratedDNA(parsed, company);
      if (!dna) console.error('[company-dna] 基因结构校验失败:', content.slice(0, 200));
      return dna;
    } catch (e) {
      console.error('[company-dna] JSON 解析失败:', e, content.slice(0, 300));
      return null;
    }
  } catch (e) {
    console.error('[company-dna] LLM 调用失败:', e);
    return null;
  }
}

// 三级获取：人工编辑版（DB 覆盖，最高优先）→ 精调库（招牌体验）→ DB 生成缓存 → LLM 生成（长尾覆盖）
export async function getCompanyDNA(company: string, headers: Headers): Promise<DNAResult | null> {
  const name = company.trim();
  if (!name) return null;

  const norm = normalizeCompanyName(name);
  const client = getSupabaseClient();

  // 查 DB（公司名/别名在应用层规范化匹配；表量级小，全表可接受）
  type DNARow = { id: number; dna: CompanyDNA; hit_count: number; version: number; manually_edited: boolean };
  let dbRow: DNARow | null = null;
  try {
    const { data: rows } = await client
      .from('company_dna')
      .select('id, company_name, aliases, dna, hit_count, version, manually_edited');
    const hit = (rows || []).find((row) => {
      const names = [row.company_name as string, ...((row.aliases as string[]) || [])].map(normalizeCompanyName);
      return names.some((n) => n === norm || (n.length >= 2 && norm.includes(n)) || (norm.length >= 2 && n.includes(norm)));
    });
    if (hit) dbRow = hit as unknown as DNARow;
  } catch {
    // 查询失败继续走精调/生成
  }

  // 1. 人工编辑版（审查闭环的产物，优先级最高）
  if (dbRow?.manually_edited) {
    bumpHitCount(client, dbRow.id, dbRow.hit_count);
    return { dna: dbRow.dna, source: 'manual', version: dbRow.version };
  }

  // 2. 精调基因库
  const curated = findCuratedDNA(name);
  if (curated) return { dna: curated, source: 'curated', version: 0 };

  // 3. DB 生成缓存
  if (dbRow) {
    bumpHitCount(client, dbRow.id, dbRow.hit_count);
    return { dna: dbRow.dna, source: 'cached', version: dbRow.version };
  }

  // 4. LLM 生成并写回缓存
  const generated = await generateDNAWithLLM(name, headers);
  if (!generated) return null;
  let version = 1;
  try {
    const { data: inserted } = await client
      .from('company_dna')
      .insert({ company_name: name, aliases: generated.aliases, dna: generated, source: 'generated' })
      .select('version')
      .single();
    if (inserted?.version) version = inserted.version;
  } catch {
    // 写入失败不影响本次返回
  }
  return { dna: generated, source: 'generated', version };
}

function bumpHitCount(client: SupabaseClient, id: number, current: number): void {
  void client
    .from('company_dna')
    .update({ hit_count: (current || 0) + 1, updated_at: new Date().toISOString() })
    .eq('id', id)
    .then(() => undefined);
}

// 人工更新基因（审查闭环：低真实度案例 → 人工审查差异点 → 更新基因 → 版本 +1 → 后续面试即用新版 prompt）
export async function saveManualDNA(company: string, dna: CompanyDNA, reviewNotes?: string): Promise<{ version: number } | null> {
  const client = getSupabaseClient();
  const norm = normalizeCompanyName(company);
  try {
    // 查全表按规范化名/别名匹配（精调公司首次人工编辑时 DB 可能无记录，生成公司可能有未编辑记录）
    const { data: rows } = await client
      .from('company_dna')
      .select('id, company_name, aliases, version');
    const existing = (rows || []).find((row) => {
      const names = [row.company_name as string, ...((row.aliases as string[]) || [])].map(normalizeCompanyName);
      return names.some((n) => n === norm);
    });
    if (existing) {
      const nextVersion = ((existing.version as number) || 1) + 1;
      await client
        .from('company_dna')
        .update({
          dna,
          source: 'manual',
          manually_edited: true,
          review_notes: reviewNotes || null,
          version: nextVersion,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      return { version: nextVersion };
    }
    const { data: inserted } = await client
      .from('company_dna')
      .insert({
        company_name: company,
        aliases: dna.aliases,
        dna,
        source: 'manual',
        manually_edited: true,
        version: 1,
        review_notes: reviewNotes || null,
      })
      .select('version')
      .single();
    return { version: inserted?.version || 1 };
  } catch {
    return null;
  }
}
