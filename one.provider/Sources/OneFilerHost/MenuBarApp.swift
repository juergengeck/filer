import Cocoa
import FileProvider

class MenuBarApp: NSObject, NSApplicationDelegate {

    private var statusItem: NSStatusItem!
    private var menu: NSMenu!
    private var statusMonitor: StatusMonitor!
    private var domainManager: DomainManager!
    private let runtimeService = RuntimeService()

    func applicationDidFinishLaunching(_ notification: Notification) {
        do { try runtimeService.start() }
        catch {
            let alert = NSAlert(error: error)
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
                for (identifier, _) in domains {
                    let domainMenu = NSMenu()

                    // Status
                    let status = statusMonitor.getStatus(for: identifier)
                    let statusItem = NSMenuItem(title: "Status: \(status.description)", action: nil, keyEquivalent: "")
                    statusItem.isEnabled = false
                    domainMenu.addItem(statusItem)

                    let endpointItem = NSMenuItem(title: "Local ONE runtime", action: nil, keyEquivalent: "")
                    endpointItem.isEnabled = false
                    domainMenu.addItem(endpointItem)

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

    @objc private func registerNewDomain() {
        let alert = NSAlert()
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
        alert.informativeText = "Create a local ONE instance and make its files available in Finder. Keep OneFiler open while using the drive."

        alert.accessoryView = stackView
        alert.addButton(withTitle: "Register")
        alert.addButton(withTitle: "Cancel")

        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            let name = nameField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)

            if !name.isEmpty {
                do {
                    try domainManager.registerDomain(name: name) { error in
                        self.showDomainResult(error, success: "Domain '\(name)' registered.")
                    }
                } catch {
                    showDomainResult(error, success: "")
                }
            }
        }
    }

    @objc private func unregisterDomain(_ sender: NSMenuItem) {
        guard let identifier = sender.representedObject as? String else { return }

        let alert = NSAlert()
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
            let alert = NSAlert()
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
