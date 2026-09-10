import Cocoa
import FileProvider

// Domain commands run inside the signed host so File Provider resolves its extension.
let arguments = CommandLine.arguments
if arguments.count > 1 {
    let registration = arguments.count == 5 && arguments[1] == "--register-domain" && arguments[3] == "--email"
    guard registration || (arguments.count == 3 &&
          ["--register-domain", "--unregister-domain", "--pair-domain", "--refresh-domain"].contains(arguments[1])) else {
        fputs("Usage: OneFilerHost --register-domain NAME [--email EMAIL] | --unregister-domain NAME | --refresh-domain NAME | --pair-domain NAME < invitation.txt\n", stderr)
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
        if arguments[1] == "--pair-domain" {
            guard let data = try FileHandle.standardInput.read(upToCount: 65537),
                  data.count <= 65536, let url = String(data: data, encoding: .utf8) else {
                throw PrivateSocket.failure("Supply one pairing invitation URL on standard input.")
            }
            let request = try JSONSerialization.jsonObject(with: PairingInvitation.request(url: url))
            let fd = try PrivateSocket.connect(path: RuntimeSecurity.container().appendingPathComponent(RuntimeSecurity.socketName).path,
                                               requirement: RuntimeSecurity.hostRequirement)
            defer { Darwin.close(fd) }
            try PrivateSocket.writeFrame(fd, JSONSerialization.data(withJSONObject: ["domain": name, "request": request]))
            try PairingInvitation.validateResponse(PrivateSocket.readFrame(fd))
            print("Paired domain: \(name). Sync progress is separate from pairing.")
            exit(0)
        } else if arguments[1] == "--refresh-domain" {
            try manager.refreshDomain(name: name, completion: finish)
        } else if arguments[1] == "--register-domain" {
            try manager.registerDomain(name: name, email: registration ? arguments[4] : nil, completion: finish)
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
