import XCTest
@testable import OneFilerExtension

final class FotosBridgeTests: XCTestCase {
    private func bridge() throws -> ONEBridge {
        let env = ProcessInfo.processInfo.environment
        guard let endpoint = env["FOTOS_TEST_ENDPOINT"], let url = URL(string: endpoint),
              let token = env["FOTOS_TEST_TOKEN"] else {
            throw XCTSkip("Run pnpm test:fotos for the Fotos runtime integration")
        }
        return try ONEBridge(config: ONEInstanceConfig(name: "Fotos Integration"), invoke: httpFixtureTransport(endpoint: url, token: token))
    }

    func testBrowseOriginal() async throws {
        let bridge = try bridge()
        try await bridge.connect()
        let root = try await bridge.getChildren(parentId: "/")
        XCTAssertTrue(root.contains { $0.id == "fotos" && $0.type == .folder && $0.parentId == nil })
        let entries = try await bridge.getChildren(parentId: "fotos")
        let original = try XCTUnwrap(entries.first { $0.name == "rose-detail.png" })
        XCTAssertEqual(original.parentId, "fotos")
        XCTAssertEqual(original.id, "fotos/rose-detail.png")
        let expected = try Data(contentsOf: URL(fileURLWithPath: XCTUnwrap(ProcessInfo.processInfo.environment["FOTOS_TEST_ORIGINAL"])))
        let content = try await bridge.readContent(id: original.id)
        XCTAssertEqual(content, expected)
        XCTAssertEqual(original.size, expected.count)
        let again = try await bridge.getObject(id: original.id)
        XCTAssertFalse(original.contentHash.isEmpty)
        XCTAssertEqual(FileProviderItem(oneObject: original).itemVersion, FileProviderItem(oneObject: again).itemVersion)
        await bridge.disconnect()
    }

    func testImportOriginal() async throws {
        let bridge = try bridge()
        try await bridge.connect()
        let content = try Data(contentsOf: URL(fileURLWithPath: XCTUnwrap(ProcessInfo.processInfo.environment["FOTOS_TEST_IMPORT"])))
        let created = try await bridge.createItem(parentId: "fotos", name: "imported.jpg", data: content, isDirectory: false)
        XCTAssertEqual(created.id, "fotos/imported.jpg")
        XCTAssertEqual(created.parentId, "fotos")
        let readBack = try await bridge.readContent(id: created.id)
        XCTAssertEqual(readBack, content)
        let repeated = try await bridge.createItem(parentId: "fotos", name: "imported.jpg", data: content, isDirectory: false)
        XCTAssertEqual(created.metadataHash, repeated.metadataHash)
        await bridge.disconnect()
    }
}
