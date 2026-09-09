import Foundation
import Darwin
#if SWIFT_PACKAGE
import OneFilerShared
#endif

/// Authenticate the host before sending an operation over its private app-group socket.
actor PrivateRuntimeClient {
    private let domain: String
    init(domain: String) { self.domain = domain }

    func invoke(_ request: Data) async throws -> Data {
        let path = try RuntimeSecurity.container().appendingPathComponent(RuntimeSecurity.socketName).path
        let envelope = try JSONSerialization.data(withJSONObject: ["domain": domain,
            "request": JSONSerialization.jsonObject(with: request)])
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let fd = try PrivateSocket.connect(path: path, requirement: RuntimeSecurity.hostRequirement)
                    defer { Darwin.close(fd) }
                    try PrivateSocket.writeFrame(fd, envelope)
                    let response = try PrivateSocket.readFrame(fd)
                    continuation.resume(returning: response)
                } catch { continuation.resume(throwing: error) }
            }
        }
    }

    func disconnect() { /* Every request owns and closes its connection. */ }
}
