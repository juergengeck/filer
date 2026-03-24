import Foundation
import FileProvider

class DomainManager {

    struct DomainConfig: Codable {
        let path: String
        let email: String?
        let secret: String?
        let name: String?
    }

    private let containerURL: URL?
    private let configFileURL: URL?

    init() {
        // Get App Group container
        containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.one.filer"
        )

        if let containerURL = containerURL {
            configFileURL = containerURL.appendingPathComponent("domains.json")
        } else {
            configFileURL = nil
            NSLog("⚠️ DomainManager: Failed to get App Group container URL")
        }
    }

    // MARK: - Domain Management

    func listDomains() -> [String: DomainConfig] {
        guard let configFileURL = configFileURL else {
            return [:]
        }

        guard FileManager.default.fileExists(atPath: configFileURL.path) else {
            return [:]
        }

        do {
            let data = try Data(contentsOf: configFileURL)
            return try JSONDecoder().decode([String: DomainConfig].self, from: data)
        } catch {
            NSLog("⚠️ DomainManager: Failed to read domains.json: \(error)")
            return [:]
        }
    }

    func registerDomain(name: String, path: String, email: String? = nil, secret: String? = nil, instanceName: String? = nil) throws {
        guard let configFileURL = configFileURL else {
            throw NSError(domain: "DomainManager", code: -1, userInfo: [
                NSLocalizedDescriptionKey: "Failed to access App Group container"
            ])
        }

        // Validate path exists
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            throw NSError(domain: "DomainManager", code: -2, userInfo: [
                NSLocalizedDescriptionKey: "Instance path does not exist or is not a directory: \(path)"
            ])
        }

        // Read existing domains
        var domains = listDomains()

        // Add or update domain
        domains[name] = DomainConfig(path: path, email: email, secret: secret, name: instanceName)

        // Write back to file
        let data = try JSONEncoder().encode(domains)
        try data.write(to: configFileURL, options: .atomic)

        // Register with File Provider
        let domain = NSFileProviderDomain(identifier: NSFileProviderDomainIdentifier(rawValue: name), displayName: name)

        NSFileProviderManager.add(domain) { error in
            if let error = error {
                NSLog("⚠️ DomainManager: Failed to add domain '\(name)': \(error)")
            } else {
                NSLog("✅ DomainManager: Domain '\(name)' registered successfully")
            }
        }
    }

    func unregisterDomain(name: String) throws {
        guard let configFileURL = configFileURL else {
            throw NSError(domain: "DomainManager", code: -1, userInfo: [
                NSLocalizedDescriptionKey: "Failed to access App Group container"
            ])
        }

        // Read existing domains
        var domains = listDomains()

        // Remove domain from config
        domains.removeValue(forKey: name)

        // Write back to file
        let data = try JSONEncoder().encode(domains)
        try data.write(to: configFileURL, options: .atomic)

        // Unregister from File Provider
        let domainIdentifier = NSFileProviderDomainIdentifier(rawValue: name)
        let domain = NSFileProviderDomain(identifier: domainIdentifier, displayName: name)

        NSFileProviderManager.remove(domain) { error in
            if let error = error {
                NSLog("⚠️ DomainManager: Failed to remove domain '\(name)': \(error)")
            } else {
                NSLog("✅ DomainManager: Domain '\(name)' unregistered successfully")
            }
        }
    }

    func getDomainConfig(name: String) -> DomainConfig? {
        return listDomains()[name]
    }
}
