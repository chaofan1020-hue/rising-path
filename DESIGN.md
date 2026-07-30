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
