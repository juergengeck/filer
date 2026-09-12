import Cocoa
import FileProvider

// Domain commands run inside the signed host so File Provider resolves its extension.
let arguments = CommandLine.arguments
if arguments.count > 1 {
    let registration = arguments.count >= 3 && arguments[1] == "--register-domain"
    let qaCommand = arguments.count == 4 && arguments[1] == "--qa-domain"
    guard registration || qaCommand || (arguments.count == 3 &&
          ["--register-domain", "--unregister-domain", "--pair-domain", "--refresh-domain"].contains(arguments[1])) else {
        fputs("Usage: OneFilerHost --register-domain NAME [--email EMAIL] [--comm-server URL] | --unregister-domain NAME | --refresh-domain NAME | --pair-domain NAME < invitation.txt | --qa-domain NAME runFullProtocol|getStatus|resume|stop|getProtocolReport|getInspectionReport|getDiagnostics|getFotosSnapshot|waitForFotos [< parameters.json]\n", stderr)
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
        if qaCommand {
            let method = arguments[3]
            let operation = try RuntimeService.qaOperation(method: method)
            var parameters: [String: Any] = [:]
            if ["runFullProtocol", "waitForFotos"].contains(method) {
                guard let data = try FileHandle.standardInput.read(upToCount: 8 * 1024 * 1024 + 1),
                      data.count <= 8 * 1024 * 1024,
                      let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    throw PrivateSocket.failure("Supply an operation parameters JSON object on standard input.")
                }
                parameters = value
            }
            let request: [String: Any] = ["operation": operation, "request": parameters,
                                          "requestId": UUID().uuidString]
            let fd = try PrivateSocket.connect(path: RuntimeSecurity.container().appendingPathComponent(RuntimeSecurity.socketName).path,
                                               requirement: RuntimeSecurity.hostRequirement)
            defer { Darwin.close(fd) }
            try PrivateSocket.writeFrame(fd, JSONSerialization.data(withJSONObject: ["domain": name, "request": request]))
            let response = try PrivateSocket.readFrame(fd)
            FileHandle.standardOutput.write(response + Data("\n".utf8))
            let envelope = try JSONSerialization.jsonObject(with: response) as? [String: Any]
            exit(envelope?["success"] as? Bool == true ? 0 : 1)
        } else if arguments[1] == "--pair-domain" {
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
            var options: [String: String] = [:]
            var index = 3
            while index < arguments.count {
                let key = arguments[index]
                guard ["--email", "--comm-server"].contains(key), index + 1 < arguments.count, options[key] == nil else {
                    throw PrivateSocket.failure("Use each domain registration option once with its value.")
                }
                options[key] = arguments[index + 1]; index += 2
            }
            try manager.registerDomain(name: name, email: options["--email"], commServerUrl: options["--comm-server"], completion: finish)
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
