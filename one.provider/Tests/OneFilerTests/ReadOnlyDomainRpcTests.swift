import XCTest
import CryptoKit
@testable import OneFilerExtension

final class ReadOnlyDomainRpcTests: XCTestCase {
    func testPublishedDocumentFromOwningRuntime() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let endpointValue = environment["ONE_FILER_DOMAIN_TEST_ENDPOINT"],
              let endpoint = URL(string: endpointValue),
              let token = environment["ONE_FILER_DOMAIN_TEST_TOKEN"],
              let path = environment["ONE_FILER_DOMAIN_TEST_PATH"],
              let expectedHash = environment["ONE_FILER_DOMAIN_TEST_SHA256"] else {
            throw XCTSkip("Set ONE_FILER_DOMAIN_TEST_ENDPOINT, TOKEN, PATH and SHA256 for domain integration")
        }
        let bridge = try ONEBridge(config: ONEInstanceConfig(name: "Domain integration"), invoke: httpFixtureTransport(endpoint: endpoint, token: token))
        try await bridge.connect()
        let parent = (path as NSString).deletingLastPathComponent
        let children = try await bridge.getChildren(parentId: parent)
        XCTAssertTrue(children.contains { $0.name == (path as NSString).lastPathComponent })
        let object = try await bridge.getObject(id: path)
        XCTAssertTrue(object.permissions.contains(.read))
        XCTAssertFalse(object.permissions.contains(.write))
        XCTAssertEqual(object.contentHash, expectedHash)
        let bytes = try await bridge.readContent(id: path)
        XCTAssertEqual(bytes.count, object.size)
        let hash = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        XCTAssertEqual(hash, expectedHash)
        await bridge.disconnect()
    }
}
