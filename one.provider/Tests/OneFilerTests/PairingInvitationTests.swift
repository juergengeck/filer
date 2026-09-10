import XCTest
@testable import OneFilerHostSupport

final class PairingInvitationTests: XCTestCase {
    /// URL fragments must be decoded once, retaining enrollment and its exact token.
    func testPreservesEncodedInvitationAndEnrollment() throws {
        let invitation: [String: Any] = ["token": "secret%+&value", "publicKey": String(repeating: "a", count: 64),
            "url": "wss://example.test/comm", "pairingProtocolVersion": 2,
            "identityRelation": "device-enrollment", "deviceEnrollmentPersonId": String(repeating: "b", count: 64)]
        var url = URLComponents(string: "https://example.test/invite")!
        url.fragment = String(data: try JSONSerialization.data(withJSONObject: invitation), encoding: .utf8)
        let bytes = try PairingInvitation.request(url: url.string!)
        let frame = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        XCTAssertEqual(frame["operation"] as? String, "pairing:connectUsingInvitation")
        let request = try XCTUnwrap(frame["request"] as? [String: Any])
        let decoded = try XCTUnwrap(request["invitation"] as? [String: Any])
        XCTAssertEqual(decoded["token"] as? String, invitation["token"] as? String)
        XCTAssertEqual(decoded["deviceEnrollmentPersonId"] as? String, invitation["deviceEnrollmentPersonId"] as? String)
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
