import Foundation

/// Own one ONE instance in a Node child. Only inherited stdin/stdout carry operations.
final class NodeRuntimeProcess: @unchecked Sendable {
    private let process = Process()
    private let input = Pipe()
    private let output = Pipe()
    private let state = DispatchQueue(label: "one.filer.runtime.responses")
    private let writer = DispatchQueue(label: "one.filer.runtime.requests")
    private var buffer = Data()
    private var pending: [String: (Result<Data, Error>) -> Void] = [:]
    private var generations: [String: UUID] = [:]
    private var failure: Error?
    private var bootstrapped = false
    private let onChange: @Sendable ([String]) -> Void
    private let onQAProgress: @Sendable (FilerQAProgress) -> Void
    private static let maxFrame = 96 * 1024 * 1024

    var isRunning: Bool { state.sync { failure == nil && process.isRunning } }

    /// Paths are supplied by the host's signed bundle, never by an IPC request.
    init(node: URL, entry: URL, preload: URL, onChange: @escaping @Sendable ([String]) -> Void = { _ in },
         onQAProgress: @escaping @Sendable (FilerQAProgress) -> Void = { _ in }) {
        self.onChange = onChange
        self.onQAProgress = onQAProgress
        process.executableURL = node
        process.arguments = ["--jitless", "--require", preload.path, entry.path]
        // Do not inherit NODE_OPTIONS, NODE_PATH, inspector settings, or injected loaders.
        process.environment = ["HOME": NSHomeDirectory(), "TMPDIR": NSTemporaryDirectory(), "NODE_ENV": "production"]
        process.standardInput = input
        process.standardOutput = output
        process.standardError = FileHandle.standardError
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard let self else { return }
            self.state.async { self.receive(data) }
        }
        process.terminationHandler = { [weak self] _ in
            guard let self else { return }
            self.state.async { self.fail(Self.error("The local ONE runtime stopped.")) }
        }
    }

    /// Bootstrap configuration, including the instance secret, never appears in arguments or files.
    func start(configuration: [String: String]) async throws {
        let bytes = try JSONSerialization.data(withJSONObject: configuration)
        _ = try await exchange(bytes, id: "bootstrap", launch: true)
    }

    func invoke(_ data: Data) async throws -> Data {
        guard let request = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = request["requestId"] as? String, !id.isEmpty, id != "bootstrap" else {
            throw Self.error("An operation request ID is required.")
        }
        return try await exchange(data, id: id, launch: false)
    }

    /// Closing the owner's input causes refinio.api to drain operations and close its instance.
    func stop() {
        writer.async { try? self.input.fileHandleForWriting.close() }
    }

    /// Wait for process exit before releasing its storage or completing application termination.
    func shutdown() async {
        stop()
        await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                if self.process.isRunning { self.process.waitUntilExit() }
                continuation.resume()
            }
        }
    }

    private func exchange(_ data: Data, id: String, launch: Bool) async throws -> Data {
        guard data.count <= Self.maxFrame else { throw Self.error("The operation is too large.") }
        return try await withCheckedThrowingContinuation { continuation in
            state.async {
                if let failure = self.failure { continuation.resume(throwing: failure); return }
                guard self.pending[id] == nil else {
                    continuation.resume(throwing: Self.error("Duplicate operation request ID.")); return
                }
                let generation = UUID()
                self.generations[id] = generation
                self.pending[id] = { continuation.resume(with: $0) }
                do {
                    if launch { try self.process.run() }
                    self.writer.async {
                        do {
                            try self.input.fileHandleForWriting.write(contentsOf: data + Data([10]))
                        } catch { self.state.async { self.fail(error) } }
                    }
                    // A deadline bounds stuck bootstrap/IO; requests are never retried automatically.
                    self.state.asyncAfter(deadline: .now() + 60) {
                        if self.generations[id] == generation {
                            self.fail(Self.error("The local ONE runtime did not respond within 60 seconds."))
                            if self.process.isRunning { self.process.terminate() }
                        }
                    }
                } catch { self.fail(error) }
            }
        }
    }

    private func receive(_ bytes: Data) {
        guard failure == nil else { return }
        if bytes.isEmpty { fail(Self.error("The local ONE runtime closed its response pipe.")); return }
        buffer.append(bytes)
        guard buffer.count <= Self.maxFrame else { fail(Self.error("Runtime response is too large.")); return }
        while let newline = buffer.firstIndex(of: 10) {
            let line = Data(buffer[..<newline])
            buffer.removeSubrange(...newline)
            do {
                guard let response = try JSONSerialization.jsonObject(with: line) as? [String: Any] else {
                    throw Self.error("Invalid runtime response.")
                }
                if let event = response["event"] {
                    if event as? String == "filerQAProgress" {
                        guard bootstrapped, response["requestId"] == nil, let status = response["status"] else {
                            throw Self.error("Invalid QA progress notification.")
                        }
                        onQAProgress(try FilerQAProgress.decode(status))
                        continue
                    }
                    guard bootstrapped, event as? String == "filerChanged", response["requestId"] == nil,
                          let containers = response["containers"] as? [String], !containers.isEmpty, containers.count <= 128,
                          containers.allSatisfy({ $0 == "root" || $0 == "workingSet" || $0 == "ONE/System" ||
                              ($0.hasPrefix("filer:") && Self.isHash(String($0.dropFirst(6)))) || Self.isPublishedDirectory($0) }) else {
                        throw Self.error("Invalid filesystem change notification.")
                    }
                    onChange(containers)
                    continue
                }
                let id: String
                if response["ready"] as? Bool == true {
                    guard Self.isHash(response["owner"]), Self.isHash(response["instance"]) else {
                        throw Self.error("The runtime did not return valid ONE identities.")
                    }
                    bootstrapped = true
                    id = "bootstrap"
                } else if let requestId = response["requestId"] as? String { id = requestId }
                else { throw Self.error("Runtime response has no request ID.") }
                guard let reply = pending.removeValue(forKey: id) else { throw Self.error("Unsolicited runtime response.") }
                generations.removeValue(forKey: id)
                reply(.success(line))
            } catch { fail(error); return }
        }
    }

    private func fail(_ error: Error) {
        guard failure == nil else { return }
        failure = error
        let replies = pending.values
        pending.removeAll()
        generations.removeAll()
        for reply in replies { reply(.failure(error)) }
        output.fileHandleForReading.readabilityHandler = nil
        stop()
    }

    /// Only explicitly mounted file publications may use absolute path identifiers.
    static func isPublishedDirectory(_ value: String) -> Bool {
        if value == "/ONE" || value == "/ONE/System" { return true }
        guard ["/Gesundheit", "/Files", "/Fotos", "/objects", "/contacts", "/ONE/System/journal"].contains(where: { value == $0 || value.hasPrefix($0 + "/") }) else { return false }
        return !value.contains("\\") && !value.contains("\0") &&
            value.dropFirst().split(separator: "/", omittingEmptySubsequences: false).allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }

    private static func isHash(_ value: Any?) -> Bool {
        guard let value = value as? String else { return false }
        return value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }

    private static func error(_ message: String) -> NSError {
        NSError(domain: "one.filer.runtime", code: 3, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
