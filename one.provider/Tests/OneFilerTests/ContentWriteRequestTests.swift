import XCTest
@testable import OneFilerExtension

final class ContentWriteRequestTests: XCTestCase {
    func testCarriesOpaqueBaseVersionWithoutLoss() {
        let version = Data([0, 255, 128, 42])
        let request = ContentWriteRequest(path: "/Gesundheit/Baseline.xlsx", content: Data([1, 2, 3]), baseVersion: version)
        XCTAssertEqual(request.parameters["baseVersion"] as? String, version.base64EncodedString())
        XCTAssertEqual(request.parameters["operationId"] as? String, request.operationId)
    }

    func testRedeliveryKeepsIdentity() {
        let first = ContentWriteRequest(path: "/Gesundheit/Baseline.xlsx", content: Data([1, 2, 3]), baseVersion: Data("V0".utf8))
        let repeated = ContentWriteRequest(path: first.path, content: first.content, baseVersion: first.baseVersion)
        XCTAssertEqual(first.operationId, repeated.operationId)
    }

    func testLaterSaveAndOtherItemHaveDifferentIdentities() {
        let first = ContentWriteRequest(path: "/a", content: Data([1, 2, 3]), baseVersion: Data("V0".utf8))
        XCTAssertNotEqual(first.operationId, ContentWriteRequest(path: first.path, content: first.content, baseVersion: Data("V1".utf8)).operationId)
        XCTAssertNotEqual(first.operationId, ContentWriteRequest(path: "/b", content: first.content, baseVersion: first.baseVersion).operationId)
        XCTAssertNotEqual(first.operationId, ContentWriteRequest(path: first.path, content: Data([3, 2, 1]), baseVersion: first.baseVersion).operationId)
    }

    func testLengthFramingDistinguishesBoundaries() {
        let first = ContentWriteRequest(path: "/ab", content: Data("d".utf8), baseVersion: Data("c".utf8))
        let second = ContentWriteRequest(path: "/a", content: Data("d".utf8), baseVersion: Data("bc".utf8))
        XCTAssertNotEqual(first.operationId, second.operationId)
    }

    func testOrdinaryCreationHasNoFabricatedBase() {
        let request = ContentWriteRequest(path: "/note.txt", content: Data(), baseVersion: nil)
        XCTAssertNil(request.parameters["baseVersion"])
        XCTAssertNil(request.parameters["operationId"])
    }
}
