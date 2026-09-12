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

}
