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
npm install --omit=dev --ignore-scripts @deepseek-ai/dsh@0.1.0-rc.6
Pop-Location
Copy-Item (Join-Path $RuntimeDir "node_modules/@deepseek-ai/dsh/LICENSE") (Join-Path $RuntimeDir "licenses/DSH-LICENSE.txt") -Force

Write-Host "Runtime prepared. Run: npm ci; npm run build:win"
