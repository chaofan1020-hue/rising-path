# 实时面试 B 方案：流式 + 提前规划

## 目标

候选人确认回答后尽快听到面试官，同时保持企业 DNA、岗位、简历证据和事实台账带来的问题质量。

## 链路

```text
Silero VAD speech end + ASR segment final
  -> current candidateEpoch draft
  -> 850ms ASR 追平 + 最多 900ms 句尾语义缓冲（恢复说话则取消）
  -> 后台 turn-plan（可失败，不阻塞）
  -> 自动提交
  -> /api/interview/chat（固定幂等键 + revision）
  -> 强模型流式输出
  -> 首个完整句子立即 TTS
  -> 后续句子继续排队播放
```

规划器只选择意图、维度、场景、角度和相关简历证据，不生成候选人可见话术。服务端使用 `session_seed + sessionId + revision + answer hash` 签名，聊天接口只接受签名规划，客户端不能伪造岗位或公司策略。正常语音作答不需要候选人点击确认：Silero VAD 先确认至少 420ms 的真实语音，ASR segment final 再追加到当前 `candidateEpoch` 草稿。只有在神经 VAD 的 1800ms 赎回窗口结束后，才等待 850ms ASR 追平；句尾仍为连接词或未完句时再增加最多 900ms。候选人重新开口会取消提交并继续合并，旧 epoch 的迟到事件被丢弃。只有发送失败时才显示“重试发送 / 丢弃识别稿”的紧急处理。

面试官字幕不跟随模型 token 提前显示。每个 TTS 片段绑定一个播放回调，实时 PCM 首次排程或 HTTP fallback 的 `audio.play` 事件触发后才揭示对应字幕片段，字幕片段按音频队列顺序追加，避免“先看到完整问题、后听到声音”。PCM 短片段结束时和整轮音频排空后均会回填，保证最终字幕与面试官完整话术一致。

实现约束：规划请求在 ASR `final` 进入待确认字幕时后台启动；候选人点击提交后只读取已经完成的规划缓存，不等待规划 HTTP 返回。缓存命中时为强模型补充意图和证据角度，未命中时立即进入同一套强模型流式路径，并在 `ai_usage_events.metadata.strategy_fallback` 记录降级。

## 错误恢复

- 识别字幕在服务端确认 `turn.completed` 前一直保留。
- 发送失败时保留原字幕和同一个 `clientRequestId`，重试请求优先回放已提交结果。
- `REVISION_CONFLICT` 会同步服务端 revision 并自动重试一次；`REQUEST_IN_FLIGHT` 不重复调用模型。
- SSE 断线但服务端已提交时，通过幂等键读取结构化 turn，不产生第二次模型调用或扣费。
- 自动提交遇到网络、revision 或服务端错误时，识别稿保留在本地并进入紧急重试状态；不会自动重复发送，也不会丢弃候选人的回答。

## 质量保护

最终提问仍由强模型基于 `context_digest + facts_ledger + 相关原始证据` 生成。规划器失败只记录缺失，不阻塞面试；模型仍须遵守单问题、岗位相关、公司风格、无评价和不重复规则。

## 观测指标

记录 `turn_plan` 是否命中、首 token、首音、完整生成、TTS fallback、revision 冲突、请求回放和最终提交成功率。目标为首 token P95 < 1.5 秒，首音 P95 < 1.8 秒，turn 成功率 > 99%，重复提交接近 0。
