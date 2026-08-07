# 项目上下文

### 项目概述

**Rising Path** - 专为海外留学生打造的一站式求职平台，提供岗位查询、AI选岗、简历优化、自动网申等功能。

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4
- **数据库**: Supabase (PostgreSQL)
- **AI能力**: coze-coding-dev-sdk (LLM)
- **存储**: S3 兼容对象存储

## 目录结构

```
├── public/                 # 静态资源
├── scripts/                # 构建与启动脚本
├── src/
│   ├── app/                # 页面路由与API
│   │   ├── api/            # 后端API接口
│   │   │   ├── ai/         # AI相关接口 (match, optimize)
│   │   │   ├── jobs/       # 岗位管理接口
│   │   │   ├── resume/     # 简历管理接口
│   │   │   └── applications/ # 网申管理接口
│   │   ├── jobs/           # 岗位查询页面
│   │   ├── resume/         # 简历管理页面
│   │   ├── ai-match/       # AI选岗页面
│   │   ├── optimize/       # 简历优化页面
│   │   └── applications/   # 网申管理页面
│   ├── components/ui/      # Shadcn UI 组件库
│   ├── hooks/              # 自定义 Hooks
│   ├── lib/                # 工具库
│   │   └── utils.ts        # 通用工具函数 (cn)
│   ├── storage/database/   # 数据库相关
│   │   └── supabase-client.ts  # Supabase 客户端
│   └── server.ts           # 自定义服务端入口
├── next.config.ts          # Next.js 配置
├── package.json            # 项目依赖管理
└── tsconfig.json           # TypeScript 配置
```

## 数据库表结构

### jobs (岗位表)
- id, title, company, region, direction, audience
- description, requirements, salary_range, job_url
- created_at, updated_at

### resumes (简历表)
- id, file_key, file_name, parsed_content
- user_info (JSONB), user_id (UUID), created_at, updated_at
- **profile (JSONB)**：完整简历画像（教育含毕业年份/实习含时长/项目/技能/求职意向/语言版本）
- **segmentation (JSONB)**：用户分层结果（careerStage/schoolTier/regions/majorMatch/experienceQuality）
- **segmentation_overrides (JSONB)**：用户手动修正的分层字段
- **segmentation_confirmed (BOOLEAN)**：分层是否已确认

### interview_sessions (面试会话表)
- id, user_id (UUID), interview_type, job_description, job_id
- target_company, mode (single/gauntlet), total_rounds, current_round
- interviewer_ids (JSONB), messages (JSONB), status
- **resume_id (BIGINT)**：关联简历（分层标尺数据源）
- report (JSONB), report_grade, overall_score, created_at, updated_at

### company_dna (企业面试基因表)
- id, company_name, aliases (JSONB), dna (JSONB), source
- hit_count, **version**, **manually_edited**, **review_notes**, created_at, updated_at

### interview_feedback (面试真实度反馈表)
- id, session_id (unique FK), user_id (UUID), company
- realism_score (1-10), feedback_text, status (pending_review/high_quality/reviewed)
- dna_source, dna_version（基因版本快照，追溯"评分针对哪版基因"）
- review_notes, created_at, updated_at

### applications (网申记录表)
- id, job_id, resume_id, status, notes
- user_id (UUID), submitted_at, created_at, updated_at

### application_fields (网申字段映射表)
- id, job_id, field_name, field_value, field_type

### ai_matches (AI匹配记录表)
- id, resume_id, job_id, match_score
- match_reason, suggestions, user_id (UUID), created_at

### profiles (用户资料表)
- id (UUID, FK auth.users), display_name, avatar_url
- created_at, updated_at

## 数据隔离说明

每个 Supabase Auth 用户对应独立的用户空间：
- 简历、网申、AI匹配、字段映射、收藏、面试会话和反馈按 `user_id` 隔离
- 后端 API 必须从 Bearer token 获取用户身份，不能信任客户端传入的 `user_id`
- PostgreSQL RLS 以 `auth.uid()` 作为第二道数据隔离边界
- 岗位数据为公共数据，所有用户共享

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。

## 开发规范

- **项目理解加速**：初始可以依赖项目下`package.json`文件理解项目类型
- **Hydration 错误预防**：严禁在 JSX 渲染逻辑中直接使用动态数据
- **前后端分离**：前端调用后端 API，后端处理数据库和第三方服务

## UI 设计与组件规范

- 项目使用 `shadcn/ui` 组件库，位于 `src/components/ui/` 目录
- 遵循 shadcn/ui 的设计规范和最佳实践

## 核心功能

1. **岗位查询** - 按地区、方向、受众筛选岗位
2. **简历管理** - 上传、解析、管理简历（解析后自动生成用户分层画像）
3. **用户分层** - 求职阶段×院校背景×专业匹配度×地区（第一权重），驱动差异化策略
4. **AI选岗** - 基于简历智能匹配岗位
5. **ATS简历优化** - 针对ATS系统优化简历（按地区招聘逻辑+用户分层差异化）
6. **模拟面试** - 企业面试基因库 + 分层评估标尺 + 真实度反馈闭环
7. **自动网申** - 学习记录网申字段，自动填写表单
8. **账号体系** - Google OAuth、邮箱密码、邮箱验证码和邮箱验证

## 关键库文件

- `src/lib/region-dna.ts` - 地区招聘逻辑库（美/英/新/国内一线/国内二三线）
- `src/lib/user-segmentation.ts` - 用户分层引擎（院校库/推导规则/评估标尺 prompt 块）
- `src/lib/company-dna.ts` - 企业面试基因库（12 家精调）
- `src/lib/company-dna-service.ts` - 基因四级获取（manual > curated > cached > generated）
- `src/components/segmentation-card.tsx` - 简历页分层确认卡片（透明展示+可修正）

## API 接口清单

| 路径 | 方法 | 功能 |
|------|------|------|
| /api/jobs | GET/POST | 获取/创建岗位 |
| /api/auth/register | POST | 邮箱注册（密码策略、限流、可选 Turnstile） |
| /api/auth/login | POST | 邮箱密码登录（IP/邮箱限流） |
| /api/auth/reset | POST | 发送密码重置邮件 |
| /api/auth/resend | POST | 重发邮箱验证邮件 |
| /api/auth/otp | POST | 发送邮箱验证码 |
| /api/auth/otp/verify | POST | 验证邮箱验证码并建立会话 |
| /api/resume | GET/POST | 获取/上传简历（后台异步：解析+画像提取+分层推导） |
| /api/resume/[id] | PATCH/DELETE | 修正用户分层/删除简历 |
| /api/applications | GET/POST | 获取/创建网申记录 |
| /api/ai/match | POST | AI岗位匹配 |
| /api/ai/optimize | POST | AI简历优化（注入地区规则+分层上下文） |
| /api/interview/chat | POST | 模拟面试（流式；新会话/继续/轮次切换） |
| /api/interview/feedback | POST | 面试真实度反馈（<6分进人工审查） |
| /api/company-dna | GET/PATCH | 获取企业基因摘要/人工更新基因（version+1） |
| /api/admin/dna-feedback | GET | 反馈审查列表 |
| /api/admin/dna-feedback/[id] | GET/PATCH | 反馈详情（含对话+当前基因）/标记处理 |
