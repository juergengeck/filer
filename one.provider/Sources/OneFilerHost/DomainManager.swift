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

    func registerDomain(
        name: String,
        displayName: String? = nil,
        email: String? = nil,
        commServerUrl: String? = nil,
        storageId: UUID? = nil,
        instanceName: String? = nil,
        glueApiBase: String? = nil,
        completion: @escaping (Error?) -> Void = { _ in }
    ) throws {
        if let email, email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw PrivateSocket.failure("An identity email is required.")
        }
        let resolvedDisplayName: String
        if let displayName {
            resolvedDisplayName = try Self.validateDisplayName(displayName)
        } else {
            resolvedDisplayName = try Self.validateDisplayName(name)
        }
        let trimmedInstanceName: String?
        if let instanceName {
            let trimmed = instanceName.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else {
                throw PrivateSocket.failure("An instance name cannot be empty.")
            }
            trimmedInstanceName = trimmed
        } else {
            trimmedInstanceName = nil
        }
        if let commServerUrl {
            guard let url = URLComponents(string: commServerUrl), ["ws", "wss"].contains(url.scheme),
                  url.host?.isEmpty == false, url.user == nil, url.password == nil, url.fragment == nil else {
                throw PrivateSocket.failure("A WebSocket relay URL without credentials is required.")
            }
        }
        let normalizedGlueApiBase: String?
        if let glueApiBase {
            let trimmed = glueApiBase.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let url = URLComponents(string: trimmed),
                  let host = url.host, !host.isEmpty,
                  url.user == nil, url.password == nil, url.fragment == nil,
                  url.scheme == "https" || (url.scheme == "http" && ["127.0.0.1", "localhost"].contains(host.lowercased())) else {
                throw PrivateSocket.failure("A valid HTTPS Glue authority URL without credentials is required.")
            }
            normalizedGlueApiBase = trimmed.hasSuffix("/") ? String(trimmed.dropLast()) : trimmed
        } else {
            normalizedGlueApiBase = nil
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
                if let previous, let storageId, previous.storageId != storageId {
                    throw PrivateSocket.failure("This domain already has local storage. Create a new domain instead.")
                }
                if let previous, let trimmedInstanceName, previous.resolvedInstanceName(fallback: name) != trimmedInstanceName {
                    throw PrivateSocket.failure("This domain already belongs to another ONE instance. Create a new domain instead.")
                }
                if let previous, let normalizedGlueApiBase, previous.glueApiBase != normalizedGlueApiBase {
                    throw PrivateSocket.failure("This domain already uses another Glue authority. Create a new domain instead.")
                }
                let id = storageId ?? UUID()
                let storedDisplayName = displayName != nil ? resolvedDisplayName : previous?.displayName
                let config = previous.map {
                    DomainConfig(
                        storageId: $0.storageId,
                        email: $0.email,
                        commServerUrl: $0.commServerUrl,
                        displayName: storedDisplayName,
                        instanceName: $0.instanceName,
                        glueApiBase: $0.glueApiBase
                    )
                } ?? DomainConfig(
                    storageId: id,
                    email: email ?? "\(id.uuidString.lowercased())@filer.local",
                    commServerUrl: commServerUrl,
                    displayName: displayName != nil ? resolvedDisplayName : nil,
                    instanceName: trimmedInstanceName,
                    glueApiBase: normalizedGlueApiBase
                )
                domains[name] = config
                return (previous, config, domains, original)
            }
            let effectiveDisplayName = change.1.resolvedDisplayName(fallback: name)
            let domain = NSFileProviderDomain(identifier: NSFileProviderDomainIdentifier(rawValue: name), displayName: effectiveDisplayName)
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

    /// Update a registered domain's user-facing display name in place without changing its identifier or storage.
    func renameDomain(name: String, displayName: String, completion: @escaping (Error?) -> Void = { _ in }) throws {
        let trimmed = try Self.validateDisplayName(displayName)
        let lease = try acquireDomain(name)
        let finish: (Error?) -> Void = { error in lease.release(); completion(error) }
        do {
            let change = try withConfiguration(write: true) { domains, original -> (DomainConfig, DomainConfig, [String: DomainConfig], Data?) in
                guard let previous = domains[name] else {
                    throw PrivateSocket.failure("Unknown domain.")
                }
                let updated = DomainConfig(
                    storageId: previous.storageId,
                    email: previous.email,
                    commServerUrl: previous.commServerUrl,
                    displayName: trimmed,
                    instanceName: previous.instanceName,
                    glueApiBase: previous.glueApiBase
                )
                domains[name] = updated
                return (previous, updated, domains, original)
            }
            let domain = NSFileProviderDomain(identifier: NSFileProviderDomainIdentifier(rawValue: name), displayName: trimmed)
            addDomain(domain) { error in
                if let error {
                    do {
                        try self.withConfiguration { domains, _ in
                            guard domains[name] == change.1, let url = self.configFileURL else { throw Self.conflict() }
                            if domains == change.2, let original = change.3 {
                                try original.write(to: url, options: .atomic)
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
            let displayName = expected?.resolvedDisplayName(fallback: name) ?? name
            let domain = NSFileProviderDomain(identifier: NSFileProviderDomainIdentifier(rawValue: name), displayName: displayName)
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
        guard let config = try getDomainConfig(name: name) else { throw PrivateSocket.failure("Unknown domain.") }
        let domain = NSFileProviderDomain(identifier: NSFileProviderDomainIdentifier(name), displayName: config.resolvedDisplayName(fallback: name))
        guard let provider = NSFileProviderManager(for: domain) else {
            throw PrivateSocket.failure("The File Provider domain is unavailable.")
        }
        provider.signalEnumerator(for: .workingSet, completionHandler: completion)
    }

    private static func validateDisplayName(_ rawValue: String) throws -> String {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw PrivateSocket.failure("A domain name is required.")
        }
        guard !trimmed.contains("/"), !trimmed.contains(":") else {
            throw PrivateSocket.failure("Domain names cannot contain '/' or ':'.")
        }
        return trimmed
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
