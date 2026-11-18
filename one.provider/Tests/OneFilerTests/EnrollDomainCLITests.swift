import XCTest
import OneFilerShared
@testable import OneFilerHostSupport

/// Slice-1 CLI contract: `--enroll-domain NAME --owner PERSON_ID` binds Cube
/// IoM enrollment to one exact owner, and `--list-domains`/`--inspect` expose
/// read-only configuration inside the machine-readable envelope. Follows the
/// PairingInvitationTests invitation-builder pattern.
final class EnrollDomainCLITests: XCTestCase {
    private static let ownerHash = String(repeating: "b", count: 64)
    private static let otherOwnerHash = String(repeating: "c", count: 64)
    private static let keyHash = String(repeating: "a", count: 64)

    private func enrollURL(
        token: String = "secret%+&value",
        relation: String = "device-enrollment",
        fragmentOwner: String? = ownerHash,
        email: String? = "lab@example.test",
        queryOwner: String? = ownerHash,
        mode: String = "IoM"
    ) throws -> String {
        var invitation: [String: Any] = ["token": token, "publicKey": Self.keyHash,
            "url": "wss://example.test/comm", "pairingProtocolVersion": 2,
            "identityRelation": relation, "mode": mode]
        if let fragmentOwner { invitation["deviceEnrollmentPersonId"] = fragmentOwner }
        var url = URLComponents(string: "https://example.test/invite")!
        var items: [URLQueryItem] = []
        if let email { items.append(URLQueryItem(name: "fe", value: email)) }
        if let queryOwner { items.append(URLQueryItem(name: "fdi", value: queryOwner)) }
        if !items.isEmpty { url.queryItems = items }
        url.fragment = String(data: try JSONSerialization.data(withJSONObject: invitation), encoding: .utf8)
        return try XCTUnwrap(url.string)
    }

    private func partnerURL() throws -> String {
        let invitation: [String: Any] = ["token": "partner-token", "publicKey": Self.keyHash,
            "url": "wss://example.test/comm", "pairingProtocolVersion": 2,
            "identityRelation": "distinct-person", "mode": "IoP"]
        var url = URLComponents(string: "https://example.test/invite")!
        url.fragment = String(data: try JSONSerialization.data(withJSONObject: invitation), encoding: .utf8)
        return try XCTUnwrap(url.string)
    }

    private func frame(_ bytes: Data) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
    }

    // MARK: - Owner binding

    func testEnrollAcceptsMatchingOwnerAndEmail() throws {
        let bytes = try EnrollDomainCommand.enrollRequest(
            invitationURL: enrollURL(), domainEmail: "lab@example.test",
            expectedOwner: Self.ownerHash)
        let framed = try frame(bytes)
        XCTAssertEqual(framed["operation"] as? String, "pairing:acceptDeviceEnrollment")
        let request = try XCTUnwrap(framed["request"] as? [String: Any])
        XCTAssertEqual(request["expectedOwnerPersonId"] as? String, Self.ownerHash)
        // Account email comparison ignores case, mirroring the Pair dialog route.
        XCTAssertNoThrow(try EnrollDomainCommand.enrollRequest(
            invitationURL: enrollURL(), domainEmail: "LAB@example.test",
            expectedOwner: Self.ownerHash))
    }

    func testEnrollRejectsOwnerMismatchWithoutExposingToken() throws {
        let address = try enrollURL()
        XCTAssertThrowsError(try EnrollDomainCommand.enrollRequest(
            invitationURL: address, domainEmail: "lab@example.test",
            expectedOwner: Self.otherOwnerHash)) { error in
            XCTAssertTrue(error.localizedDescription.contains("--owner"))
            XCTAssertFalse(error.localizedDescription.contains("secret%+&value"))
        }
    }

    func testEnrollRejectsEmailMismatch() throws {
        let address = try enrollURL()
        XCTAssertThrowsError(try EnrollDomainCommand.enrollRequest(
            invitationURL: address, domainEmail: "other@example.test",
            expectedOwner: Self.ownerHash)) { error in
            XCTAssertTrue(error.localizedDescription.contains("lab@example.test"))
            XCTAssertTrue(error.localizedDescription.contains("other@example.test"))
            XCTAssertFalse(error.localizedDescription.contains("secret%+&value"))
        }
    }

    func testEnrollRejectsPartnerInvitations() throws {
        XCTAssertThrowsError(try EnrollDomainCommand.enrollRequest(
            invitationURL: partnerURL(), domainEmail: "lab@example.test",
            expectedOwner: Self.ownerHash))
    }

    func testEnrollRejectsMalformedOwners() throws {
        let address = try enrollURL()
        for owner in ["", "short", String(repeating: "B", count: 64),
                      String(repeating: "g", count: 64), " \(Self.ownerHash) "] {
            // Whitespace-padded input is trimmed back to a valid owner.
            if owner.trimmingCharacters(in: .whitespacesAndNewlines) == Self.ownerHash {
                XCTAssertNoThrow(try EnrollDomainCommand.enrollRequest(
                    invitationURL: address, domainEmail: "lab@example.test",
                    expectedOwner: owner))
            } else {
                XCTAssertThrowsError(try EnrollDomainCommand.enrollRequest(
                    invitationURL: address, domainEmail: "lab@example.test",
                    expectedOwner: owner))
            }
        }
    }

    /// Re-running enrollment frames the same operation: consent-by-invocation
    /// is safe to repeat after a lost response instead of replaying blindly.
    func testReEnrollFramesIdenticalOperation() throws {
        let address = try enrollURL()
        let first = try frame(EnrollDomainCommand.enrollRequest(
            invitationURL: address, domainEmail: "lab@example.test",
            expectedOwner: Self.ownerHash))
        let second = try frame(EnrollDomainCommand.enrollRequest(
            invitationURL: address, domainEmail: "lab@example.test",
            expectedOwner: Self.ownerHash))
        XCTAssertEqual(first["operation"] as? String, second["operation"] as? String)
        let firstRequest = try XCTUnwrap(first["request"] as? [String: Any])
        let secondRequest = try XCTUnwrap(second["request"] as? [String: Any])
        XCTAssertEqual(firstRequest["expectedOwnerPersonId"] as? String,
                       secondRequest["expectedOwnerPersonId"] as? String)
        XCTAssertEqual((firstRequest["invitation"] as? [String: Any])?["token"] as? String,
                       (secondRequest["invitation"] as? [String: Any])?["token"] as? String)
    }

    // MARK: - Envelope

    func testEnvelopeCarriesProtocolVersion() throws {
        let ok = try frame(EnrollDomainCommand.success(["domain": "Cube"]))
        XCTAssertEqual(ok["success"] as? Bool, true)
        XCTAssertEqual(ok["protocolVersion"] as? Int, EnrollDomainCommand.protocolVersion)
        XCTAssertNotNil(ok["result"])
        let failure = try frame(EnrollDomainCommand.failure("nope"))
        XCTAssertEqual(failure["success"] as? Bool, false)
        XCTAssertEqual(failure["protocolVersion"] as? Int, EnrollDomainCommand.protocolVersion)
        XCTAssertEqual((failure["error"] as? [String: Any])?["message"] as? String, "nope")
    }

    // MARK: - Read-only views

    func testListViewSortsDomainsAndReportsEffectiveRelay() throws {
        let domains = [
            "b": LocalDomainConfiguration(storageId: UUID(), email: "b@example.test", commServerUrl: "wss://relay.example.test"),
            "a": LocalDomainConfiguration(storageId: UUID(), email: "a@example.test")
        ]
        let view = EnrollDomainCommand.listView(domains: domains)
        let rows = try XCTUnwrap(view["domains"] as? [[String: Any]])
        XCTAssertEqual(rows.map { $0["name"] as? String }, ["a", "b"])
        XCTAssertEqual(rows[0]["effectiveRelay"] as? String, EnrollDomainCommand.defaultRelay)
        XCTAssertTrue(rows[0]["commServerUrl"] is NSNull)
        XCTAssertEqual(rows[1]["effectiveRelay"] as? String, "wss://relay.example.test")
        XCTAssertEqual(rows[1]["commServerUrl"] as? String, "wss://relay.example.test")
        XCTAssertNotNil(UUID(uuidString: rows[0]["storageId"] as? String ?? ""))
    }

    func testInspectViewMarksRunningIdentitiesUnexposed() throws {
        let config = LocalDomainConfiguration(storageId: UUID(), email: "lab@example.test")
        let view = EnrollDomainCommand.inspectView(
            name: "Cube", config: config,
            fileProvider: ["registered": false, "url": NSNull(), "note": "n/a"],
            hostRunning: false)
        let domain = try XCTUnwrap(view["domain"] as? [String: Any])
        XCTAssertEqual(domain["name"] as? String, "Cube")
        XCTAssertEqual(domain["email"] as? String, "lab@example.test")
        let fileProvider = try XCTUnwrap(view["fileProvider"] as? [String: Any])
        XCTAssertEqual(fileProvider["registered"] as? Bool, false)
        let host = try XCTUnwrap(view["host"] as? [String: Any])
        XCTAssertEqual(host["running"] as? Bool, false)
        XCTAssertTrue(host["owner"] is NSNull)
        XCTAssertTrue(host["instance"] is NSNull)
        XCTAssertNotNil(host["note"])
    }
}
