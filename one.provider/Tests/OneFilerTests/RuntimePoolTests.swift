import XCTest
@testable import OneFilerHostSupport
import OneFilerShared

private final class RuntimeConfigurationBox: @unchecked Sendable {
    var domains: [String: LocalDomainConfiguration]
    init(_ domains: [String: LocalDomainConfiguration]) { self.domains = domains }
}
private final class FakeOwnedRuntime: OwnedRuntime, @unchecked Sendable {
    private let lock = NSLock()
    private var running = true
    private var stopCount = 0
    private var callCount = 0
    var isRunning: Bool { lock.withLock { running } }
    var stops: Int { lock.withLock { stopCount } }
    var calls: Int { lock.withLock { callCount } }
    func invoke(_ request: Data) async throws -> Data { lock.withLock { callCount += 1 }; return request }
    func shutdown() async { lock.withLock { stopCount += 1; running = false } }
}
private actor StartupGate {
    private var waiting: CheckedContinuation<Void, Never>?
    private var started: CheckedContinuation<Void, Never>?
    private var entered = false
    func hold() async {
        entered = true
        started?.resume(); started = nil
        await withCheckedContinuation { waiting = $0 }
    }
    func waitForStart() async {
        if entered { return }
        await withCheckedContinuation { started = $0 }
    }
    func release() { waiting?.resume(); waiting = nil }
}

final class RuntimePoolTests: XCTestCase {
    func testRemovalStopsOnlyItsRuntimeAndRejectsFurtherCalls() async throws {
        let config = LocalDomainConfiguration(storageId: UUID(), email: "a@filer.local")
        let box = RuntimeConfigurationBox(["a": config])
        let child = FakeOwnedRuntime()
        let pool = RuntimePool(configuration: { box.domains }, factory: { _, _ in child })
        _ = try await pool.perform(domain: "a", request: Data())
        box.domains.removeAll()
        try await pool.reconcile()
        XCTAssertEqual(child.stops, 1)
        do { _ = try await pool.perform(domain: "a", request: Data()); XCTFail("Removed domain was revived") }
        catch {}
        await pool.stop()
        XCTAssertEqual(child.stops, 1)
    }

    func testRemovalDuringBootstrapCannotDispatchAnOperation() async throws {
        let config = LocalDomainConfiguration(storageId: UUID(), email: "a@filer.local")
        let box = RuntimeConfigurationBox(["a": config])
        let child = FakeOwnedRuntime()
        let gate = StartupGate()
        let pool = RuntimePool(configuration: { box.domains }, factory: { _, _ in await gate.hold(); return child })
        let request = Task { try await pool.perform(domain: "a", request: Data()) }
        await gate.waitForStart()
        box.domains.removeAll()
        // Either the observer or the resumed request sees removal first; both must close ownership.
        let reconcile = Task { try await pool.reconcile() }
        await gate.release()
        _ = try await reconcile.value
        do { _ = try await request.value; XCTFail("Removed domain accepted a request") } catch {}
        XCTAssertEqual(child.calls, 0)
        XCTAssertEqual(child.stops, 1)
    }

    func testConcurrentRequestsShareOneBootstrap() async throws {
        let config = LocalDomainConfiguration(storageId: UUID(), email: "a@filer.local")
        let box = RuntimeConfigurationBox(["a": config])
        let child = FakeOwnedRuntime()
        let gate = StartupGate()
        var starts = 0
        let pool = RuntimePool(configuration: { box.domains }, factory: { _, _ in starts += 1; await gate.hold(); return child })
        let first = Task { try await pool.perform(domain: "a", request: Data([1])) }
        await gate.waitForStart()
        let second = Task { try await pool.perform(domain: "a", request: Data([2])) }
        await gate.release()
        let values = try await (first.value, second.value)
        XCTAssertEqual(values.0, Data([1])); XCTAssertEqual(values.1, Data([2]))
        XCTAssertEqual(starts, 1)
        await pool.stop()
        XCTAssertEqual(child.stops, 1)
    }
    func testAtomicConfigRemovalReconcilesTheRunningOwner() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let manager = DomainManager(configFileURL: directory.appendingPathComponent("domains.json"),
            addDomain: { _, done in done(nil) }, removeDomain: { _, done in done(nil) })
        try manager.registerDomain(name: "watched")
        let child = FakeOwnedRuntime()
        let pool = RuntimePool(configuration: { try manager.listDomains() }, factory: { _, _ in child })
        _ = try await pool.perform(domain: "watched", request: Data())
        let ready = expectation(description: "watch installed")
        let removed = expectation(description: "removed owner closed")
        removed.assertForOverFulfill = false
        let observer = try RuntimeConfigurationObserver(directory: directory, onReady: { ready.fulfill() }) {
            Task {
                do { try await pool.reconcile(); if child.stops == 1 { removed.fulfill() } }
                catch { XCTFail("Configuration observation failed: \(error)") }
            }
        }
        defer { observer.stop() }
        await fulfillment(of: [ready], timeout: 5)
        try manager.unregisterDomain(name: "watched")
        await fulfillment(of: [removed], timeout: 5)
        XCTAssertEqual(child.stops, 1)
        await pool.stop()
    }

}
