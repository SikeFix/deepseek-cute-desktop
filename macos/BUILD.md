# macOS 构建说明

发布版使用 Swift + WebKit 原生壳，并在 App Bundle 中携带 Apple Silicon Node.js 与 `@deepseek-ai/dsh` 运行时。

源码入口为 `Main.swift`，界面资源位于 `Resources/`。公开 Release 已提供完成签名封装的 DMG；自行构建时需要准备 `DeepSeek.app/Contents/Resources/Runtime/bin/node` 与 `Runtime/dsh/node_modules`，随后使用 `swiftc` 编译并通过 `codesign` 签名 App Bundle。
