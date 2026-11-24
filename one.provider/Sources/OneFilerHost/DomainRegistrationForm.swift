import Cocoa

/// Fixed-geometry accessory form for domain registration so NSAlert never collapses
/// the input fields under AppKit Auto Layout, suggests user-centric domain names,
/// and keeps the Register button disabled until a valid name is entered.
final class DomainRegistrationForm: NSObject, NSTextFieldDelegate {
    static let defaultWidth: CGFloat = 320
    static let defaultHeight: CGFloat = 110

    let containerView: NSView
    let nameLabel: NSTextField
    let nameField: NSTextField
    let emailLabel: NSTextField
    let emailField: NSTextField
    private weak var submitButton: NSButton?
    private var nameEditedByUser = false
    private var lastAutoSuggestedName: String

    init(suggestedName: String = "") {
        let width = Self.defaultWidth
        let initialSuggestion = Self.sanitizeName(suggestedName)
        lastAutoSuggestedName = initialSuggestion
        containerView = NSView(frame: NSRect(x: 0, y: 0, width: width, height: Self.defaultHeight))

        nameLabel = NSTextField(labelWithString: "User / Domain Name:")
        nameLabel.frame = NSRect(x: 0, y: 92, width: width, height: 18)

        nameField = NSTextField(frame: NSRect(x: 0, y: 64, width: width, height: 24))
        nameField.placeholderString = "e.g., \(NSUserName())"
        nameField.stringValue = initialSuggestion
        nameField.usesSingleLineMode = true
        nameField.cell?.isScrollable = true

        emailLabel = NSTextField(labelWithString: "Identity Email (optional):")
        emailLabel.frame = NSRect(x: 0, y: 34, width: width, height: 18)

        emailField = NSTextField(frame: NSRect(x: 0, y: 6, width: width, height: 24))
        emailField.placeholderString = "Same email as Edda, Flexibel, or Cube"
        emailField.usesSingleLineMode = true
        emailField.cell?.isScrollable = true

        super.init()

        containerView.addSubview(nameLabel)
        containerView.addSubview(nameField)
        containerView.addSubview(emailLabel)
        containerView.addSubview(emailField)

        nameField.nextKeyView = emailField
        emailField.nextKeyView = nameField
        nameField.delegate = self
        emailField.delegate = self
    }

    var domainName: String {
        nameField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var identityEmail: String? {
        let trimmed = emailField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    var isValid: Bool {
        let name = domainName
        return !name.isEmpty && !name.contains("/") && !name.contains(":")
    }

    /// Derive a sensible user label from an email address (e.g. `gecko@refinio.net` -> `gecko`).
    static func suggestedName(fromEmail email: String) -> String {
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let atIndex = trimmed.firstIndex(of: "@") else { return "" }
        let localPart = String(trimmed[..<atIndex])
        return sanitizeName(localPart)
    }

    static func sanitizeName(_ rawValue: String) -> String {
        rawValue
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
    }

    /// Attach the form to an alert, bind the primary button's enabled state, and focus the name field.
    func attach(to alert: NSAlert, submitButton: NSButton) {
        self.submitButton = submitButton
        alert.accessoryView = containerView
        updateSubmitState()
        alert.layout()
        alert.window.initialFirstResponder = nameField
    }

    func updateSubmitState() {
        submitButton?.isEnabled = isValid
    }

    func controlTextDidChange(_ notification: Notification) {
        if let field = notification.object as? NSTextField {
            if field === nameField {
                let current = nameField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
                nameEditedByUser = !current.isEmpty && current != lastAutoSuggestedName
            } else if field === emailField, !nameEditedByUser {
                let derived = Self.suggestedName(fromEmail: emailField.stringValue)
                if !derived.isEmpty {
                    nameField.stringValue = derived
                    lastAutoSuggestedName = derived
                }
            }
        }
        updateSubmitState()
    }
}
