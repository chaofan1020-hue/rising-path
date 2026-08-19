# AI 供应商架构

## 当前状态

项目的文本 AI 已统一通过 `src/lib/ai/text-provider.ts` 创建服务端阿里云文本模型客户端，业务代码不直接依赖供应商 SDK。

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
- 模拟面试编排与语音链路。纯语音面试中，文本模型只负责生成候选人可见的面试官话术；轮次推进、淘汰、结束和会话状态由服务端状态机及结构化会话字段决定，不能由模型文本标记控制。候选人输入必须来自 ASR。

ASR 已切换到阿里云 Qwen3-ASR-Flash；岗位描述生成、企业 DNA 生成和翻译也已统一复用阿里文本 provider。TTS 独立使用 Cartesia，不与文本模型供应商耦合。

## 面试 TTS：Cartesia 接入

模拟面试语音统一从以下接口进入；候选人没有文本输入通道：

```text
POST /api/interview/tts
```

前端不需要知道 Cartesia 的具体调用方式。服务端通过 `src/lib/tts-provider.ts` 统一返回同源音频字节，保留当前前端的 Blob 播放和频谱分析逻辑。所有 HTTP fallback 都必须绑定进行中的面试会话。

启用 Cartesia：

```text
TTS_PROVIDER=cartesia
CARTESIA_API_KEY=...
CARTESIA_MODEL=sonic-3.5
CARTESIA_VERSION=2026-03-01
CARTESIA_VOICE_ZH=...
CARTESIA_VOICE_EN=...
```

HTTP 路径使用 Cartesia Bytes API 输出 MP3，仅作为实时链路失败时的单一路径 fallback。若需要给某个面试官指定 Cartesia 音色，可以传入 UUID，或传入 `cartesia:<voice-id>`。

当前实时面试使用自定义 server 的会话级 WebSocket TTS。浏览器复用一个连接，以 `requestId` 连续发送 `speak` 和 `cancel`；结束面试、切换轮次、打断和卸载时会取消播放并释放连接及音频资源。HTTP MP3 仅作为单一路径 fallback，不能与同一段实时合成并行预取。若未来需要更低首字节延迟，再扩展独立的上游会话复用协议：

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
4. 为实时 ASR 补齐 `pause`、`resume`、`finalize` 会话协议、每日额度及端到端延迟监控。
