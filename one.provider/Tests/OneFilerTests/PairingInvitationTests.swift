import XCTest
@testable import OneFilerHostSupport

final class PairingInvitationTests: XCTestCase {
    private static let ownerHash = String(repeating: "b", count: 64)
    private static let keyHash = String(repeating: "a", count: 64)

    /// Build a device-enrollment link of the shape Flexibel finalizes:
    /// transport JSON in the fragment, account email (`fe`) and enrollment
    /// owner (`fdi`) as query parameters.
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

    /// URL fragments must be decoded once, retaining enrollment and its exact token.
    func testEnrollRequestBindsInvitationToItsOwner() throws {
        let bytes = try PairingInvitation.enrollRequest(
            url: enrollURL(), domainEmail: "lab@example.test", consented: true)
        let frame = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        XCTAssertEqual(frame["operation"] as? String, "pairing:acceptDeviceEnrollment")
        let request = try XCTUnwrap(frame["request"] as? [String: Any])
        XCTAssertEqual(request["expectedOwnerPersonId"] as? String, Self.ownerHash)
        let decoded = try XCTUnwrap(request["invitation"] as? [String: Any])
        XCTAssertEqual(decoded["token"] as? String, "secret%+&value")
        XCTAssertEqual(decoded["deviceEnrollmentPersonId"] as? String, Self.ownerHash)
    }

    func testKindSeparatesEnrollmentFromPartnerPairing() throws {
        XCTAssertEqual(try PairingInvitation.kind(url: enrollURL()),
                       .deviceEnrollment(email: "lab@example.test", owner: Self.ownerHash))
        XCTAssertEqual(try PairingInvitation.kind(url: partnerURL()), .partner)
    }

    /// Enrollment must not silently flow through plain pairing: it binds the
    /// domain to another identity and needs the enroll dialog's consent.
    func testRequestDirectsEnrollmentToTheEnrollDialog() throws {
        XCTAssertThrowsError(try PairingInvitation.request(url: enrollURL())) { error in
            XCTAssertFalse(error.localizedDescription.contains("secret%+&value"))
        }
        XCTAssertNoThrow(try PairingInvitation.request(url: partnerURL()))
    }

    func testEnrollRequiresMatchingAccountEmailAndConsent() throws {
        let address = try enrollURL()
        XCTAssertThrowsError(try PairingInvitation.enrollRequest(
            url: address, domainEmail: "other@example.test", consented: true)) { error in
            XCTAssertTrue(error.localizedDescription.contains("lab@example.test"))
            XCTAssertTrue(error.localizedDescription.contains("other@example.test"))
            XCTAssertFalse(error.localizedDescription.contains("secret%+&value"))
        }
        XCTAssertThrowsError(try PairingInvitation.enrollRequest(
            url: address, domainEmail: "lab@example.test", consented: false))
        XCTAssertThrowsError(try PairingInvitation.enrollRequest(
            url: partnerURL(), domainEmail: "lab@example.test", consented: true))
        // Account email comparison ignores case.
        XCTAssertNoThrow(try PairingInvitation.enrollRequest(
            url: address, domainEmail: "LAB@example.test", consented: true))
    }

    func testEnrollRefusesUnverifiableOwners() throws {
        XCTAssertThrowsError(try PairingInvitation.enrollRequest(
            url: enrollURL(fragmentOwner: nil, queryOwner: nil),
            domainEmail: "lab@example.test", consented: true))
        XCTAssertThrowsError(try PairingInvitation.enrollRequest(
            url: enrollURL(fragmentOwner: Self.ownerHash, queryOwner: String(repeating: "c", count: 64)),
            domainEmail: "lab@example.test", consented: true))
    }

    func testRejectsMalformedAndUnsupportedInvitationsWithoutExposingToken() throws {
        for address in ["file:///tmp/invite", "https://example.test", "https://example.test/#not-json"] {
            XCTAssertThrowsError(try PairingInvitation.request(url: address))
        }
        var url = URLComponents(string: "https://example.test")!
        for version in [1, 3] {
            url.fragment = "{\"token\":\"private-token\",\"publicKey\":\"\(String(repeating: "a", count: 64))\",\"url\":\"wss://example.test\",\"pairingProtocolVersion\":\(version)}"
            XCTAssertThrowsError(try PairingInvitation.request(url: url.string!)) { error in
                XCTAssertFalse(error.localizedDescription.contains("private-token"))
            }
        }
    }

    func testPairingRequiresExplicitConnectedResponse() throws {
        for response in [#"{"success":false,"error":{"message":"private-token"}}"#, #"{"success":true,"result":{}}"#] {
            XCTAssertThrowsError(try PairingInvitation.validateResponse(Data(response.utf8))) { error in
                XCTAssertFalse(error.localizedDescription.contains("private-token"))
            }
        }
        XCTAssertNoThrow(try PairingInvitation.validateResponse(Data(#"{"success":true,"result":{"status":"connected"}}"#.utf8)))
    }
}
