import XCTest
import OneFilerShared
@testable import OneFilerHostSupport

final class GlueEnrollmentSessionTests: XCTestCase {
    func testCandidateHandleNormalizesNameAndEmail() {
        XCTAssertEqual(GlueEnrollmentSession.candidateHandle(from: "gecko"), "gecko")
        XCTAssertEqual(GlueEnrollmentSession.candidateHandle(from: "  Gecko@glue.one  "), "gecko")
        XCTAssertEqual(GlueEnrollmentSession.candidateHandle(from: "Alice.Smith@glue.one"), "alice.smith")
    }

    func testValidateNoDomainConflictDetectsCaseInsensitiveIdentifierAndDisplayName() throws {
        let existing: [String: LocalDomainConfiguration] = [
            "Gecko": LocalDomainConfiguration(storageId: UUID(), email: "gecko@glue.one", displayName: "Gecko"),
            "work": LocalDomainConfiguration(storageId: UUID(), email: "work@filer.local", displayName: "Personal")
        ]

        XCTAssertThrowsError(try GlueEnrollmentSession.validateNoDomainConflict(handle: "gecko", existingDomains: existing)) { error in
            guard case GlueEnrollmentError.conflict(let message) = error else {
                return XCTFail("Expected conflict error, got \(error)")
            }
            XCTAssertTrue(message.contains("Gecko"))
        }

        XCTAssertThrowsError(try GlueEnrollmentSession.validateNoDomainConflict(handle: "personal", existingDomains: existing)) { error in
            guard case GlueEnrollmentError.conflict(let message) = error else {
                return XCTFail("Expected conflict error, got \(error)")
            }
            XCTAssertTrue(message.contains("Personal"))
        }

        XCTAssertNoThrow(try GlueEnrollmentSession.validateNoDomainConflict(handle: "alice", existingDomains: existing))
    }

    func testNormalizedDomainNameLowercasesVerifiedHandle() {
        let result = GlueEnrollmentResult(
            identity: "gecko@glue.one",
            handle: "Gecko",
            email: "gecko@glue.one",
            instanceName: "filer-0123456789abcdef",
            personId: String(repeating: "a", count: 64),
            instanceId: String(repeating: "b", count: 64),
            apiBase: "https://api.glue.one",
            commServerUrl: "wss://api.glue.one/comm"
        )
        XCTAssertEqual(result.normalizedDomainName, "gecko")
    }

    func testGlueEnrollmentProcessRoundTripAndCancellation() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let preload = dir.appendingPathComponent("preload.cjs")
        try Data("".utf8).write(to: preload)

        // Mock helper speaking the exact --glue-enroll stdin/stdout line protocol.
        let mockEntry = dir.appendingPathComponent("mock-enroll.mjs")
        let script = """
        import {createInterface} from 'node:readline';
        const rl = createInterface({input: process.stdin, crlfDelay: Infinity});
        const lines = [];
        const waiters = [];
        rl.on('line', line => { const w = waiters.shift(); if (w) w(line); else lines.push(line); });
        const nextLine = () => lines.length ? Promise.resolve(lines.shift()) : new Promise(r => waiters.push(r));
        const init = JSON.parse(await nextLine());
        process.stdout.write(JSON.stringify({
          event: 'openAuthUrl',
          url: 'https://glue.one/auth?returnTo=refinio42://glue-auth-result#request=abc',
          callbackScheme: 'refinio42'
        }) + '\\n');
        const reply = JSON.parse(await nextLine());
        if (reply.error) {
          process.stdout.write(JSON.stringify({success: false, error: reply.error}) + '\\n');
          rl.close();
          process.exit(1);
        }
        process.stdout.write(JSON.stringify({
          success: true,
          result: {
            identity: init.loginHint + '@glue.one',
            handle: init.loginHint,
            email: init.loginHint + '@glue.one',
            instanceName: 'filer-test1234',
            personId: 'a'.repeat(64),
            instanceId: 'b'.repeat(64),
            apiBase: 'https://api.glue.one',
            commServerUrl: 'wss://api.glue.one/comm'
          }
        }) + '\\n');
        rl.close();
        """
        try Data(script.utf8).write(to: mockEntry)

        let nodeCandidates = [
            "/Users/gecko/src/filer/one.provider/build/native-runtime/node",
            "/Users/gecko/src/filer/one.provider/build/toolchain/node-v24.22.1/node",
            "/Users/gecko/src/filer/one.provider/build/toolchain/node"
        ]
        guard let nodePath = nodeCandidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
            throw XCTSkip("No bundled Node binary available for GlueEnrollmentProcess round-trip test")
        }
        let node = URL(fileURLWithPath: nodePath)

        // 1. Happy path
        let result = try await GlueEnrollmentProcess.run(
            node: node,
            entry: mockEntry,
            preload: preload,
            directory: dir,
            loginHint: "gecko",
            storageSecret: "super-secret-value",
            openAuthSession: { url, scheme in
                XCTAssertEqual(scheme, "refinio42")
                XCTAssertTrue(url.absoluteString.contains("https://glue.one/auth"))
                return URL(string: "refinio42://glue-auth-result?result=ok")!
            }
        )
        XCTAssertEqual(result.handle, "gecko")
        XCTAssertEqual(result.email, "gecko@glue.one")
        XCTAssertEqual(result.instanceName, "filer-test1234")

        // 2. User cancellation path
        do {
            _ = try await GlueEnrollmentProcess.run(
                node: node,
                entry: mockEntry,
                preload: preload,
                directory: dir,
                loginHint: "gecko",
                storageSecret: "super-secret-value",
                openAuthSession: { _, _ in
                    throw GlueEnrollmentError.cancelled
                }
            )
            XCTFail("Expected cancellation error")
        } catch GlueEnrollmentError.cancelled {
            // expected
        }
    }
}
