// 地区招聘逻辑知识库（Region Hiring DNA）
// 分层第一权重：不同地区的招聘逻辑差异，比不同公司之间的差异还要大。
// 一个面字节北京的学生，和面字节新加坡的学生——简历写法、面试语言、考察重点全都不一样。

export type RegionKey = 'us' | 'uk' | 'sg' | 'cn_t1' | 'cn_t2';

export interface RegionDNA {
  key: RegionKey;
  name: string;           // 中文名
  nameEn: string;         // 英文名
  atsPreferences: string[];   // ATS 筛选偏好
  resumeStyle: string[];      // 简历写法规则
  interviewRhythm: string[];  // 面试节奏与考察权重
  visaNotes: string;          // 签证/身份依赖度
  keySignals: string[];       // 简历关键标签（没有会被刷/有了会加分）
}

export const REGION_DNA: Record<RegionKey, RegionDNA> = {
  us: {
    key: 'us',
    name: '美国（硅谷/纽约）',
    nameEn: 'United States',
    atsPreferences: [
      '极度看重刷题记录（LeetCode 数量/进度，技术岗）',
      'Tech Stack 与 JD 的关键词精确匹配度',
      '实习公司知名度（FAANG/大厂实习显著加分）',
      '简历中未标明当前签证状态会被系统自动剔除',
    ],
    resumeStyle: [
      '严格一页以内',
      '动词开头（Led/Built/Drove/Optimized）',
      '每条经历必须有量化结果',
      '不写照片、年龄、性别等个人信息',
    ],
    interviewRhythm: [
      '重算法重代码，技术考察强度高',
      '行为面 BQ 是单独一轮，约占 30-45% 时间聊软技能',
      '自我介绍要有"故事线"，tell me about yourself 常常是整场面试成败的关键',
      'STAR 原则是默认回答结构',
    ],
    visaNotes: 'H1B/OPT 是核心考量，签证状态必须前置标明',
    keySignals: ['签证状态', 'LeetCode 进度', '是否人在美国', 'Tech Stack 关键词'],
  },
  uk: {
    key: 'uk',
    name: '英国',
    nameEn: 'United Kingdom',
    atsPreferences: [
      '看重学历等级（First / Distinction 优先）',
      '实习公司知名度',
      'G5 毕业显著加分',
      '学术成绩权重高于其他地区',
    ],
    resumeStyle: [
      '两页以内',
      '不带照片',
      'CV 风格偏正式',
      '强调学术成绩和社团活动',
    ],
    interviewRhythm: [
      '重行为面（BQ 占 50% 以上）',
      '重案例面（尤其咨询方向）',
      '技术题权重相对国内低',
      ' competency-based questions 是主流，需准备大量具体事例',
    ],
    visaNotes: 'PSW 签证是加分项（不占用工签名额），有 PSW 在简历上会显著提高通过率',
    keySignals: ['签证状态', '学校等级（G5/罗素集团）', '有无 PSW', '学术排名（First/2:1）'],
  },
  sg: {
    key: 'sg',
    name: '新加坡',
    nameEn: 'Singapore',
    atsPreferences: [
      '本地实习/项目权重极高（证明本地适应力）',
      '英语能力要求高（全英文面试）',
      'NUS/NTU/SMU 三校毕业生有加分',
      '国际经验与跨文化适应能力',
    ],
    resumeStyle: [
      '中英双语或纯英文',
      '一页以内',
      '排版国际化',
      '强调国际经验和适应能力',
    ],
    interviewRhythm: [
      '高频行为面（几乎每轮都会穿插 BQ）',
      '技术和行为面混合占比大',
      '业务理解面更注重东南亚视角（Grab/Sea 等本地生态）',
    ],
    visaNotes: 'EP 签证依赖学历+薪资门槛，名校+高薪 offer 才稳',
    keySignals: ['新加坡本地经验', '英文水平', '东南亚市场理解', 'EP 工签匹配度'],
  },
  cn_t1: {
    key: 'cn_t1',
    name: '国内一线（北上深杭）',
    nameEn: 'China Tier-1 Cities',
    atsPreferences: [
      '看重实习公司知名度（大厂实习是硬通货）',
      '学校档次（985/211/海归）',
      '项目量化结果密度',
      '技术栈与岗位匹配度',
    ],
    resumeStyle: [
      '可中可英',
      '一页（更推荐）或两页',
      '可放照片',
      '可写政治面貌（国企/事业单位方向）',
    ],
    interviewRhythm: [
      '技术面占绝对主导（互联网）',
      '业务面深挖项目细节，追问极深',
      '行为面（性格面）比重低但必须有',
      '常有多轮交叉面，压力面常见',
    ],
    visaNotes: '无签证问题（国内学生/海归回国无限制）',
    keySignals: ['学校档次', '实习公司档次', '技术栈匹配度', '中文逻辑表达'],
  },
  cn_t2: {
    key: 'cn_t2',
    name: '国内二三线（新一线/省会）',
    nameEn: 'China Tier-2/3 Cities',
    atsPreferences: [
      '本地高校/省内高校有明显优势（地域锁定）',
      '本地实习权重极高',
      '稳定性信号（是否愿意长期留下）',
    ],
    resumeStyle: [
      '可中文一页或两页',
      '注重地域相关经历',
      '强调本地资源和人脉',
    ],
    interviewRhythm: [
      '更偏向稳定性和业务匹配',
      '硬核技术权重低于一线',
      '用人文化偏向"本地化+长期稳定"',
      '常问"为什么选择这个城市"',
    ],
    visaNotes: '无签证问题',
    keySignals: ['是否本地人（隐性地域偏好）', '本地实习/项目', '长期留任意愿'],
  },
};

// 地区别名归并：未精调地区映射到最近的精调地区逻辑
// hk → 国内一线逻辑与英联邦混合，就近归 cn_t1；ca → us；au → uk；eu → uk（英联邦体系）
const REGION_ALIAS: Record<string, RegionKey> = {
  '美国': 'us', '美國': 'us', 'usa': 'us', 'us': 'us', 'america': 'us', 'united states': 'us',
  '硅谷': 'us', '纽约': 'us', '加拿大': 'us', 'canada': 'us', 'ca': 'us', '北美': 'us',
  '英国': 'uk', '英國': 'uk', 'uk': 'uk', 'britain': 'uk', '伦敦': 'uk', '倫敦': 'uk',
  '澳大利亚': 'uk', '澳洲': 'uk', 'australia': 'uk', 'au': 'uk',
  '欧洲': 'uk', 'eu': 'uk', 'europe': 'uk', '德国': 'uk', '法国': 'uk', '荷兰': 'uk',
  '新加坡': 'sg', 'sg': 'sg', 'singapore': 'sg',
  '香港': 'cn_t1', 'hk': 'cn_t1', 'hong kong': 'cn_t1', 'hongkong': 'cn_t1',
  '北京': 'cn_t1', '上海': 'cn_t1', '深圳': 'cn_t1', '杭州': 'cn_t1', '广州': 'cn_t1',
  '国内一线': 'cn_t1', '北上深杭': 'cn_t1', '北上广深': 'cn_t1', '一线': 'cn_t1', 'cn': 'cn_t1', '中国': 'cn_t1', '国内': 'cn_t1',
  '成都': 'cn_t2', '武汉': 'cn_t2', '西安': 'cn_t2', '南京': 'cn_t2', '苏州': 'cn_t2',
  '长沙': 'cn_t2', '郑州': 'cn_t2', '合肥': 'cn_t2', '佛山': 'cn_t2', '东莞': 'cn_t2',
  '国内二三线': 'cn_t2', '新一线': 'cn_t2', '二三线': 'cn_t2', '省会': 'cn_t2',
  '日本': 'cn_t1', 'jp': 'cn_t1', 'japan': 'cn_t1', '东京': 'cn_t1',
};

// 归一化地区输入 → RegionKey。无法识别时返回 null（由调用方决定默认值）
export function resolveRegionKey(input?: string | null): RegionKey | null {
  if (!input) return null;
  const norm = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!norm) return null;
  if (norm in REGION_DNA) return norm as RegionKey;
  if (REGION_ALIAS[norm]) return REGION_ALIAS[norm];
  // 双向包含匹配（如"美国纽约"、"上海市"）
  for (const [alias, key] of Object.entries(REGION_ALIAS)) {
    if (norm.includes(alias) || alias.includes(norm)) return key;
  }
  return null;
}

// 构建地区规则 prompt 块（面试官标尺 / ATS 优化共用）
export function buildRegionBlock(key: RegionKey, lang: 'zh' | 'en' = 'zh'): string {
  const dna = REGION_DNA[key];
  if (lang === 'en') {
    return [
      `Target Region Hiring Logic — ${dna.nameEn}:`,
      `- ATS preferences: ${dna.atsPreferences.join('; ')}`,
      `- Interview rhythm: ${dna.interviewRhythm.join('; ')}`,
      `- Visa context: ${dna.visaNotes}`,
      `- Key resume signals: ${dna.keySignals.join(', ')}`,
    ].join('\n');
  }
  return [
    `【目标地区招聘逻辑 — ${dna.name}】`,
    `- ATS 偏好：${dna.atsPreferences.join('；')}`,
    `- 面试节奏：${dna.interviewRhythm.join('；')}`,
    `- 签证背景：${dna.visaNotes}`,
    `- 简历关键信号：${dna.keySignals.join('、')}`,
  ].join('\n');
}
