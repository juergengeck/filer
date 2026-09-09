import Cocoa
import FileProvider

// Domain commands run inside the signed host so File Provider resolves its extension.
let arguments = CommandLine.arguments
if arguments.count > 1 {
    guard arguments.count == 3,
          ["--register-domain", "--unregister-domain"].contains(arguments[1]) else {
        fputs("Usage: OneFilerHost --register-domain NAME | --unregister-domain NAME\n", stderr)
        exit(2)
    }
    let manager = DomainManager()
    let name = arguments[2]
    func finish(_ error: Error?) {
        if let error {
            fputs("\(error)\n", stderr)
            exit(1)
        }
        print("File Provider domain command completed: \(name)")
        exit(0)
    }
    do {
        if arguments[1] == "--register-domain" {
            try manager.registerDomain(name: name, completion: finish)
        } else {
            try manager.unregisterDomain(name: name, completion: finish)
        }
        RunLoop.main.run()
    } catch {
        finish(error)
    }
    exit(0)
}

if NSRunningApplication.runningApplications(withBundleIdentifier: "one.filer").contains(where: { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }) {
    exit(0)
}
let app = NSApplication.shared
let delegate = MenuBarApp()
app.delegate = delegate
app.run()
