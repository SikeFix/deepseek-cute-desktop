# DeepSeek Cute Desktop

> 保留官方 DeepSeek 界面与核心功能的本地桌面客户端。

[中文](README.md) · [English](README.en.md) · [⭐ Star this project](https://github.com/SikeFix/deepseek-cute-desktop)

1.8.0 回归官方 DeepSeek 使用体验：移除自定义主题、动画、桌面宠物、悬浮顶栏和视觉覆盖层，只保留官方会话界面、历史记录、模型服务设置与本地运行能力。应用自带运行时，启动后不会要求用户安装 Node.js，也不会强制打开系统浏览器。

[下载最新版](https://github.com/SikeFix/deepseek-cute-desktop/releases/latest) · [提交 Issue](https://github.com/SikeFix/deepseek-cute-desktop/issues) · [查看更新日志](RELEASE_NOTES.md)

如果项目对你有帮助，欢迎点击右上角 **Star ⭐**。Star 会帮助更多用户发现项目，也支持后续维护和多语言文档更新。

## 直接下载

| 系统 | 下载 | 要求 |
| --- | --- | --- |
| macOS Apple Silicon | [DeepSeek-M2-1.8.0.dmg](https://github.com/SikeFix/deepseek-cute-desktop/releases/latest/download/DeepSeek-M2-1.8.0.dmg) | macOS 13.5+，M1/M2/M3/M4 |
| Windows x64 | [DeepSeek-Cute-Windows-x64-Setup-1.8.0.exe](https://github.com/SikeFix/deepseek-cute-desktop/releases/latest/download/DeepSeek-Cute-Windows-x64-Setup-1.8.0.exe) | Windows 10/11 x64 |

## 1.8.0 功能

- 官方 DeepSeek 会话界面和官方交互流程
- 本地运行 DeepSeek 内核，应用启动时自动准备服务
- 历史会话和工作区数据由本机管理
- 模型服务设置与连接状态提示
- 诊断信息复制与日志导出，方便提交 Issue
- API 密钥使用 macOS 钥匙串或 Windows DPAPI 加密保存，重复保存同一密钥不会重复授权或反复重启服务
- 更新由用户主动检查、确认和安装，不会强制更新
- 中文、English 双语说明文档；欢迎提交其他语言的翻译

## 安装

### macOS

打开 DMG，将 DeepSeek 拖入“应用程序”。发布包使用 ad-hoc 签名，未进行 Apple 公证；首次打开被拦截时，在 Finder 中右键应用并选择“打开”。

### Windows

下载 Setup EXE 后双击安装。发布包未购买商业代码签名证书，Windows 可能显示 SmartScreen 提示；运行前请先核对 SHA256。

## 故障排查

如果本地服务没有启动，请在等待页面复制诊断信息，并在 [Issue 页面](https://github.com/SikeFix/deepseek-cute-desktop/issues) 附上系统版本、应用版本和诊断报告。报告会脱敏 API 密钥等敏感值。

## 校验值

```text
13c308cd9ef55cea5e88c11340530711b0ea2b5e9aa5d0626be4f724867e2b7b  DeepSeek-M2-1.8.0.dmg
e3e3f905fbcc2bc50e4107585c49379d187c2656a1792cc9a858751fce3a8fda  DeepSeek-Cute-Windows-x64-Setup-1.8.0.exe
```

macOS 使用 `shasum -a 256 -c DeepSeek-M2-1.8.0.dmg.sha256`，Windows 使用 `certutil -hashfile DeepSeek-Cute-Windows-x64-Setup-1.8.0.exe SHA256`。

## 源码

- `windows/`：Electron 外壳、托盘和本地服务管理
- `macos/`：Swift + WebKit 原生外壳和本地服务管理

本项目不是 DeepSeek 官方产品，详情见 [NOTICE.md](NOTICE.md)。源码采用 MIT License，内置运行时保留各自许可证。
