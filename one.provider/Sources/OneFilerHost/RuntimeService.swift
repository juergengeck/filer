import Foundation
import Darwin
#if SWIFT_PACKAGE
import OneFilerShared
#endif

/// One owner holds an exclusive app-group lock and accepts only the signed extension.
final class RuntimeService {
    private let runtimes = RuntimeOwner()
    private let queue = DispatchQueue(label: "one.filer.runtime.accept")
    private var source: DispatchSourceRead?
    private var lockFD: Int32 = -1
    private var socketPath: String?

    func start() throws {
        let directory = try RuntimeSecurity.container()
        let lock = Darwin.open(directory.appendingPathComponent("runtime.lock").path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0o600)
        guard lock >= 0 else { throw PrivateSocket.failure("Cannot lock the local runtime.") }
        guard flock(lock, LOCK_EX | LOCK_NB) == 0 else {
            Darwin.close(lock)
            throw PrivateSocket.failure("Another Filer host already owns the local runtime.")
        }
        do {
            let path = directory.appendingPathComponent(RuntimeSecurity.socketName).path
            if unlink(path) != 0 && errno != ENOENT { throw PrivateSocket.failure("Cannot remove the stale runtime socket.") }
            let fd = try PrivateSocket.listen(path: path)
            guard fcntl(fd, F_SETFL, O_NONBLOCK) == 0 else { Darwin.close(fd); throw PrivateSocket.failure("Cannot configure the runtime listener.") }
            let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
            source.setEventHandler { [weak self] in self?.accept(fd) }
            source.setCancelHandler { Darwin.close(fd) }
            self.source = source
            lockFD = lock
            socketPath = path
            source.resume()
        } catch { Darwin.close(lock); throw error }
    }

    func stop() async {
        source?.cancel()
        source = nil
        await runtimes.stop()
        if let socketPath { unlink(socketPath) }
        if lockFD >= 0 { Darwin.close(lockFD); lockFD = -1 }
    }

    private func accept(_ listener: Int32) {
        let fd = Darwin.accept(listener, nil, nil)
        guard fd >= 0 else { return }
        // Accepted descriptors must not leak into the owned Node child.
        guard fcntl(fd, F_SETFD, FD_CLOEXEC) == 0 else { Darwin.close(fd); return }
        let runtimes = self.runtimes
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try PrivateSocket.configure(fd)
                try PrivateSocket.validatePeer(fd, requirement: RuntimeSecurity.clientRequirement)
                let bytes = try PrivateSocket.readFrame(fd)
                guard let envelope = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                      let domain = envelope["domain"] as? String, let request = envelope["request"] else {
                    throw PrivateSocket.failure("Invalid private runtime request.")
                }
                let data = try JSONSerialization.data(withJSONObject: request)
                Task {
                    do {
                        let response = try await runtimes.perform(domain: domain, request: data)
                        try PrivateSocket.writeFrame(fd, response)
                    } catch {
                        // Never disclose bootstrap credentials or storage paths through transport errors.
                    }
                    Darwin.close(fd)
                }
            } catch { Darwin.close(fd) }
        }
    }
}

/// Runtime configuration is resolved from the host-owned domain table, never from request parameters.
private actor RuntimeOwner {
    private var children: [UUID: Task<NodeRuntimeProcess, Error>] = [:]
    private var stopped = false

    func perform(domain: String, request: Data) async throws -> Data {
        guard !stopped else { throw CocoaError(.userCancelled) }
        guard let config = try DomainManager().getDomainConfig(name: domain) else {
            throw NSError(domain: "one.filer.runtime", code: 4,
                          userInfo: [NSLocalizedDescriptionKey: "This domain is not registered with Filer."])
        }
        if let task = children[config.storageId], let child = try? await task.value, !child.isRunning {
            children.removeValue(forKey: config.storageId)
        }
        if children[config.storageId] == nil {
            let task = Task<NodeRuntimeProcess, Error> {
                let bundle = Bundle.main
                guard let executable = bundle.executableURL, let resources = bundle.resourceURL else {
                    throw CocoaError(.fileNoSuchFile)
                }
                let node = executable.deletingLastPathComponent().appendingPathComponent("node")
                let root = resources.appendingPathComponent("runtime")
                let directory = try RuntimeSecurity.container().appendingPathComponent("instances").appendingPathComponent(config.storageId.uuidString)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let child = NodeRuntimeProcess(node: node,
                    entry: root.appendingPathComponent("node_modules/@refinio/api/dist/src/filer/stdio-main.js"),
                    preload: root.appendingPathComponent("console-to-stderr.cjs"))
                try await child.start(configuration: ["directory": directory.path, "email": config.email,
                    "secret": InstanceSecrets.getOrCreate(instance: config.storageId), "name": domain,
                    "commServerUrl": "wss://comm10.dev.refinio.one", "inviteUrlPrefix": "https://refinio.one/invite"])
                return child
            }
            children[config.storageId] = task
        }
        guard let task = children[config.storageId] else { throw CocoaError(.fileNoSuchFile) }
        let child: NodeRuntimeProcess
        do { child = try await task.value }
        catch { children.removeValue(forKey: config.storageId); throw error }
        guard !stopped else { child.stop(); throw CocoaError(.userCancelled) }
        // Each IPC client has its own request sequence. Re-key only the pipe envelope.
        guard var envelope = try JSONSerialization.jsonObject(with: request) as? [String: Any],
              let clientId = envelope["requestId"] as? String else { throw CocoaError(.coderInvalidValue) }
        envelope["requestId"] = UUID().uuidString
        let result = try await child.invoke(JSONSerialization.data(withJSONObject: envelope))
        guard var response = try JSONSerialization.jsonObject(with: result) as? [String: Any] else { throw CocoaError(.coderInvalidValue) }
        response["requestId"] = clientId
        return try JSONSerialization.data(withJSONObject: response)
    }

    func stop() async {
        stopped = true
        for task in children.values { if let child = try? await task.value { await child.shutdown() } }
        children.removeAll()
    }
}
