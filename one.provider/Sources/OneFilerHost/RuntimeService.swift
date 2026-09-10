import Foundation
import Darwin
import FileProvider
#if SWIFT_PACKAGE
import OneFilerShared
#endif

/// One owner holds an exclusive app-group lock and accepts only signed Filer clients.
final class RuntimeService {
    private let runtimes = RuntimePool(configuration: { try DomainManager().listDomains() }, factory: RuntimeService.createRuntime)
    private var configurationSource: RuntimeConfigurationObserver?
    private let queue = DispatchQueue(label: "one.filer.runtime.accept")
    private var source: DispatchSourceRead?
    private var lockFD: Int32 = -1
    private var socketPath: String?

    /// The menu uses the same runtime owner as Finder; it never opens a second instance.
    func pair(domain: String, invitationURL: String) async throws {
        let request = try PairingInvitation.request(url: invitationURL)
        try PairingInvitation.validateResponse(await runtimes.perform(domain: domain, request: request))
    }

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
            configurationSource = try RuntimeConfigurationObserver(directory: directory) { [weak self] in
                guard let self else { return }
                Task {
                    do { try await self.runtimes.reconcile() }
                    catch { NSLog("Filer could not reconcile runtime configuration: %@", error.localizedDescription) }
                }
            }
        } catch {
            source?.cancel()
            source = nil
            if let socketPath { unlink(socketPath) }
            lockFD = -1
            Darwin.close(lock)
            throw error
        }
    }

    func stop() async {
        configurationSource?.stop()
        configurationSource = nil
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
                guard var operation = request as? [String: Any],
                      let clientId = operation["requestId"] as? String, !clientId.isEmpty else {
                    throw CocoaError(.coderInvalidValue)
                }
                // Request sequences belong to clients; use one unique pipe ID per operation.
                operation["requestId"] = UUID().uuidString
                let data = try JSONSerialization.data(withJSONObject: operation)
                Task {
                    defer { Darwin.close(fd) }
                    let reply: [String: Any]
                    do {
                        let result = try await runtimes.perform(domain: domain, request: data)
                        guard var response = try JSONSerialization.jsonObject(with: result) as? [String: Any] else { throw CocoaError(.coderInvalidValue) }
                        response["requestId"] = clientId
                        reply = response
                    } catch {
                        let failure = error as NSError
                        let removed = failure.domain == "one.filer.runtime" && failure.code == 4
                        reply = ["requestId": clientId, "success": false, "error": [
                            "code": removed ? "DOMAIN_UNREGISTERED" : "RUNTIME_UNAVAILABLE",
                            "message": removed ? "This domain is no longer registered with Filer." : "The local ONE runtime could not complete the operation."]]
                        NSLog("Filer runtime operation failed (%@:%ld)", failure.domain, failure.code)
                    }
                    // A disconnected caller cannot receive a response; never replay its operation.
                    do { try PrivateSocket.writeFrame(fd, JSONSerialization.data(withJSONObject: reply)) }
                    catch { NSLog("Filer runtime response connection closed") }
                }
            } catch { Darwin.close(fd) }
        }
    }

    /// All paths and credentials are resolved by the owner, never supplied by an IPC caller.
    private static func createRuntime(domain: String, config: LocalDomainConfiguration) async throws -> any OwnedRuntime {
        let bundle = Bundle.main
        guard let executable = bundle.executableURL, let resources = bundle.resourceURL else { throw CocoaError(.fileNoSuchFile) }
        let root = resources.appendingPathComponent("runtime")
        let directory = try RuntimeSecurity.container().appendingPathComponent("instances").appendingPathComponent(config.storageId.uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let child = NodeRuntimeProcess(node: executable.deletingLastPathComponent().appendingPathComponent("node"),
            entry: root.appendingPathComponent("node_modules/@refinio/api/dist/src/filer/stdio-main.js"),
            preload: root.appendingPathComponent("console-to-stderr.cjs"), onChange: { containers in
                Task {
                    do {
                        // A storage owner may back more than one configured domain.
                        let names = try DomainManager().listDomains().filter { $0.value.storageId == config.storageId }.keys.sorted()
                        for name in names {
                            let providerDomain = NSFileProviderDomain(identifier: NSFileProviderDomainIdentifier(name), displayName: name)
                            guard let manager = NSFileProviderManager(for: providerDomain) else {
                                throw PrivateSocket.failure("Cannot resolve the registered File Provider domain.")
                            }
                            // Replicated providers only honor working-set notifications.
                            // The runtime's validated containers describe the change source.
                            guard !containers.isEmpty,
                                  try DomainManager().listDomains()[name]?.storageId == config.storageId else { continue }
                            try await manager.signalEnumerator(for: .workingSet)
                        }
                    } catch { NSLog("Filer change signaling failed: %@", error.localizedDescription) }
                }
            })
        do {
            try await child.start(configuration: ["directory": directory.path, "email": config.email,
                "secret": InstanceSecrets.getOrCreate(instance: config.storageId), "name": domain,
                "commServerUrl": "wss://comm10.dev.refinio.one", "inviteUrlPrefix": "https://refinio.one/invite"])
            return child
        } catch { await child.shutdown(); throw error }
    }

    /// Match ONEBridge's path item identifiers when routing validated runtime notifications.
    static func containerIdentifier(_ value: String) -> NSFileProviderItemIdentifier {
        if value == "root" { return .rootContainer }
        if value == "workingSet" { return .workingSet }
        return NSFileProviderItemIdentifier(value.hasPrefix("/") ? String(value.dropFirst()) : value)
    }
}
