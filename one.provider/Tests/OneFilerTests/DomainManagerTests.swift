import XCTest
@testable import OneFilerHostSupport

final class DomainManagerTests: XCTestCase {
    func testExplicitRelayIsPersistedAndCannotRetargetAnExistingDomain() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let manager = DomainManager(configFileURL: directory.appendingPathComponent("domains.json"),
            addDomain: { _, completion in completion(nil) })
        try manager.registerDomain(name: "QA", commServerUrl: "ws://127.0.0.1:19100")
        XCTAssertEqual(try manager.getDomainConfig(name: "QA")?.commServerUrl, "ws://127.0.0.1:19100")
        XCTAssertThrowsError(try manager.registerDomain(name: "QA", commServerUrl: "ws://127.0.0.1:19102"))
        XCTAssertThrowsError(try manager.registerDomain(name: "bad", commServerUrl: "https://example.test"))
        XCTAssertThrowsError(try manager.registerDomain(name: "bad", commServerUrl: "ws://user:secret@example.test"))
        XCTAssertNil(try manager.getDomainConfig(name: "bad"))
    }

    /// Enrollment selects the email before storage creation and cannot rebind a live domain.
    func testExplicitIdentityIsPreservedAndCannotBeReplaced() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let manager = DomainManager(configFileURL: directory.appendingPathComponent("domains.json"), addDomain: { _, done in done(nil) })
        try manager.registerDomain(name: "Cube", email: "demo@demo.de")
        let original = try manager.getDomainConfig(name: "Cube")
        XCTAssertEqual(original?.email, "demo@demo.de")
        try manager.registerDomain(name: "Cube")
        XCTAssertEqual(try manager.getDomainConfig(name: "Cube"), original)
        XCTAssertThrowsError(try manager.registerDomain(name: "Cube", email: "someone-else@example.test"))
        XCTAssertEqual(try manager.getDomainConfig(name: "Cube"), original)
    }

    func testRejectedRegistrationRestoresPreviousConfiguration() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("domains.json")
        let original = Data(#"{"existing":{"storageId":"A72A2B8B-CCB3-4B7A-83DB-17A467520414","email":"test@filer.local"}}"#.utf8)
        try original.write(to: url)
        let rejected = NSError(domain: "RegistrationTest", code: -2003)
        let manager = DomainManager(configFileURL: url, addDomain: { _, completion in completion(rejected) })
        var received: Error?
        try manager.registerDomain(name: "new") { received = $0 }
        XCTAssertEqual((received as NSError?)?.code, -2003)
        XCTAssertEqual(try Data(contentsOf: url), original)
    }

    func testLegacyConfigurationCannotBeOverwrittenByRegistration() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("domains.json")
        let original = Data(#"{"existing":{"path":"/existing/instance"}}"#.utf8)
        try original.write(to: url)
        let manager = DomainManager(configFileURL: url)
        XCTAssertThrowsError(try manager.registerDomain(name: "new"))
        XCTAssertEqual(try Data(contentsOf: url), original)
        XCTAssertThrowsError(try manager.unregisterDomain(name: "existing"))
        XCTAssertEqual(try Data(contentsOf: url), original)
    }
    func testDelayedRemovalPreservesAnotherRegistration() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("domains.json")
        var remove: ((Error?) -> Void)?
        let manager = DomainManager(configFileURL: url, addDomain: { _, done in done(nil) }, removeDomain: { _, done in remove = done })
        try manager.registerDomain(name: "old")
        try manager.unregisterDomain(name: "old")
        try manager.registerDomain(name: "new")
        remove?(nil)
        XCTAssertEqual(Set(try manager.listDomains().keys), ["new"])
    }

    func testRejectedRegistrationPreservesConcurrentDomainAndReleasesLock() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("domains.json")
        var add: ((Error?) -> Void)?
        let pending = DomainManager(configFileURL: url, addDomain: { _, done in add = done })
        let immediate = DomainManager(configFileURL: url, addDomain: { _, done in done(nil) })
        try pending.registerDomain(name: "pending")
        XCTAssertThrowsError(try immediate.unregisterDomain(name: "pending"))
        try immediate.registerDomain(name: "other")
        add?(NSError(domain: "Test", code: 1))
        XCTAssertEqual(Set(try immediate.listDomains().keys), ["other"])
        try immediate.registerDomain(name: "pending")
        XCTAssertEqual(Set(try immediate.listDomains().keys), ["other", "pending"])
    }

    func testRenameUpdatesDisplayNameInPlaceAndRollsBackOnFailure() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("domains.json")

        var addedDomains: [(String, String)] = []
        let manager = DomainManager(configFileURL: url, addDomain: { domain, done in
            addedDomains.append((domain.identifier.rawValue, domain.displayName))
            done(nil)
        })
        try manager.registerDomain(name: "work", displayName: "gecko", email: "gecko@refinio.net")
        let initialStorageId = try manager.getDomainConfig(name: "work")?.storageId
        XCTAssertEqual(try manager.getDomainConfig(name: "work")?.resolvedDisplayName(fallback: "work"), "gecko")

        try manager.renameDomain(name: "work", displayName: "Juergen")
        XCTAssertEqual(try manager.getDomainConfig(name: "work")?.storageId, initialStorageId)
        XCTAssertEqual(try manager.getDomainConfig(name: "work")?.resolvedDisplayName(fallback: "work"), "Juergen")
        XCTAssertEqual(addedDomains.last?.0, "work")
        XCTAssertEqual(addedDomains.last?.1, "Juergen")

        XCTAssertThrowsError(try manager.renameDomain(name: "work", displayName: "bad/name"))

        let failing = DomainManager(configFileURL: url, addDomain: { _, done in
            done(NSError(domain: "RenameTest", code: -1))
        })
        try failing.renameDomain(name: "work", displayName: "RolledBack")
        XCTAssertEqual(try failing.getDomainConfig(name: "work")?.resolvedDisplayName(fallback: "work"), "Juergen")
    }

    func testGlueConfigurationIsPersistedValidatedImmutableAndPreservedOnRename() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("domains.json")
        let storageId = UUID()
        let manager = DomainManager(configFileURL: url, addDomain: { _, done in done(nil) })

        try manager.registerDomain(
            name: "gecko",
            displayName: "gecko",
            email: "gecko@glue.one",
            commServerUrl: "wss://api.glue.one/comm",
            storageId: storageId,
            instanceName: "filer-deadbeef",
            glueApiBase: "https://api.glue.one/"
        )

        let stored = try XCTUnwrap(try manager.getDomainConfig(name: "gecko"))
        XCTAssertEqual(stored.storageId, storageId)
        XCTAssertEqual(stored.instanceName, "filer-deadbeef")
        XCTAssertEqual(stored.resolvedInstanceName(fallback: "gecko"), "filer-deadbeef")
        XCTAssertEqual(stored.glueApiBase, "https://api.glue.one")

        // Immutability checks on existing Glue domain
        XCTAssertThrowsError(try manager.registerDomain(name: "gecko", instanceName: "filer-other"))
        XCTAssertThrowsError(try manager.registerDomain(name: "gecko", glueApiBase: "https://other.glue.one"))
        XCTAssertThrowsError(try manager.registerDomain(name: "gecko", storageId: UUID()))

        // Validation checks on malformed glueApiBase / instanceName
        XCTAssertThrowsError(try manager.registerDomain(name: "bad", glueApiBase: "http://api.glue.one"))
        XCTAssertThrowsError(try manager.registerDomain(name: "bad", glueApiBase: "https://user:pass@api.glue.one"))
        XCTAssertThrowsError(try manager.registerDomain(name: "bad", instanceName: "   "))
        XCTAssertNil(try manager.getDomainConfig(name: "bad"))

        // Rename preserves canonical instanceName and glueApiBase
        try manager.renameDomain(name: "gecko", displayName: "gecko mac")
        let renamed = try XCTUnwrap(try manager.getDomainConfig(name: "gecko"))
        XCTAssertEqual(renamed.resolvedDisplayName(fallback: "gecko"), "gecko mac")
        XCTAssertEqual(renamed.instanceName, "filer-deadbeef")
        XCTAssertEqual(renamed.glueApiBase, "https://api.glue.one")
        XCTAssertEqual(renamed.storageId, storageId)
    }

}
