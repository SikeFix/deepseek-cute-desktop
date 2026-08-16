# Windows 构建

在 Windows 10/11 x64 的 PowerShell 中运行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\prepare-runtime.ps1
npm ci
npm run build:win
```

脚本会下载官方 Node.js 24.18.1 x64、校验 SHA256，并安装 `@deepseek-ai/dsh@0.1.0-rc.6`。成品位于 `dist/`。
