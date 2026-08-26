# DeepSeek Cute Desktop 1.6.0

本次双端更新：界面主题可自由切换、新增模型服务设置（官方 DeepSeek / 本地千问），并升级到支持最新图片模型的 DeepSeek Harness 0.1.1-rc.2 内核。

## 双端新功能

- 主题切换：标题栏一键在「DeepSeek 官方样式」和「正太主题」之间切换，选择自动保存；托盘/菜单栏同样可切
- 模型服务设置向导：可选择 DeepSeek 官方，或本地千问兼容接口（默认 qwen3.8-27b）
- 千问 API 密钥加密保存（Windows safeStorage / macOS Keychain），只显示不泄漏
- 切换官方 DeepSeek 热生效无需重启；切换千问会进入明确等待页并安全重启本地内核
- 内核升级：`@deepseek-ai/dsh` 0.1.0-rc.6 → 0.1.1-rc.2，支持最新图片模型与图片附件/Files API 管线

## 保留能力

- 点击即开：自动启动本地服务，无需终端命令
- 可拖动、可点击的桌面宠物与任务完成提醒
- 自动从 GitHub 检查更新：Windows 增量更新，macOS 下载新 DMG
- 分阶段启动反馈与诊断日志

## 下载

- `DeepSeek-M2-1.6.0.dmg`：macOS 13.5+，Apple Silicon（M1/M2/M3/M4）
- `DeepSeek-Cute-Windows-x64-Setup-1.6.0.exe`：Windows 10/11 x64 NSIS 安装版
- `latest.yml` 与 `.blockmap`：Windows 自动更新元数据
- 同名 `.sha256`：完整性校验

## 验证

Windows 1.6.0 已完成 electron-builder x64 构建、asar 打包清单核对（主题、模型设置向导、等待页、内置运行时与 Provider 助手齐全）、NSIS 元数据与 blockmap 校验。macOS 1.6.0 已在 M2 本机完成 Swift 编译、ad-hoc 签名、DMG 挂载验证。

## 签名说明

发布包是社区构建。Windows 版未使用商业代码签名证书（可能触发 SmartScreen 提示，请先核对 SHA256）；macOS 版采用 ad-hoc 签名且未公证，首次打开请右键选择“打开”。
