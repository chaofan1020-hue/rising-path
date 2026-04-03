# PathUp AutoFill - Chrome 扩展

智能网申表单自动填写浏览器扩展，基于 PathUp 平台的简历字段映射。

## 功能特性

- 自动检测网页表单字段
- 根据配置的字段映射智能填充
- 支持姓名、邮箱、电话、教育背景、工作经历等字段
- 支持按公司名称配置特定映射
- 可视化状态指示器

## 安装步骤

### 1. 下载扩展文件

访问以下地址下载扩展文件：
```
{domain}/extension/
```

### 2. 在 Chrome 中加载扩展

1. 打开 Chrome，进入 `chrome://extensions/`
2. 开启右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择下载的 `extension` 文件夹

### 3. 配置 PathUp 平台地址

1. 点击扩展图标打开 popup
2. 输入你的 PathUp 平台地址（如：`https://pathup.example.com`）
3. 点击「同步简历数据」

### 4. 开始使用

访问招聘网站的网申页面，扩展会自动检测并填充表单字段。

## 字段支持

| 字段类型 | 支持状态 |
|---------|---------|
| 姓名 (name) | ✅ |
| 邮箱 (email) | ✅ |
| 电话 (phone) | ✅ |
| 地址 (location) | ✅ |
| 学校 (school) | ✅ |
| 学位 (degree) | ✅ |
| 专业 (major) | ✅ |
| 公司 (company) | ✅ |
| 职位 (job_title) | ✅ |
| 技能 (skills) | ✅ |
| LinkedIn | ✅ |

## 隐私说明

- 所有数据存储在本地 Chrome 存储中
- 不会上传任何个人信息到第三方
- 仅在用户主动操作时同步数据

## 文件结构

```
extension/
├── manifest.json      # 扩展配置文件
├── background.js      # 后台服务脚本
├── content.js         # 内容脚本（检测和填充表单）
├── popup.html         # 弹出页面 UI
├── popup.js           # 弹出页面逻辑
└── icons/
    ├── icon16.svg     # 图标 16px
    ├── icon48.svg     # 图标 48px
    └── icon128.svg    # 图标 128px
```

## 常见问题

### Q: 扩展图标不显示？
A: 确保 manifest.json 中的图标路径正确，或将 SVG 转换为 PNG 格式。

### Q: 表单没有自动填充？
A: 可能是该网站的表单字段名称不在支持列表中，可手动在 PathUp 配置字段映射。

### Q: 如何更新简历数据？
A: 在 popup 中点击「同步简历数据」按钮即可。

## 版本历史

- v1.0.0 - 初始版本，支持基础字段自动填充
