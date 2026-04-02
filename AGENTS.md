# 项目上下文

### 项目概述

**PathUp** - 专为海外留学生打造的一站式求职平台，提供岗位查询、AI选岗、简历优化、自动网申等功能。

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
- user_info (JSONB), created_at, updated_at

### applications (网申记录表)
- id, job_id, resume_id, status, notes
- submitted_at, created_at, updated_at

### application_fields (网申字段映射表)
- id, job_id, field_name, field_value, field_type

### ai_matches (AI匹配记录表)
- id, resume_id, job_id, match_score
- match_reason, suggestions, created_at

### access_codes (访问码表)
- id, code, name, duration_days, expires_at
- is_active, created_at, last_used_at

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
2. **简历管理** - 上传、解析、管理简历
3. **AI选岗** - 基于简历智能匹配岗位
4. **ATS简历优化** - 针对ATS系统优化简历
5. **自动网申** - 学习记录网申字段，自动填写表单
6. **访问码管理** - 生成、管理用户访问权限

## API 接口清单

| 路径 | 方法 | 功能 |
|------|------|------|
| /api/jobs | GET/POST | 获取/创建岗位 |
| /api/resume | GET/POST | 获取/上传简历 |
| /api/resume/[id] | DELETE | 删除简历 |
| /api/applications | GET/POST | 获取/创建网申记录 |
| /api/ai/match | POST | AI岗位匹配 |
| /api/ai/optimize | POST | AI简历优化 |
| /api/access-codes | GET/POST | 获取/创建访问码 |
| /api/access-codes/[id] | PATCH/DELETE | 更新/删除访问码 |
| /api/access-codes/verify | POST | 验证访问码 |
