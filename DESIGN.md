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

## 模拟面试间（沉浸式视频会议语言）
- 布局：面试官全屏主画面 + 候选人右下角画中画悬浮小窗（PiP），真实会议感
- 背景：深色 zinc-950 底 + 赤陶/灰绿 8-10% 透明度径向微光
- 面试官形象：大头像 + 说话时多层波纹扩散动画；身份卡含姓名/头衔/公司/人格标签
- 字幕：电影式底部居中浮层（半透明黑 + 毛玻璃），仅显当前对话
- 控制栏：底部中央悬浮毛玻璃胶囊（字幕开关/麦克风主按钮/面试记录/结束通话）
- 面试记录：右侧滑出抽屉，展示完整对话流
- 顶部栏：极简单行毛玻璃条（面试官信息 + 轮次进度 + 倒计时）
- 覆盖层：轮次切换/等待焦虑全屏毛玻璃（zinc-950/95 + backdrop-blur）

### 面试官全息虚拟形象
- 形象素材：AI 生成的科幻全息人像（/public/hologram-male.png、/public/hologram-female.png，按面试官 gender 选用；黑底、半透明青色全息、自带扫描线与粒子 glitch）
- 呈现方式：`mix-blend-mode: screen` 让黑底融入深色背景，营造投影悬浮感
- 全息动效（globals.css）：
  - `holo-figure`：透明度/位移微抖动闪烁（holo-flicker 4.2s steps）
  - `holo-scanlines`：青色水平扫描线匀速下滚（holo-scan 6s linear）
  - `holo-base`：底部椭圆青色光环呼吸脉冲（holo-base-pulse 2.8s）
  - `holo-figure-speaking`：说话状态增亮增饱和 + cyan drop-shadow
- 说话联动：青色圆环双层扩散（border-cyan-400 ping）+ 语音条用 cyan-400
- 尺寸：主画面 h-56/w-56（md:h-80/w-80），轮次切换覆盖层 h-28/w-28
