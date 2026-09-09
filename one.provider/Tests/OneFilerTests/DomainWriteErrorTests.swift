import XCTest
import FileProvider
@testable import OneFilerExtension

final class DomainWriteErrorTests: XCTestCase {
    func testStaleClinicalBaseRemainsUnsynchronized() {
        let error = DomainWriteError.fromRPC(code: -32010, message: "Die Baseline wurde inzwischen geändert.")
        XCTAssertEqual(error.domain, NSFileProviderErrorDomain)
        XCTAssertEqual(error.code, NSFileProviderError.Code.cannotSynchronize.rawValue)
        XCTAssertEqual((error.userInfo[NSUnderlyingErrorKey] as? NSError)?.code, -32010)
        XCTAssertEqual(error.localizedDescription, "Die Baseline wurde inzwischen geändert.")
    }

    func testDeniedWritePreservesPermissionFailure() {
        let error = DomainWriteError.fromRPC(code: -32011, message: "Die aktive Rolle darf dieses Feld nicht ändern.")
        XCTAssertEqual(error.domain, NSCocoaErrorDomain)
        XCTAssertEqual(error.code, CocoaError.Code.fileWriteNoPermission.rawValue)
    }

    func testValidationErrorPreservesCodeAndExplanation() {
        let error = DomainWriteError.fromRPC(code: -32012, message: "Baseline!C2: Pflichtwert fehlt.")
        XCTAssertEqual(error.code, NSFileProviderError.Code.cannotSynchronize.rawValue)
        XCTAssertEqual((error.userInfo[NSUnderlyingErrorKey] as? NSError)?.code, -32012)
        XCTAssertEqual(error.localizedDescription, "Baseline!C2: Pflichtwert fehlt.")
    }
}
