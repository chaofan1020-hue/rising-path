# 实时模拟面试语音架构

## 目标

模拟面试采用“用户语音实时识别 -> 最终句提交面试模型 -> 面试官语音分片播放”的链路：

```text
浏览器麦克风
  -> PCM16 / 16kHz / mono
  -> Rising Path WebSocket 代理
  -> qwen3-asr-flash-realtime
  -> partial / final
  -> /api/interview/chat SSE
  -> Cartesia WebSocket PCM
  -> Web Audio 播放队列
```

ASR 的中间结果只用于字幕预览，只有 `final` 事件可以调用 `submitAnswer`。这样可以避免模型在用户还没有说完时被重复触发。

## 服务入口

- `/ws/interview/asr`：校验 Supabase access token，代理阿里实时 ASR。
- `/ws/interview/tts`：校验 Supabase access token，代理 Cartesia WebSocket TTS。
- `/api/interview/asr`：原有整段 Base64 HTTP ASR，作为实时 ASR 失败时的 fallback。
- `/api/interview/tts`：原有完整 MP3 HTTP TTS，作为实时 TTS 失败时的 fallback。
- `/api/interview/chat`：保留现有 SSE 文本面试接口。

WebSocket 鉴权通过 `Sec-WebSocket-Protocol` 传递 Supabase access token，服务器端再调用 Supabase `auth.getUser`。阿里和 Cartesia 的密钥只存在服务端环境变量中。

## 环境变量

实时 ASR 至少需要：

```env
DASHSCOPE_API_KEY=...
ALIBABA_ASR_WORKSPACE_ID=...
ALIBABA_ASR_REALTIME_REGION=cn-beijing
ALIBABA_ASR_REALTIME_MODEL=qwen3-asr-flash-realtime
```

也可以直接设置 `ALIBABA_ASR_REALTIME_URL` 覆盖自动拼接的 Workspace 地址。实时 TTS 沿用已有 Cartesia 配置：

```env
CARTESIA_API_KEY=...
CARTESIA_MODEL=sonic-3.5
CARTESIA_VERSION=2026-03-01
CARTESIA_VOICE_ZH=...
CARTESIA_VOICE_EN=...
```

## 本地启动

必须使用自定义服务器，因为普通 `next dev` 不会加载本项目的 WebSocket upgrade 处理：

```bash
pnpm dev
```

生产环境使用：

```bash
pnpm build
pnpm start
```

反向代理必须支持 WebSocket upgrade，并将 `/ws/interview/asr` 与 `/ws/interview/tts` 转发到同一个 Node 进程。HTTPS 环境使用 `wss://`；本地 HTTP 环境使用 `ws://`。

## 运行策略

1. 用户点击麦克风后建立实时 ASR 连接。
2. 服务端 VAD 负责判断说话开始与结束，前端不再用第二套 VAD 决定提交时机。
3. `partial` 事件更新临时字幕，`completed` 事件触发一次面试回答提交。
4. 用户回答期间暂停 ASR，面试官思考或说话期间停止采集，避免回声和重复提交。
5. 实时 ASR 连接失败时自动切换到原有 MediaRecorder + Base64 HTTP ASR。
6. Cartesia 实时音频连接失败时自动切换到完整 MP3 HTTP TTS。

## 部署检查

- [ ] 服务器配置了 `ALIBABA_ASR_WORKSPACE_ID` 或完整的 `ALIBABA_ASR_REALTIME_URL`。
- [ ] 阿里 API Key 与 Workspace 所在地域一致。
- [ ] Cartesia 的中文/英文 Voice ID 已配置。
- [ ] 生产反向代理开启 WebSocket upgrade 和足够长的 idle timeout。
- [ ] `pnpm start` 使用的是本项目构建出的 `dist/server.js`。
- [ ] 浏览器控制台能看到实时字幕，且一段回答只产生一次 `/api/interview/chat` 请求。
- [ ] 关闭麦克风、离开页面、结束面试后没有持续的 WebSocket 或麦克风轨道。

## 常见问题

### 实时模式立即降级

优先检查 Workspace ID、地域、API Key 和生产进程是否为 `pnpm start`。如果只启动了 `next start`，HTTP 页面能打开，但实时 WebSocket 不会工作。

### 有字幕但没有声音

检查 Cartesia Voice ID、浏览器 AudioContext 是否已在用户点击后恢复，以及反向代理是否允许 WebSocket。HTTP MP3 fallback 仍可用于区分 Cartesia 账号配置问题与浏览器播放问题。

### 识别结果被拆得太碎

实时 ASR 的服务端 VAD 当前使用 `silence_duration_ms=400`。面试回答中自然停顿较多时，可调整到 `800` 或更高；不要同时让前端静音计时器和服务端 VAD 都决定一句话结束。
