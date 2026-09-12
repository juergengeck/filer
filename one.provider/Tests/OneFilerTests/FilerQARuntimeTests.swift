import XCTest
@testable import OneFilerHostSupport

final class FilerQARuntimeTests: XCTestCase {
    /// Invoke the embedded protocol against explicit live app participants, observing pushed completion.
    func testGlueFotosFullProtocol() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let configurationPath = env["FILER_QA_CONFIGURATION"], let node = env["ONE_FILER_TEST_NODE"],
              let entry = env["ONE_FILER_TEST_ENTRY"], let preload = env["ONE_FILER_TEST_PRELOAD"],
              let commServer = env["FILER_QA_COMM_SERVER"] else {
            throw XCTSkip("Set FILER_QA_CONFIGURATION and FILER_QA_COMM_SERVER to run the app-owned Glue/Fotos protocol")
        }
        let configuration = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: configurationPath))) as? [String: Any])
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let completed = expectation(description: "embedded integration protocol completed")
        let runtime = NodeRuntimeProcess(node: URL(fileURLWithPath: node), entry: URL(fileURLWithPath: entry),
            preload: URL(fileURLWithPath: preload), onQAProgress: { progress in
                FileHandle.standardError.write(Data("Filer QA: \(progress.status) \(progress.currentStep?.title ?? "") \(progress.error ?? "")\n".utf8))
                if ["passed", "failed", "cancelled"].contains(progress.status) { completed.fulfill() }
            })
        func call(_ method: String, _ request: [String: Any] = [:]) async throws -> [String: Any] {
            let data = try await runtime.invoke(JSONSerialization.data(withJSONObject: [
                "operation": "filer-test-runner:\(method)", "request": request, "requestId": UUID().uuidString]))
            let response = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            XCTAssertEqual(response["success"] as? Bool, true, String(describing: response["error"]))
            return try XCTUnwrap(response["result"] as? [String: Any])
        }
        do {
            try await runtime.start(configuration: ["directory": directory.path, "email": "qa-\(UUID().uuidString)@filer.test",
                "secret": UUID().uuidString, "name": "Glue Fotos Filer QA", "commServerUrl": commServer,
                "inviteUrlPrefix": "https://refinio.one/invite"])
            _ = try await call("runFullProtocol", configuration)
            await fulfillment(of: [completed], timeout: 600)
            let report = try await call("getProtocolReport")
            let reportPath = URL(fileURLWithPath: configurationPath).deletingLastPathComponent().appendingPathComponent("filer-protocol-report.json")
            try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]).write(to: reportPath, options: .atomic)
            print("Filer protocol report: \(reportPath.path)")
            let status = try await call("getStatus")
            XCTAssertEqual(status["status"] as? String, "passed", String(describing: status["error"]))
            if status["status"] as? String != "passed" {
                print("Failed Filer runtime evidence retained at: \(directory.path)")
                await runtime.shutdown()
                return
            }
        } catch {
            await runtime.shutdown()
            throw error
        }
        await runtime.shutdown()
        try FileManager.default.removeItem(at: directory)
    }

    /// Exercise the real private app operations and a local-only runtime replacement.
    func testIdentityAndFilesSurviveOfflineRuntimeRestart() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let node = env["ONE_FILER_TEST_NODE"], let entry = env["ONE_FILER_TEST_ENTRY"], let preload = env["ONE_FILER_TEST_PRELOAD"] else {
            throw XCTSkip("Run npm run test:connection for the private runtime QA integration")
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let runtime = NodeRuntimeProcess(node: URL(fileURLWithPath: node), entry: URL(fileURLWithPath: entry), preload: URL(fileURLWithPath: preload))
        func call(_ operation: String, _ request: [String: Any] = [:]) async throws -> [String: Any] {
            let bytes = try await runtime.invoke(JSONSerialization.data(withJSONObject: ["operation": operation,
                "request": request, "requestId": UUID().uuidString]))
            let envelope = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
            XCTAssertEqual(envelope["success"] as? Bool, true, String(describing: envelope["error"]))
            return try XCTUnwrap(envelope["result"] as? [String: Any])
        }
        do {
            try await runtime.start(configuration: ["directory": directory.path, "email": "qa-native@filer.test",
                "secret": UUID().uuidString, "name": "QA native", "commServerUrl": "ws://127.0.0.1:1", "inviteUrlPrefix": "https://refinio.one/invite"])
            let before = try await call("filer-qa:getIdentity")
            XCTAssertEqual(before["ownerId"] as? String, before["personId"] as? String)
            XCTAssertNotEqual(before["personId"] as? String, before["instanceId"] as? String)
            let write = try await call("filer:writeFile", ["path": "/Files/retained.txt", "content": Data("retained bytes".utf8).base64EncodedString()])
            XCTAssertNil(write["error"])
            let after = try await call("filer-qa:restartRuntime", ["networkEnabled": false])
            for field in ["ownerId", "personId", "instanceId", "publicSignKey", "instanceEncryptionKey"] {
                XCTAssertEqual(before[field] as? String, after[field] as? String, field)
            }
            let read = try await call("filer:readFile", ["path": "/Files/retained.txt"])
            XCTAssertEqual((read["result"] as? [String: Any])?["content"] as? String, Data("retained bytes".utf8).base64EncodedString())
            let snapshot = try await call("filer-qa:getFotosSnapshot")
            XCTAssertEqual((snapshot["collections"] as? [Any])?.count, 0)
        } catch {
            await runtime.shutdown()
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
        await runtime.shutdown()
        try FileManager.default.removeItem(at: directory)
    }
}
