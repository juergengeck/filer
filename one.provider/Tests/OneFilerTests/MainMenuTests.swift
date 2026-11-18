import Cocoa
import XCTest
@testable import OneFilerHostSupport

/// The host is an LSUIElement agent with no visible menu bar. Without an Edit
/// menu, standard key equivalents never reach the field editor, so pasting a
/// pairing invitation with Cmd+V silently fails while typing works.
final class MainMenuTests: XCTestCase {
    func testEditMenuProvidesStandardEditingShortcuts() throws {
        let editMenu = try XCTUnwrap(MainMenu.make().items.compactMap(\.submenu).first { $0.title == "Edit" })
        func keyEquivalent(for action: Selector) -> String? {
            editMenu.items.first { $0.action == action }?.keyEquivalent
        }
        XCTAssertEqual(keyEquivalent(for: Selector("paste:")), "v", "Cmd+V must reach the invitation field")
        XCTAssertEqual(keyEquivalent(for: Selector("copy:")), "c")
        XCTAssertEqual(keyEquivalent(for: Selector("cut:")), "x")
        XCTAssertEqual(keyEquivalent(for: Selector("selectAll:")), "a")
        XCTAssertEqual(keyEquivalent(for: Selector("undo:")), "z")
    }
}
