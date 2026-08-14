# 实时模拟面试语音架构

## 目标

模拟面试是纯语音全真模拟：候选人只能通过麦克风回答，系统将语音实时识别为最终句后提交面试模型，再把面试官回复合成为语音播放。不存在文本回答替代入口。

```text
浏览器麦克风
  -> 克隆音轨 -> Silero 神经 VAD / 语义端点
  -> PCM16 / 16kHz / mono
  -> Rising Path WebSocket 代理
  -> qwen3-asr-flash-realtime
  -> partial / final
  -> /api/interview/chat SSE
  -> Cartesia WebSocket PCM
  -> Web Audio 播放队列
```

ASR 的中间结果只用于字幕预览，并以 80ms 节流合并，避免 React 重绘导致字幕抖动。Provider `final` 只追加到当前回答草稿；Silero VAD 在独立的克隆音轨上判定真实语音边界，只有其 1.8 秒静音赎回窗口结束、ASR 结果追平并通过句尾语义缓冲后才调用 `submitAnswer`。

## 服务入口

- `/ws/interview/asr`：校验一次性、短期、绑定会话的 ASR ticket，代理阿里实时 ASR。
- `/ws/interview/tts`：校验一次性、短期、绑定会话的 TTS ticket，代理 Cartesia WebSocket TTS。
- `/api/interview/asr`：整段 Base64 HTTP ASR，仅作为实时 ASR 失败时的 fallback，必须绑定进行中的会话。
- `/api/interview/tts`：完整 MP3 HTTP TTS，仅作为实时 TTS 失败时的 fallback，必须绑定进行中的会话。
- `/api/interview/chat`：保留 SSE 编排入口；候选人回答只接受 `asr` 或 `asr_fallback`，开场和控制动作使用 `system`。

浏览器先调用 `/api/interview/realtime-ticket` 获取一次性 ticket。WebSocket 升级阶段只携带 ticket，首条 `start/speak` 消息还必须提供同一个 `sessionId`；服务端同时检查该会话属于当前用户且仍为 `in_progress`。长期 Supabase access token 不进入 WebSocket 协议。

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

服务端的内置 Cartesia catalog 会按 `语言 + 企业 DNA 风格 + 面试官人格 + 性别 + 轮次` 分配实际 voice ID；同一场内同一面试官保持一致，不同轮次优先使用不同声音。可选环境变量 `CARTESIA_VOICE_{ZH|EN}_{STYLE}_{FEMALE|MALE}` 用于覆盖某个组合，例如 `CARTESIA_VOICE_EN_EXECUTIVE_MALE`。不要再把非 Cartesia UUID 的旧供应商音色别名填入这些变量。

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

1. 浏览器复用麦克风预检权限并并行启动可选摄像头与开场请求。服务端并行读取确认简历、岗位、已有 DNA 与题目历史；创建并返回 `sessionId` 后，浏览器立即预热会话绑定的 TTS 和 ASR WebSocket。ASR 整场复用，但只在候选人作答窗口发送音频。开场只读取已有企业 DNA，最长等待 1.5 秒；未知公司直接按岗位 JD 开始，不在用户等待路径生成 DNA。
2. 服务端 VAD 继续产生 ASR 声学片段，但不拥有面试提交边界。浏览器使用 Silero v5 神经 VAD，在共享麦克风轨道的克隆上运行，`positive=0.60`、`negative=0.45`、`redemption=1800ms`、`minSpeech=420ms`。因此环境杂音和短促呼吸不会提交，用户在自然思考停顿后重新开口也会继续属于同一回答。
3. `partial` 事件只在本次语音片段达到至少 280ms 后更新临时字幕，并以 80ms 节流合并。服务端为每个 ASR 片段发出 `utteranceId`，客户端把它绑定到当前 `candidateEpoch`；旧 epoch 的 partial/final 一律丢弃，避免迟到识别稿进入下一题。神经 VAD 结束后额外等待 ASR 追平 850ms；文本以连接词、逗号或未完句结尾时增加最多 900ms 语义缓冲。只有自动提交失败时，页面才展示识别稿的“重试发送 / 丢弃”紧急操作。
4. 用户回答期间暂停 ASR，面试官思考或说话期间停止采集，避免回声和重复提交。
5. 实时 ASR 连接失败时，Silero 仍负责分段，浏览器将该段 16kHz WAV 送至 HTTP ASR fallback；只有不支持 WASM / AudioWorklet 的旧浏览器才回退到旧的 MediaRecorder 能量检测。
6. Cartesia TTS 每场面试复用一条浏览器 WebSocket；每个 `speak` 带唯一 `requestId`，`cancel` 只取消当前播放任务。完整的一条面试官话术只合成一次，字幕片段绑定到对应音频片段的实际开始播放回调，不提前展示模型流式文本。每个 PCM 分段在播放完成时都会进行字幕追平，整轮音频排空后以完整文本最终校正，避免漏回调后字幕永久停在半句。客户端先缓冲至少约 180ms 的 PCM，再在同一 AudioContext 时钟上连续排程，避免按标点拆分合成造成的断续。实时连接或合成失败后才切换到完整 MP3 HTTP TTS，同一段文字不会并行预取两路音频。
7. 面试文本模型调用明确关闭推理输出。创建会话时，服务端把完整 JD、DNA、确认后的简历画像编译为 `context_digest`；每轮维护 `facts_ledger`（已考察意图、候选人事实主张、未验证缺口和上一轮内容）。续答只传递摘要、当前回答、最近对话和按当前意图召回的 4 条以内原始简历证据。完整 JD、简历版本和所有 `interview_turns` 仍保存在数据库，报告引用原始对话，绝不以截断代替保存。每次调用记录 `phase`、`ttfb_ms`、`total_ms`、`fallback` 和 `retry_count`，用于定位首 token 与语音链路瓶颈。
8. 底部麦克风不再是会反复开关采集的按钮：候选人作答窗口显示采集状态，面试官播报时唯一可执行动作是打断当前播报。其余阶段只显示当前语音状态，避免 UI 状态与实际采样状态不一致。
9. 会话结束时，报告请求在面试官结束语播放期间并行启动；音频播完后才切到总结页。报告使用紧凑上下文、关闭模型推理、32 秒服务端超时与 38 秒客户端超时，超时或失败进入可重试状态，不允许无限加载。

## 会话与状态契约

- 候选人回答只接受 `asr` 或 `asr_fallback`，不提供文本回答入口。
- 新建面试必须从公司目录选择公司及其有效岗位；前端公司和岗位选择器都支持关键字筛选。客户端不再提供手动公司或手动 JD 入口，服务端以 `jobId` 中的公司与 JD 作为唯一事实来源。
- 续答请求必须携带 `sessionId`、`clientRequestId`、`revision` 与 `inputSource`。服务端先原子 claim 请求，再调用模型。
- 开场与续答的 JSON transcript、`interview_turns`、`interview_questions`、revision 和状态在 `commit_interview_turn` 中同一事务提交。
- `context_digest` 和 `facts_ledger` 与 transcript 在同一 `commit_interview_turn` 事务中更新。重试和 revision 冲突不会产生两份不同的记忆；旧会话在下一次成功续答时自动升级为 memory v1。
- SSE 事件统一包含 `eventId`、`requestId`、`revision`，事件类型为 `session.ready`、`turn.started`、`interviewer.delta`、`turn.completed`、`round.ended`、`session.completed` 或 `error`。
- `[ROUND_END]`、`[ELIMINATE]`、`[WRAP_UP]` 只作为旧模型输出的过滤残留，绝不改变会话状态。轮次推进与完成由服务端状态机和超时/配额策略决定。

## 部署检查

- [ ] 服务器配置了 `ALIBABA_ASR_WORKSPACE_ID` 或完整的 `ALIBABA_ASR_REALTIME_URL`。
- [ ] 阿里 API Key 与 Workspace 所在地域一致。
- [ ] Cartesia 的中文/英文 Voice ID 已配置。
- [ ] `public/vad/` 已随 `pnpm dev` 或 `pnpm build` 生成，且浏览器可请求 Silero 模型和 ONNX WASM 文件。
- [ ] 生产反向代理开启 WebSocket upgrade 和足够长的 idle timeout。
- [ ] `pnpm start` 使用的是本项目构建出的 `dist/server.js`。
- [ ] 浏览器控制台能看到实时字幕，且一段回答只产生一次 `/api/interview/chat` 请求。
- [ ] 连续三段面试官语音只建立一条 `/ws/interview/tts` 连接；打断、结束、离开页面都会发送 cancel/关闭连接并释放 AudioBuffer。
- [ ] 未拿到 `sessionId` 时不会申请 realtime ticket、启动 ASR 或调用 HTTP ASR/TTS。
- [ ] 拒绝麦克风、没有设备或设备被占用时明确阻断面试，并提供重试/诊断；不显示文本回答替代。
- [ ] 关闭麦克风、离开页面、结束面试后没有持续的 WebSocket 或麦克风轨道。

## 常见问题

### 实时模式立即降级

优先检查 Workspace ID、地域、API Key 和生产进程是否为 `pnpm start`。如果只启动了 `next start`，HTTP 页面能打开，但实时 WebSocket 不会工作。

### 有字幕但没有声音

检查 Cartesia Voice ID、浏览器 AudioContext 是否已在用户点击后恢复，以及反向代理是否允许 WebSocket。HTTP MP3 fallback 仍可用于区分 Cartesia 账号配置问题与浏览器播放问题。

### 识别结果被拆得太碎

实时 ASR 的服务端 VAD 默认使用 `silence_duration_ms=850`，只负责产生声学分段。面试回答的提交边界由 Silero 1.8 秒赎回窗口、ASR 追平和句尾语义缓冲共同决定，因此不能把 provider `final` 直接当作一次完整作答。
