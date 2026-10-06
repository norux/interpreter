import AppKit
import Darwin

let resources = Bundle.main.resourceURL!
let python = resources.appendingPathComponent("python/bin/python3.12").path
let runtime = resources.appendingPathComponent("runtime.py").path

func runRuntime(_ arguments: [String]) -> Never {
    let strings = [python, "-I", "-B", runtime] + arguments
    let pointers = strings.map { strdup($0) } + [nil]
    _ = pointers.withUnsafeBufferPointer { buffer in
        execv(python, buffer.baseAddress!)
    }
    perror("Interpreter Python runtime")
    exit(1)
}

// Chrome invokes this same executable with its extension origin, without a GUI.
if CommandLine.arguments.count > 1 {
    runRuntime(Array(CommandLine.arguments.dropFirst()))
}

final class SetupWindow: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var button: NSButton!
    let log = NSTextView()
    var process: Process?

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 540, height: 360),
                          styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Interpreter Companion"
        window.center()
        let title = NSTextField(labelWithString: "로컬 번역 준비")
        title.font = .boldSystemFont(ofSize: 22)
        title.frame = NSRect(x: 24, y: 298, width: 490, height: 30)
        let description = NSTextField(wrappingLabelWithString:
            "최초 준비에서 음성 인식·번역 모델을 다운로드합니다. 이후에는 Chrome 확장의 Start로 자동 실행됩니다.")
        description.frame = NSRect(x: 24, y: 238, width: 490, height: 50)
        button = NSButton(title: "모델 준비 시작", target: self, action: #selector(prepare))
        button.bezelStyle = .rounded
        button.frame = NSRect(x: 24, y: 194, width: 160, height: 32)
        let extensionFolder = NSButton(title: "확장 폴더 열기", target: self, action: #selector(showExtension))
        extensionFolder.bezelStyle = .rounded
        extensionFolder.frame = NSRect(x: 202, y: 194, width: 160, height: 32)
        let scroll = NSScrollView(frame: NSRect(x: 24, y: 24, width: 490, height: 156))
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        log.isEditable = false
        log.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        log.autoresizingMask = [.width]
        scroll.documentView = log
        for view in [title, description, button!, extensionFolder, scroll] { window.contentView!.addSubview(view) }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        launch(["--register"], preparing: false)
    }

    func append(_ text: String) {
        log.textStorage?.append(NSAttributedString(string: text))
        log.scrollToEndOfDocument(nil)
    }

    func launch(_ arguments: [String], preparing: Bool) {
        button.isEnabled = false
        let task = Process()
        task.executableURL = URL(fileURLWithPath: python)
        task.arguments = ["-I", "-B", runtime] + arguments
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil; return }
            let text = String(decoding: data, as: UTF8.self)
            DispatchQueue.main.async { self.append(text) }
        }
        task.terminationHandler = { finished in
            DispatchQueue.main.async {
                self.process = nil
                self.button.isEnabled = true
                if finished.terminationStatus != 0 {
                    self.append("\n준비 실패. 위 내용을 확인한 뒤 다시 시도하세요.\n")
                } else if !preparing {
                    self.append("확장 연결 등록 완료. 모델 준비를 시작하세요.\n")
                }
            }
        }
        do { try task.run(); process = task }
        catch { append("실행 실패: \(error.localizedDescription)\n"); button.isEnabled = true }
    }

    @objc func prepare() { launch(["--setup"], preparing: true) }

    @objc func showExtension() {
        let folder = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Interpreter/extension")
        NSWorkspace.shared.open(folder)
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        process?.terminate()
        return .terminateNow
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let delegate = SetupWindow()
let application = NSApplication.shared
application.setActivationPolicy(.regular)
application.delegate = delegate
application.run()
