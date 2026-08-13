# 阶段四：简历优化闭环

## 本轮目标

把简历优化从浏览器临时结果升级为用户隔离、岗位绑定、画像版本可追溯的服务端优化版本。

## 已完成

- 新增 `src/lib/optimized-resume-contract.ts`，统一优化结果的 Zod 运行时校验和模型 JSON Schema。
- AI 返回非法 JSON 或字段结构不完整时返回 502，不再把未验证的原始文本当作成功结果。
- 新增 `supabase/migrations/0011_resume_optimizations.sql`。
- `resume_optimizations` 保存：用户、简历、目标岗位、画像版本、原始内容、不可变结构化优化内容、审核后的结构化内容、用户编辑文本和时间。
- 新增 RLS，优化版本只能由所属用户读取、修改和删除。
- `POST /api/ai/optimize` 支持 `jobId`，自动读取岗位公司、职位、地区和 JD，并保存优化版本。
- `GET /api/ai/optimize` 读取当前用户的服务端优化历史。
- `PATCH /api/ai/optimize` 保存审核后的结构化结果、变更项状态和编辑器文本；不会覆盖 AI 原始优化结果。
- `DELETE /api/ai/optimize` 删除当前用户自己的优化版本。
- `POST /api/ai/optimize/score` 使用同一岗位和评分维度对比原始/优化简历，并保存结果。
- 优化页面不再依赖 `localStorage`；AI Match 和岗位详情评分可以直接进入目标岗位优化。
- 变更项支持逐条接受、拒绝和撤销；拒绝项会恢复对应结构化字段，撤销后重新从不可变 AI 结果计算。

## 当前接口约定

```text
POST /api/ai/optimize
  resumeId       必填，必须是用户拥有且已确认的简历
  jobId          可选，存在时必须是有效的在招岗位
  targetCompany  可选
  targetPosition 可选；没有 jobId 时必填
  targetRegion   可选
  suggestions    可选
  jdContent      可选

GET /api/ai/optimize?resumeId=&jobId=
PATCH /api/ai/optimize { optimizationId, resumeData, editedContent, changeItems, isEnglish }
DELETE /api/ai/optimize { optimizationId }
POST /api/ai/optimize/score { optimizationId }
```

## 验收结果

- `pnpm run test:phase4` 通过，覆盖默认字段归一化、代码围栏 JSON、非法输出、评分对比和变更审核恢复。
- `pnpm run ts-check`、`pnpm run lint:build` 和 `pnpm run build` 通过。
- 未登录访问优化历史返回 401。
- 优化前后评分比较契约和未登录接口检查已通过。
- 未配置真实 AI 凭据和未执行 `0011` 远程迁移，因此真实优化生成和保存尚未完成浏览器验收。

## 未完成与下一步

1. 执行 `0011_resume_optimizations.sql`，使用真实 Alibaba 凭据完成生成和保存回归。
2. 生成优化版本后由用户明确确认，才能用于投递。
3. 增加 PDF/DOCX 导出版本的排版验收和移动端检查。
