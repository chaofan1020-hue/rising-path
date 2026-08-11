# 模拟面试问题策略开发流程

## 目标

解决同一个学生重复面试同一家企业时问题重复的问题，同时保留企业 DNA 的稳定风格。

核心原则：

~~~text
企业 DNA 决定“像哪家公司”
问题策略决定“这一场具体问什么”
历史记录决定“不能重复什么”
候选人表现决定“下一次重点练什么”
~~~

企业 DNA 不应该每场随机变化。需要变化的是考察维度、问题场景、简历切入点和追问路径。

## 当前实现与缺口

当前企业 DNA 主要位于：

- src/lib/company-dna.ts
- src/lib/company-dna-service.ts
- src/app/api/interview/chat/route.ts

当前流程是：

1. 根据目标公司名称和别名获取企业 DNA。
2. 按 manual > curated > cached > generated 获取 DNA。
3. 将 DNA 编译为 System Prompt。
4. 当前会话内依靠历史消息避免重复问题。

当前缺口：

- 没有记录同一个学生在历史会话中问过的问题。
- 没有区分“文字重复”和“考察意图重复”。
- signatureQuestions 是具体问题文本，模型可能直接复用。
- 每次继续面试都会重新读取当前 DNA，可能导致同一场面试中途切换版本。
- 反馈只有分数和文本，无法精确判断重复或低真实度的原因。

## 目标流程

~~~mermaid
flowchart LR
  A[开始面试] --> B[读取用户历史问题]
  B --> C[选择本场考察维度与问题意图]
  C --> D[根据 DNA 和简历生成问题]
  D --> E{重复检测}
  E -->|重复| D
  E -->|通过| F[发送问题]
  F --> G[记录问题与意图]
  G --> H[候选人回答]
  H --> C
~~~

## 核心概念

### 企业 DNA

描述公司的稳定面试特征：

- 考察重点
- 追问风格
- 面试节奏
- 文化关键词
- 典型禁用问法

企业 DNA 不负责保存每一场的具体问题。

### 问题意图

问题意图表示问题真正要考察的内容，例如：

~~~text
metric_definition
metric_attribution
conflict_resolution
customer_understanding
technical_depth
failure_reflection
ownership
~~~

“讲一个你解决团队冲突的经历”和“你和同事意见不一致时，最后是怎么推进的”文字不同，但都属于 conflict_resolution，不能在短时间内重复使用。

### 问题场景

同一个问题意图可以使用不同场景：

- 简历项目
- 实习经历
- 课程项目
- 社团经历
- 工作案例
- 假设业务场景

场景不同，可以在保留考察目标的同时降低机械重复。

### 会话 DNA 快照

创建面试时保存本场使用的 DNA 版本。后续继续面试始终使用该版本，避免管理员发布新版本后影响进行中的会话。

## 数据模型设计

### 第一阶段：扩展现有表

在 interview_sessions 增加：

~~~text
dna_version_id
dna_source
dna_variant_key
dna_hash
question_strategy_version
session_seed
practice_mode
~~~

在 interview_sessions.messages 的面试官消息增加：

~~~json
{
  "role": "interviewer",
  "content": "问题内容",
  "dimension": "数据驱动能力",
  "intentKey": "metric_attribution",
  "questionHash": "sha256-value",
  "round": 1,
  "ts": 0
}
~~~

该阶段可以复用现有消息结构，先完成主流程验证。

### 第二阶段：新增问题记录表

建议新增 interview_questions：

~~~sql
id bigint primary key
user_id uuid not null
session_id bigint not null
company_id bigint null
company_name text not null
job_id bigint null
interview_type text not null
round_role text null
dimension text not null
intent_key text not null
scenario_key text null
question_text text not null
question_hash text not null
semantic_fingerprint jsonb null
answer_quality text null
asked_at timestamptz not null default now()
~~~

建议索引：

~~~text
(user_id, company_name, asked_at desc)
(user_id, company_name, intent_key, asked_at desc)
(session_id)
(question_hash)
~~~

所有用户字段必须从服务端认证上下文获取，不能信任客户端传入的 user_id。

### 第三阶段：问题原型

将企业 DNA 中的具体 signatureQuestions 逐步迁移为问题原型：

~~~json
{
  "intentKey": "metric_attribution",
  "dimension": "数据驱动与归因能力",
  "scenarioTypes": ["resume_project", "internship"],
  "angles": ["baseline", "causality", "experiment"],
  "companySpecificHints": ["追问数据口径和对照组"],
  "roles": ["product", "analytics", "marketing"]
}
~~~

模型接收原型和角度，不直接复用固定问题文本。

## 问题生成流程

### 创建会话

服务端完成以下步骤：

1. 获取当前用户身份。
2. 获取目标公司、岗位、地区和面试类型。
3. 获取企业 DNA 和版本。
4. 生成随机 session_seed。
5. 查询该用户最近同公司、同岗位的历史问题。
6. 根据练习模式生成本场问题约束。
7. 保存 DNA 快照和问题策略版本。

历史查询默认范围建议为最近 5 场同公司面试，或最近 30 个问题，取较大范围。

### 选择本场考察计划

先选考察意图，再生成具体问题。

选择输入：

- 企业 DNA 的核心维度和权重
- 岗位类型
- 面试轮次
- 用户历史薄弱项
- 最近已使用的 intent_key
- 本场 session_seed

选择输出：

~~~json
{
  "dimension": "数据驱动与归因能力",
  "intentKey": "metric_attribution",
  "scenarioKey": "resume_project",
  "angle": "causality"
}
~~~

同一场中同一个 intent_key 默认只允许出现一次。

### 生成具体问题

LLM Prompt 应包含：

- 企业 DNA 行为规则
- 本轮考察意图
- 问题角度
- 候选人简历和岗位描述
- 当前会话已问问题
- 历史排除问题摘要
- 输出限制：每次只能问一个问题

Prompt 不应直接要求模型从固定题目列表中选择，而应要求根据考察意图和候选人经历生成新问题。

### 重复检测

问题发送前执行三层检查：

1. 完全重复：规范化文字后计算 hash。规范化包括转小写、去除空格和标点、统一中英文标点、删除“请问”等无意义开头。
2. 意图重复：如果用户近期同公司已经使用同一个 intent_key，则换用其他意图或场景。
3. 语义重复：后续接入 embedding。建议初始阈值为相似度 0.90 以上拦截，0.80 至 0.90 结合意图和场景判断。

重复时重新生成，最多重试 2 至 3 次。连续失败时降级为未使用过的问题原型，不要无限调用模型。

### Prompt 长度控制

历史问题的完整内容只保存在数据库中，不应无限追加到 Prompt。跨场次历史只作为“排除提示”，当前会话完整对话才作为模型上下文。

P0 阶段固定以下上限：

~~~text
历史问题：最多 10 条
单条历史问题：最多 100 个字符
历史排除提示：最多 1500 个字符
当前会话已问问题清单：最多 10 条
~~

压缩规则：

1. 只保留问题文本或问题摘要，不注入完整面试官回复。
2. 统一规范化后去重，再截断数量和长度。
3. 历史问题按最近使用时间倒序保留。
4. review 模式不生成历史排除提示。
5. 超过长度上限时优先保留最近问题和高频核心维度，不能让 Prompt 随用户面试次数无限增长。

当前会话消息已经进入 LLM 上下文时，不要再把同一批完整问题复制到 noRepeatNote 中。后续可以只传最近问题摘要、已覆盖维度和服务端去重结果。

后续接入语义去重后，数据库仍然保存完整历史，但 Prompt 只需要传递少量代表性样本；最终是否重复由服务端 hash 或 embedding 检查决定。

### 保存问题记录

问题成功发送后立即保存：

- 用户和会话
- 企业和岗位
- 面试轮次
- 考察维度
- intent_key
- 场景
- 问题文本
- hash
- DNA 版本

如果保存失败，不应阻塞面试，但必须记录服务端错误，避免去重失效长期不被发现。

## 三种练习模式

### 全新练习 fresh

- 排除最近 5 场同公司面试的问题。
- 排除近期已经使用的意图。
- 优先选择尚未覆盖的核心维度。

### 薄弱项强化 targeted

- 可以重新使用薄弱维度。
- 必须更换问题意图、场景或简历项目。
- 优先生成上一场回答不完整的追问。

### 复盘重练 review

- 允许重复原问题。
- 明确显示这是复盘模式。
- 可以对比本次回答和上次回答。
- 不把复盘问题写入 fresh 模式的排除列表。

## 面试轮次策略

| 轮次 | 主要目标 | 问题策略 |
|---|---|---|
| 初筛 | 基础匹配和经历真实性 | 少量核心问题，避免复杂追问 |
| 技术面 | 技术深度和解决问题能力 | 优先技术意图和项目细节 |
| 行为面 | 领导力、冲突、失败复盘 | 优先行为意图和真实经历 |
| 终面 | 价值观、业务理解和长期潜力 | 选择未覆盖的高权重维度 |

## 反馈闭环

反馈建议增加：

~~~text
company_fit_score
question_quality_score
followup_quality_score
role_relevance_score
difficulty_score
issue_tags
~~~

问题标签建议包括：

~~~text
company_mismatch
too_generic
followup_too_shallow
question_repeated
question_too_hard
question_not_role_related
incorrect_company_fact
tone_mismatch
~~~

| 问题类型 | 修复对象 |
|---|---|
| 公司风格不对 | 企业 DNA |
| 问题重复 | 问题历史与去重策略 |
| 问题太泛 | 问题原型和 Prompt |
| 岗位不相关 | 岗位变体 |
| 难度不合适 | 用户分层和轮次策略 |
| 追问太浅 | drilldown 规则 |

## API 改造建议

当前 POST /api/interview/chat 创建新会话时增加 practiceMode：

~~~json
{
  "practiceMode": "fresh"
}
~~~

服务端保存：

~~~json
{
  "sessionId": 123,
  "dnaVersion": 3,
  "questionStrategyVersion": 1,
  "practiceMode": "fresh"
}
~~~

继续会话时不得重新选择 DNA 版本，必须使用会话创建时保存的快照。

建议新增内部服务函数：

~~~ts
getRecentInterviewQuestions({
  userId,
  company,
  jobId,
  limit,
  excludeReviewMode
})
~~~

返回脱敏后的摘要即可，不需要把所有历史完整对话放进 Prompt。

## 开发阶段

### P0：最小可用去重

1. 增加 session_seed 和 practice_mode。
2. 创建会话时保存 DNA 版本快照。
3. 把当前会话的问题写入结构化字段。
4. 查询用户最近同公司的问题。
5. 增加完全重复去重，并限制历史排除提示的长度。
6. 历史问题最多注入 10 条、每条最多 100 字、总长度最多 1500 字。
7. 将 signatureQuestions 改为随机抽取，并加入压缩后的历史排除提示。

验收标准：同一学生连续进行 3 场同公司、同岗位的 fresh 面试，不出现完全相同的问题；历史排除提示始终不超过 1500 字；Prompt 不随历史场次无限增长。

### P1：问题原型和模式

1. 建立问题原型结构。
2. 将固定问题迁移为意图、角度和场景。
3. 实现 fresh、targeted、review 三种模式。
4. 记录问题回答后的表现标签。
5. 根据薄弱项选择下一场考察计划。

验收标准：同一意图可以根据不同简历项目生成不同场景的问题；review 可以重复原题，fresh 不会重复复盘题。

### P2：语义去重和质量评估

1. 接入 embedding 或其他语义相似度能力。
2. 增加生成后重试机制。
3. 建立问题重复率、意图覆盖率和用户满意度指标。
4. 增加问题策略版本管理。
5. 支持问题池和策略回滚。

验收标准：换一种说法但考察意图相同的问题能够被识别并按策略处理。

## 测试清单

### 单元测试

- 相同问题能够生成相同 hash。
- 中英文标点差异不会绕过 hash 去重。
- 同一意图在排除窗口内能够被拦截。
- review 模式不污染 fresh 历史。
- 不同用户之间的问题历史完全隔离。
- 不同企业之间的问题历史不会互相排除。
- 历史问题超过 10 条时只保留最近 10 条。
- 单条问题和历史排除提示都不会超过字符上限。
- 完整历史只在数据库保存，不会全部注入 Prompt。

### 接口测试

- 新会话正确保存 DNA 版本。
- 继续会话不读取新发布的 DNA 版本。
- 问题生成失败时能够重试。
- 问题记录写入失败不会泄露错误信息。
- 客户端传入其他 user_id 不会影响查询范围。

### 产品验收

- 同一企业风格在多场面试中保持一致。
- 连续 3 至 5 场后仍然可以生成未使用过的问题。
- 薄弱项能够被重复训练，但不是重复原题。
- 用户可以明确选择“新题”或“复盘”。
- 管理员可以判断问题重复是 DNA 问题还是去重策略问题。

## 推荐实施顺序

不要一开始就接入 embedding 或构建复杂题库，建议按以下顺序开发：

~~~text
DNA 版本快照
  -> 问题结构化记录
  -> 完全重复去重
  -> Prompt 长度上限
  -> intent_key 去重
  -> 三种练习模式
  -> 问题原型
  -> 语义去重
  -> 质量统计和后台运营
~~~

第一阶段完成后，系统就能解决最明显的“问题一模一样”；后续阶段再解决“换句话说但本质相同”和“根据个人表现自适应训练”。
