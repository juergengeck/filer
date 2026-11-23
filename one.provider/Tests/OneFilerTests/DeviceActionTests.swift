import XCTest
import FileProvider
import OneFilerCore
@testable import OneFilerExtension

/// Finder device actions: activation rules, badge declarations, and the
/// bridge dispatch that backs them.
final class DeviceActionTests: XCTestCase {

    private let mountAction = FilerDeviceAction.mount.rawValue
    private let unmountAction = FilerDeviceAction.unmount.rawValue

    // MARK: - ExtensionInfo.plist declarations

    private var extensionPlist: [String: Any] {
        get throws {
            let here = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            let plist = here
                .deletingLastPathComponent().deletingLastPathComponent()
                .appendingPathComponent("Resources/ExtensionInfo.plist")
            let data = try Data(contentsOf: plist)
            return try XCTUnwrap(PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])
        }
    }

    func testPlistDeclaresDeviceActionsWithActivationRules() throws {
        let dict = try XCTUnwrap((try extensionPlist)["NSExtension"] as? [String: Any])
        let actions = try XCTUnwrap(dict["NSExtensionFileProviderActions"] as? [[String: Any]])
        var byId: [String: [String: Any]] = [:]
        for action in actions {
            byId[try XCTUnwrap(action["NSExtensionFileProviderActionIdentifier"] as? String)] = action
        }
        XCTAssertEqual(Set(byId.keys), [mountAction, unmountAction])
        let mountRule = try XCTUnwrap(byId[mountAction]?["NSExtensionFileProviderActionActivationRule"] as? String)
        XCTAssertTrue(mountRule.contains("userInfo.mountState == 'available'"))
        let unmountRule = try XCTUnwrap(byId[unmountAction]?["NSExtensionFileProviderActionActivationRule"] as? String)
        XCTAssertTrue(unmountRule.contains("userInfo.mountState == 'mounted'"))
        XCTAssertTrue(unmountRule.contains("userInfo.mountState == 'mounting'"))
    }

    func testPlistDeclaresDeviceDecorations() throws {
        let dict = try XCTUnwrap((try extensionPlist)["NSExtension"] as? [String: Any])
        let decorations = try XCTUnwrap(dict["NSFileProviderDecorations"] as? [[String: Any]])
        XCTAssertEqual(
            Set(decorations.compactMap { $0["Identifier"] as? String }),
            Set(FilerDeviceDecoration.allCases.map(\.rawValue))
        )
    }

    // MARK: - Bridge presentation decoding

    private func itemRow(id: String = "filer:" + String(repeating: "a", count: 64),
                         extra: [String: Any] = [:]) -> [String: Any] {
        var row: [String: Any] = [
            "id": id, "parentId": "root", "name": "Peer", "path": "/ONE/devices/Peer",
            "type": "directory", "size": 0, "contentVersion": "v1", "metadataVersion": "m1",
            "downloadOnDemand": false,
        ]
        for (key, value) in extra { row[key] = value }
        return row
    }

    private func bridge(recording: Recording? = nil,
                        item: @escaping (String) -> [String: Any] = { _ in [:] },
                        stat: ((String) -> [String: Any])? = nil) throws -> ONEBridge {
        try ONEBridge(config: ONEInstanceConfig(name: "Device actions"), invoke: { bytes in
            let request = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
            let operation = try XCTUnwrap(request["operation"] as? String)
            let params = try XCTUnwrap(request["request"] as? [String: Any])
            if operation == "filer:getItem", let id = params["id"] as? String {
                recording?.requests.append((operation, params))
                let row = item(id)
                return try JSONSerialization.data(withJSONObject: ["requestId": request["requestId"]!,
                    "success": true, "result": ["jsonrpc": "2.0", "id": NSNull(), "result": row]])
            }
            if operation == "filer:stat", let path = params["path"] as? String, let stat {
                recording?.requests.append((operation, params))
                return try JSONSerialization.data(withJSONObject: ["requestId": request["requestId"]!,
                    "success": true, "result": ["jsonrpc": "2.0", "id": NSNull(), "result": stat(path)]])
            }
            if operation == "filer:performAction" {
                recording?.requests.append((operation, params))
                return try JSONSerialization.data(withJSONObject: ["requestId": request["requestId"]!,
                    "success": true, "result": ["jsonrpc": "2.0", "id": NSNull(), "result": ["status": "ok"]]])
            }
            throw ONEBridgeError.invalidResponse
        }, close: {})
    }

    func testDecodeItemReadsUserInfoAndDecorations() async throws {
        let client = try bridge(item: { _ in self.itemRow(extra: [
            "userInfo": ["deviceKey": "instance:peer-1", "mountState": "available"],
            "decorations": ["one.filer.decoration.device.available"],
        ]) })
        let object = try await client.getItem(id: "filer:" + String(repeating: "a", count: 64))
        XCTAssertEqual(object.userInfo, ["deviceKey": "instance:peer-1", "mountState": "available"])
        XCTAssertEqual(object.decorationIdentifiers, ["one.filer.decoration.device.available"])
        XCTAssertEqual(
            FileProviderItem(oneObject: object).userInfo?["mountState"] as? String,
            "available"
        )
    }

    func testStatPathDecodesPresentation() async throws {
        let client = try bridge(stat: { path in
            XCTAssertEqual(path, "/ONE/devices/Peer")
            return [
                "mode": 0o40555, "size": 0,
                "contentHash": "folder-v1", "metadataHash": "folder-m1",
                "userInfo": ["deviceKey": "instance:peer-1", "mountState": "available"],
                "decorations": ["one.filer.decoration.device.available"],
            ]
        })
        let object = try await client.getObject(id: "ONE/devices/Peer")
        XCTAssertEqual(object.userInfo, ["deviceKey": "instance:peer-1", "mountState": "available"])
        XCTAssertEqual(object.decorationIdentifiers, ["one.filer.decoration.device.available"])
        let native = FileProviderItem(oneObject: object)
        XCTAssertEqual(native.userInfo?["mountState"] as? String, "available")
        #if os(macOS)
        XCTAssertEqual(native.decorations?.map(\.rawValue), ["one.filer.decoration.device.available"])
        #endif
    }

    func testDecodeItemRejectsMalformedPresentation() async throws {
        for extra in [
            ["userInfo": ["mountState": 42]],
            ["decorations": "one.filer.decoration.device.available"],
        ] as [[String: Any]] {
            let client = try bridge(item: { _ in self.itemRow(extra: extra) })
            do {
                _ = try await client.getItem(id: "filer:" + String(repeating: "b", count: 64))
                XCTFail("Malformed presentation must throw")
            } catch {
                XCTAssertNotNil(error as? ONEBridgeError ?? error as NSError?)
            }
        }
    }

    func testPerformActionDispatchesResolvedPathsInOrder() async throws {
        let recording = Recording()
        let client = try bridge(recording: recording, item: { id in self.itemRow(id: id) })
        let ids = ["filer:" + String(repeating: "a", count: 64), "filer:" + String(repeating: "b", count: 64)]
        try await client.performAction(identifier: mountAction, itemIdentifiers: ids)
        XCTAssertEqual(recording.operations, ["filer:getItem", "filer:performAction", "filer:getItem", "filer:performAction"])
        let actions = recording.requests.filter { $0.operation == "filer:performAction" }
        XCTAssertEqual(actions.count, 2)
        for request in actions {
            XCTAssertEqual(request.params["actionId"] as? String, mountAction)
            XCTAssertEqual(request.params["id"] as? String, "/ONE/devices/Peer")
        }
    }

    func testPerformActionPassesThroughLegacyPaths() async throws {
        let recording = Recording()
        let client = try bridge(recording: recording, item: { id in self.itemRow(id: id) })
        try await client.performAction(identifier: unmountAction, itemIdentifiers: ["ONE/devices/Peer"])
        XCTAssertEqual(recording.operations, ["filer:performAction"])
        XCTAssertEqual(recording.requests.first?.params["id"] as? String, "/ONE/devices/Peer")
    }

    func testPerformActionRejectsEmptyInput() async throws {
        let client = try bridge(item: { id in self.itemRow(id: id) })
        do {
            try await client.performAction(identifier: "", itemIdentifiers: ["x"])
            XCTFail("Empty identifier must throw")
        } catch { }
        do {
            try await client.performAction(identifier: mountAction, itemIdentifiers: [])
            XCTFail("Empty item list must throw")
        } catch { }
    }
}

private final class Recording: @unchecked Sendable {
    var requests: [(operation: String, params: [String: Any])] = []
    var operations: [String] { requests.map(\.operation) }
}
