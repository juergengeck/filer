import Cocoa
import XCTest
@testable import OneFilerHostSupport

final class DomainRegistrationFormTests: XCTestCase {
    @MainActor
    func testAccessoryViewPreservesNonCollapsedGeometryInsideAlert() {
        let alert = NSAlert()
        alert.messageText = "Register New Domain"
        alert.informativeText = "Create a local ONE instance."
        let registerButton = alert.addButton(withTitle: "Register")
        alert.addButton(withTitle: "Cancel")

        let form = DomainRegistrationForm()
        form.attach(to: alert, submitButton: registerButton)

        XCTAssertGreaterThanOrEqual(form.containerView.frame.width, 300)
        XCTAssertGreaterThanOrEqual(form.containerView.frame.height, 96)
        XCTAssertGreaterThanOrEqual(form.nameField.frame.width, 300)
        XCTAssertGreaterThanOrEqual(form.nameField.frame.height, 22)
        XCTAssertGreaterThanOrEqual(form.emailField.frame.width, 300)
        XCTAssertGreaterThanOrEqual(form.emailField.frame.height, 22)
        XCTAssertGreaterThanOrEqual(form.nameLabel.frame.height, 14)
        XCTAssertGreaterThanOrEqual(form.emailLabel.frame.height, 14)

        // Ensure fields are stacked top-to-bottom without overlapping.
        XCTAssertGreaterThanOrEqual(form.nameLabel.frame.minY, form.nameField.frame.maxY)
        XCTAssertGreaterThanOrEqual(form.nameField.frame.minY, form.emailLabel.frame.maxY)
        XCTAssertGreaterThanOrEqual(form.emailLabel.frame.minY, form.emailField.frame.maxY)

        XCTAssertTrue(form.nameField.nextKeyView === form.emailField)
        XCTAssertTrue(alert.window.initialFirstResponder === form.nameField)
    }

    @MainActor
    func testSubmitButtonTracksNonEmptyDomainName() {
        let alert = NSAlert()
        let registerButton = alert.addButton(withTitle: "Register")
        let form = DomainRegistrationForm()
        form.attach(to: alert, submitButton: registerButton)

        XCTAssertFalse(registerButton.isEnabled)
        XCTAssertFalse(form.isValid)

        form.nameField.stringValue = "   "
        form.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification, object: form.nameField))
        XCTAssertFalse(registerButton.isEnabled)

        form.nameField.stringValue = "  MyONE  "
        form.emailField.stringValue = "  user@example.com  "
        form.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification, object: form.nameField))
        XCTAssertTrue(registerButton.isEnabled)
        XCTAssertEqual(form.domainName, "MyONE")
        XCTAssertEqual(form.identityEmail, "user@example.com")

        form.emailField.stringValue = "   "
        XCTAssertNil(form.identityEmail)
    }

    @MainActor
    func testSuggestsUserNameFromEmailWithoutOverwritingManualEdit() {
        let alert = NSAlert()
        let registerButton = alert.addButton(withTitle: "Register")
        let form = DomainRegistrationForm(suggestedName: "gecko")
        form.attach(to: alert, submitButton: registerButton)

        XCTAssertTrue(registerButton.isEnabled)
        XCTAssertEqual(form.domainName, "gecko")

        // Typing an email before manual edit derives the user name from the email local-part.
        form.emailField.stringValue = "alice@refinio.net"
        form.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification, object: form.emailField))
        XCTAssertEqual(form.domainName, "alice")

        // Once manually edited, subsequent email edits do not overwrite the chosen name.
        form.nameField.stringValue = "Privat"
        form.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification, object: form.nameField))
        form.emailField.stringValue = "bob@refinio.net"
        form.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification, object: form.emailField))
        XCTAssertEqual(form.domainName, "Privat")
    }
}
