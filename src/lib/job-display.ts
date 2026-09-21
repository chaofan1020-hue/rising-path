// 岗位/地区文本的展示层清洗：合并重复拼接的地区片段
// 数据库中部分岗位的 region 字段存在 "Melbourne, Melbourne" 这类重复拼接，展示时在此兜底去重
export function formatLocationDisplay(value: string | null | undefined): string {
  if (!value) return '';
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of value.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result.join(', ');
}

// 数据库中的枚举值以简体中文为规范存储（实习/校招/社招/留学生/未注明），展示时按语言本地化
const CN_ENUM_KEYS: Record<string, string> = {
  '实习': 'jobs.enum.internship',
  '校招': 'jobs.enum.newGrad',
  '社招': 'jobs.enum.experienced',
  '留学生': 'jobs.enum.intlStudents',
  '未注明': 'jobs.enum.notSpecified',
};

export function localizeJobEnum(
  value: string | null | undefined,
  t: (key: string) => string,
): string {
  if (!value) return '';
  const key = CN_ENUM_KEYS[value.trim()];
  return key ? t(key) : value;
}

// 分层摘要是服务端生成的中文模板串（如 "高年级（校招全职） × Tier2院校 × 2个目标地区 × 1段实习（已确认）"），展示时按语言重建
export function localizeSegSummary(
  summary: string | null | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!summary) return '';
  const match = /^(低年级（实习预备）|高年级（校招全职）|社招（在职跳槽）|实习转正) ?× ?Tier(\d+)院校 ?× ?(\d+)个目标地区(?: ?× ?(\d+)段实习)?（(已确认|待确认)）$/.exec(summary.trim());
  if (!match) return summary;
  const stageMap: Record<string, string> = {
    '低年级（实习预备）': 'resume.segStage.junior',
    '高年级（校招全职）': 'resume.segStage.senior',
    '社招（在职跳槽）': 'resume.segStage.experienced',
    '实习转正': 'resume.segStage.returning_intern',
  };
  const parts = [
    t(stageMap[match[1]]),
    `Tier${match[2]}`,
    t('resume.segTargetRegions', { count: Number(match[3]) }),
  ];
  if (match[4]) parts.push(t('resume.segInternships', { count: Number(match[4]) }));
  const state = match[5] === '已确认' ? t('resume.segConfirmed') : t('resume.segPending');
  return `${parts.join(' × ')}（${state}）`;
}

// 阶段判定原因（careerStageReason）服务端按中文生成，展示时按语言重建
export function localizeSegReason(
  reason: string | null | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!reason) return '';
  const senior = /^(?:毕业时间|畢業時間)\s*(\d{4})\s*（\s*≤\s*(\d{4})\s*），无全职工作经历$/.exec(reason.trim());
  if (senior) return t('resume.segReason.senior', { year: senior[1], limit: senior[2] });
  const junior = /^(?:毕业时间|畢業時間)\s*(\d{4})\s*（\s*≥\s*(\d{4})\s*），处于实习预备阶段$/.exec(reason.trim());
  if (junior) return t('resume.segReason.junior', { year: junior[1], limit: junior[2] });
  if (reason.trim() === '未检测到毕业时间与实习经历，按低年级实习预备处理') return t('resume.segReason.none');
  return reason;
}
