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

    func testNestedProjectionRootUsesItsPathOwnedParent() async throws {
        var row = item
        row["parentId"] = "ONE/System"
        row["path"] = "/ONE/System/models"
        row["name"] = "models"
        row["type"] = "directory"
        let client = try bridge { _, _ in ["item": row] }
        let object = try await client.getObject(id: "/ONE/System/models")
        XCTAssertEqual(object.parentId, "ONE/System")
        XCTAssertEqual(FileProviderItem(oneObject: object).parentItemIdentifier.rawValue, "ONE/System")
    }

    func testImportDirectoryAllowsDropsWithoutAdvertisingMutationOfTheMount() async throws {
        let client = try bridge { _, _ in
            ["mode": 0o40555, "size": 0, "canAddChildren": true, "contentHash": "root-version"]
        }
        let object = try await client.getObject(id: "/Files")
        let native = FileProviderItem(oneObject: object)
        XCTAssertTrue(native.capabilities.contains(.allowsAddingSubItems))
        XCTAssertFalse(native.capabilities.contains(.allowsRenaming))
        XCTAssertFalse(native.capabilities.contains(.allowsDeleting))
    }

    func testStatCanDeleteCapabilityOverridesModePermissions() async throws {
        for (mode, canDelete, expected) in [(0o40555, true, true), (0o40755, false, false)] {
            let client = try bridge { operation, _ in
                XCTAssertEqual(operation, "filer:stat")
                return ["mode": mode, "size": 0, "canDelete": canDelete]
            }
            let object = try await client.getObject(id: "/objects/shared")
            XCTAssertEqual(object.permissions.contains(.delete), expected)
        }
    }

    func testCreateItemUsesCanonicalPathReturnedByWrite() async throws {
        let canonicalPath = "/objects/object-1/Shared with/Alice"
        let row: [String: Any] = [
            "id": "filer:" + String(repeating: "d", count: 64),
            "parentId": "objects/object-1/Shared with",
            "name": "Alice",
            "path": canonicalPath,
            "type": "directory",
            "size": 0,
            "contentVersion": "folder-v1",
            "metadataVersion": "folder-m1",
            "downloadOnDemand": false,
            "canDelete": true
        ]
        let client = try bridge { operation, params in
            switch operation {
            case "filer:writeFile":
                XCTAssertEqual(params["path"] as? String, "/objects/object-1/Shared with/index.html")
                return ["status": "ok", "path": canonicalPath]
            case "filer:stat":
                XCTAssertEqual(params["path"] as? String, canonicalPath)
                return ["item": row]
            default:
                throw ONEBridgeError.invalidResponse
            }
        }
        let object = try await client.createItem(parentId: "/objects/object-1/Shared with", name: "index.html",
                                                 data: Data("<html>".utf8), isDirectory: false)
        XCTAssertEqual(object.path, canonicalPath)
        XCTAssertEqual(object.name, "Alice")
        XCTAssertTrue(object.permissions.contains(.delete))
    }

    func testCreateItemRejectsCanonicalPathWithBackslash() async throws {
        let client = try bridge { operation, _ in
            XCTAssertEqual(operation, "filer:writeFile")
            return ["status": "ok", "path": "/objects/object-1/Shared\\with/Alice"]
        }
        do {
            _ = try await client.createItem(parentId: "/objects/object-1/Shared with", name: "index.html",
                                            data: Data("<html>".utf8), isDirectory: false)
            XCTFail("Accepted a canonical path containing a backslash")
        } catch { XCTAssertTrue(error is ONEBridgeError) }
    }

    func testReconcileDifferentContentDefersToOwnerValidation() async throws {
        let client = try bridge { operation, params in
            switch operation {
            case "filer:stat":
                XCTAssertEqual(params["path"] as? String, "/contact.html")
                return ["mode": 0o100444, "size": 3]
            case "filer:readFile":
                XCTAssertEqual(params["path"] as? String, "/contact.html")
                return ["content": Data("old".utf8).base64EncodedString()]
            default:
                throw ONEBridgeError.invalidResponse
            }
        }
        let reconciled = try await client.reconcileImportedItem(
            parentId: "/", name: "contact.html", data: Data("new".utf8), isDirectory: false)
        XCTAssertNil(reconciled)
    }

    func testDeleteFolderUsesRmdir() async throws {
        var operations: [String] = []
        let client = try bridge { operation, params in
            operations.append(operation)
            switch operation {
            case "filer:stat":
                return ["mode": 0o40755, "size": 0]
            case "filer:rmdir":
                XCTAssertEqual(params["path"] as? String, "/objects/object-1/Shared with/Alice")
                return ["result": true]
            default:
                throw ONEBridgeError.invalidResponse
            }
        }
        try await client.deleteObject(id: "/objects/object-1/Shared with/Alice")
        XCTAssertEqual(operations, ["filer:stat", "filer:rmdir"])
    }

    func testRootEnumerationLocalizesRuntimeMounts() async throws {
        var row = item
        row["id"] = "contacts"
        row["parentId"] = "root"
        row["path"] = "/contacts"
        row["name"] = "contacts"
        row["type"] = "directory"
        let client = try bridge { operation, params in
            if operation == "filer:readDir" {
                XCTAssertEqual(params["path"] as? String, "/")
                return ["children": ["contacts"]]
            }
            XCTAssertEqual(operation, "filer:stat")
            XCTAssertEqual(params["path"] as? String, "/contacts")
            return ["item": row]
        }
        let enumerator = FilerEnumerator(container: "root", bridge: { client })
        defer { enumerator.invalidate() }
        let listed = expectation(description: "root listed")
        let observer = ItemObserver(listed)
        enumerator.enumerateItems(for: observer, startingAt: NSFileProviderPage(NSFileProviderPage.initialPageSortedByName as Data))
        await fulfillment(of: [listed], timeout: 3)
        XCTAssertNil(observer.error)
        let contact = try XCTUnwrap(observer.items.first)
        let language = FilerFolderNames.language(for: Locale.preferredLanguages)
        XCTAssertEqual(contact.filename, FilerFolderNames.name(for: "/contacts", language: language))
        XCTAssertEqual(contact.itemIdentifier.rawValue, "contacts")
        XCTAssertEqual(contact.parentItemIdentifier, .rootContainer)
    }

    func testRootAnchorsInvalidateOldFolderLabelsAndRoundTrip() async throws {
        let client = try bridge { operation, params in
            if operation == "filer:getCurrentAnchor" { return ["anchor": "source-anchor"] }
            XCTAssertEqual(operation, "filer:getChanges")
            XCTAssertEqual(params["since"] as? String, "source-anchor")
            return ["updated": [], "deleted": [], "newAnchor": "source-next", "moreComing": false]
        }
        let enumerator = FilerEnumerator(container: "root", bridge: { client })
        defer { enumerator.invalidate() }
        for old in ["source-anchor", "filer-folders-v1:fr:source-anchor"] {
            let finished = expectation(description: "expired")
            let observer = ChangeObserver(finished)
            enumerator.enumerateChanges(for: observer, from: NSFileProviderSyncAnchor(Data(old.utf8)))
            await fulfillment(of: [finished], timeout: 3)
            XCTAssertEqual((observer.error as NSError?)?.code, NSFileProviderError.syncAnchorExpired.rawValue)
        }
        let anchored = expectation(description: "localized anchor")
        var current: NSFileProviderSyncAnchor?
        enumerator.currentSyncAnchor { anchor in current = anchor; anchored.fulfill() }
        await fulfillment(of: [anchored], timeout: 3)
        let language = FilerFolderNames.language(for: Locale.preferredLanguages)
        XCTAssertEqual(current?.rawValue, Data("filer-folders-v1:\(language):source-anchor".utf8))
        let finished = expectation(description: "round trip")
        let observer = ChangeObserver(finished)
        enumerator.enumerateChanges(for: observer, from: try XCTUnwrap(current))
        await fulfillment(of: [finished], timeout: 3)
        XCTAssertNil(observer.error)
        XCTAssertEqual(observer.anchor?.rawValue, Data("filer-folders-v1:\(language):source-next".utf8))
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

    func testPathContainersUseAbsoluteFilesystemAddressesForAnchorsAndChanges() async throws {
        let client = try bridge { operation, params in
            XCTAssertEqual(params["container"] as? String, "/Gesundheit/Patient")
            if operation == "filer:getCurrentAnchor" { return ["anchor": "health-version"] }
            XCTAssertEqual(operation, "filer:getChanges")
            XCTAssertEqual(params["since"] as? String, "health-version")
            return ["updated": [], "deleted": [], "newAnchor": "health-version", "moreComing": false]
        }
        let anchor = try await client.getCurrentAnchor(container: "Gesundheit/Patient")
        let changes = try await client.getChanges(container: "Gesundheit/Patient", since: anchor)
        XCTAssertEqual(changes.newAnchor, anchor)
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
