# DeepSeek Cute Desktop

> A cute, local-first DeepSeek desktop client with themes, a desktop pet, and user-controlled updates.

[中文](README.md) · [English](README.en.md) · [⭐ Star this project](https://github.com/SikeFix/deepseek-cute-desktop)

A ready-to-use DeepSeek desktop client for macOS and Windows. It includes built-in themes, a customizable theme studio, an interactive desktop pet, task notifications, token usage statistics, Markdown conversation export, diagnostics export, and support for the official DeepSeek service or a local Qwen-compatible provider.

[Download the latest release](https://github.com/SikeFix/deepseek-cute-desktop/releases/latest)

## Downloads

| Platform | Requirement |
| --- | --- |
| macOS Apple Silicon | macOS 13.5+, M1/M2/M3/M4 |
| Windows x64 | Windows 10/11 x64 |

No separate Node.js installation or terminal command is required. The bundled runtime starts automatically.

## Features

- Five built-in visual themes and a persistent theme studio
- Interactive desktop pet with idle, thinking, completed, and error states
- Task completion notifications and tray/menu-bar resident mode
- Token usage statistics with cached fast startup
- Copy the current conversation as Markdown
- One-click diagnostics export with sensitive values redacted
- Official DeepSeek provider and configurable Qwen-compatible provider
- Optional updates: the app never downloads or installs updates without user confirmation

## Provider setup

Open **Model service settings** from the tray menu or use `Ctrl/Cmd + ,`. Official DeepSeek uses the bundled provider. For a Qwen-compatible service, enter an HTTPS endpoint, model name, and API key. Credentials are stored using the operating system secure storage when available. Submitting the same key again does not trigger a duplicate authorization or unnecessary backend restart.

## Keyboard shortcuts

- New session: `Ctrl/Cmd + K`
- Copy conversation as Markdown: `Ctrl/Cmd + Shift + C`
- Switch theme: `Ctrl/Cmd + T`
- Model service settings: `Ctrl/Cmd + ,`

## Troubleshooting

If the local service does not start, use **Copy diagnostics** on the waiting page and attach the generated report when opening an issue. The report redacts API keys and other sensitive values.

## Development

Windows packaging runs in GitHub Actions and prepares the bundled Node.js and DeepSeek runtime before invoking electron-builder. See [`windows/BUILD.md`](windows/BUILD.md) for local build notes.

Please open an issue with your OS version, app version, and diagnostics when reporting a problem. If the project helps you, please consider giving it a [Star](https://github.com/SikeFix/deepseek-cute-desktop) to support continued maintenance.
