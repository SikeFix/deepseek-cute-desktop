# DeepSeek Cute Desktop

下载即用的本地 DeepSeek 桌面端：暖色正太主题（可一键切回官方样式）、会互动的桌面宠物、任务完成提醒，以及官方 DeepSeek / 本地千问双模型服务。macOS 和 Windows 都不需要用户额外安装 Node.js 或手动运行 `dsh web`。

[下载最新版](https://github.com/SikeFix/deepseek-cute-desktop/releases/latest)

![真实界面](docs/images/real-ui.png)

> 上图为真实应用界面截图。下方三图为 AI 生成的场景展示，用来呈现桌面搭配效果。

## 直接下载

| 系统 | 下载 | 要求 |
| --- | --- | --- |
| macOS Apple Silicon | [DeepSeek-M2-1.6.0.dmg](https://github.com/SikeFix/deepseek-cute-desktop/releases/latest/download/DeepSeek-M2-1.6.0.dmg) | macOS 13.5+，M1/M2/M3/M4 |
| Windows x64 | [DeepSeek-Cute-Windows-x64-Setup-1.6.0.exe](https://github.com/SikeFix/deepseek-cute-desktop/releases/latest/download/DeepSeek-Cute-Windows-x64-Setup-1.6.0.exe) | Windows 10/11 x64 |

## 1.6.0 新功能

- 主题切换：标题栏一键切换「DeepSeek 官方样式 / 正太主题」，选择自动保存
- 模型服务设置：官方 DeepSeek 或本地千问兼容接口（默认 qwen3.8-27b），API 密钥加密保存
- 内核升级 0.1.1-rc.2：支持最新图片模型与图片附件/Files API 管线

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
- macOS 菜单栏常驻入口，可打开应用、重启服务、检查更新和定位日志
- macOS 桌宠专注计时：25/50 分钟专注、10 分钟休息与完成提醒
- macOS 最近任务历史，可从菜单返回最近 8 个完成任务
- macOS 登录时自动启动，以及点击桌宠的随机暖心回应

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
5bda8fd31c2a1dc68a2234c30f1ca412a5c38880d7fbdaf0210c8ad9c93434e0  DeepSeek-M2-1.6.0.dmg
689ccf1c337ce6df9ed9a766cd232a788b2c534ed5267175474d3976398dc343  DeepSeek-Cute-Windows-x64-Setup-1.6.0.exe
```

## 说明

- 模型账号、登录状态和工作区数据仍由每台电脑分别管理，不会打包进安装文件。
- macOS Apple Silicon 1.6.0 已在 M2 环境完成编译、ad-hoc 签名、DMG 挂载与内置 0.1.1-rc.2 运行时验证。
- Windows 1.6.0 已完成 electron-builder x64 构建、asar 打包清单核对、NSIS 更新元数据与差分 blockmap 校验；由于构建环境是 macOS，仍建议首次 Windows 用户在 Issues 反馈兼容性。
- 项目不是 DeepSeek 官方产品，详情见 [NOTICE.md](NOTICE.md)。

## 源码

- `windows/`：Electron 壳、主题注入、桌宠、托盘与内置服务管理
- `macos/`：Swift + WebKit 原生壳、菜单栏、桌宠与服务管理

源码采用 MIT License。构建依赖和内置运行时保留各自许可证。
