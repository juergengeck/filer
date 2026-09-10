import Foundation
import Darwin

@main struct PrivateSocketProbe {
    static func main() throws {
        let path = CommandLine.arguments[2]
        if CommandLine.arguments[1] == "runtime" {
            Task {
                do { try await checkRuntime(); exit(0) }
                catch { fputs("Sandbox runtime failed: \(error)\n", stderr); exit(4) }
            }
            RunLoop.main.run()
        } else if CommandLine.arguments[1] == "server" {
            let listener = try PrivateSocket.listen(path: path)
            defer { Darwin.close(listener); unlink(path) }
            print("READY"); fflush(stdout)
            let peer = Darwin.accept(listener, nil, nil)
            guard peer >= 0 else { exit(4) }
            do {
                // Match descriptors accepted by the production nonblocking listener.
                guard fcntl(peer, F_SETFL, O_NONBLOCK) == 0 else { exit(4) }
                try PrivateSocket.configure(peer)
                guard fcntl(peer, F_GETFL) & O_NONBLOCK == 0 else { exit(4) }
                try PrivateSocket.validatePeer(peer, requirement: RuntimeSecurity.clientRequirement)
                let request = try PrivateSocket.readFrame(peer)
                try PrivateSocket.writeFrame(peer, request)
            } catch { fputs("Peer rejected: \(error.localizedDescription)\n", stderr) }
            Darwin.close(peer)
            // Keep the signed process alive until the driver completes both identity checks.
            RunLoop.main.run()
        } else {
            do {
                let peer = try PrivateSocket.connect(path: path, requirement: RuntimeSecurity.hostRequirement)
                defer { Darwin.close(peer) }
                try PrivateSocket.writeFrame(peer, Data("probe".utf8))
                guard try PrivateSocket.readFrame(peer) == Data("probe".utf8) else { exit(4) }
            } catch { fputs("Peer rejected: \(error.localizedDescription)\n", stderr); exit(3) }
        }
    }
    static func checkRuntime() async throws {
        let directory = try RuntimeSecurity.container().appendingPathComponent("test-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let bundle = Bundle.main
        let root = bundle.resourceURL!.appendingPathComponent("runtime")
        let child = NodeRuntimeProcess(node: bundle.executableURL!.deletingLastPathComponent().appendingPathComponent("node"),
            entry: root.appendingPathComponent("node_modules/@refinio/api/dist/src/filer/stdio-main.js"),
            preload: root.appendingPathComponent("console-to-stderr.cjs"))
        defer { child.stop() }
        try await child.start(configuration: ["directory": directory.path, "email": "sandbox-test@filer.local",
            "secret": UUID().uuidString, "name": "Sandbox test", "commServerUrl": "ws://127.0.0.1:1",
            "inviteUrlPrefix": "https://refinio.one/invite"])
        let response = try await child.invoke(JSONSerialization.data(withJSONObject: [
            "operation": "devices:listDevices", "request": [:], "requestId": "sandbox"]))
        guard let result = try JSONSerialization.jsonObject(with: response) as? [String: Any], result["success"] as? Bool == true else {
            throw PrivateSocket.failure("Sandbox runtime operation failed.")
        }
        await child.shutdown()
        try FileManager.default.removeItem(at: directory)
        print("PASS: sandboxed bundled Node and canonical ONE runtime")
    }

}
