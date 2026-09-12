import XCTest
@testable import OneFilerHostSupport

final class FilerQAProgressTests: XCTestCase {
    func testRunningAndTerminalProgress() throws {
        let running = try FilerQAProgress.decode(["status": "running", "runId": "run-1",
            "currentStep": ["number": 3, "title": "Recipient originals"]])
        XCTAssertEqual(running.currentStep?.number, 3)
        XCTAssertEqual(try FilerQAProgress.decode(["status": "passed", "currentStep": NSNull()]).status, "passed")
        let inspection = try FilerQAProgress.decode(["status": "running", "waitingForResume": true,
            "collectionPath": "/Fotos/collection", "currentStep": ["number": 9, "title": "Inspect in Finder"]])
        XCTAssertEqual(inspection.waitingForResume, true)
        XCTAssertEqual(inspection.collectionPath, "/Fotos/collection")
    }

    func testMalformedProgressIsRejected() {
        for payload: [String: Any] in [["status": "arbitrary"], ["status": "running", "currentStep": ["number": -1, "title": "bad"]],
            ["status": "running", "currentStep": ["number": 2]], ["status": "failed", "error": String(repeating: "x", count: 20000)]] {
            XCTAssertThrowsError(try FilerQAProgress.decode(payload))
        }
    }
}
