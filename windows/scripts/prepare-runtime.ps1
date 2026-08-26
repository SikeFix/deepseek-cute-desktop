$ErrorActionPreference = "Stop"

$NodeVersion = "24.18.1"
$NodeArchive = "node-v$NodeVersion-win-x64.zip"
$NodeUrl = "https://nodejs.org/dist/v$NodeVersion/$NodeArchive"
$NodeSha256 = "ec56b84a7551893ab2324ebdfdc4ab974a63b4781162600b68a1293cc3e53765"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DownloadDir = Join-Path $ProjectRoot "runtime-downloads"
$ArchivePath = Join-Path $DownloadDir $NodeArchive
$ExtractDir = Join-Path $DownloadDir "node"
$RuntimeDir = Join-Path $ProjectRoot "runtime"

New-Item -ItemType Directory -Force -Path $DownloadDir, $ExtractDir, (Join-Path $RuntimeDir "node"), (Join-Path $RuntimeDir "licenses") | Out-Null
Invoke-WebRequest -Uri $NodeUrl -OutFile $ArchivePath

$ActualSha256 = (Get-FileHash -Algorithm SHA256 $ArchivePath).Hash.ToLowerInvariant()
if ($ActualSha256 -ne $NodeSha256) {
    throw "Node.js SHA256 mismatch: $ActualSha256"
}

Expand-Archive -Path $ArchivePath -DestinationPath $ExtractDir -Force
$NodeSource = Join-Path $ExtractDir "node-v$NodeVersion-win-x64"
Copy-Item (Join-Path $NodeSource "node.exe") (Join-Path $RuntimeDir "node/node.exe") -Force
Copy-Item (Join-Path $NodeSource "LICENSE") (Join-Path $RuntimeDir "licenses/Node-LICENSE.txt") -Force

Push-Location $RuntimeDir
$HarnessPackages = @(
    "@deepseek-ai/dsh@0.1.1-rc.2",
    "@deepseek-ai/cordis-plugin-group@1.0.1",
    "@deepseek-ai/dsh-anonymous-user-id@0.1.1-rc.2",
    "@deepseek-ai/dsh-atomic-write@0.1.1-rc.2",
    "@deepseek-ai/dsh-authorization@0.1.1-rc.2",
    "@deepseek-ai/dsh-bash-local@0.1.1-rc.2",
    "@deepseek-ai/dsh-code-runtime@0.1.1-rc.2",
    "@deepseek-ai/dsh-compaction@0.1.1-rc.2",
    "@deepseek-ai/dsh-fs@0.1.1-rc.2",
    "@deepseek-ai/dsh-invariants@0.1.1-rc.2",
    "@deepseek-ai/dsh-output-retention@0.1.1-rc.2",
    "@deepseek-ai/dsh-sandbox@0.1.1-rc.2",
    "@deepseek-ai/dsh-scope@0.1.1-rc.2",
    "@deepseek-ai/dsh-session-telemetry@0.1.1-rc.2",
    "@deepseek-ai/dsh-session-title-llm@0.1.1-rc.2",
    "@deepseek-ai/dsh-shell@0.1.1-rc.2",
    "@deepseek-ai/dsh-spill@0.1.1-rc.2",
    "@deepseek-ai/dsh-subagent-in-process-driver@0.1.1-rc.2",
    "@deepseek-ai/dsh-timeout@0.1.1-rc.2",
    "@deepseek-ai/dsh-workflow@0.1.1-rc.2"
)
npm install --omit=dev --ignore-scripts --legacy-peer-deps $HarnessPackages
Pop-Location
Copy-Item (Join-Path $RuntimeDir "node_modules/@deepseek-ai/dsh/LICENSE") (Join-Path $RuntimeDir "licenses/DSH-LICENSE.txt") -Force

Write-Host "Runtime prepared. Run: npm ci; npm run build:win"
