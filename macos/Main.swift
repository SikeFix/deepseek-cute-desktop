import Cocoa
import Security
import ServiceManagement
import WebKit
import UserNotifications

let APP_URL = "http://127.0.0.1:3080"
let APP_NAME = "DeepSeek"

func appBackground() -> NSColor {
    let dark = UserDefaults.standard.string(forKey: "AppleInterfaceStyle") == "Dark"
    if dark {
        return NSColor(calibratedRed: 0.05, green: 0.09, blue: 0.09, alpha: 0.5)
    }
    return NSColor(calibratedRed: 0.98, green: 0.96, blue: 0.90, alpha: 0.55)
}

enum PetMood: String {
    case idle = "pet-idle"
    case thinking = "pet-thinking"
    case complete = "pet-complete"
    case error = "pet-error"
}

struct GitHubRelease: Decodable {
    struct Asset: Decodable {
        let name: String
        let browserDownloadURL: URL

        enum CodingKeys: String, CodingKey {
            case name
            case browserDownloadURL = "browser_download_url"
        }
    }

    let tagName: String
    let htmlURL: URL
    let assets: [Asset]

    enum CodingKeys: String, CodingKey {
        case tagName = "tag_name"
        case htmlURL = "html_url"
        case assets
    }
}

struct TaskRecord: Codable {
    let title: String
    let duration: TimeInterval
    let url: String?
    let completedAt: Date
}

final class PetView: NSView {
    private let mascotView = NSImageView()
    private let statusCapsule = NSVisualEffectView()
    private let statusDot = NSView()
    private let statusLabel = NSTextField(labelWithString: "正在启动…")
    private var trackingArea: NSTrackingArea?
    private var mouseDownLocation = NSPoint.zero
    private var windowOriginAtMouseDown = NSPoint.zero
    private var didDrag = false
    private var currentMood: PetMood?

    var onActivate: (() -> Void)?
    var onInteract: (() -> Void)?
    var onRetry: (() -> Void)?
    var onHide: (() -> Void)?
    var onTestCompletion: (() -> Void)?
    var onStartFocus: ((Int) -> Void)?
    var onCancelFocus: (() -> Void)?
    var onMoveFinished: ((NSPoint) -> Void)?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        configure()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        configure()
    }

    private func configure() {
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor

        mascotView.imageScaling = .scaleProportionallyUpOrDown
        mascotView.wantsLayer = true
        mascotView.translatesAutoresizingMaskIntoConstraints = false
        mascotView.layer?.shadowColor = NSColor.black.cgColor
        mascotView.layer?.shadowOpacity = 0.24
        mascotView.layer?.shadowRadius = 8
        mascotView.layer?.shadowOffset = NSSize(width: 0, height: -3)

        statusCapsule.material = .hudWindow
        statusCapsule.blendingMode = .behindWindow
        statusCapsule.state = .active
        statusCapsule.wantsLayer = true
        statusCapsule.layer?.cornerRadius = 15
        statusCapsule.layer?.cornerCurve = .continuous
        statusCapsule.layer?.borderWidth = 1
        statusCapsule.layer?.borderColor = NSColor.white.withAlphaComponent(0.30).cgColor
        statusCapsule.translatesAutoresizingMaskIntoConstraints = false

        statusDot.wantsLayer = true
        statusDot.layer?.cornerRadius = 4
        statusDot.layer?.backgroundColor = NSColor.systemYellow.cgColor
        statusDot.translatesAutoresizingMaskIntoConstraints = false

        statusLabel.alignment = .center
        statusLabel.font = .systemFont(ofSize: 12, weight: .semibold)
        statusLabel.textColor = .labelColor
        statusLabel.lineBreakMode = .byTruncatingTail
        statusLabel.translatesAutoresizingMaskIntoConstraints = false

        addSubview(mascotView)
        addSubview(statusCapsule)
        statusCapsule.addSubview(statusDot)
        statusCapsule.addSubview(statusLabel)
        toolTip = "拖动小助手 · 单击打开 DeepSeek · 右键更多"

        NSLayoutConstraint.activate([
            mascotView.topAnchor.constraint(equalTo: topAnchor),
            mascotView.centerXAnchor.constraint(equalTo: centerXAnchor),
            mascotView.widthAnchor.constraint(equalToConstant: 166),
            mascotView.heightAnchor.constraint(equalToConstant: 166),
            statusCapsule.topAnchor.constraint(equalTo: mascotView.bottomAnchor, constant: -7),
            statusCapsule.centerXAnchor.constraint(equalTo: centerXAnchor),
            statusCapsule.widthAnchor.constraint(equalToConstant: 152),
            statusCapsule.heightAnchor.constraint(equalToConstant: 31),
            statusDot.widthAnchor.constraint(equalToConstant: 8),
            statusDot.heightAnchor.constraint(equalToConstant: 8),
            statusDot.leadingAnchor.constraint(equalTo: statusCapsule.leadingAnchor, constant: 12),
            statusDot.centerYAnchor.constraint(equalTo: statusCapsule.centerYAnchor),
            statusLabel.centerYAnchor.constraint(equalTo: statusDot.centerYAnchor),
            statusLabel.leadingAnchor.constraint(equalTo: statusDot.trailingAnchor, constant: 6),
            statusLabel.trailingAnchor.constraint(equalTo: statusCapsule.trailingAnchor, constant: -10)
        ])

        setMood(.thinking, text: "正在启动服务…", color: .systemYellow)
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        bounds.contains(point) ? self : nil
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func updateTrackingAreas() {
        if let trackingArea { removeTrackingArea(trackingArea) }
        let area = NSTrackingArea(
            rect: bounds,
            options: [.activeAlways, .mouseEnteredAndExited, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(area)
        trackingArea = area
        super.updateTrackingAreas()
    }

    override func mouseEntered(with event: NSEvent) {
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.16
            mascotView.animator().alphaValue = 1
            statusCapsule.animator().alphaValue = 1
        }
    }

    override func mouseExited(with event: NSEvent) {
        guard !didDrag else { return }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.22
            mascotView.animator().alphaValue = 0.96
            statusCapsule.animator().alphaValue = 0.90
        }
    }

    override func mouseDown(with event: NSEvent) {
        mouseDownLocation = NSEvent.mouseLocation
        windowOriginAtMouseDown = window?.frame.origin ?? .zero
        didDrag = false
    }

    override func mouseDragged(with event: NSEvent) {
        guard let window else { return }
        let current = NSEvent.mouseLocation
        let deltaX = current.x - mouseDownLocation.x
        let deltaY = current.y - mouseDownLocation.y
        if abs(deltaX) > 3 || abs(deltaY) > 3 { didDrag = true }
        var proposed = NSPoint(
            x: windowOriginAtMouseDown.x + deltaX,
            y: windowOriginAtMouseDown.y + deltaY
        )
        let visible = window.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? .zero
        proposed.x = min(max(proposed.x, visible.minX - 18), visible.maxX - window.frame.width + 18)
        proposed.y = min(max(proposed.y, visible.minY), visible.maxY - window.frame.height + 20)
        window.setFrameOrigin(proposed)
    }

    override func mouseUp(with event: NSEvent) {
        if didDrag {
            if let origin = window?.frame.origin { onMoveFinished?(origin) }
        } else {
            reactToTap()
            onInteract?()
            onActivate?()
        }
        didDrag = false
    }

    override func rightMouseDown(with event: NSEvent) {
        let menu = NSMenu(title: "桌面小助手")
        menu.addItem(withTitle: "打开 DeepSeek", action: #selector(activateFromMenu), keyEquivalent: "")
        menu.addItem(withTitle: "重试本地服务", action: #selector(retryFromMenu), keyEquivalent: "")
        menu.addItem(withTitle: "测试完成提醒", action: #selector(testFromMenu), keyEquivalent: "")
        let focusItem = NSMenuItem(title: "专注计时", action: nil, keyEquivalent: "")
        let focusMenu = NSMenu(title: "专注计时")
        focusMenu.addItem(withTitle: "专注 25 分钟", action: #selector(focus25FromMenu), keyEquivalent: "")
        focusMenu.addItem(withTitle: "深度专注 50 分钟", action: #selector(focus50FromMenu), keyEquivalent: "")
        focusMenu.addItem(withTitle: "休息 10 分钟", action: #selector(break10FromMenu), keyEquivalent: "")
        focusMenu.addItem(.separator())
        focusMenu.addItem(withTitle: "取消计时", action: #selector(cancelFocusFromMenu), keyEquivalent: "")
        for item in focusMenu.items { item.target = self }
        focusItem.submenu = focusMenu
        menu.addItem(focusItem)
        menu.addItem(.separator())
        menu.addItem(withTitle: "隐藏桌面宠物", action: #selector(hideFromMenu), keyEquivalent: "")
        for item in menu.items { item.target = self }
        NSMenu.popUpContextMenu(menu, with: event, for: self)
    }

    @objc private func activateFromMenu() { onActivate?() }
    @objc private func retryFromMenu() { onRetry?() }
    @objc private func testFromMenu() { onTestCompletion?() }
    @objc private func focus25FromMenu() { onStartFocus?(25) }
    @objc private func focus50FromMenu() { onStartFocus?(50) }
    @objc private func break10FromMenu() { onStartFocus?(10) }
    @objc private func cancelFocusFromMenu() { onCancelFocus?() }
    @objc private func hideFromMenu() { onHide?() }

    func setMood(_ mood: PetMood, text: String, color: NSColor) {
        if currentMood != mood,
           let imageURL = Bundle.main.url(forResource: mood.rawValue, withExtension: "png", subdirectory: "PopTheme"),
           let image = NSImage(contentsOf: imageURL) {
            let transition = CATransition()
            transition.type = .fade
            transition.duration = 0.20
            mascotView.layer?.add(transition, forKey: "dsmPetMood")
            mascotView.image = image
            currentMood = mood
            startAmbientAnimation(for: mood)
        }
        statusLabel.stringValue = text
        statusDot.layer?.backgroundColor = color.cgColor
    }

    private func startAmbientAnimation(for mood: PetMood) {
        guard let layer = mascotView.layer else { return }
        layer.removeAnimation(forKey: "dsmPetAmbient")
        guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return }

        switch mood {
        case .idle:
            let breathe = CABasicAnimation(keyPath: "transform.scale")
            breathe.fromValue = 1.0
            breathe.toValue = 1.018
            let float = CABasicAnimation(keyPath: "transform.translation.y")
            float.fromValue = -1.5
            float.toValue = 3.0
            float.isAdditive = true
            let group = CAAnimationGroup()
            group.animations = [breathe, float]
            group.duration = 2.6
            group.autoreverses = true
            group.repeatCount = .infinity
            group.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            layer.add(group, forKey: "dsmPetAmbient")
        case .thinking:
            let sway = CABasicAnimation(keyPath: "transform.rotation.z")
            sway.fromValue = -0.018
            sway.toValue = 0.018
            sway.isAdditive = true
            let bob = CABasicAnimation(keyPath: "transform.translation.y")
            bob.fromValue = -1.0
            bob.toValue = 2.0
            bob.isAdditive = true
            let group = CAAnimationGroup()
            group.animations = [sway, bob]
            group.duration = 1.35
            group.autoreverses = true
            group.repeatCount = .infinity
            group.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            layer.add(group, forKey: "dsmPetAmbient")
        case .error:
            let worry = CAKeyframeAnimation(keyPath: "transform.translation.x")
            worry.values = [0, -1.8, 1.8, -1.2, 1.2, 0, 0, 0]
            worry.keyTimes = [0, 0.08, 0.16, 0.24, 0.32, 0.40, 0.72, 1]
            worry.duration = 1.8
            worry.repeatCount = .infinity
            worry.isAdditive = true
            layer.add(worry, forKey: "dsmPetAmbient")
        case .complete:
            break
        }
    }

    private func reactToTap() {
        guard let layer = mascotView.layer,
              !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return }
        let tap = CAKeyframeAnimation(keyPath: "transform.scale")
        tap.values = [1, 0.94, 1.06, 1]
        tap.keyTimes = [0, 0.24, 0.62, 1]
        tap.duration = 0.32
        tap.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        layer.add(tap, forKey: "dsmPetTap")
    }

    func celebrate() {
        guard let layer = mascotView.layer else { return }
        layer.removeAnimation(forKey: "dsmPetAmbient")
        guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return }
        let bounce = CAKeyframeAnimation(keyPath: "transform.translation.y")
        bounce.values = [0, -13, 0, -7, 0]
        bounce.keyTimes = [0, 0.24, 0.48, 0.72, 1]
        bounce.duration = 0.82
        bounce.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        let scale = CAKeyframeAnimation(keyPath: "transform.scale")
        scale.values = [1, 1.08, 1, 1.04, 1]
        scale.duration = 0.82
        layer.add(bounce, forKey: "dsmPetBounce")
        layer.add(scale, forKey: "dsmPetScale")
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, UNUserNotificationCenterDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var backendProcess: Process?
    var healthTimer: Timer?
    var updateTimer: Timer?
    var focusTimer: Timer?
    var focusEndDate: Date?
    var focusTitle = "专注时间"
    var backendStartedAt: Date?
    var backendLogHandle: FileHandle?
    var consecutiveHealthFailures = 0
    var isTerminating = false
    var statusItem: NSStatusItem?
    var serviceMenuItem: NSMenuItem?
    var loginItemMenuItem: NSMenuItem?
    var historyMenu = NSMenu(title: "最近完成任务")
    var updateCheckInProgress = false
    var updateDownloadInProgress = false
    var petPanel: NSPanel?
    var petView: PetView?
    var taskBusy = false
    var lastServiceStatus = "starting"
    var taskStartedAt: Date?
    var lastTaskTitle = "当前任务"
    var lastTaskURL: String?
    var taskHistory: [TaskRecord] = []
    var interfaceTheme = UserDefaults.standard.string(forKey: "DSMInterfaceTheme") ?? "cute"
    var themeOfficialMenuItems: [NSMenuItem] = []
    var themeCuteMenuItems: [NSMenuItem] = []
    let providerWizardVersion = "2026-08-v4-vision-qwen-1"
    let qwenEndpoint = "https://ai-xtu.yangrucheng.eu.org/v1"
    let qwenKeychainService = "com.sikefix.deepseek-cute.provider"
    let qwenKeychainAccount = "QWEN_API_KEY"

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        writeAppLog("application launched version=\(version)")
        loadTaskHistory()
        buildMenu()
        buildStatusItem()

        let config = WKWebViewConfiguration()
        let controller = WKUserContentController()

        // 注入可切换的正太主题；官方模式保留 Harness 原生样式。
        if let cssURL = Bundle.main.url(forResource: "theme", withExtension: "css"),
           let css = try? String(contentsOf: cssURL, encoding: .utf8),
           let jsonData = try? JSONSerialization.data(withJSONObject: [css]),
           let json = String(data: jsonData, encoding: .utf8) {
            let initialTheme = interfaceTheme == "official" ? "official" : "cute"
            let script = "window.__dsmMac=true;window.__dsmThemeMode='" + initialTheme + "';(function(){try{var s=document.createElement('style');s.id='dsm-theme-style';s.setAttribute('data-dsm-mac','app');s.textContent=" + json + ";s.disabled=window.__dsmThemeMode==='official';document.documentElement.dataset.dsmTheme=window.__dsmThemeMode;document.documentElement.appendChild(s);window.__dsmApplyTheme=function(mode){window.__dsmThemeMode=mode;document.documentElement.dataset.dsmTheme=mode;var style=document.getElementById('dsm-theme-style');if(style)style.disabled=mode==='official';window.__dsmSetThemeMode&&window.__dsmSetThemeMode(mode);};}catch(e){console.error('DSM_CSS',e);}})();"
            controller.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }

        // 轻量本地互动：按钮波纹、指针柔光和滚动阅读增强。
        if let interactionsURL = Bundle.main.url(forResource: "interactions", withExtension: "js"),
           let interactions = try? String(contentsOf: interactionsURL, encoding: .utf8) {
            controller.addUserScript(WKUserScript(source: interactions, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        controller.add(self, name: "dsmService")
        controller.add(self, name: "dsmPet")
        config.userContentController = controller

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 920),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false)
        window.title = APP_NAME
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.titlebarSeparatorStyle = .none
        window.isMovableByWindowBackground = true
        window.isOpaque = false
        window.backgroundColor = .clear
        window.center()
        window.minSize = NSSize(width: 1000, height: 660)
        window.contentView = webView
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("DeepSeekMainWindow")
        window.makeKeyAndOrderFront(nil)

        buildDesktopPet()
        configureNotifications()

        showOffline()
        startBackendIfNeeded()
        startHealthMonitor()
        startUpdateMonitor()
        NSApp.activate(ignoringOtherApps: true)
        if UserDefaults.standard.string(forKey: "DSMProviderWizardVersion") != providerWizardVersion {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
                self?.showModelProviderWizard()
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        activateFromPet()
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        isTerminating = true
        healthTimer?.invalidate()
        updateTimer?.invalidate()
        focusTimer?.invalidate()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "dsmService")
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "dsmPet")
        if let process = backendProcess, process.isRunning {
            process.terminate()
        }
        try? backendLogHandle?.close()
    }

    func loadApp() {
        guard let url = URL(string: APP_URL) else { return }
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8))
    }

    func logsDirectory() -> URL {
        let base = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
        let directory = base.appendingPathComponent("Logs/DeepSeek Cute", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    func logFile(named name: String) -> URL {
        let url = logsDirectory().appendingPathComponent(name)
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        return url
    }

    func writeAppLog(_ message: String) {
        let timestamp = ISO8601DateFormatter().string(from: Date())
        guard let data = "[\(timestamp)] \(message)\n".data(using: .utf8) else { return }
        let url = logFile(named: "app.log")
        guard let handle = try? FileHandle(forWritingTo: url) else { return }
        do {
            try handle.seekToEnd()
            try handle.write(contentsOf: data)
            try handle.close()
        } catch {
            try? handle.close()
        }
    }

    func prepareBackendLog() -> FileHandle? {
        try? backendLogHandle?.close()
        let url = logFile(named: "backend.log")
        guard let handle = try? FileHandle(forWritingTo: url) else { return nil }
        _ = try? handle.seekToEnd()
        if let header = "\n[\(ISO8601DateFormatter().string(from: Date()))] starting backend\n".data(using: .utf8) {
            try? handle.write(contentsOf: header)
        }
        backendLogHandle = handle
        return handle
    }

    func startBackendIfNeeded() {
        checkBackend(shouldRecover: true)
    }

    func startHealthMonitor() {
        healthTimer?.invalidate()
        healthTimer = Timer.scheduledTimer(withTimeInterval: 8, repeats: true) { [weak self] _ in
            self?.checkBackend(shouldRecover: true)
        }
    }

    func startUpdateMonitor() {
        updateTimer?.invalidate()
        DispatchQueue.main.asyncAfter(deadline: .now() + 12) { [weak self] in
            self?.checkForUpdates(manual: false)
        }
        updateTimer = Timer.scheduledTimer(withTimeInterval: 6 * 60 * 60, repeats: true) { [weak self] _ in
            self?.checkForUpdates(manual: false)
        }
    }

    @objc func checkForUpdatesFromMenu() {
        checkForUpdates(manual: true)
    }

    func checkForUpdates(manual: Bool) {
        guard !updateCheckInProgress else { return }
        updateCheckInProgress = true
        if manual, !taskBusy {
            petView?.setMood(.thinking, text: "正在检查更新…", color: .systemYellow)
        }
        guard let url = URL(string: "https://api.github.com/repos/SikeFix/deepseek-cute-desktop/releases/latest") else { return }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.setValue("DeepSeek-Cute-macOS/\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0")", forHTTPHeaderField: "User-Agent")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.updateCheckInProgress = false
                if let error {
                    self.writeAppLog("update check failed: \(error.localizedDescription)")
                    if manual { self.showAlert(title: "检查更新失败", message: error.localizedDescription) }
                    self.publishServiceStatus(self.lastServiceStatus)
                    return
                }
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                guard (200..<300).contains(status), let data,
                      let release = try? JSONDecoder().decode(GitHubRelease.self, from: data) else {
                    if manual { self.showAlert(title: "检查更新失败", message: "GitHub 返回的数据无法读取。") }
                    self.publishServiceStatus(self.lastServiceStatus)
                    return
                }
                let current = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
                let latest = release.tagName.trimmingCharacters(in: CharacterSet(charactersIn: "vV"))
                self.writeAppLog("update check current=\(current) latest=\(latest)")
                guard self.isVersion(latest, newerThan: current) else {
                    if manual { self.showAlert(title: "已经是最新版", message: "当前版本 \(current)") }
                    self.publishServiceStatus(self.lastServiceStatus)
                    return
                }
                guard let asset = release.assets.first(where: {
                    $0.name.lowercased().hasSuffix(".dmg") &&
                    ($0.name.lowercased().contains("m2") || $0.name.lowercased().contains("mac"))
                }) else {
                    if manual { NSWorkspace.shared.open(release.htmlURL) }
                    return
                }
                self.offerUpdate(version: latest, asset: asset, releaseURL: release.htmlURL)
            }
        }.resume()
    }

    func isVersion(_ candidate: String, newerThan current: String) -> Bool {
        let lhs = candidate.split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }
        let rhs = current.split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }
        for index in 0..<max(lhs.count, rhs.count) {
            let left = index < lhs.count ? lhs[index] : 0
            let right = index < rhs.count ? rhs[index] : 0
            if left != right { return left > right }
        }
        return false
    }

    func offerUpdate(version: String, asset: GitHubRelease.Asset, releaseURL: URL) {
        let alert = NSAlert()
        alert.messageText = "发现 DeepSeek \(version)"
        alert.informativeText = "可以从 GitHub 下载新版 DMG。下载完成后会自动打开安装镜像。"
        alert.alertStyle = .informational
        alert.addButton(withTitle: "下载更新")
        alert.addButton(withTitle: "查看发布页")
        alert.addButton(withTitle: "稍后")
        NSApp.activate(ignoringOtherApps: true)
        let response = alert.runModal()
        if response == .alertFirstButtonReturn { downloadUpdate(asset: asset, version: version) }
        else if response == .alertSecondButtonReturn { NSWorkspace.shared.open(releaseURL) }
    }

    func downloadUpdate(asset: GitHubRelease.Asset, version: String) {
        guard !updateDownloadInProgress else { return }
        updateDownloadInProgress = true
        if !taskBusy { petView?.setMood(.thinking, text: "正在下载 \(version)…", color: .systemYellow) }
        writeAppLog("update download started asset=\(asset.name)")
        URLSession.shared.downloadTask(with: asset.browserDownloadURL) { [weak self] temporaryURL, _, error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.updateDownloadInProgress = false
                if let error {
                    self.writeAppLog("update download failed: \(error.localizedDescription)")
                    self.showAlert(title: "更新下载失败", message: error.localizedDescription)
                    self.publishServiceStatus(self.lastServiceStatus)
                    return
                }
                guard let temporaryURL else { return }
                let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
                var destination = downloads.appendingPathComponent(asset.name)
                if FileManager.default.fileExists(atPath: destination.path) {
                    destination = downloads.appendingPathComponent("DeepSeek-Cute-macOS-\(version)-\(Int(Date().timeIntervalSince1970)).dmg")
                }
                do {
                    try FileManager.default.moveItem(at: temporaryURL, to: destination)
                    self.writeAppLog("update downloaded to \(destination.path)")
                    if !self.taskBusy {
                        self.petView?.setMood(.complete, text: "更新已下载！", color: .systemGreen)
                        self.petView?.celebrate()
                    }
                    NSWorkspace.shared.open(destination)
                } catch {
                    self.showAlert(title: "保存更新失败", message: error.localizedDescription)
                }
            }
        }.resume()
    }

    func showAlert(title: String, message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.alertStyle = .informational
        alert.addButton(withTitle: "好")
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }

    func setKeychainPassword(_ password: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: qwenKeychainService,
            kSecAttrAccount as String: qwenKeychainAccount
        ]
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = Data(password.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }

    func keychainPassword() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: qwenKeychainService,
            kSecAttrAccount as String: qwenKeychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    func applyProviderConfig(provider: String, endpoint: String? = nil, model: String? = nil) -> Bool {
        guard let node = Bundle.main.url(forResource: "node", withExtension: nil, subdirectory: "Runtime/bin"),
              let script = Bundle.main.url(forResource: "provider-config", withExtension: "mjs", subdirectory: "Provider"),
              let modules = Bundle.main.resourceURL?.appendingPathComponent("Runtime/dsh/node_modules") else {
            showAlert(title: "模型设置不可用", message: "应用内置配置组件不完整，请重新安装最新版。")
            return false
        }
        let process = Process()
        process.executableURL = node
        var arguments = [script.path, "--modules", modules.path, "--provider", provider]
        if let endpoint { arguments += ["--baseURL", endpoint] }
        if let model { arguments += ["--model", model] }
        process.arguments = arguments
        process.standardOutput = FileHandle.nullDevice
        let errorPipe = Pipe()
        process.standardError = errorPipe
        do {
            try process.run()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else {
                let data = errorPipe.fileHandleForReading.readDataToEndOfFile()
                let detail = String(data: data, encoding: .utf8) ?? "配置写入失败"
                showAlert(title: "模型设置失败", message: detail)
                return false
            }
            writeAppLog("model provider configured provider=\(provider)")
            return true
        } catch {
            showAlert(title: "模型设置失败", message: error.localizedDescription)
            return false
        }
    }

    @objc func showModelProviderWizard() {
        let alert = NSAlert()
        alert.messageText = "选择默认模型服务"
        alert.informativeText = "DeepSeek 官方模式已支持 V4 Flash、V4 Pro 与最新 V4 Vision 图片理解；也可以使用你的本地千问兼容接口。"
        alert.alertStyle = .informational
        alert.addButton(withTitle: "DeepSeek 官方 V4")
        alert.addButton(withTitle: "本地千问")
        alert.addButton(withTitle: "稍后设置")
        NSApp.activate(ignoringOtherApps: true)
        let choice = alert.runModal()
        if choice == .alertFirstButtonReturn {
            if applyProviderConfig(provider: "official") {
                UserDefaults.standard.set(providerWizardVersion, forKey: "DSMProviderWizardVersion")
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in self?.loadApp() }
            }
        } else if choice == .alertSecondButtonReturn {
            showQwenProviderForm()
        } else {
            UserDefaults.standard.set(providerWizardVersion, forKey: "DSMProviderWizardVersion")
        }
    }

    func showQwenProviderForm() {
        let endpointField = NSTextField(string: qwenEndpoint)
        let modelField = NSTextField(string: "qwen3.8-27b")
        let keyField = NSSecureTextField(string: "")
        endpointField.placeholderString = "https://…/v1"
        modelField.placeholderString = "千问模型名称"
        keyField.placeholderString = "API 密钥（只保存到钥匙串）"

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 7
        stack.alignment = .leading
        for (title, field) in [("兼容接口", endpointField), ("模型名称", modelField), ("API 密钥", keyField)] {
            let label = NSTextField(labelWithString: title)
            label.font = .systemFont(ofSize: 11, weight: .medium)
            field.frame.size.width = 390
            stack.addArrangedSubview(label)
            stack.addArrangedSubview(field)
        }
        stack.frame = NSRect(x: 0, y: 0, width: 390, height: 154)

        let alert = NSAlert()
        alert.messageText = "设置本地千问模型"
        alert.informativeText = "接口预设为你提供的地址。请确认模型名称，并输入该服务的密钥。图片输入会随最新 DSH 内核启用。"
        alert.accessoryView = stack
        alert.addButton(withTitle: "保存并使用")
        alert.addButton(withTitle: "取消")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let endpoint = endpointField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let model = modelField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let key = keyField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: endpoint), url.scheme == "https", !model.isEmpty, !key.isEmpty else {
            showAlert(title: "请检查模型设置", message: "接口必须是 HTTPS 地址，模型名称和 API 密钥不能为空。")
            showQwenProviderForm()
            return
        }
        guard setKeychainPassword(key) else {
            showAlert(title: "无法保存密钥", message: "macOS 钥匙串拒绝了写入，请检查系统权限。")
            return
        }
        if applyProviderConfig(provider: "qwen", endpoint: endpoint, model: model) {
            UserDefaults.standard.set(providerWizardVersion, forKey: "DSMProviderWizardVersion")
            requestBackendRecovery()
            showAlert(title: "已切换到本地千问", message: "模型 \(model) 已启用；密钥只保存在 macOS 钥匙串中。")
        }
    }

    func applyInterfaceTheme(_ mode: String) {
        interfaceTheme = mode == "official" ? "official" : "cute"
        UserDefaults.standard.set(interfaceTheme, forKey: "DSMInterfaceTheme")
        let script = "window.__dsmApplyTheme&&window.__dsmApplyTheme('\(interfaceTheme)')"
        webView?.evaluateJavaScript(script, completionHandler: nil)
        refreshThemeMenuState()
    }

    func refreshThemeMenuState() {
        themeOfficialMenuItems.forEach { $0.state = interfaceTheme == "official" ? .on : .off }
        themeCuteMenuItems.forEach { $0.state = interfaceTheme == "cute" ? .on : .off }
    }

    @objc func useOfficialTheme() { applyInterfaceTheme("official") }
    @objc func useCuteTheme() { applyInterfaceTheme("cute") }

    func checkBackend(shouldRecover: Bool) {
        guard let url = URL(string: APP_URL) else { return }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 1.5)
        request.httpMethod = "HEAD"
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let online = (200..<500).contains(status)
            DispatchQueue.main.async {
                guard let self else { return }
                if online {
                    self.consecutiveHealthFailures = 0
                    self.publishServiceStatus("online")
                    let host = self.webView.url?.host ?? ""
                    if host != "127.0.0.1" && host != "localhost" {
                        self.loadApp()
                    }
                    return
                }

                self.consecutiveHealthFailures += 1
                let processRunning = self.backendProcess?.isRunning == true
                self.publishServiceStatus(processRunning ? "starting" : "offline")
                guard shouldRecover, !self.isTerminating else { return }

                if !processRunning {
                    self.launchBackend()
                    return
                }

                let startupAge = Date().timeIntervalSince(self.backendStartedAt ?? Date())
                if self.consecutiveHealthFailures >= 4, startupAge > 20 {
                    self.backendProcess?.terminate()
                    self.backendProcess = nil
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
                        self?.launchBackend()
                    }
                }
            }
        }.resume()
    }

    func fastHealthPoll(attempt: Int = 0) {
        guard attempt < 60, !isTerminating else { return }
        guard let url = URL(string: APP_URL) else { return }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 1.0)
        request.httpMethod = "HEAD"
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let online = (200..<500).contains(status)
            DispatchQueue.main.async {
                guard let self, !self.isTerminating else { return }
                if online {
                    self.consecutiveHealthFailures = 0
                    self.publishServiceStatus("online")
                    self.loadApp()
                    self.writeAppLog("backend ready after \(attempt + 1) fast checks")
                    return
                }
                if attempt > 0, attempt % 8 == 0 {
                    self.petView?.setMood(.thinking, text: "服务初始化 · \((attempt + 1) / 4)秒", color: .systemYellow)
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                    self?.fastHealthPoll(attempt: attempt + 1)
                }
            }
        }.resume()
    }

    func launchBackend() {
        if let current = backendProcess, current.isRunning { return }

        publishServiceStatus("starting")

        let process = Process()
        let fileManager = FileManager.default
        let bundledNode = Bundle.main.url(
            forResource: "node",
            withExtension: nil,
            subdirectory: "Runtime/bin"
        )
        let bundledDSH = Bundle.main.url(
            forResource: "bin",
            withExtension: "js",
            subdirectory: "Runtime/dsh/node_modules/@deepseek-ai/dsh/lib"
        )
        var runtimeLabel = "system npx"

        if let bundledNode, let bundledDSH,
           fileManager.isExecutableFile(atPath: bundledNode.path),
           fileManager.fileExists(atPath: bundledDSH.path) {
            process.executableURL = bundledNode
            process.arguments = [bundledDSH.path, "web"]
            runtimeLabel = "bundled Node + dsh"
        } else if fileManager.isExecutableFile(atPath: "/opt/homebrew/bin/npx") {
            process.executableURL = URL(fileURLWithPath: "/opt/homebrew/bin/npx")
            process.arguments = ["--yes", "@deepseek-ai/dsh", "web"]
        } else if fileManager.isExecutableFile(atPath: "/usr/local/bin/npx") {
            process.executableURL = URL(fileURLWithPath: "/usr/local/bin/npx")
            process.arguments = ["--yes", "@deepseek-ai/dsh", "web"]
        } else {
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = ["npx", "--yes", "@deepseek-ai/dsh", "web"]
        }

        var environment = ProcessInfo.processInfo.environment
        let bundledBin = Bundle.main.resourceURL?.appendingPathComponent("Runtime/bin").path ?? ""
        environment["PATH"] = bundledBin + ":/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (environment["PATH"] ?? "")
        environment["NO_COLOR"] = "1"
        if let qwenKey = keychainPassword(), !qwenKey.isEmpty {
            environment["QWEN_API_KEY"] = qwenKey
        }
        process.environment = environment
        process.currentDirectoryURL = fileManager.homeDirectoryForCurrentUser
        if let backendLog = prepareBackendLog() {
            process.standardOutput = backendLog
            process.standardError = backendLog
        } else {
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
        }
        process.terminationHandler = { [weak self] finished in
            DispatchQueue.main.async {
                if self?.backendProcess?.processIdentifier == finished.processIdentifier {
                    self?.backendProcess = nil
                }
                guard let self, !self.isTerminating else { return }
                self.writeAppLog("backend exited status=\(finished.terminationStatus)")
                try? self.backendLogHandle?.close()
                self.backendLogHandle = nil
                self.publishServiceStatus("offline")
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
                    self?.checkBackend(shouldRecover: true)
                }
            }
        }

        do {
            try process.run()
            backendProcess = process
            backendStartedAt = Date()
            fastHealthPoll()
            writeAppLog("backend started pid=\(process.processIdentifier) runtime=\(runtimeLabel)")
            NSLog("DSM_BACKEND_STARTED: %d (%@)", process.processIdentifier, runtimeLabel)
        } catch {
            NSLog("DSM_BACKEND_FAIL: %@", error.localizedDescription)
            writeAppLog("backend launch failed: \(error.localizedDescription)")
            try? backendLogHandle?.close()
            backendLogHandle = nil
            publishServiceStatus("offline")
        }
    }

    func publishServiceStatus(_ status: String) {
        lastServiceStatus = status
        let statusLabels = [
            "online": "● 服务已连接",
            "starting": "● 服务启动中",
            "offline": "● 服务异常"
        ]
        serviceMenuItem?.title = statusLabels[status] ?? "● 服务状态未知"
        statusItem?.button?.contentTintColor = status == "online" ? .systemGreen : (status == "starting" ? .systemYellow : .systemRed)
        guard webView != nil else { return }
        let script = "window.__dsmSetServiceStatus && window.__dsmSetServiceStatus('" + status + "')"
        webView.evaluateJavaScript(script, completionHandler: nil)
        guard !taskBusy else { return }
        switch status {
        case "online":
            petView?.setMood(.idle, text: "DeepSeek 已连接", color: .systemGreen)
        case "starting":
            petView?.setMood(.thinking, text: "正在启动服务…", color: .systemYellow)
        default:
            petView?.setMood(.error, text: "服务异常 · 点我重试", color: .systemRed)
        }
    }

    func requestBackendRecovery() {
        if let process = backendProcess, process.isRunning {
            showOffline()
            process.terminate()
            backendProcess = nil
            publishServiceStatus("starting")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
                self?.launchBackend()
            }
        } else {
            checkBackend(shouldRecover: true)
            loadApp()
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "dsmService", let command = message.body as? String {
            if command == "recover" {
                requestBackendRecovery()
            } else if command == "check" {
                checkBackend(shouldRecover: true)
            }
            return
        }

        if message.name == "dsmPet", let payload = message.body as? [String: Any],
           let event = payload["event"] as? String {
            let taskTitle = (payload["title"] as? String) ?? "当前任务"
            let taskURL = payload["url"] as? String
            if event == "busy" {
                if !taskBusy { taskStartedAt = Date() }
                taskBusy = true
                if !taskTitle.isEmpty { lastTaskTitle = taskTitle }
                if let taskURL, taskURL.hasPrefix(APP_URL) { lastTaskURL = taskURL }
                petView?.setMood(.thinking, text: "正在认真思考…", color: .systemYellow)
            } else if event == "complete" {
                guard taskBusy else { return }
                let measuredDuration = Date().timeIntervalSince(taskStartedAt ?? Date())
                let reportedDuration = (payload["durationMs"] as? NSNumber)?.doubleValue ?? 0
                let duration = reportedDuration > 0 ? reportedDuration / 1000 : measuredDuration
                taskBusy = false
                taskStartedAt = nil
                if !taskTitle.isEmpty { lastTaskTitle = taskTitle }
                if let taskURL, taskURL.hasPrefix(APP_URL) { lastTaskURL = taskURL }
                let durationLabel = formatDuration(duration)
                petView?.setMood(.complete, text: "完成 · " + durationLabel, color: .systemGreen)
                petView?.celebrate()
                notifyTaskCompletion(lastTaskTitle, duration: duration, taskURL: lastTaskURL)
                recordTask(title: lastTaskTitle, duration: duration, url: lastTaskURL)
                DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [weak self] in
                    guard let self, !self.taskBusy else { return }
                    self.publishServiceStatus(self.lastServiceStatus)
                }
            }
        }
    }

    func buildDesktopPet() {
        let size = NSSize(width: 184, height: 194)
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        var origin = NSPoint(x: screenFrame.maxX - size.width - 28, y: screenFrame.minY + 34)
        let defaults = UserDefaults.standard
        if defaults.object(forKey: "DSMPetOriginX") != nil,
           defaults.object(forKey: "DSMPetOriginY") != nil {
            let saved = NSPoint(x: defaults.double(forKey: "DSMPetOriginX"), y: defaults.double(forKey: "DSMPetOriginY"))
            let savedFrame = NSRect(origin: saved, size: size)
            if NSScreen.screens.contains(where: { $0.visibleFrame.intersection(savedFrame).width > 42 }) {
                origin = saved
            }
        }
        let panel = NSPanel(
            contentRect: NSRect(origin: origin, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.ignoresMouseEvents = false
        panel.acceptsMouseMovedEvents = true
        panel.becomesKeyOnlyIfNeeded = true

        let view = PetView(frame: NSRect(origin: .zero, size: size))
        view.onActivate = { [weak self] in self?.activateFromPet() }
        view.onInteract = { [weak self] in self?.showPetReaction() }
        view.onRetry = { [weak self] in self?.requestBackendRecovery() }
        view.onHide = { [weak panel] in panel?.orderOut(nil) }
        view.onTestCompletion = { [weak self] in self?.testPetCompletion() }
        view.onStartFocus = { [weak self] minutes in self?.startFocusTimer(minutes: minutes) }
        view.onCancelFocus = { [weak self] in self?.cancelFocusTimer() }
        view.onMoveFinished = { point in
            UserDefaults.standard.set(point.x, forKey: "DSMPetOriginX")
            UserDefaults.standard.set(point.y, forKey: "DSMPetOriginY")
        }
        panel.contentView = view
        panel.orderFrontRegardless()
        petPanel = panel
        petView = view
    }

    func loadTaskHistory() {
        guard let data = UserDefaults.standard.data(forKey: "DSMTaskHistory"),
              let records = try? JSONDecoder().decode([TaskRecord].self, from: data) else { return }
        taskHistory = Array(records.prefix(8))
    }

    func recordTask(title: String, duration: TimeInterval, url: String?) {
        let record = TaskRecord(title: title, duration: duration, url: url, completedAt: Date())
        taskHistory.insert(record, at: 0)
        taskHistory = Array(taskHistory.prefix(8))
        if let data = try? JSONEncoder().encode(taskHistory) {
            UserDefaults.standard.set(data, forKey: "DSMTaskHistory")
        }
        rebuildHistoryMenu()
    }

    func rebuildHistoryMenu() {
        historyMenu.removeAllItems()
        guard !taskHistory.isEmpty else {
            let empty = NSMenuItem(title: "还没有完成记录", action: nil, keyEquivalent: "")
            empty.isEnabled = false
            historyMenu.addItem(empty)
            return
        }
        let formatter = DateFormatter()
        formatter.dateFormat = "MM-dd HH:mm"
        for record in taskHistory {
            let label = "\(formatter.string(from: record.completedAt)) · \(record.title) · \(formatDuration(record.duration))"
            let item = NSMenuItem(title: label, action: #selector(openHistoricalTask(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = record.url
            item.isEnabled = record.url != nil
            historyMenu.addItem(item)
        }
        historyMenu.addItem(.separator())
        let clear = NSMenuItem(title: "清除历史", action: #selector(clearTaskHistory), keyEquivalent: "")
        clear.target = self
        historyMenu.addItem(clear)
    }

    @objc func openHistoricalTask(_ sender: NSMenuItem) {
        openTask(sender.representedObject as? String)
    }

    @objc func clearTaskHistory() {
        taskHistory.removeAll()
        UserDefaults.standard.removeObject(forKey: "DSMTaskHistory")
        rebuildHistoryMenu()
    }

    func configureNotifications() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound]) { granted, error in
            if let error { NSLog("DSM_NOTIFICATION_FAIL: %@", error.localizedDescription) }
            NSLog("DSM_NOTIFICATION_AUTH: %@", granted ? "true" : "false")
        }
    }

    func formatDuration(_ duration: TimeInterval) -> String {
        let seconds = max(1, Int(duration.rounded()))
        if seconds < 60 { return "\(seconds)秒" }
        let minutes = seconds / 60
        let remainder = seconds % 60
        return remainder == 0 ? "\(minutes)分钟" : "\(minutes)分\(remainder)秒"
    }

    func notifyTaskCompletion(_ taskTitle: String, duration: TimeInterval, taskURL: String?) {
        let content = UNMutableNotificationContent()
        content.title = "DeepSeek · 任务完成"
        content.subtitle = taskTitle
        content.body = "正太助手已完成 · 用时 " + formatDuration(duration)
        content.sound = .default
        content.userInfo = [
            "taskURL": taskURL ?? "",
            "taskTitle": taskTitle
        ]
        let request = UNNotificationRequest(identifier: "dsm-task-" + UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let taskURL = response.notification.request.content.userInfo["taskURL"] as? String
        DispatchQueue.main.async { [weak self] in
            self?.openTask(taskURL)
            completionHandler()
        }
    }

    func openTask(_ taskURL: String?) {
        activateFromPet()
        guard let taskURL,
              let url = URL(string: taskURL),
              url.host == "127.0.0.1" || url.host == "localhost" else { return }
        webView.load(URLRequest(url: url))
    }

    @objc func activateFromPet() {
        NSApp.activate(ignoringOtherApps: true)
        if window.isMiniaturized { window.deminiaturize(nil) }
        window.makeKeyAndOrderFront(nil)
        if lastServiceStatus == "offline" { requestBackendRecovery() }
    }

    @objc func testPetCompletion() {
        taskBusy = false
        lastTaskTitle = "桌面宠物提醒测试"
        lastTaskURL = webView.url?.absoluteString
        petView?.setMood(.complete, text: "测试完成啦！", color: .systemGreen)
        petView?.celebrate()
        notifyTaskCompletion(lastTaskTitle, duration: 3.8, taskURL: lastTaskURL)
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            guard let self, !self.taskBusy else { return }
            self.publishServiceStatus(self.lastServiceStatus)
        }
    }

    func showPetReaction() {
        guard !taskBusy else { return }
        let phrases = ["我在呢！", "一起加油呀", "今天也很棒", "要记得喝水", "摸摸收到啦", "随时可以找我"]
        petView?.setMood(.idle, text: phrases.randomElement() ?? "我在呢！", color: .systemGreen)
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.2) { [weak self] in
            guard let self, !self.taskBusy else { return }
            if self.focusEndDate != nil { self.updateFocusTimer() }
            else { self.publishServiceStatus(self.lastServiceStatus) }
        }
    }

    func startFocusTimer(minutes: Int) {
        focusTimer?.invalidate()
        focusTitle = minutes == 10 ? "休息时间" : "专注时间"
        focusEndDate = Date().addingTimeInterval(TimeInterval(minutes * 60))
        focusTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            self?.updateFocusTimer()
        }
        updateFocusTimer()
        writeAppLog("focus timer started minutes=\(minutes)")
    }

    func updateFocusTimer() {
        guard let endDate = focusEndDate else { return }
        let remaining = Int(ceil(endDate.timeIntervalSinceNow))
        if remaining <= 0 {
            finishFocusTimer()
            return
        }
        guard !taskBusy else { return }
        let minutes = remaining / 60
        let seconds = remaining % 60
        petView?.setMood(.thinking, text: String(format: "%@ · %02d:%02d", focusTitle, minutes, seconds), color: .systemYellow)
    }

    func finishFocusTimer() {
        focusTimer?.invalidate()
        focusTimer = nil
        focusEndDate = nil
        writeAppLog("focus timer completed title=\(focusTitle)")
        let content = UNMutableNotificationContent()
        content.title = "DeepSeek · \(focusTitle)完成"
        content.body = focusTitle == "休息时间" ? "休息结束啦，可以精神满满地回来。" : "专注完成！起来活动一下吧。"
        content.sound = .default
        UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: "dsm-focus-" + UUID().uuidString, content: content, trigger: nil)
        )
        guard !taskBusy else { return }
        petView?.setMood(.complete, text: "\(focusTitle)完成！", color: .systemGreen)
        petView?.celebrate()
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [weak self] in
            guard let self, !self.taskBusy else { return }
            self.publishServiceStatus(self.lastServiceStatus)
        }
    }

    @objc func cancelFocusTimer() {
        focusTimer?.invalidate()
        focusTimer = nil
        focusEndDate = nil
        writeAppLog("focus timer cancelled")
        if !taskBusy { publishServiceStatus(lastServiceStatus) }
    }

    @objc func startFocus25() { startFocusTimer(minutes: 25) }
    @objc func startFocus50() { startFocusTimer(minutes: 50) }
    @objc func startBreak10() { startFocusTimer(minutes: 10) }

    @objc func toggleDesktopPet() {
        guard let panel = petPanel else { return }
        panel.isVisible ? panel.orderOut(nil) : panel.orderFrontRegardless()
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript("Boolean(window.__dsmMac)") { result, _ in
            let ok = (result as? NSNumber)?.boolValue ?? false
            NSLog("DSM_THEME_CHECK: %@", ok ? "true" : "false")
        }
        checkBackend(shouldRecover: true)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let nsErr = error as NSError
        if nsErr.code == NSURLErrorCancelled { return }
        NSLog("DSM_NET_FAIL: %@", nsErr.localizedDescription)
        showOffline()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        let nsErr = error as NSError
        if nsErr.code == NSURLErrorCancelled { return }
        NSLog("DSM_NET_FAIL: %@", nsErr.localizedDescription)
        showOffline()
    }

    func showOffline() {
        guard let url = Bundle.main.url(forResource: "offline", withExtension: "html"),
              let html = try? String(contentsOf: url, encoding: .utf8) else { return }
        webView.loadHTMLString(html, baseURL: Bundle.main.resourceURL)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        let host = url.host ?? ""
        let isLocal = (host == "127.0.0.1" || host == "localhost")
        if navigationAction.targetFrame?.isMainFrame == true, !isLocal, url.scheme == "http" || url.scheme == "https" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, let request = navigationAction.request.url {
            webView.load(URLRequest(url: request))
        }
        return nil
    }

    // MARK: - Menu

    func buildStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = NSImage(systemSymbolName: "message.fill", accessibilityDescription: "DeepSeek Cute")
        item.button?.toolTip = "DeepSeek Cute · 本地助手"

        let menu = NSMenu(title: "DeepSeek Cute")
        let service = NSMenuItem(title: "● 服务启动中", action: nil, keyEquivalent: "")
        service.isEnabled = false
        menu.addItem(service)
        serviceMenuItem = service
        menu.addItem(.separator())

        let open = NSMenuItem(title: "打开 DeepSeek", action: #selector(activateFromPet), keyEquivalent: "")
        open.target = self
        menu.addItem(open)
        let pet = NSMenuItem(title: "显示/隐藏桌面宠物", action: #selector(toggleDesktopPet), keyEquivalent: "")
        pet.target = self
        menu.addItem(pet)
        let restart = NSMenuItem(title: "重启本地服务", action: #selector(restartBackendFromMenu), keyEquivalent: "")
        restart.target = self
        menu.addItem(restart)

        let theme = NSMenuItem(title: "界面主题", action: nil, keyEquivalent: "")
        let themeMenu = NSMenu(title: "界面主题")
        let officialTheme = NSMenuItem(title: "DeepSeek 官方样式", action: #selector(useOfficialTheme), keyEquivalent: "")
        let cuteTheme = NSMenuItem(title: "正太主题", action: #selector(useCuteTheme), keyEquivalent: "")
        for entry in [officialTheme, cuteTheme] { entry.target = self }
        themeOfficialMenuItems.append(officialTheme)
        themeCuteMenuItems.append(cuteTheme)
        themeMenu.addItem(officialTheme)
        themeMenu.addItem(cuteTheme)
        theme.submenu = themeMenu
        menu.addItem(theme)

        let provider = NSMenuItem(title: "模型服务设置…", action: #selector(showModelProviderWizard), keyEquivalent: "")
        provider.target = self
        menu.addItem(provider)

        let focus = NSMenuItem(title: "专注计时", action: nil, keyEquivalent: "")
        let focusMenu = NSMenu(title: "专注计时")
        let focus25 = NSMenuItem(title: "专注 25 分钟", action: #selector(startFocus25), keyEquivalent: "")
        let focus50 = NSMenuItem(title: "深度专注 50 分钟", action: #selector(startFocus50), keyEquivalent: "")
        let break10 = NSMenuItem(title: "休息 10 分钟", action: #selector(startBreak10), keyEquivalent: "")
        let cancel = NSMenuItem(title: "取消计时", action: #selector(cancelFocusTimer), keyEquivalent: "")
        for entry in [focus25, focus50, break10, cancel] { entry.target = self }
        focusMenu.addItem(focus25)
        focusMenu.addItem(focus50)
        focusMenu.addItem(break10)
        focusMenu.addItem(.separator())
        focusMenu.addItem(cancel)
        focus.submenu = focusMenu
        menu.addItem(focus)

        rebuildHistoryMenu()
        let history = NSMenuItem(title: "最近完成任务", action: nil, keyEquivalent: "")
        history.submenu = historyMenu
        menu.addItem(history)
        menu.addItem(.separator())

        let update = NSMenuItem(title: "检查 GitHub 更新", action: #selector(checkForUpdatesFromMenu), keyEquivalent: "")
        update.target = self
        menu.addItem(update)
        let login = NSMenuItem(title: "登录时自动启动", action: #selector(toggleLaunchAtLogin), keyEquivalent: "")
        login.target = self
        menu.addItem(login)
        loginItemMenuItem = login
        refreshLoginItemState()
        let logs = NSMenuItem(title: "打开诊断日志", action: #selector(openDiagnosticLogs), keyEquivalent: "")
        logs.target = self
        menu.addItem(logs)
        let copy = NSMenuItem(title: "复制诊断信息", action: #selector(copyDiagnostics), keyEquivalent: "")
        copy.target = self
        menu.addItem(copy)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "退出 DeepSeek", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
        menu.addItem(quit)

        item.menu = menu
        statusItem = item
        refreshThemeMenuState()
    }

    @objc func restartBackendFromMenu() {
        requestBackendRecovery()
    }

    @objc func openDiagnosticLogs() {
        NSWorkspace.shared.open(logsDirectory())
    }

    @objc func copyDiagnostics() {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
        let details = """
        DeepSeek Cute \(version) (\(build))
        macOS \(ProcessInfo.processInfo.operatingSystemVersionString)
        Service: \(lastServiceStatus)
        Runtime: \(backendProcess?.isRunning == true ? "running" : "stopped")
        Logs: \(logsDirectory().path)
        """
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(details, forType: .string)
        if !taskBusy {
            petView?.setMood(.idle, text: "诊断信息已复制", color: .systemGreen)
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
                guard let self, !self.taskBusy else { return }
                self.publishServiceStatus(self.lastServiceStatus)
            }
        }
    }

    func refreshLoginItemState() {
        guard #available(macOS 13.0, *) else {
            loginItemMenuItem?.isEnabled = false
            return
        }
        switch SMAppService.mainApp.status {
        case .enabled:
            loginItemMenuItem?.state = .on
            loginItemMenuItem?.title = "登录时自动启动"
        case .requiresApproval:
            loginItemMenuItem?.state = .mixed
            loginItemMenuItem?.title = "登录启动 · 等待系统批准"
        default:
            loginItemMenuItem?.state = .off
            loginItemMenuItem?.title = "登录时自动启动"
        }
    }

    @objc func toggleLaunchAtLogin() {
        guard #available(macOS 13.0, *) else { return }
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
                if SMAppService.mainApp.status == .requiresApproval {
                    SMAppService.openSystemSettingsLoginItems()
                }
            }
        } catch {
            showAlert(title: "无法修改登录启动", message: error.localizedDescription)
        }
        refreshLoginItemState()
    }

    func buildMenu() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于 " + APP_NAME, action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏 " + APP_NAME, action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "显示/隐藏桌面宠物", action: #selector(AppDelegate.toggleDesktopPet), keyEquivalent: "p")
        appMenu.addItem(withTitle: "测试任务完成提醒", action: #selector(AppDelegate.testPetCompletion), keyEquivalent: "")
        let themeItem = NSMenuItem(title: "界面主题", action: nil, keyEquivalent: "")
        let themeMenu = NSMenu(title: "界面主题")
        let officialTheme = NSMenuItem(title: "DeepSeek 官方样式", action: #selector(AppDelegate.useOfficialTheme), keyEquivalent: "")
        let cuteTheme = NSMenuItem(title: "正太主题", action: #selector(AppDelegate.useCuteTheme), keyEquivalent: "")
        for entry in [officialTheme, cuteTheme] { entry.target = self }
        themeOfficialMenuItems.append(officialTheme)
        themeCuteMenuItems.append(cuteTheme)
        themeMenu.addItem(officialTheme)
        themeMenu.addItem(cuteTheme)
        themeItem.submenu = themeMenu
        appMenu.addItem(themeItem)
        let providerItem = appMenu.addItem(withTitle: "模型服务设置…", action: #selector(AppDelegate.showModelProviderWizard), keyEquivalent: "")
        providerItem.target = self
        appMenu.addItem(.separator())
        let updateItem = appMenu.addItem(withTitle: "检查 GitHub 更新", action: #selector(AppDelegate.checkForUpdatesFromMenu), keyEquivalent: "")
        updateItem.target = self
        let logsItem = appMenu.addItem(withTitle: "打开诊断日志", action: #selector(AppDelegate.openDiagnosticLogs), keyEquivalent: "")
        logsItem.target = self
        let diagnosticsItem = appMenu.addItem(withTitle: "复制诊断信息", action: #selector(AppDelegate.copyDiagnostics), keyEquivalent: "")
        diagnosticsItem.target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 " + APP_NAME, action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        let viewItem = NSMenuItem()
        mainMenu.addItem(viewItem)
        let viewMenu = NSMenu(title: "显示")
        viewMenu.addItem(withTitle: "重新载入", action: #selector(AppDelegate.reloadPage), keyEquivalent: "r")
        viewMenu.addItem(withTitle: "进入全屏幕", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        viewItem.submenu = viewMenu

        let windowItem = NSMenuItem()
        mainMenu.addItem(windowItem)
        let windowMenu = NSMenu(title: "窗口")
        windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowItem.submenu = windowMenu
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = mainMenu
        refreshThemeMenuState()
    }

    @objc func reloadPage() {
        startBackendIfNeeded()
        loadApp()
    }
}

let delegate = AppDelegate()
let app = NSApplication.shared
app.delegate = delegate
app.run()
