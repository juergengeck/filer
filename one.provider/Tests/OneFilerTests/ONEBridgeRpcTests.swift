import XCTest
@testable import OneFilerExtension
@testable import OneFilerHostSupport

final class ONEBridgeRpcTests: XCTestCase {
    /// Start canonical ONE through the same pipe owner used by the signed host.
    func testPrivateRefinioApiRoundTrip() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let node = environment["ONE_FILER_TEST_NODE"],
              let entry = environment["ONE_FILER_TEST_ENTRY"],
              let preload = environment["ONE_FILER_TEST_PRELOAD"] else {
            throw XCTSkip("Run npm run test:connection for the private runtime integration")
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let runtime = NodeRuntimeProcess(node: URL(fileURLWithPath: node), entry: URL(fileURLWithPath: entry),
                                         preload: URL(fileURLWithPath: preload))
        defer { runtime.stop() }
        try await runtime.start(configuration: ["directory": directory.path, "email": "private-test@filer.local",
            "secret": UUID().uuidString, "name": "Private integration", "commServerUrl": "ws://127.0.0.1:1",
            "inviteUrlPrefix": "https://refinio.one/invite"])
        let bridge = try ONEBridge(config: ONEInstanceConfig(name: "RPC Integration"),
                                   invoke: { try await runtime.invoke($0) }, close: { runtime.stop() })
        try await bridge.connect()
        let children = try await bridge.getChildren(parentId: "chats")
        XCTAssertFalse(children.isEmpty)
        let request: [String: Any] = ["operation": "introspection:listOperations", "request": [:],
            "authToken": "forged", "capabilities": ["*"], "requestId": "forbidden"]
        let denied = try await runtime.invoke(JSONSerialization.data(withJSONObject: request))
        let response = try XCTUnwrap(JSONSerialization.jsonObject(with: denied) as? [String: Any])
        XCTAssertEqual((response["error"] as? [String: Any])?["code"] as? String, "FORBIDDEN")
        let devices = try await runtime.invoke(JSONSerialization.data(withJSONObject: [
            "operation": "devices:listDevices", "request": [:], "requestId": "devices"]))
        XCTAssertEqual((try JSONSerialization.jsonObject(with: devices) as? [String: Any])?["success"] as? Bool, true)
        await bridge.disconnect()
        await runtime.shutdown()
        try FileManager.default.removeItem(at: directory)
    }
}
