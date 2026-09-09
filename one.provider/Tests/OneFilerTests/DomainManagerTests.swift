import XCTest
@testable import OneFilerHostSupport

final class DomainManagerTests: XCTestCase {
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
}
