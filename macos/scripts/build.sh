#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"
OUT="${BUILD_OUTPUT:-$ROOT/build-macos}"
OUT="$(cd "$OUT" 2>/dev/null && pwd || (mkdir -p "$OUT" && cd "$OUT" && pwd))"
APP="$OUT/DeepSeek.app"
VER=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' macos/Info.plist)
NODE_VERSION=24.18.1
ARCHIVE="node-v$NODE_VERSION-darwin-arm64.tar.gz"
mkdir -p "$OUT/downloads" "$APP/Contents/MacOS" "$APP/Contents/Resources/Runtime/bin" "$APP/Contents/Resources/Runtime/dsh" "$APP/Contents/Resources/Provider"
curl --retry 3 -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$ARCHIVE" -o "$OUT/downloads/$ARCHIVE"
curl --retry 3 -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$OUT/downloads/SHASUMS256.txt"
(cd "$OUT/downloads"; awk -v name="$ARCHIVE" '$2 == name' SHASUMS256.txt > checksum.txt; test -s checksum.txt; shasum -a 256 -c checksum.txt; tar -xzf "$ARCHIVE")
NODE_ROOT="$OUT/downloads/node-v$NODE_VERSION-darwin-arm64"
cp macos/Info.plist "$APP/Contents/Info.plist"
cp -R macos/Resources/. "$APP/Contents/Resources/"
mkdir -p "$APP/Contents/Resources/shared"
cp shared/plugin-market-cli.mjs "$APP/Contents/Resources/shared/"
cp -R shared/market-engine "$APP/Contents/Resources/shared/"
cp provider/provider-config.mjs "$APP/Contents/Resources/Provider/"
cp "$NODE_ROOT/bin/node" "$APP/Contents/Resources/Runtime/bin/"
cp "$NODE_ROOT/LICENSE" "$APP/Contents/Resources/Runtime/Node-LICENSE.txt"
RUNTIME="$APP/Contents/Resources/Runtime/dsh"
printf '{"name":"deepseek-runtime","private":true}\n' > "$RUNTIME/package.json"
(cd "$RUNTIME"; PATH="$NODE_ROOT/bin:$PATH" "$NODE_ROOT/bin/node" "$NODE_ROOT/lib/node_modules/npm/bin/npm-cli.js" install --registry=https://registry.npmjs.org --no-audit --no-fund --omit=dev --ignore-scripts @deepseek-ai/dsh@0.1.5-rc.2 js-yaml)
"$APP/Contents/Resources/Runtime/bin/node" "$RUNTIME/node_modules/@deepseek-ai/dsh/lib/bin.js" --version
swiftc -target arm64-apple-macosx13.5 macos/Main.swift -o "$APP/Contents/MacOS/DeepSeek" -framework Cocoa -framework WebKit -framework UserNotifications -framework ServiceManagement -framework Security
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
mkdir -p "$OUT/dmg"
ditto "$APP" "$OUT/dmg/DeepSeek.app"
ln -sfn /Applications "$OUT/dmg/Applications"
hdiutil create -volname 'DeepSeek Cute' -srcfolder "$OUT/dmg" -ov -format UDZO "$OUT/DeepSeek-M2-$VER.dmg"
(cd "$OUT"; shasum -a 256 "DeepSeek-M2-$VER.dmg" > "DeepSeek-M2-$VER.dmg.sha256")
