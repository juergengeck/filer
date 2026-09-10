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
        var domains = ["RPC Integration": DomainManager.DomainConfig(storageId: UUID(), email: "private-test@filer.local")]
        let pool = RuntimePool(configuration: { domains }, factory: { _, config in
            try await runtime.start(configuration: ["directory": directory.path, "email": config.email,
                "secret": UUID().uuidString, "name": "Private integration", "commServerUrl": "ws://127.0.0.1:1",
                "inviteUrlPrefix": "https://refinio.one/invite"])
            return runtime
        })
        let bridge = try ONEBridge(config: ONEInstanceConfig(name: "RPC Integration"),
            invoke: { try await pool.perform(domain: "RPC Integration", request: $0) }, close: {})
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
        domains.removeAll()
        try await pool.reconcile()
        XCTAssertFalse(runtime.isRunning)
        await pool.stop()
        try FileManager.default.removeItem(at: directory)
    }
    /// Typed asynchronous notifications must not consume replies or accept arbitrary identifiers.
    func testChangeNotificationsShareTheOwnedPipe() async throws {
        guard let node = ProcessInfo.processInfo.environment["ONE_FILER_TEST_NODE"] else {
            throw XCTSkip("Run npm run test:connection for the owned process notification test")
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let entry = directory.appendingPathComponent("fixture.mjs")
        let preload = directory.appendingPathComponent("preload.cjs")
        try Data().write(to: preload)
        try Data("""
        import {createInterface} from 'node:readline';
        let ready = false;
        createInterface({input: process.stdin}).on('line', line => {
          if (!ready) { ready = true; console.log(JSON.stringify({ready: true, owner: 'a'.repeat(64), instance: 'b'.repeat(64)})); return; }
          const request = JSON.parse(line);
          console.log(JSON.stringify({event: 'filerChanged', containers: request.operation === 'invalid' ? ['/arbitrary/path'] : ['workingSet', 'filer:' + 'c'.repeat(64), '/Gesundheit']}));
          console.log(JSON.stringify({requestId: request.requestId, success: true, result: {status: 'ok'}}));
        });
        """.utf8).write(to: entry)
        let notification = expectation(description: "typed change notification")
        let runtime = NodeRuntimeProcess(node: URL(fileURLWithPath: node), entry: entry, preload: preload, onChange: { containers in
            XCTAssertEqual(containers, ["workingSet", "filer:" + String(repeating: "c", count: 64), "/Gesundheit"])
            notification.fulfill()
        })
        do {
            try await runtime.start(configuration: [:])
            let result = try await runtime.invoke(JSONSerialization.data(withJSONObject: ["operation": "notify", "requestId": "reply-1"]))
            XCTAssertEqual((try JSONSerialization.jsonObject(with: result) as? [String: Any])?["requestId"] as? String, "reply-1")
            await fulfillment(of: [notification], timeout: 3)
            do {
                _ = try await runtime.invoke(JSONSerialization.data(withJSONObject: ["operation": "invalid", "requestId": "reply-2"]))
                XCTFail("Accepted an untyped notification address")
            } catch { XCTAssertTrue(error.localizedDescription.contains("Invalid filesystem change notification")) }
        } catch {
            await runtime.shutdown()
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
        await runtime.shutdown()
        try FileManager.default.removeItem(at: directory)
    }

}
