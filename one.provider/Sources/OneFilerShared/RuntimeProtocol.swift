import Foundation

/// Both sides require the intended bundle identity and the configured signing team.
public enum RuntimeSecurity {
    public static let group = "group.one.filer"
    public static let socketName = "runtime.sock"
    public static let hostRequirement = requirement(for: "one.filer")
    public static let clientRequirement = requirement(for: "one.filer.extension")

    private static func requirement(for identifier: String) -> String {
        "anchor apple generic and identifier \"\(identifier)\" and certificate leaf[subject.OU] = \"26W8AC52QS\""
    }

    public static func container() throws -> URL {
        guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
            throw NSError(domain: "one.filer.runtime", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "The Filer app-group container is unavailable."])
        }
        return url
    }
}

/// Domain identifiers are UUIDs; paths and credentials never arrive from an IPC caller.
public struct LocalDomainConfiguration: Codable {
    public let storageId: UUID
    public let email: String
    public init(storageId: UUID, email: String) { self.storageId = storageId; self.email = email }
}
