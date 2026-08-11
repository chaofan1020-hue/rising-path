# AI 供应商架构

## 当前状态

项目此前在多个接口内直接创建 Coze 的 `LLMClient`。现在已经统一通过 `src/lib/ai/text-provider.ts` 创建服务端阿里云文本模型客户端，业务代码不再直接依赖供应商构造函数。

当前唯一文本模型配置为：

```text
AI_PROVIDER=alibaba
DASHSCOPE_API_KEY=...
ALIBABA_MODEL=qwen3.7-plus
ALIBABA_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

阿里 provider 使用百炼的 OpenAI 兼容 Chat Completions 接口，并将项目的结构化输出请求映射为 JSON Mode。生产环境建议使用阿里业务空间专属 Base URL，并保证 Base URL 与 API Key 属于同一地域和计费方案。

## 已迁移的主链路

- 简历基础字段和求职画像解析。
- AI 岗位匹配。
- ATS 简历优化。
- 模拟面试对话。

ASR 已切换到阿里云 Qwen3-ASR-Flash；岗位描述生成、企业 DNA 生成和翻译也已统一复用阿里文本 provider。TTS 独立使用 Cartesia，不与文本模型供应商耦合。

## 面试 TTS：Cartesia 接入

模拟面试语音统一从以下接口进入：

```text
POST /api/interview/tts
```

前端不需要知道 Cartesia 的具体调用方式。服务端通过 `src/lib/tts-provider.ts` 统一返回同源音频字节，保留当前前端的 Blob 播放和频谱分析逻辑。

启用 Cartesia：

```text
TTS_PROVIDER=cartesia
CARTESIA_API_KEY=...
CARTESIA_MODEL=sonic-3.5
CARTESIA_VERSION=2026-03-01
CARTESIA_VOICE_ZH=...
CARTESIA_VOICE_EN=...
```

当前使用 Cartesia Bytes API，输出 MP3，适合无须改动前端的第一阶段接入。Cartesia 的 Voice ID 与旧 Coze speaker ID 不兼容；服务端会忽略旧格式的 `zh_female_*` / `saturn_*` 值，改用对应语言的 Cartesia 默认音色。若需要给某个面试官指定 Cartesia 音色，可以传入 UUID，或传入 `cartesia:<voice-id>`。

下一阶段如果需要更低首字节延迟，再增加独立的流式接口：

```text
POST /api/interview/tts/stream
```

该接口应代理 Cartesia SSE 或 WebSocket，并配合前端 PCM 播放队列；不能把 SSE 的 Base64 音频块直接当作 MP3 Blob 播放。

## 切换规则

- 不在浏览器暴露任何 AI 密钥。
- 生产环境必须显式设置 `AI_PROVIDER=alibaba`。
- 模型名称用环境变量固定，不使用会自动漂移的 `latest` 别名。
- 阿里模型和 ASR 的 `DASHSCOPE_API_KEY` 只放在服务端环境变量中，不提交到仓库，也不暴露给浏览器。
- 供应商切换后必须使用同一组简历和岗位回归样本重新评分，不能直接比较不同模型的历史分数。
- AI 输出仍必须经过应用层 Zod 校验；模型返回合法 JSON 不等于业务判断正确。

## 后续工作

1. 配置真实 DashScope 和 Cartesia 凭据，分别完成一份真实简历解析与一段真实面试语音。
2. 给阿里文本、ASR 和 Cartesia TTS 调用保存 provider、model、耗时和错误类型，支持质量与成本审计。
3. 对岗位匹配引入确定性维度计算，模型只负责证据解释和差距总结。
4. 为实时 ASR 增加 WebSocket 接口，为 Cartesia TTS 增加流式音频播放接口。
