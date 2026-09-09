import Foundation
import FileProvider
#if SWIFT_PACKAGE
import OneFilerShared
#endif

class DomainManager {
    typealias DomainOperation = (NSFileProviderDomain, @escaping (Error?) -> Void) -> Void

    typealias DomainConfig = LocalDomainConfiguration

    private let containerURL: URL?
    private let configFileURL: URL?
    private let addDomain: DomainOperation
    private let removeDomain: DomainOperation

    init(configFileURL: URL? = nil,
         addDomain: @escaping DomainOperation = { NSFileProviderManager.add($0, completionHandler: $1) },
         removeDomain: @escaping DomainOperation = { NSFileProviderManager.remove($0, completionHandler: $1) }) {
        self.addDomain = addDomain
        self.removeDomain = removeDomain
        if let configFileURL {
            self.containerURL = configFileURL.deletingLastPathComponent()
            self.configFileURL = configFileURL
            return
        }
        // Get App Group container
        containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.one.filer"
        )

        if let containerURL = containerURL {
            self.configFileURL = containerURL.appendingPathComponent("domains.json")
        } else {
            self.configFileURL = nil
            NSLog("⚠️ DomainManager: Failed to get App Group container URL")
        }
    }

    // MARK: - Domain Management

    func listDomains() throws -> [String: DomainConfig] {
        guard let configFileURL = configFileURL else {
            throw NSError(domain: "DomainManager", code: -1, userInfo: [
                NSLocalizedDescriptionKey: "Failed to access App Group container"
            ])
        }

        guard FileManager.default.fileExists(atPath: configFileURL.path) else {
            return [:]
        }

        let data = try Data(contentsOf: configFileURL)
        return try JSONDecoder().decode([String: DomainConfig].self, from: data)
    }

    func registerDomain(name: String, completion: @escaping (Error?) -> Void = { _ in }) throws {
        guard let configFileURL = configFileURL else {
            throw NSError(domain: "DomainManager", code: -1, userInfo: [
                NSLocalizedDescriptionKey: "Failed to access App Group container"
            ])
        }

        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw NSError(domain: "one.filer.domain", code: 1, userInfo: [NSLocalizedDescriptionKey: "A domain name is required."])
        }

        // Read existing domains
        var domains = try listDomains()
        let previousData = FileManager.default.fileExists(atPath: configFileURL.path)
            ? try Data(contentsOf: configFileURL) : nil

        // Add or update domain
        if domains[name] == nil {
            let identifier = UUID()
            domains[name] = DomainConfig(storageId: identifier, email: "\(identifier.uuidString.lowercased())@filer.local")
        }

        // Write back to file
        let data = try JSONEncoder().encode(domains)
        try data.write(to: configFileURL, options: .atomic)

        // Register with File Provider
        let domain = NSFileProviderDomain(identifier: NSFileProviderDomainIdentifier(rawValue: name), displayName: name)

        addDomain(domain) { error in
            if let error = error {
                do {
                    guard try Data(contentsOf: configFileURL) == data else {
                        throw NSError(domain: "DomainManager", code: -3, userInfo: [
                            NSLocalizedDescriptionKey: "Domain configuration changed during registration"
                        ])
                    }
                    if let previousData {
                        try previousData.write(to: configFileURL, options: .atomic)
                    } else {
                        try FileManager.default.removeItem(at: configFileURL)
                    }
                } catch {
                    completion(error)
                    return
                }
                NSLog("⚠️ DomainManager: Failed to add domain '\(name)': \(error)")
            } else {
                NSLog("✅ DomainManager: Domain '\(name)' registered successfully")
            }
            completion(error)
        }
    }

    func unregisterDomain(name: String, completion: @escaping (Error?) -> Void = { _ in }) throws {
        guard let configFileURL = configFileURL else {
            throw NSError(domain: "DomainManager", code: -1, userInfo: [
                NSLocalizedDescriptionKey: "Failed to access App Group container"
            ])
        }

        // Read existing domains
        var domains = try listDomains()

        // Remove domain from config
        domains.removeValue(forKey: name)

        // Write back to file
        let data = try JSONEncoder().encode(domains)

        // Unregister from File Provider
        let domainIdentifier = NSFileProviderDomainIdentifier(rawValue: name)
        let domain = NSFileProviderDomain(identifier: domainIdentifier, displayName: name)

        removeDomain(domain) { error in
            if let error = error {
                NSLog("⚠️ DomainManager: Failed to remove domain '\(name)': \(error)")
            } else {
                do {
                    try data.write(to: configFileURL, options: .atomic)
                } catch {
                    completion(error)
                    return
                }
                NSLog("✅ DomainManager: Domain '\(name)' unregistered successfully")
            }
            completion(error)
        }
    }

    func getDomainConfig(name: String) throws -> DomainConfig? {
        return try listDomains()[name]
    }
}
