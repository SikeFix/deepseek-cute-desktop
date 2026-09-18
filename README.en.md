# DeepSeek Cute Desktop

> A local desktop client that keeps the official DeepSeek interface and core workflow.

[中文](README.md) · [English](README.en.md) · [⭐ Star this project](https://github.com/SikeFix/deepseek-cute-desktop)

Version 1.8.1 returns to the official DeepSeek experience. Custom themes, animations, desktop pets, floating toolbars, and visual overlays have been removed. The app keeps the official conversation interface, history, model service settings, and bundled local runtime. Node.js installation and a forced browser launch are not required.

[Download the latest release](https://github.com/SikeFix/deepseek-cute-desktop/releases/latest) · [Open an issue](https://github.com/SikeFix/deepseek-cute-desktop/issues) · [Release notes](RELEASE_NOTES.md)

If this project helps you, please give it a [Star ⭐](https://github.com/SikeFix/deepseek-cute-desktop). A Star helps other users find the project and supports ongoing maintenance and translations.

## Downloads

| Platform | Download | Requirement |
| --- | --- | --- |
| macOS Apple Silicon | [DeepSeek-M2-1.8.1.dmg](https://github.com/SikeFix/deepseek-cute-desktop/releases/latest/download/DeepSeek-M2-1.8.1.dmg) | macOS 13.5+, M1/M2/M3/M4 |
| Windows x64 | [DeepSeek-Cute-Windows-x64-Setup-1.8.1.exe](https://github.com/SikeFix/deepseek-cute-desktop/releases/latest/download/DeepSeek-Cute-Windows-x64-Setup-1.8.1.exe) | Windows 10/11 x64 |

## Features in 1.8.1

- Official DeepSeek conversation interface and interaction flow
- Bundled local DeepSeek runtime with automatic service startup
- Local history and workspace data
- Model service settings and connection status
- Copyable diagnostics and log export for issue reports
- API keys stored with macOS Keychain or Windows DPAPI; saving the same key does not trigger duplicate authorization or an unnecessary restart
- User-controlled update checks, downloads, and installation; updates are never forced
- Chinese and English documentation, with translations welcome

## Installation

### macOS

Open the DMG and drag DeepSeek to Applications. The community package uses an ad-hoc signature and is not notarized by Apple. If macOS blocks the first launch, right-click the app in Finder and choose **Open**.

### Windows

Run the Setup EXE and follow the installer. The community package does not use a commercial code-signing certificate, so Windows SmartScreen may show a warning. Verify the SHA256 value before running it.

## Troubleshooting

If the local service does not start, copy the diagnostics report from the waiting page and attach it to an [issue](https://github.com/SikeFix/deepseek-cute-desktop/issues) with your OS and app versions. API keys and other sensitive values are redacted.

## Checksums

```text
ac3494fa362327ab2d10b95361c130659eac4a7ed4301f4ebda3d88a1f7f0739  DeepSeek-M2-1.8.1.dmg
711ac92e2ffab82d10451982a1d13541d817862b4ca7d826752bb0b1a84c7a5b  DeepSeek-Cute-Windows-x64-Setup-1.8.1.exe
```

On macOS run `shasum -a 256 -c DeepSeek-M2-1.8.1.dmg.sha256`. On Windows run `certutil -hashfile DeepSeek-Cute-Windows-x64-Setup-1.8.1.exe SHA256`.

## Source

- `windows/`: Electron shell, tray, and local service management
- `macos/`: Swift + WebKit native shell and local service management

This project is not an official DeepSeek product; see [NOTICE.md](NOTICE.md). The source is MIT licensed, while bundled runtimes retain their own licenses.
