import Cocoa
import FileProvider

class MenuBarApp: NSObject, NSApplicationDelegate {

    private var statusItem: NSStatusItem!
    private var menu: NSMenu!
    private var statusMonitor: StatusMonitor!
    private var domainManager: DomainManager!
    private let runtimeService = RuntimeService()
    private var pairingDomains = Set<String>()

    func applicationDidFinishLaunching(_ notification: Notification) {
        do { try runtimeService.start() }
        catch {
            let alert = Self.createAlert(error: error)
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

        // Initialize managers
        domainManager = DomainManager()
        statusMonitor = StatusMonitor(domainManager: domainManager)
        statusMonitor.delegate = self

        // Build initial menu
        updateMenu()

        // Assign menu to status item
        statusItem.menu = menu

        // DISABLED: Start monitoring (causes permission dialog loop)
        // statusMonitor.startMonitoring()

        NSLog("OneFiler menu bar app started")
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        Task {
            await runtimeService.stop()
            await MainActor.run { sender.reply(toApplicationShouldTerminate: true) }
        }
        return .terminateLater
    }

    func applicationWillTerminate(_ notification: Notification) {
        statusMonitor.stopMonitoring()
    }

    // MARK: - Menu Building

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
                for (identifier, _) in domains.sorted(by: { $0.key < $1.key }) {
                    let domainMenu = NSMenu()

                    // Status
                    let status = statusMonitor.getStatus(for: identifier)
                    let statusItem = NSMenuItem(title: "Status: \(status.description)", action: nil, keyEquivalent: "")
                    statusItem.isEnabled = false
                    domainMenu.addItem(statusItem)

                    let endpointItem = NSMenuItem(title: "Local ONE runtime", action: nil, keyEquivalent: "")
                    endpointItem.isEnabled = false
                    domainMenu.addItem(endpointItem)

                    let pairItem = NSMenuItem(title: pairingDomains.contains(identifier) ? "Pairing…" : "Pair with Another Device…",
                                             action: #selector(pairDomain(_:)), keyEquivalent: "")
                    pairItem.target = self
                    pairItem.representedObject = identifier
                    pairItem.isEnabled = !pairingDomains.contains(identifier)
                    domainMenu.addItem(pairItem)

                    let refreshFiles = NSMenuItem(title: "Refresh Files", action: #selector(refreshDomainFiles(_:)), keyEquivalent: "")
                    refreshFiles.target = self
                    refreshFiles.representedObject = identifier
                    domainMenu.addItem(refreshFiles)

                    domainMenu.addItem(NSMenuItem.separator())

                    // Unregister
                    let unregisterItem = NSMenuItem(title: "Unregister", action: #selector(unregisterDomain(_:)), keyEquivalent: "")
                    unregisterItem.representedObject = identifier
                    unregisterItem.target = self
                    domainMenu.addItem(unregisterItem)

                    // Add to main menu
                    let domainItem = NSMenuItem(title: identifier, action: nil, keyEquivalent: "")
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

        // Register new domain
        let registerItem = NSMenuItem(title: "Register New Domain...", action: #selector(registerNewDomain), keyEquivalent: "")
        registerItem.target = self
        menu.addItem(registerItem)

        menu.addItem(NSMenuItem.separator())

        // Refresh
        let refreshItem = NSMenuItem(title: "Refresh", action: #selector(refreshMenu), keyEquivalent: "r")
        refreshItem.target = self
        menu.addItem(refreshItem)

        // Open logs
        let logsItem = NSMenuItem(title: "Open Logs...", action: #selector(openLogs), keyEquivalent: "")
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

    @objc private func registerNewDomain() {
        let alert = Self.createAlert()
        alert.messageText = "Register New Domain"
        alert.informativeText = "Enter domain details:"
        alert.alertStyle = .informational

        // Create input fields
        let stackView = NSStackView()
        stackView.orientation = .vertical
        stackView.spacing = 8
        stackView.alignment = .leading

        // Name field
        let nameLabel = NSTextField(labelWithString: "Domain Name:")
        let nameField = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        nameField.placeholderString = "e.g., MyONE"

        stackView.addArrangedSubview(nameLabel)
        stackView.addArrangedSubview(nameField)
        let emailField = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        emailField.placeholderString = "Use the same email as Cube for device pairing"
        stackView.addArrangedSubview(NSTextField(labelWithString: "Identity email (optional):"))
        stackView.addArrangedSubview(emailField)
        alert.informativeText = "Create a local ONE instance and make its files available in Finder. Keep OneFiler open while using the drive."

        alert.accessoryView = stackView
        alert.addButton(withTitle: "Register")
        alert.addButton(withTitle: "Cancel")

        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            let name = nameField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)

            if !name.isEmpty {
                do {
                    let email = emailField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
                    try domainManager.registerDomain(name: name, email: email.isEmpty ? nil : email) { error in
                        self.showDomainResult(error, success: "Domain '\(name)' registered.")
                    }
                } catch {
                    showDomainResult(error, success: "")
                }
            }
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
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let url = field.stringValue
        pairingDomains.insert(domain)
        updateMenu()
        Task {
            var failure: Error?
            do { try await runtimeService.pair(domain: domain, invitationURL: url) }
            catch { failure = error }
            let error = failure
            await MainActor.run {
                self.pairingDomains.remove(domain)
                self.updateMenu()
                let result = Self.createAlert()
                result.messageText = error == nil ? "Device Paired" : "Pairing Failed"
                result.informativeText = error?.localizedDescription ?? "\(domain) is paired. The other device determines which data is shared; synchronization continues while Filer is open."
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
            alert.runModal()
        }
    }

    @objc private func refreshMenu() {
        updateMenu()
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

    @objc private func refreshDomainFiles(_ sender: NSMenuItem) {
        guard let name = sender.representedObject as? String else { return }
        do {
            try domainManager.refreshDomain(name: name) { error in
                if let error { DispatchQueue.main.async { Self.createAlert(error: error).runModal() } }
            }
        } catch { Self.createAlert(error: error).runModal() }
    }

    @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }

    // MARK: - Icon Updates

    private func updateIcon(state: StatusMonitor.ConnectionState) {
        guard let button = statusItem.button else { return }

        // Update tooltip to reflect state
        switch state {
        case .connected:
            button.toolTip = "OneFiler - Connected"
        case .disconnected:
            button.toolTip = "OneFiler - Disconnected"
        case .syncing:
            button.toolTip = "OneFiler - Syncing"
        case .error:
            button.toolTip = "OneFiler - Error"
        }
    }
}

// MARK: - StatusMonitorDelegate

extension MenuBarApp: StatusMonitorDelegate {
    func statusDidChange(for domain: String, state: StatusMonitor.ConnectionState) {
        DispatchQueue.main.async {
            self.updateMenu()
            self.updateIcon(state: state)
        }
    }
}
