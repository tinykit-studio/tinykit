import AppKit

// LaunchServices delivers URLs here. Identity validation and registered-only
// resolution happen in the CLI; browser input is never used as executable code.
final class LauncherDelegate: NSObject, NSApplicationDelegate {
    var receivedURL = false
    var busy = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            if !self.receivedURL {
                self.showError("Open an app in Tinykit Studio and choose Edit with local agent. Register its folder first with tinykit edit .")
                NSApp.terminate(nil)
            }
        }
    }

    func showError(_ message: String) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Tinykit couldn’t open this app"
        alert.informativeText = String(message.prefix(4000))
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        receivedURL = true
        guard !busy, urls.count == 1, let url = urls.first else { return }
        busy = true
        // Bring any normal macOS folder-access prompt into view.
        NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let resource = Bundle.main.url(forResource: "tinykit-launcher", withExtension: "json"),
                      let config = try JSONSerialization.jsonObject(with: Data(contentsOf: resource)) as? [String: String],
                      let node = config["node"], let cli = config["cli"], let directory = config["config_directory"] else {
                    throw NSError(domain: "Tinykit", code: 1, userInfo: [NSLocalizedDescriptionKey: "Reinstall the launcher with tinykit launcher install."])
                }
                let task = Process(), output = Pipe(), errors = Pipe()
                task.executableURL = URL(fileURLWithPath: node)
                task.arguments = [cli, "open-url", url.absoluteString, "--json"]
                task.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser
                // LaunchServices has a minimal PATH. Pin the Node selected at install
                // time, without forwarding browser, hosting, or API credentials.
                let home = FileManager.default.homeDirectoryForCurrentUser.path
                task.environment = ["HOME": home, "USER": NSUserName(), "PATH": URL(fileURLWithPath: node).deletingLastPathComponent().path + ":/usr/bin:/bin:/usr/sbin:/sbin", "TMPDIR": NSTemporaryDirectory(), "TINYKIT_CONFIG_DIR": directory]
                task.standardOutput = output
                task.standardError = errors
                try task.run()
                let timeout = DispatchWorkItem { if task.isRunning { task.terminate() } }
                DispatchQueue.global().asyncAfter(deadline: .now() + 120, execute: timeout)
                // Drain both pipes concurrently so a verbose failure cannot deadlock.
                let group = DispatchGroup()
                let stderr = OutputBox()
                group.enter()
                DispatchQueue.global().async { stderr.data = errors.fileHandleForReading.readDataToEndOfFile(); group.leave() }
                let stdout = output.fileHandleForReading.readDataToEndOfFile()
                task.waitUntilExit()
                timeout.cancel()
                group.wait()
                let result = URL(fileURLWithPath: directory).appendingPathComponent("launcher-last-result.json")
                let manager = FileManager.default
                if (try? manager.destinationOfSymbolicLink(atPath: result.path)) == nil {
                    let data = stdout.isEmpty ? stderr.data : stdout
                    try data.write(to: result, options: .atomic)
                    try manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: result.path)
                }
                if task.terminationStatus != 0 {
                    let parsed = try? JSONSerialization.jsonObject(with: stdout) as? [String: Any]
                    let message = parsed?["error"] as? String ?? String(data: stderr.data, encoding: .utf8) ?? "Retry from Studio, or use Copy command."
                    DispatchQueue.main.async { self.showError(message); NSApp.terminate(nil) }
                } else {
                    DispatchQueue.main.async { NSApp.terminate(nil) }
                }
            } catch {
                DispatchQueue.main.async { self.showError("\(error.localizedDescription)\nRun tinykit launcher install to repair the launcher."); NSApp.terminate(nil) }
            }
        }
    }
}

final class OutputBox: @unchecked Sendable { var data = Data() }
let app = NSApplication.shared
let delegate = LauncherDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
