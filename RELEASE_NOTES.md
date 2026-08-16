# DeepSeek Cute Desktop 1.5.0

本次重点更新 macOS，把桌宠变成真正有互动、也能辅助工作的桌面伙伴。

## macOS 新功能

- 系统菜单栏常驻入口：打开应用、重启服务、显示桌宠、检查更新和打开日志
- GitHub 联网更新：自动检查新版，确认后下载并打开 DMG
- 登录时自动启动，使用 macOS 13+ 原生 ServiceManagement
- 25/50 分钟专注与 10 分钟休息计时，倒计时显示在桌宠上
- 计时完成后切换庆祝表情并发送系统通知
- 点击桌宠会随机给出暖心回应
- 保存最近 8 个完成任务，可从菜单直接返回对应对话
- 应用和内置服务分别写入诊断日志，并支持一键复制诊断信息
- 初次启动使用快速健康检查，服务就绪后立即进入主界面

## 下载

- `DeepSeek-M2-1.5.0.dmg`：macOS 13.5+，Apple Silicon
- `DeepSeek-Cute-Windows-x64-Setup-1.4.1.exe`：Windows 10/11 x64 稳定安装版
- `latest.yml` 与 `.blockmap`：Windows 自动更新元数据
- 同名 `.sha256`：完整性校验

## 验证

macOS 1.5.0 已在 M2 本机完成 Swift 编译、ad-hoc 签名、DMG CRC、挂载后签名、App 图标、GitHub Release 解析、专注计时、内置服务启动和 HTTP 200 验证。

## 签名说明

发布包是社区构建。Windows 版未使用商业代码签名证书，macOS 版采用 ad-hoc 签名且未公证；请从本仓库下载并核对 SHA256。
