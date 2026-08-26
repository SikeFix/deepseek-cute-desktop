# Windows 构建

在 Windows 10/11 x64 的 PowerShell 中运行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\prepare-runtime.ps1
npm ci
npm run build:win
```

脚本会下载官方 Node.js 24.18.1 x64、校验 SHA256，并安装带图片附件/Files API 管线的 `@deepseek-ai/dsh@0.1.1-rc.2`。`npm run build:win` 会生成 NSIS 安装包、`latest.yml` 和差分更新 blockmap，成品位于 `dist/`。
