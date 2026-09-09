import Foundation
import Security
import Darwin

/// Framed local IPC. Peer identity comes from the kernel, never a PID or token supplied by a caller.
public enum PrivateSocket {
    public static let maximumFrame = 96 * 1024 * 1024

    public static func validatePeer(_ fd: Int32, requirement: String) throws {
        var token = audit_token_t()
        var size = socklen_t(MemoryLayout.size(ofValue: token))
        guard getsockopt(fd, SOL_LOCAL, LOCAL_PEERTOKEN, &token, &size) == 0,
              size == MemoryLayout.size(ofValue: token) else { throw failure("Cannot identify the local peer.") }
        let data = withUnsafeBytes(of: token) { Data($0) }
        var code: SecCode?
        var rule: SecRequirement?
        // Validate the live kernel signature; disk-based lookup is forbidden in App Sandbox.
        let lookup = SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributeAudit: data, kSecGuestAttributeDynamicCode: true] as CFDictionary, [], &code)
        guard lookup == errSecSuccess else { throw failure("Cannot inspect the local peer signature (\(lookup)).") }
        let parsed = SecRequirementCreateWithString(requirement as CFString, [], &rule)
        guard parsed == errSecSuccess, let code, let rule else { throw failure("Invalid local peer requirement.") }
        let valid = SecCodeCheckValidity(code, [], rule)
        guard valid == errSecSuccess else { throw failure("The local peer does not have the required Filer signature (\(valid)).") }

    }

    public static func connect(path: String, requirement: String) throws -> Int32 {
        let fd = try create()
        do {
            try withAddress(path) { address, size in
                guard Darwin.connect(fd, address, size) == 0 else { throw failure("Open OneFiler to start its local runtime.") }
            }
            try configure(fd)
            try validatePeer(fd, requirement: requirement)
            return fd
        } catch { Darwin.close(fd); throw error }
    }

    /// The owning process holds a separate lock before removing a stale socket and binding.
    public static func listen(path: String) throws -> Int32 {
        let fd = try create()
        do {
            try withAddress(path) { address, size in
                guard Darwin.bind(fd, address, size) == 0 else { throw failure("Cannot bind the private runtime socket.") }
            }
            guard chmod(path, 0o600) == 0, Darwin.listen(fd, 16) == 0 else { throw failure("Cannot listen on the private runtime socket.") }
            return fd
        } catch { Darwin.close(fd); throw error }
    }

    /// Timeouts bound stalled local peers; failed operations are never replayed.
    public static func configure(_ fd: Int32) throws {
        var timeout = timeval(tv_sec: 65, tv_usec: 0)
        var yes: Int32 = 1
        guard setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout.size(ofValue: timeout))) == 0,
              setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout.size(ofValue: timeout))) == 0,
              setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, socklen_t(MemoryLayout.size(ofValue: yes))) == 0 else {
            throw failure("Cannot configure the private runtime socket.")
        }
    }

    public static func readFrame(_ fd: Int32) throws -> Data {
        let header = try readExactly(fd, count: 4)
        let length = header.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        guard length > 0, length <= maximumFrame else { throw failure("Invalid runtime frame length.") }
        return try readExactly(fd, count: Int(length))
    }

    public static func writeFrame(_ fd: Int32, _ data: Data) throws {
        guard !data.isEmpty, data.count <= maximumFrame else { throw failure("Invalid runtime frame length.") }
        var size = UInt32(data.count).bigEndian
        try writeAll(fd, withUnsafeBytes(of: &size) { Data($0) })
        try writeAll(fd, data)
    }

    private static func create() throws -> Int32 {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw failure("Cannot create the private runtime socket.") }
        guard fcntl(fd, F_SETFD, FD_CLOEXEC) == 0 else { Darwin.close(fd); throw failure("Cannot isolate the runtime socket.") }
        return fd
    }

    private static func withAddress<T>(_ path: String, _ body: (UnsafePointer<sockaddr>, socklen_t) throws -> T) throws -> T {
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8) + [0]
        guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else { throw failure("App-group socket path is too long.") }
        withUnsafeMutableBytes(of: &address.sun_path) { target in target.copyBytes(from: bytes) }
        address.sun_len = UInt8(MemoryLayout.size(ofValue: address))
        return try withUnsafePointer(to: &address) { pointer in
            try pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { try body($0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
    }

    private static func readExactly(_ fd: Int32, count: Int) throws -> Data {
        var data = Data(count: count)
        try data.withUnsafeMutableBytes { bytes in
            var offset = 0
            while offset < count {
                let received = Darwin.read(fd, bytes.baseAddress!.advanced(by: offset), count - offset)
                if received < 0 && errno == EINTR { continue }
                guard received > 0 else { throw failure("The private runtime connection closed or timed out.") }
                offset += received
            }
        }
        return data
    }

    private static func writeAll(_ fd: Int32, _ data: Data) throws {
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < data.count {
                let sent = Darwin.write(fd, bytes.baseAddress!.advanced(by: offset), data.count - offset)
                if sent < 0 && errno == EINTR { continue }
                guard sent > 0 else { throw failure("The private runtime connection closed or timed out.") }
                offset += sent
            }
        }
    }

    public static func failure(_ message: String) -> NSError {
        NSError(domain: "one.filer.runtime", code: 5, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
