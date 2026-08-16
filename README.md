# DeepSeek Cute Desktop

下载即用的本地 DeepSeek 桌面端：一套完整的暖色正太主题、会互动的桌面宠物，以及任务完成提醒。macOS 和 Windows 都不需要用户额外安装 Node.js 或手动运行 `dsh web`。

[下载最新版](https://github.com/SikeFix/deepseek-cute-desktop/releases/latest)

![真实界面](docs/images/real-ui.png)

> 上图为真实应用界面截图。下方三图为 AI 生成的场景展示，用来呈现桌面搭配效果。

## 直接下载

| 系统 | 下载 | 要求 |
| --- | --- | --- |
| macOS Apple Silicon | [DeepSeek-M2-1.4.0.dmg](https://github.com/SikeFix/deepseek-cute-desktop/releases/latest/download/DeepSeek-M2-1.4.0.dmg) | macOS 13.5+，M1/M2/M3/M4 |
| Windows x64 | [DeepSeek-Cute-Windows-x64-Setup-1.4.1.exe](https://github.com/SikeFix/deepseek-cute-desktop/releases/latest/download/DeepSeek-Cute-Windows-x64-Setup-1.4.1.exe) | Windows 10/11 x64 |

## 主题体验

- 全局暖奶油底色，珊瑚橙、薄荷绿与阳光黄按钮系统
- 沉浸式标题栏与统一的可爱图标，不再出现突兀白条或蓝色状态文字
- 点击应用自动启动本地 DeepSeek 服务，无需终端命令
- 可拖动、可点击、可右键的桌面宠物
- 思考、完成、错误等状态使用不同表情与动作
- 任务完成时弹出系统通知，点击通知可返回应用
- 主窗口关闭后驻留托盘/菜单栏，后台继续等待任务
- 自动从 GitHub Release 检查并下载更新，显示速度与百分比
- 标题栏和托盘都可手动检查更新，下载完成后一键重启安装
- 分阶段启动反馈与诊断日志，服务异常不再静默等待

## 场景展示（AI 生成）

![暖色桌面场景](docs/images/scene-evening.png)

![明亮桌面场景](docs/images/scene-daytime.png)

![夜间创作场景](docs/images/scene-night.png)

## 安装提示

### macOS

打开 DMG，把 DeepSeek 拖入“应用程序”。发布包为社区构建，采用 ad-hoc 签名、未做 Apple 公证；若系统首次拦截，请在 Finder 中右键应用并选择“打开”。

### Windows

下载 Setup EXE 后双击，只需完成一次安装，之后从桌面快捷方式启动。旧的 1.0.0 便携版每次运行都要临时解压整套 Electron 与本地运行时，因此在 Windows 11 上启动很慢；1.4.1 起改用 NSIS 安装版，后续启动无需重复解压，并支持自动更新。当前发布包未购买商业代码签名证书，Windows 可能显示 SmartScreen 提示；请先核对本页 SHA256，再自行决定是否运行。

## 校验值

```text
2f5895a97222e0830078f416d13a829a750d5363f0dbe7cedd977a567df78b48  DeepSeek-M2-1.4.0.dmg
db73896515e4761caffc70348b9541dc762a20119f18eca3c40b0244efdc9459  DeepSeek-Cute-Windows-x64-Setup-1.4.1.exe
```

## 说明

- 模型账号、登录状态和工作区数据仍由每台电脑分别管理，不会打包进安装文件。
- macOS Apple Silicon 版已在 M2 环境完成安装、签名、内置服务启动与 HTTP 连通验证。
- Windows 版已完成 x64 构建、PE 架构、七级 ICO、NSIS 更新元数据、差分 blockmap 及内置原生依赖检查；由于本次构建环境是 macOS，仍建议首次 Windows 用户在 Issues 反馈兼容性。
- 项目不是 DeepSeek 官方产品，详情见 [NOTICE.md](NOTICE.md)。

## 源码

- `windows/`：Electron 壳、主题注入、桌宠、托盘与内置服务管理
- `macos/`：Swift + WebKit 原生壳、菜单栏、桌宠与服务管理

源码采用 MIT License。构建依赖和内置运行时保留各自许可证。
