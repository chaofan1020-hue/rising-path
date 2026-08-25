# Liorvix Auto Apply

加载方式：Chrome `chrome://extensions`、Edge `edge://extensions` 或其他 Chromium 浏览器的扩展管理页 → 开发者模式 → 加载已解压的扩展程序 → 选择本目录。

使用前先在本地 Liorvix 页面登录（例如 `http://localhost:5000` 或 `http://localhost:5057`），扩展会自动跟随当前页面地址连接 API，并保持扩展 Popup 显示“已连接”。Chrome、Edge、Brave、Arc 等 Chromium 浏览器共用这份 Manifest V3 扩展。

Firefox 不在当前构建的兼容范围内；如需支持，需要单独适配 Firefox 的扩展 API 和发布包。

当前版本只做“识别 + 填写”，不会点击提交；文件上传字段需要手动选择文件。
