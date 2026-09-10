import XCTest
import FileProvider
@testable import OneFilerExtension

private final class ChangeObserver: NSObject, NSFileProviderChangeObserver {
    let finished: XCTestExpectation
    var updated: [NSFileProviderItem] = []
    var deleted: [NSFileProviderItemIdentifier] = []
    var anchor: NSFileProviderSyncAnchor?
    var moreComing = false
    var error: Error?
    init(_ finished: XCTestExpectation) { self.finished = finished }
    func didUpdate(_ updatedItems: [NSFileProviderItem]) { updated += updatedItems }
    func didDeleteItems(withIdentifiers deletedItemIdentifiers: [NSFileProviderItemIdentifier]) { deleted += deletedItemIdentifiers }
    func finishEnumeratingChanges(upTo anchor: NSFileProviderSyncAnchor, moreComing: Bool) {
        self.anchor = anchor; self.moreComing = moreComing; finished.fulfill()
    }
    func finishEnumeratingWithError(_ error: Error) { self.error = error; finished.fulfill() }
}
private final class ItemObserver: NSObject, NSFileProviderEnumerationObserver {
    let finished: XCTestExpectation
    var items: [NSFileProviderItem] = []
    var page: NSFileProviderPage?
    var error: Error?
    init(_ finished: XCTestExpectation) { self.finished = finished }
    func didEnumerate(_ updatedItems: [NSFileProviderItem]) { items += updatedItems }
    func finishEnumerating(upTo nextPage: NSFileProviderPage?) { page = nextPage; finished.fulfill() }
    func finishEnumeratingWithError(_ error: Error) { self.error = error; finished.fulfill() }
}

final class FileProviderChangesTests: XCTestCase {
    private let itemID = "filer:" + String(repeating: "a", count: 64)
    private let parentID = "filer:" + String(repeating: "b", count: 64)
    private var item: [String: Any] {
        ["id": itemID, "parentId": parentID, "name": "model.safetensors", "path": "/models/revision/model.safetensors",
         "type": "file", "size": 7, "contentVersion": "bytes-v1", "metadataVersion": "metadata-v2", "downloadOnDemand": true]
    }

    private func bridge(_ response: @escaping (String, [String: Any]) throws -> [String: Any]) throws -> ONEBridge {
        try ONEBridge(config: ONEInstanceConfig(name: "Fixture"), invoke: { bytes in
            let request = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
            let operation = try XCTUnwrap(request["operation"] as? String)
            let params = try XCTUnwrap(request["request"] as? [String: Any])
            return try JSONSerialization.data(withJSONObject: ["requestId": request["requestId"]!, "success": true,
                "result": ["jsonrpc": "2.0", "id": NSNull(), "result": response(operation, params)]])
        }, close: {})
    }

    func testEnumeratorsPreserveItemVersionsPagesAndChangeAnchors() async throws {
        let row = item
        let client = try bridge { operation, params in
            switch operation {
            case "filer:enumerateItems":
                XCTAssertEqual(params["container"] as? String, self.parentID)
                XCTAssertNil(params["page"])
                return ["items": [row], "nextPage": "page-after-first"]
            case "filer:getChanges":
                XCTAssertEqual(params["container"] as? String, self.parentID)
                XCTAssertEqual(params["since"] as? String, "anchor-before")
                return ["updated": [row], "deleted": ["filer:" + String(repeating: "c", count: 64)],
                        "newAnchor": "anchor-after", "moreComing": true]
            case "filer:getCurrentAnchor": return ["anchor": "current-anchor"]
            default: throw ONEBridgeError.invalidResponse
            }
        }
        let enumerator = FilerEnumerator(container: parentID, bridge: { client })
        defer { enumerator.invalidate() }
        let listed = expectation(description: "listed")
        let items = ItemObserver(listed)
        enumerator.enumerateItems(for: items, startingAt: NSFileProviderPage(NSFileProviderPage.initialPageSortedByName as Data))
        await fulfillment(of: [listed], timeout: 3)
        XCTAssertNil(items.error)
        XCTAssertEqual(items.page?.rawValue, Data("page-after-first".utf8))
        let native = try XCTUnwrap(items.items.first)
        XCTAssertEqual(native.itemIdentifier.rawValue, itemID)
        XCTAssertEqual(native.parentItemIdentifier.rawValue, parentID)
        XCTAssertEqual(native.itemVersion?.contentVersion, Data("bytes-v1".utf8))
        XCTAssertEqual(native.itemVersion?.metadataVersion, Data("metadata-v2".utf8))
        XCTAssertNil(native.contentModificationDate ?? nil)
        let changed = expectation(description: "changed")
        let observer = ChangeObserver(changed)
        enumerator.enumerateChanges(for: observer, from: NSFileProviderSyncAnchor(Data("anchor-before".utf8)))
        await fulfillment(of: [changed], timeout: 3)
        XCTAssertNil(observer.error)
        XCTAssertEqual(observer.updated.first?.itemIdentifier.rawValue, itemID)
        XCTAssertEqual(observer.deleted.count, 1)
        XCTAssertEqual(observer.anchor?.rawValue, Data("anchor-after".utf8))
        XCTAssertTrue(observer.moreComing)
        let anchored = expectation(description: "anchored")
        enumerator.currentSyncAnchor { anchor in
            XCTAssertEqual(anchor?.rawValue, Data("current-anchor".utf8)); anchored.fulfill()
        }
        await fulfillment(of: [anchored], timeout: 3)
    }

    func testMalformedChangesCannotAdvanceTheAnchor() async throws {
        for payload: [String: Any] in [
            ["updated": [["id": itemID]], "deleted": [], "newAnchor": "bad", "moreComing": false],
            ["updated": [], "deleted": [], "moreComing": false]
        ] {
            let client = try bridge { _, _ in payload }
            do { _ = try await client.getChanges(container: "workingSet", since: Data("known".utf8)); XCTFail("Accepted malformed feed") }
            catch { XCTAssertTrue(error is ONEBridgeError) }
        }
        let error = DomainWriteError.fromRPC(code: -32020, message: "expired")
        XCTAssertEqual(error.domain, NSFileProviderErrorDomain)
        XCTAssertEqual(error.code, NSFileProviderError.Code.syncAnchorExpired.rawValue)
    }

    func testHydrationUsesTheRequestedPersistentContentVersion() async throws {
        let row = item
        let client = try bridge { operation, params in
            if operation == "filer:getItem" { return row }
            XCTAssertEqual(operation, "filer:readItemContent")
            XCTAssertEqual(params["id"] as? String, self.itemID)
            XCTAssertEqual(params["version"] as? String, "bytes-v1")
            return ["content": Data("weights".utf8).base64EncodedString()]
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        try await client.copyContent(id: itemID, to: url, size: 7, progress: Progress(totalUnitCount: 7), version: "bytes-v1")
        XCTAssertEqual(try Data(contentsOf: url), Data("weights".utf8))
        do {
            try await client.copyContent(id: itemID, to: url, size: 7, progress: Progress(totalUnitCount: 7), version: "old")
            XCTFail("Hydrated a different version")
        } catch {
            XCTAssertEqual((error as NSError).code, NSFileProviderError.Code.versionNoLongerAvailable.rawValue)
        }
    }
}
