import Cocoa
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
    var onRetry: (() -> Void)?
    var onHide: (() -> Void)?
    var onTestCompletion: (() -> Void)?
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
            onActivate?()
        }
        didDrag = false
    }

    override func rightMouseDown(with event: NSEvent) {
        let menu = NSMenu(title: "桌面小助手")
        menu.addItem(withTitle: "打开 DeepSeek", action: #selector(activateFromMenu), keyEquivalent: "")
        menu.addItem(withTitle: "重试本地服务", action: #selector(retryFromMenu), keyEquivalent: "")
        menu.addItem(withTitle: "测试完成提醒", action: #selector(testFromMenu), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "隐藏桌面宠物", action: #selector(hideFromMenu), keyEquivalent: "")
        for item in menu.items { item.target = self }
        NSMenu.popUpContextMenu(menu, with: event, for: self)
    }

    @objc private func activateFromMenu() { onActivate?() }
    @objc private func retryFromMenu() { onRetry?() }
    @objc private func testFromMenu() { onTestCompletion?() }
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
    var backendStartedAt: Date?
    var consecutiveHealthFailures = 0
    var isTerminating = false
    var petPanel: NSPanel?
    var petView: PetView?
    var taskBusy = false
    var lastServiceStatus = "starting"
    var taskStartedAt: Date?
    var lastTaskTitle = "当前任务"
    var lastTaskURL: String?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildMenu()

        let config = WKWebViewConfiguration()
        let controller = WKUserContentController()

        // 注入 macOS 主题 CSS（资源文件 theme.css）
        if let cssURL = Bundle.main.url(forResource: "theme", withExtension: "css"),
           let css = try? String(contentsOf: cssURL, encoding: .utf8),
           let jsonData = try? JSONSerialization.data(withJSONObject: [css]),
           let json = String(data: jsonData, encoding: .utf8) {
            let script = "window.__dsmMac=true;(function(){try{var s=document.createElement('style');s.setAttribute('data-dsm-mac','app');s.textContent=" + json + ";document.documentElement.appendChild(s);}catch(e){console.error('DSM_CSS',e);}})();"
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

        startBackendIfNeeded()
        startHealthMonitor()
        loadApp()
        NSApp.activate(ignoringOtherApps: true)
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
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "dsmService")
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "dsmPet")
        if let process = backendProcess, process.isRunning {
            process.terminate()
        }
    }

    func loadApp() {
        guard let url = URL(string: APP_URL) else { return }
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8))
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
        process.environment = environment
        process.currentDirectoryURL = fileManager.homeDirectoryForCurrentUser
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] finished in
            DispatchQueue.main.async {
                if self?.backendProcess?.processIdentifier == finished.processIdentifier {
                    self?.backendProcess = nil
                }
                guard let self, !self.isTerminating else { return }
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
            NSLog("DSM_BACKEND_STARTED: %d (%@)", process.processIdentifier, runtimeLabel)
        } catch {
            NSLog("DSM_BACKEND_FAIL: %@", error.localizedDescription)
            publishServiceStatus("offline")
        }
    }

    func publishServiceStatus(_ status: String) {
        lastServiceStatus = status
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
        view.onRetry = { [weak self] in self?.requestBackendRecovery() }
        view.onHide = { [weak panel] in panel?.orderOut(nil) }
        view.onTestCompletion = { [weak self] in self?.testPetCompletion() }
        view.onMoveFinished = { point in
            UserDefaults.standard.set(point.x, forKey: "DSMPetOriginX")
            UserDefaults.standard.set(point.y, forKey: "DSMPetOriginY")
        }
        panel.contentView = view
        panel.orderFrontRegardless()
        petPanel = panel
        petView = view
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
