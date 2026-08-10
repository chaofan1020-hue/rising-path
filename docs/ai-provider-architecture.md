# AI 供应商架构

## 当前状态

项目此前在多个接口内直接创建 `coze-coding-dev-sdk` 的 `LLMClient`。现在已经统一通过 `src/lib/ai/text-provider.ts` 创建服务端文本模型客户端，业务代码不再直接依赖供应商构造函数。

默认配置仍为：

```text
AI_PROVIDER=coze
```

因此已有 Coze 环境不需要修改业务逻辑。配置：

```text
AI_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5-mini
```

即可切换到 OpenAI Responses API。OpenAI 请求使用 `store: false`，避免把简历和面试内容交给 API 层长期保存；应用自己的 Supabase 快照仍按项目版本规则保存。

也可以切换到阿里云百炼/通义千问：

```text
AI_PROVIDER=alibaba
DASHSCOPE_API_KEY=...
ALIBABA_MODEL=qwen3.7-plus
ALIBABA_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

阿里 provider 使用百炼的 OpenAI 兼容 Chat Completions 接口，并将项目的结构化输出请求映射为 JSON Mode。这样可以复用现有的流式接口，同时由应用层的 Zod 合约继续校验结果。生产环境建议使用阿里业务空间专属 Base URL，并保证 Base URL 与 API Key 属于同一地域和计费方案。

## 已迁移的主链路

- 简历基础字段和求职画像解析。
- AI 岗位匹配。
- ATS 简历优化。
- 模拟面试对话。

ASR、TTS、岗位描述生成、企业 DNA 生成和翻译等其他能力仍使用原有 Coze 专用客户端，后续可以按同一适配层继续迁移。

## 切换规则

- 不在浏览器暴露任何 AI 密钥。
- 生产环境必须显式设置 `AI_PROVIDER`，不要依赖默认值。
- 模型名称用环境变量固定，不使用会自动漂移的 `latest` 别名。
- 阿里模型的 `DASHSCOPE_API_KEY` 只放在服务端环境变量中，不提交到仓库，也不暴露给浏览器。
- 供应商切换后必须使用同一组简历和岗位回归样本重新评分，不能直接比较不同模型的历史分数。
- AI 输出仍必须经过应用层 Zod 校验；模型返回合法 JSON 不等于业务判断正确。

## 后续工作

1. 配置真实 Coze 或 OpenAI 凭据并完成一份真实简历解析。
2. 已为 AI 选岗接入 OpenAI Responses API 的 JSON Schema Structured Outputs；应用层仍保留 Zod 校验。
3. 对岗位匹配引入确定性维度计算，模型只负责证据解释和差距总结。
4. 给 AI 调用保存 provider、model、耗时和错误类型，支持质量与成本审计。
