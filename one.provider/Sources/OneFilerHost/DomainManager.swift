import Foundation
import FileProvider
import CryptoKit
import Darwin
#if SWIFT_PACKAGE
import OneFilerShared
#endif

/// Coordinates the app and its signed CLI without holding a global lock across OS callbacks.
class DomainManager {
    typealias DomainOperation = (NSFileProviderDomain, @escaping (Error?) -> Void) -> Void
    typealias DomainConfig = LocalDomainConfiguration
    private let configFileURL: URL?
    private let addDomain: DomainOperation
    private let removeDomain: DomainOperation

    init(configFileURL: URL? = nil,
         addDomain: @escaping DomainOperation = { NSFileProviderManager.add($0, completionHandler: $1) },
         removeDomain: @escaping DomainOperation = { NSFileProviderManager.remove($0, completionHandler: $1) }) {
        self.configFileURL = configFileURL ?? FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: RuntimeSecurity.group)?.appendingPathComponent("domains.json")
        self.addDomain = addDomain
        self.removeDomain = removeDomain
    }

    func listDomains() throws -> [String: DomainConfig] {
        try withConfiguration { domains, _ in domains }
    }

    func registerDomain(name: String, email: String? = nil, commServerUrl: String? = nil, completion: @escaping (Error?) -> Void = { _ in }) throws {
        if let email, email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw PrivateSocket.failure("An identity email is required.")
        }
        if let commServerUrl {
            guard let url = URLComponents(string: commServerUrl), ["ws", "wss"].contains(url.scheme),
                  url.host?.isEmpty == false, url.user == nil, url.password == nil, url.fragment == nil else {
                throw PrivateSocket.failure("A WebSocket relay URL without credentials is required.")
            }
        }
        let lease = try acquireDomain(name)
        let finish: (Error?) -> Void = { error in lease.release(); completion(error) }
        do {
            let change = try withConfiguration(write: true) { domains, original -> (DomainConfig?, DomainConfig, [String: DomainConfig], Data?) in
                let previous = domains[name]
                if let previous, let email, previous.email != email {
                    throw PrivateSocket.failure("This domain already belongs to another identity. Create a new domain to use a different email.")
                }
                if let previous, let commServerUrl, previous.commServerUrl != commServerUrl {
                    throw PrivateSocket.failure("This domain already uses another relay. Create a new domain for this relay.")
                }
                let id = UUID()
                let config = previous ?? DomainConfig(storageId: id, email: email ?? "\(id.uuidString.lowercased())@filer.local", commServerUrl: commServerUrl)
                domains[name] = config
                return (previous, config, domains, original)
            }
            let domain = NSFileProviderDomain(identifier: NSFileProviderDomainIdentifier(rawValue: name), displayName: name)
            addDomain(domain) { error in
                if let error {
                    do {
                        try self.withConfiguration { domains, _ in
                            guard domains[name] == change.1, let url = self.configFileURL else { throw Self.conflict() }
                            if domains == change.2 {
                                if let original = change.3 { try original.write(to: url, options: .atomic) }
                                else { try FileManager.default.removeItem(at: url) }
                            } else {
                                domains[name] = change.0
                                try JSONEncoder().encode(domains).write(to: url, options: .atomic)
                            }
                        }
                    } catch { finish(error); return }
                    finish(error)
                } else { finish(nil) }
            }
        } catch { lease.release(); throw error }
    }

    func unregisterDomain(name: String, completion: @escaping (Error?) -> Void = { _ in }) throws {
        let lease = try acquireDomain(name)
        let finish: (Error?) -> Void = { error in lease.release(); completion(error) }
        do {
            // Validate existing configuration before asking macOS to remove anything.
            let expected = try listDomains()[name]
            let domain = NSFileProviderDomain(identifier: NSFileProviderDomainIdentifier(rawValue: name), displayName: name)
            removeDomain(domain) { error in
                if let error { finish(error); return }
                do {
                    // Re-read after the callback: other domains may have changed meanwhile.
                    try self.withConfiguration(write: true) { domains, _ in
                        guard domains[name] == expected else { throw Self.conflict() }
                        domains.removeValue(forKey: name)
                    }
                    finish(nil)
                } catch { finish(error) }
            }
        } catch { lease.release(); throw error }
    }

    func getDomainConfig(name: String) throws -> DomainConfig? { try listDomains()[name] }

    /// Ask File Provider to enumerate the current tree after runtime mounts change.
    func refreshDomain(name: String, completion: @escaping (Error?) -> Void) throws {
        guard try getDomainConfig(name: name) != nil else { throw PrivateSocket.failure("Unknown domain.") }
        let domain = NSFileProviderDomain(identifier: NSFileProviderDomainIdentifier(name), displayName: name)
        guard let provider = NSFileProviderManager(for: domain) else {
            throw PrivateSocket.failure("The File Provider domain is unavailable.")
        }
        provider.signalEnumerator(for: .workingSet, completionHandler: completion)
    }

    private func withConfiguration<T>(write: Bool = false, _ operation: (inout [String: DomainConfig], Data?) throws -> T) throws -> T {
        guard let url = configFileURL else { throw PrivateSocket.failure("The Filer app-group container is unavailable.") }
        let lease = try DomainLease(url: url.deletingLastPathComponent().appendingPathComponent("domains.lock"), nonblocking: false)
        defer { lease.release() }
        let original = FileManager.default.fileExists(atPath: url.path) ? try Data(contentsOf: url) : nil
        var domains = try original.map { try JSONDecoder().decode([String: DomainConfig].self, from: $0) } ?? [:]
        let previous = domains
        let result = try operation(&domains, original)
        if write && domains != previous {
            try JSONEncoder().encode(domains).write(to: url, options: .atomic)
        }
        return result
    }

    /// This digest names a local operation lock; it is not a ONE object reference.
    private func acquireDomain(_ name: String) throws -> DomainLease {
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw PrivateSocket.failure("A domain name is required.") }
        guard let url = configFileURL else { throw PrivateSocket.failure("The Filer app-group container is unavailable.") }
        let key = SHA256.hash(data: Data(name.utf8)).map { String(format: "%02x", $0) }.joined()
        return try DomainLease(url: url.deletingLastPathComponent().appendingPathComponent("domain-\(key).lock"), nonblocking: true)
    }

    private static func conflict() -> NSError { PrivateSocket.failure("Domain configuration changed during the operation.") }
}

/// File locks also serialize separate host CLI processes. The lock inode is never unlinked.
private final class DomainLease {
    private let lock = NSLock()
    private var fd: Int32
    init(url: URL, nonblocking: Bool) throws {
        fd = Darwin.open(url.path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw PrivateSocket.failure("Cannot lock domain configuration.") }
        if flock(fd, LOCK_EX | (nonblocking ? LOCK_NB : 0)) != 0 {
            Darwin.close(fd)
            fd = -1
            throw PrivateSocket.failure("Another operation is already changing this domain.")
        }
    }
    func release() {
        lock.lock()
        defer { lock.unlock() }
        if fd >= 0 { Darwin.close(fd); fd = -1 }
    }
    deinit { release() }
}
