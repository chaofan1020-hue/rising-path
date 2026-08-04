# DESIGN.md

## 品牌与视觉方向
- 品牌名称：Rising Path（yes! 风格）
- 视觉风格：温暖、自然、现代、亲和力强
- 灵感来源：yes! logo 配色方案

## Design Tokens

### 色彩
- 主色（Primary）：赤陶色 #C46A4A（温暖、活力）
- 辅助色（Secondary）：灰绿色 #B5BEB0（自然、平静）
- 强调色（Accent）：米色/沙色 #E2D0B8（温暖、柔和）
- 中性色（Neutral）：浅灰色 #C5C9CE（低调、平衡）
- 背景色：暖白色 #F5F0EB

### 渐变
- 主渐变：from-terracotta-600 to-sage-600
- 次渐变：from-sage-600 via-beige-500 to-gray-500
- 强调渐变：from-beige-600 via-terracotta-500 to-sage-500

### 字体
- 字体族：PingFang SC, Microsoft YaHei, system-ui

### 圆角
- 基础圆角：0.625rem (10px)
- 大圆角：calc(var(--radius) + 4px)

## 组件规范
- 按钮：使用赤陶色渐变背景
- 卡片：暖白色背景，微妙阴影
- 图标：使用主色或辅助色

## 交互与状态
- 悬停：颜色加深 10%
- 激活：颜色加深 20%
- 禁用：灰色 #C5C9CE

## 模拟面试间（视频会议语言）
- 设置页：不使用品牌主题色，采用中性黑白灰（zinc 系）——选中态为黑边框+浅灰底+黑字（暗色反转），主按钮为 zinc-900 实心黑（暗色为白），页面图标为黑/白纯色方块；必填星号用语义红 text-red-500；下拉选中项为 zinc-900 实心（暗色反转）
- 设置表单容器：响应式 Modal（src/components/ui/modal.tsx）——桌面端居中 Dialog（sm:max-w-2xl、max-h-88vh、Body 滚动），移动端底部 Drawer（vaul，自带 max-h-80vh）；进入页面默认打开，关闭后页面提供"打开面试设置"重开按钮
- 布局：顶部栏 + 双 16:9 并排画面（左面试官/右候选人，移动端纵向堆叠）+ 字幕条 + 底部控制栏
- 面试官画面：实时音波图（canvas + Web Audio 频谱分析 TTS 音频，赤陶→灰绿横向渐变柱条，不可用时降级正弦伪音波），下方姓名与状态文字、左下角"头衔·姓名·公司"标签
- 候选人画面：摄像头实时画面（video 常驻渲染、CSS 控制显隐），未开启时显示占位与开启按钮；右上角 REC 录制标记
- 字幕：视频区下方独立字幕条（深色毛玻璃），展示最近 4 条对话，面试官赤陶色/候选人灰绿色署名
- 控制栏：底部居中大圆麦克风按钮（点击开关免提，VAD 语音活动检测自动断句：RMS>0.02 判说话、停顿 1.2s 自动提交 ASR；AI 说话/思考/识别期间自动暂停监听，结束自动恢复）；常开时红色呼吸灯、检测到语音时红色放大；上方为麦克风错误分级提示区
- 顶部栏：深色毛玻璃条（面试官信息 + 闯关轮次进度点 + 角色标签 + 倒计时 + 字幕开关 + 结束按钮）
- 覆盖层：轮次切换/等待焦虑覆盖面试官画面（zinc-950/95 + backdrop-blur，随机 8-16 秒短等待）；淘汰为全屏覆盖层（fixed inset-0、zinc-950/95，PhoneOff 红色图标 + 标题 + 说明 + 转圈），面试官主动收尾的自然结束为同构覆盖层（Check 中性 zinc 图标），两者展示后均自动进入评估

## 简历管理页（极简黑白灰语言，参考 ResumeGPT footer 美学）
- 整体：不使用品牌主题色，全面 zinc 系单色——白底（暗色 zinc-950）、zinc-200/800 细腻边框、zinc-500 辅助文字、zinc-900 实心黑主按钮（暗色反转为白）
- Hero（参考 Tailark 式左对齐范式）：无水印、无主图标方块——左对齐 eyebrow 小标签（text-sm font-medium text-zinc-400，模块名如"简历中心"）+ 超大粗体标题（text-2xl md:text-4xl font-bold tracking-tight）+ 灰色副标题（text-zinc-500 max-w-2xl md:text-lg leading-relaxed）
- 上传区：大圆角（rounded-2xl）虚线 dropzone（border-dashed zinc-200 hover:border-zinc-400），居中图标 + 文案引导，选中文件后以 chip 展示 + 实心黑上传按钮
- 简历卡片：白底 zinc-200 边框、hover 时细腻阴影（shadow-zinc-900/5）；文件图标为黑色圆角小方块（与 Hero 方块同语言）；操作按钮为 ghost/outline 中性风，删除按钮仅 hover 显红
- 按钮 hover 高亮：统一中性浅灰底（hover:bg-zinc-100 dark:hover:bg-zinc-800）+ 文字加深（hover:text-zinc-900）——必须显式覆盖 Button 组件 outline/ghost variant 默认的 hover:bg-accent（全局 accent 为灰绿调，与本页语言冲突）
- 分层确认卡片：同页内嵌套使用，中性 zinc 系（去品牌渐变底），信息层级靠字重与灰度区分
- 排版：充裕留白（区块间距 mb-10+）、字重对比（标题 semibold tracking-tight / 正文 zinc-500）

## AI 选岗页 / ATS 优化页 / 岗位查询页（沿用简历页极简黑白灰语言）
- 与简历管理页同一套 zinc 单色语言：Hero 同为 Tailark 式左对齐范式（eyebrow 小标签——选岗"智能匹配"/优化"ATS 工作台"/岗位"岗位探索"+ 超大粗体标题 + 灰色副标题，无水印无主图标）、白底 zinc-200 边框卡片、zinc-900 实心主按钮（暗色反转）
- 卡片语言：rounded-2xl、border-zinc-200、去渐变去彩色顶条；区块标题图标统一黑色圆角小方块（w-6/7 h-6/7 rounded-lg bg-zinc-900 反白图标）
- 表单控件：Select/Input/textarea 中性边框；筛选 chip、提示卡（JD 结果/AI 建议/Tips）统一 zinc-50 底 + zinc-100/200 边框，原蓝/琥珀/赤陶提示色全部移除
- 分数与等级不做彩色语义：匹配分数为大号 zinc-900 黑字，等级徽章 zinc-900 实心（高匹配）或 zinc-100 灰底；原绿/黄/红评分色废弃
- 按钮 hover 同规范：outline/ghost 必须显式 hover:bg-zinc-100 dark:hover:bg-zinc-800 覆盖全局 accent
- 简历预览组件（ResumePreview）为"纸张"隐喻：保持白底黑字灰分隔线，不随页面语言改动
