import Cocoa
import FileProvider
import UniformTypeIdentifiers

@MainActor
class MenuBarApp: NSObject, NSApplicationDelegate {

    private var statusItem: NSStatusItem!
    private var menu: NSMenu!
    private var statusMonitor = StatusMonitor()
    private var domainManager: DomainManager!
    private let runtimeService = RuntimeService()
    private var pairingDomains = Set<String>()
    private var isSigningInWithGlue = false
    private var qaProgress: [String: FilerQAProgress] = [:]
    private var runtimeInspection = UUID()

    nonisolated override init() {
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // No visible menu bar, but the hidden Edit menu is what routes
        // Cmd+C/V/X/A/Z to text fields in modal dialogs.
        MainMenu.install()
        do { try runtimeService.start() }
        catch {
            let alert = Self.createAlert(error: error)
            NSApp.activate(ignoringOtherApps: true)
            alert.runModal()
            NSApplication.shared.terminate(nil)
            return
        }
        // Create status item in menu bar
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)

        if let button = statusItem.button {
            guard let iconImage = NSImage(named: "MenuBarIcon") else {
                fatalError("The bundled olive menu bar icon is missing")
            }
            // AppKit tints the olive silhouette for the actual menu bar appearance,
            // including light/dark wallpaper and the selected menu state.
            iconImage.isTemplate = true
            iconImage.size = NSSize(width: 18, height: 18)
            iconImage.accessibilityDescription = "OneFiler"
            button.image = iconImage
            button.toolTip = "OneFiler - ONE Platform File Provider"
        }

        // Create menu
        menu = NSMenu()
        menu.delegate = self

        // Initialize managers
        domainManager = DomainManager()
        NotificationCenter.default.addObserver(self, selector: #selector(integrationProgress(_:)), name: .filerQAProgress, object: nil)

        // Build initial menu
        updateMenu()

        // Assign menu to status item
        statusItem.menu = menu

        NSLog("OneFiler menu bar app started")
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        Task {
            await runtimeService.stop()
            await MainActor.run { sender.reply(toApplicationShouldTerminate: true) }
        }
        return .terminateLater
    }

    // MARK: - Menu Building

    /// Native progress is pushed by the owning runtime, with no status polling.
    @objc private func integrationProgress(_ notification: Notification) {
        guard let storageId = notification.userInfo?["storageId"] as? UUID,
              let progress = notification.userInfo?["progress"] as? FilerQAProgress else { return }
        do {
            for (domain, configuration) in try domainManager.listDomains() where configuration.storageId == storageId {
                qaProgress[domain] = progress
            }
            updateMenu()
        } catch { NSLog("Cannot display integration progress: %@", error.localizedDescription) }
    }

    /// A run explicitly selects its configured app participants and fixture photos.
    @objc private func runIntegration(_ sender: NSMenuItem) {
        guard let domain = sender.representedObject as? String else { return }
        let panel = NSOpenPanel()
        panel.title = "Choose Integration Test Configuration"
        panel.message = "Choose the JSON configuration for the Glue registrar and the two Fotos app instances."
        panel.allowedContentTypes = [.json]
        panel.allowsMultipleSelection = false
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            let data = try Data(contentsOf: url)
            guard data.count <= 8 * 1024 * 1024,
                  let parameters = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw CocoaError(.fileReadCorruptFile)
            }
            Task {
                do { _ = try await runtimeService.qa(domain: domain, method: "runFullProtocol", parameters: parameters) }
                catch { await MainActor.run { self.presentErrorAlert(error) } }
            }
        } catch { presentErrorAlert(error) }
    }

    @objc private func stopIntegration(_ sender: NSMenuItem) {
        guard let domain = sender.representedObject as? String else { return }
        Task {
            do { _ = try await runtimeService.qa(domain: domain, method: "stop") }
            catch { await MainActor.run { self.presentErrorAlert(error) } }
        }
    }

    @objc private func resumeIntegration(_ sender: NSMenuItem) {
        guard let domain = sender.representedObject as? String else { return }
        Task {
            do { _ = try await runtimeService.qa(domain: domain, method: "resume") }
            catch { await MainActor.run { self.presentErrorAlert(error) } }
        }
    }

    @objc private func saveIntegrationReport(_ sender: NSMenuItem) {
        guard let domain = sender.representedObject as? String else { return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "filer-integration-report.json"
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task {
            do {
                let data = try await runtimeService.qa(domain: domain, method: qaProgress[domain]?.waitingForResume == true ? "getInspectionReport" : "getProtocolReport")
                try data.write(to: url, options: .atomic)
            } catch { await MainActor.run { self.presentErrorAlert(error) } }
        }
    }

    private func updateMenu() {
        menu.removeAllItems()

        // Title
        let titleItem = NSMenuItem(title: "OneFiler", action: nil, keyEquivalent: "")
        titleItem.isEnabled = false
        menu.addItem(titleItem)
        menu.addItem(NSMenuItem.separator())

        // Domains section
        do {
            let domains = try domainManager.listDomains()
            if domains.isEmpty {
                let noDomainsItem = NSMenuItem(title: "No domains registered", action: nil, keyEquivalent: "")
                noDomainsItem.isEnabled = false
                menu.addItem(noDomainsItem)
            } else {
                for (identifier, config) in domains.sorted(by: {
                    $0.value.resolvedDisplayName(fallback: $0.key)
                        .localizedCaseInsensitiveCompare($1.value.resolvedDisplayName(fallback: $1.key)) == .orderedAscending
                }) {
                    let displayName = config.resolvedDisplayName(fallback: identifier)
                    let domainMenu = NSMenu()

                    // Status
                    let status = statusMonitor.getStatus(for: identifier)
                    let statusItem = NSMenuItem(title: "Runtime: \(status)", action: nil, keyEquivalent: "")
                    statusItem.isEnabled = false
                    statusItem.toolTip = statusMonitor.errorDescription
                    domainMenu.addItem(statusItem)

                    let identityTitle: String
                    if config.glueApiBase != nil {
                        identityTitle = "glue.one: \(config.email)"
                    } else if config.email.hasSuffix("@filer.local") {
                        identityTitle = "Local ONE runtime"
                    } else {
                        identityTitle = "Identity: \(config.email)"
                    }
                    let endpointItem = NSMenuItem(title: identityTitle, action: nil, keyEquivalent: "")
                    endpointItem.isEnabled = false
                    domainMenu.addItem(endpointItem)

                    if let glueApiBase = config.glueApiBase {
                        let glueSyncItem = NSMenuItem(title: "Sync: glue.one IoM + contacts", action: nil, keyEquivalent: "")
                        glueSyncItem.isEnabled = false
                        glueSyncItem.toolTip = glueApiBase
                        domainMenu.addItem(glueSyncItem)
                    }

                    let pairItem = NSMenuItem(title: pairingDomains.contains(identifier) ? "Pairing…" : "Pair with Another Device…",
                                             action: #selector(pairDomain(_:)), keyEquivalent: "")
                    pairItem.target = self
                    pairItem.representedObject = identifier
                    pairItem.isEnabled = !pairingDomains.contains(identifier)
                    domainMenu.addItem(pairItem)

                    let renameItem = NSMenuItem(title: "Rename Domain…", action: #selector(renameDomain(_:)), keyEquivalent: "")
                    renameItem.target = self
                    renameItem.representedObject = identifier
                    domainMenu.addItem(renameItem)

                    let qaState = qaProgress[identifier]
                    let qaStatus = NSMenuItem(title: "Integration: \(qaState?.status ?? "idle")\(qaState?.currentStep.map { " · \($0.title)" } ?? "")", action: nil, keyEquivalent: "")
                    qaStatus.isEnabled = false
                    domainMenu.addItem(qaStatus)
                    for (title, action) in [("Run Integration Test…", #selector(runIntegration(_:))),
                                            ("Finish Revocation Test", #selector(resumeIntegration(_:))),
                                            ("Stop Integration Test", #selector(stopIntegration(_:))),
                                            ("Save Integration Report…", #selector(saveIntegrationReport(_:)))] {
                        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
                        item.target = self
                        item.representedObject = identifier
                        if title == "Run Integration Test…" { item.isEnabled = qaState?.status != "running" }
                        if title == "Stop Integration Test" { item.isEnabled = qaState?.status == "running" }
                        if title == "Finish Revocation Test" { item.isEnabled = qaState?.waitingForResume == true }
                        if title == "Save Integration Report…" { item.isEnabled = qaState?.waitingForResume == true || ["passed", "failed", "cancelled"].contains(qaState?.status ?? "idle") }
                        domainMenu.addItem(item)
                    }

                    domainMenu.addItem(NSMenuItem.separator())

                    // Unregister
                    let unregisterItem = NSMenuItem(title: "Unregister", action: #selector(unregisterDomain(_:)), keyEquivalent: "")
                    unregisterItem.representedObject = identifier
                    unregisterItem.target = self
                    domainMenu.addItem(unregisterItem)

                    // Add to main menu; representedObject keeps the stable identifier even if displayName changes.
                    let domainItem = NSMenuItem(title: displayName, action: nil, keyEquivalent: "")
                    domainItem.representedObject = identifier
                    domainItem.submenu = domainMenu
                    menu.addItem(domainItem)
                }
            }
        } catch {
            let failure = NSMenuItem(title: "Cannot read domain configuration", action: nil, keyEquivalent: "")
            failure.isEnabled = false
            failure.toolTip = error.localizedDescription
            menu.addItem(failure)
            NSLog("OneFiler domain configuration error: \(error)")
        }

        menu.addItem(NSMenuItem.separator())

        // Sign in with glue.one
        let glueSignInItem = NSMenuItem(
            title: isSigningInWithGlue ? "Signing in with glue.one…" : "Sign in with glue.one…",
            action: #selector(signInWithGlue),
            keyEquivalent: ""
        )
        glueSignInItem.target = self
        glueSignInItem.isEnabled = !isSigningInWithGlue
        menu.addItem(glueSignInItem)

        // Register new domain
        let registerItem = NSMenuItem(title: "Register New Domain…", action: #selector(registerNewDomain), keyEquivalent: "")
        registerItem.target = self
        menu.addItem(registerItem)

        menu.addItem(NSMenuItem.separator())

        // Open logs
        let logsItem = NSMenuItem(title: "Open Logs…", action: #selector(openLogs), keyEquivalent: "")
        logsItem.target = self
        menu.addItem(logsItem)

        menu.addItem(NSMenuItem.separator())

        // Quit
        let quitItem = NSMenuItem(title: "Quit OneFiler", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)
    }

    // MARK: - Actions

    /// Uses the appearance-aware olive artwork instead of NSAlert's boxed app icon.
    private static func createAlert(error: Error? = nil) -> NSAlert {
        let alert: NSAlert
        if let error {
            alert = NSAlert(error: error)
        } else {
            alert = NSAlert()
        }
        guard let icon = NSImage(named: "FilerIcon")?.copy() as? NSImage else {
            fatalError("The bundled olive dialog icon is missing")
        }
        icon.size = NSSize(width: 64, height: 64)
        icon.accessibilityDescription = "OneFiler"
        alert.icon = icon
        return alert
    }

    private func presentErrorAlert(_ error: Error) {
        NSApp.activate(ignoringOtherApps: true)
        Self.createAlert(error: error).runModal()
    }

    @objc private func signInWithGlue() {
        guard !isSigningInWithGlue else { return }
        let alert = Self.createAlert()
        alert.messageText = "Sign in with glue.one"
        alert.informativeText = "Enter your registered glue.one name. You will approve this Mac with your glue.one passkey so your Fotos and Files sync automatically with your other devices."
        alert.alertStyle = .informational

        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        field.placeholderString = "e.g., \(NSUserName().lowercased())"
        let hasGlueDomain = (try? domainManager.listDomains().values.contains { $0.glueApiBase != nil }) ?? false
        if !hasGlueDomain {
            field.stringValue = NSUserName().lowercased()
        }
        alert.accessoryView = field
        alert.addButton(withTitle: "Continue")
        alert.addButton(withTitle: "Cancel")
        alert.layout()
        alert.window.initialFirstResponder = field

        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        let loginHint = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !loginHint.isEmpty else {
            presentErrorAlert(GlueEnrollmentError.failed("Enter your glue.one name (for example, gecko)."))
            return
        }

        isSigningInWithGlue = true
        updateMenu()

        let manager = domainManager!
        Task { @MainActor in
            defer {
                self.isSigningInWithGlue = false
                self.updateMenu()
            }
            do {
                let result = try await GlueEnrollmentSession.signIn(loginHint: loginHint, domainManager: manager)
                self.updateMenu()
                let success = Self.createAlert()
                success.messageText = "Connected to glue.one"
                success.informativeText = "Registered Finder domain '\(result.normalizedDomainName)' for \(result.email). Your Fotos and Files will sync automatically with your other glue.one devices."
                NSApp.activate(ignoringOtherApps: true)
                success.runModal()
            } catch GlueEnrollmentError.cancelled {
                // User dismissed the passkey prompt; no error alert needed.
            } catch {
                self.presentErrorAlert(error)
            }
        }
    }

    @objc private func registerNewDomain() {
        let alert = Self.createAlert()
        alert.messageText = "Register New Domain"
        alert.informativeText = "Create a local ONE instance and make its files available in Finder. Keep OneFiler open while using the drive."
        alert.alertStyle = .informational

        let registerButton = alert.addButton(withTitle: "Register")
        alert.addButton(withTitle: "Cancel")

        let suggestedName = (try? domainManager.listDomains().isEmpty) == true ? NSUserName() : ""
        let form = DomainRegistrationForm(suggestedName: suggestedName)
        form.attach(to: alert, submitButton: registerButton)

        // Activate this LSUIElement host so typing and Cmd+V go straight to the dialog.
        NSApp.activate(ignoringOtherApps: true)
        let response = alert.runModal()
        guard response == .alertFirstButtonReturn else { return }

        let name = form.domainName
        guard !name.isEmpty else {
            showDomainResult(PrivateSocket.failure("A domain name is required."), success: "")
            return
        }

        do {
            try domainManager.registerDomain(name: name, displayName: name, email: form.identityEmail) { error in
                self.showDomainResult(error, success: "Domain '\(name)' registered.")
            }
        } catch {
            showDomainResult(error, success: "")
        }
    }

    @objc private func renameDomain(_ sender: NSMenuItem) {
        guard let identifier = sender.representedObject as? String else { return }
        let currentName = (try? domainManager.getDomainConfig(name: identifier)?.resolvedDisplayName(fallback: identifier)) ?? identifier

        let alert = Self.createAlert()
        alert.messageText = "Rename Domain"
        alert.informativeText = "Choose the user-visible name for this domain in Finder and the OneFiler menu bar."
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        field.stringValue = currentName
        field.placeholderString = "e.g., \(NSUserName())"
        alert.accessoryView = field
        alert.addButton(withTitle: "Rename")
        alert.addButton(withTitle: "Cancel")
        alert.layout()
        alert.window.initialFirstResponder = field

        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let nextName = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try domainManager.renameDomain(name: identifier, displayName: nextName) { error in
                self.showDomainResult(error, success: "Domain renamed to '\(nextName)'.")
            }
        } catch {
            showDomainResult(error, success: "")
        }
    }

    /// Start pairing on the existing host owner and leave the menu responsive while it runs.
    @objc private func pairDomain(_ sender: NSMenuItem) {
        guard let domain = sender.representedObject as? String, !pairingDomains.contains(domain) else { return }
        let alert = Self.createAlert()
        alert.messageText = "Pair \(domain)"
        alert.informativeText = "Paste the invitation from Cube or another ONE device. Device enrollment requires this domain to use the same identity email."
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 420, height: 24))
        field.placeholderString = "Pairing invitation link"
        alert.accessoryView = field
        alert.addButton(withTitle: "Pair")
        alert.addButton(withTitle: "Cancel")
        alert.layout()
        alert.window.initialFirstResponder = field
        // The dialog is opened from the status menu; take activation so key
        // equivalents (Cmd+V) route to this app instead of the previous one.
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let url = field.stringValue
        // Enrollment binds this domain to the invitation's owner identity and
        // needs explicit consent beyond pasting the link.
        var enrollConsented = false
        if case .deviceEnrollment(let email, _) = (try? PairingInvitation.kind(url: url)) ?? .partner {
            let confirm = Self.createAlert()
            confirm.messageText = "Enroll Device"
            confirm.informativeText = "This invitation enrolls this domain as a new device of \(email ?? "another identity"). The domain's identity email must match that account. Continue?"
            confirm.addButton(withTitle: "Enroll")
            confirm.addButton(withTitle: "Cancel")
            NSApp.activate(ignoringOtherApps: true)
            guard confirm.runModal() == .alertFirstButtonReturn else { return }
            enrollConsented = true
        }
        pairingDomains.insert(domain)
        updateMenu()
        Task {
            var failure: Error?
            do { try await runtimeService.pair(domain: domain, invitationURL: url, enrollConsented: enrollConsented) }
            catch { failure = error }
            let error = failure
            await MainActor.run {
                self.pairingDomains.remove(domain)
                self.updateMenu()
                let result = Self.createAlert()
                result.messageText = error == nil ? "Device Paired" : "Pairing Failed"
                result.informativeText = error?.localizedDescription ?? "\(domain) is paired. The other device determines which data is shared; synchronization continues while Filer is open."
                NSApp.activate(ignoringOtherApps: true)
                result.runModal()
            }
        }
    }

    @objc private func unregisterDomain(_ sender: NSMenuItem) {
        guard let identifier = sender.representedObject as? String else { return }

        let alert = Self.createAlert()
        alert.messageText = "Unregister Domain"
        alert.informativeText = "Are you sure you want to unregister domain '\(identifier)'?"
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Unregister")
        alert.addButton(withTitle: "Cancel")

        NSApp.activate(ignoringOtherApps: true)
        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            do {
                try domainManager.unregisterDomain(name: identifier) { error in
                    self.showDomainResult(error, success: "Domain '\(identifier)' removed.")
                }
            } catch {
                showDomainResult(error, success: "")
            }
        }
    }

    private func showDomainResult(_ error: Error?, success: String) {
        DispatchQueue.main.async {
            self.updateMenu()
            let alert = Self.createAlert()
            alert.messageText = error == nil ? "Domain Updated" : "Domain Update Failed"
            alert.informativeText = error?.localizedDescription ?? success
            alert.alertStyle = error == nil ? .informational : .critical
            NSApp.activate(ignoringOtherApps: true)
            alert.runModal()
        }
    }

    @objc private func openLogs() {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.one.filer"
        ) else {
            return
        }

        let logsURL = containerURL.appendingPathComponent("logs")
        NSWorkspace.shared.open(logsURL)
    }

    @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }

}

// MARK: - Menu snapshots

extension MenuBarApp: NSMenuDelegate {
    /// Refresh local ownership once per menu opening, without starting a runtime.
    func menuWillOpen(_ menu: NSMenu) {
        let inspection = UUID()
        runtimeInspection = inspection
        statusMonitor = StatusMonitor()
        updateMenu()
        Task {
            do {
                let states = try await runtimeService.runtimeStates()
                await MainActor.run {
                    guard self.runtimeInspection == inspection else { return }
                    self.statusMonitor = StatusMonitor(states: states)
                    self.updateRuntimeStatusItems()
                }
            } catch {
                NSLog("Cannot inspect local runtime ownership: %@", error.localizedDescription)
                await MainActor.run {
                    guard self.runtimeInspection == inspection else { return }
                    self.statusMonitor = StatusMonitor(errorDescription: error.localizedDescription)
                    self.updateRuntimeStatusItems()
                }
            }
        }
    }

    /// Keep the active menu hierarchy intact when the asynchronous snapshot arrives.
    private func updateRuntimeStatusItems() {
        for domainItem in menu.items {
            guard let identifier = domainItem.representedObject as? String,
                  let statusItem = domainItem.submenu?.items.first else { continue }
            statusItem.title = "Runtime: \(statusMonitor.getStatus(for: identifier))"
            statusItem.toolTip = statusMonitor.errorDescription
        }
    }
}
