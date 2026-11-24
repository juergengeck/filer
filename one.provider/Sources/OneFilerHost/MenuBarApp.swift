import Cocoa
import FileProvider
import UniformTypeIdentifiers

@MainActor
class MenuBarApp: NSObject, NSApplicationDelegate {

    private var statusItem: NSStatusItem!
    private var menu: NSMenu!
    private var statusMonitor = StatusMonitor()
    private var domainManager: DomainManager!
    private var updateManager: UpdateManager!
    private let runtimeService = RuntimeService()
    private var pairingDomains = Set<String>()
    private var isSigningInWithGlue = false
    private var qaProgress: [String: FilerQAProgress] = [:]
    private var runtimeInspection = UUID()
    private var isMenuOpen = false
    private var updatesSubmenu: NSMenu?
    private var topLevelUpdateActionItem: NSMenuItem?
    private var topLevelCancelDownloadItem: NSMenuItem?

    nonisolated override init() {
        super.init()
    }

    private static let checkTimeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter
    }()

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
        updateManager = UpdateManager(onStateChange: { [weak self] _ in
            self?.handleUpdateStateChanged()
        })
        NotificationCenter.default.addObserver(self, selector: #selector(integrationProgress(_:)), name: .filerQAProgress, object: nil)

        // Build initial menu
        updateMenu()
        updateStatusItemToolTip()

        // Assign menu to status item
        statusItem.menu = menu

        // Start automatic background update checks if enabled
        updateManager.startAutomaticChecks()

        NSLog("OneFiler menu bar app started")
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        updateManager?.stop()
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
            if !isMenuOpen {
                updateMenu()
            }
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

    private func handleUpdateStateChanged() {
        updateStatusItemToolTip()
        if isMenuOpen {
            refreshOpenUpdateMenuItems()
        } else {
            updateMenu()
        }
    }

    private func updateStatusItemToolTip() {
        guard let button = statusItem?.button else { return }
        let version = updateManager?.currentVersionString ?? ""
        switch updateManager?.state {
        case .updateAvailable(let release, _):
            button.toolTip = "OneFiler \(version) — Update \(release.versionString) available"
        case .downloading(let release, let received, let total):
            let percent = total > 0 ? Int((Double(received) / Double(total)) * 100.0) : 0
            button.toolTip = "OneFiler \(version) — Downloading \(release.versionString) (\(percent)%)"
        case .readyToInstall(let release, _):
            button.toolTip = "OneFiler \(version) — Update \(release.versionString) ready to install"
        default:
            button.toolTip = version.isEmpty
                ? "OneFiler - ONE Platform File Provider"
                : "OneFiler \(version) - ONE Platform File Provider"
        }
    }

    private func updateMenu() {
        menu.removeAllItems()
        updatesSubmenu = nil
        topLevelUpdateActionItem = nil
        topLevelCancelDownloadItem = nil

        // Title with installed version
        let version = updateManager?.currentVersionString ?? ""
        let headerTitle = version.isEmpty ? "OneFiler" : "OneFiler \(version)"
        let titleItem = NSMenuItem(title: headerTitle, action: nil, keyEquivalent: "")
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

        // Update management section
        addUpdateMenuItems(to: menu)

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

    private func addUpdateMenuItems(to targetMenu: NSMenu) {
        guard let updateManager else { return }

        switch updateManager.state {
        case .updateAvailable(let release, _):
            let actionItem = NSMenuItem(
                title: "Update Available: \(release.versionString)…",
                action: #selector(downloadAvailableUpdate),
                keyEquivalent: ""
            )
            actionItem.target = self
            targetMenu.addItem(actionItem)
            topLevelUpdateActionItem = actionItem
        case .downloading(let release, let received, let total):
            let percent = total > 0 ? Int((Double(received) / Double(total)) * 100.0) : 0
            let progressItem = NSMenuItem(
                title: "Downloading Update \(release.versionString)… \(percent)%",
                action: nil,
                keyEquivalent: ""
            )
            progressItem.isEnabled = false
            targetMenu.addItem(progressItem)
            topLevelUpdateActionItem = progressItem

            let cancelItem = NSMenuItem(
                title: "Cancel Update Download",
                action: #selector(cancelUpdateDownload),
                keyEquivalent: ""
            )
            cancelItem.target = self
            targetMenu.addItem(cancelItem)
            topLevelCancelDownloadItem = cancelItem
        case .readyToInstall(let release, _):
            let installItem = NSMenuItem(
                title: "Install Verified Update (\(release.versionString))…",
                action: #selector(promptInstallReadyUpdate),
                keyEquivalent: ""
            )
            installItem.target = self
            targetMenu.addItem(installItem)
            topLevelUpdateActionItem = installItem
        default:
            break
        }

        let submenu = NSMenu()
        populateUpdatesSubmenu(submenu)
        updatesSubmenu = submenu

        let updatesItem = NSMenuItem(title: "Updates", action: nil, keyEquivalent: "")
        updatesItem.submenu = submenu
        targetMenu.addItem(updatesItem)
    }

    private func populateUpdatesSubmenu(_ submenu: NSMenu) {
        submenu.removeAllItems()
        guard let updateManager else { return }

        let statusTitle: String
        var statusToolTip: String?

        switch updateManager.state {
        case .managedByAppStore:
            statusTitle = "Managed by App Store"
        case .idle:
            if let lastChecked = updateManager.lastCheckedAt {
                statusTitle = "Last Checked: \(Self.checkTimeFormatter.string(from: lastChecked))"
            } else {
                statusTitle = "Not Checked Yet"
            }
        case .checking:
            statusTitle = "Checking for Updates…"
        case .upToDate(let checkedAt, let latestVersion, let fingerprint):
            statusTitle = "Up to Date (\(latestVersion))"
            statusToolTip = "Verified at \(Self.checkTimeFormatter.string(from: checkedAt)) · root \(fingerprint)"
        case .updateAvailable(let release, let checkedAt):
            statusTitle = "Update Available: \(release.versionString)"
            statusToolTip = "Verified at \(Self.checkTimeFormatter.string(from: checkedAt)) · root \(release.rootFingerprint)"
        case .downloading(let release, let received, let total):
            let percent = total > 0 ? Int((Double(received) / Double(total)) * 100.0) : 0
            statusTitle = "Downloading \(release.versionString)… \(percent)%"
        case .readyToInstall(let release, _):
            statusTitle = "Verified Installer Ready (\(release.versionString))"
            statusToolTip = "SHA-256 verified · root \(release.rootFingerprint)"
        case .failed(let message, _):
            statusTitle = "Update Check Failed"
            statusToolTip = message
        }

        let statusItem = NSMenuItem(title: statusTitle, action: nil, keyEquivalent: "")
        statusItem.isEnabled = false
        statusItem.toolTip = statusToolTip
        submenu.addItem(statusItem)

        submenu.addItem(NSMenuItem.separator())

        if updateManager.distribution == .appStore {
            let appStoreItem = NSMenuItem(title: "Open App Store Updates…", action: #selector(openAppStoreUpdates), keyEquivalent: "")
            appStoreItem.target = self
            submenu.addItem(appStoreItem)
            return
        }

        let checkItem = NSMenuItem(title: "Check for Updates…", action: #selector(checkForUpdatesInteractive), keyEquivalent: "")
        checkItem.target = self
        if case .checking = updateManager.state { checkItem.isEnabled = false }
        if case .downloading = updateManager.state { checkItem.isEnabled = false }
        submenu.addItem(checkItem)

        switch updateManager.state {
        case .updateAvailable(let release, _):
            let downloadItem = NSMenuItem(title: "Download Update (\(release.versionString))…", action: #selector(downloadAvailableUpdate), keyEquivalent: "")
            downloadItem.target = self
            submenu.addItem(downloadItem)
        case .downloading:
            let cancelItem = NSMenuItem(title: "Cancel Download", action: #selector(cancelUpdateDownload), keyEquivalent: "")
            cancelItem.target = self
            submenu.addItem(cancelItem)
        case .readyToInstall(let release, _):
            let installItem = NSMenuItem(title: "Install Verified Update (\(release.versionString))…", action: #selector(promptInstallReadyUpdate), keyEquivalent: "")
            installItem.target = self
            submenu.addItem(installItem)
        default:
            break
        }

        submenu.addItem(NSMenuItem.separator())

        let autoCheckItem = NSMenuItem(title: "Automatically Check for Updates", action: #selector(toggleAutomaticUpdateChecks), keyEquivalent: "")
        autoCheckItem.target = self
        autoCheckItem.state = updateManager.automaticChecksEnabled ? .on : .off
        submenu.addItem(autoCheckItem)

        let downloadsItem = NSMenuItem(title: "Open Downloads Page…", action: #selector(openDownloadsPage), keyEquivalent: "")
        downloadsItem.target = self
        submenu.addItem(downloadsItem)
    }

    /// Update open-menu progress without tearing down the tracked root menu hierarchy.
    private func refreshOpenUpdateMenuItems() {
        guard let updateManager else { return }
        if let submenu = updatesSubmenu {
            populateUpdatesSubmenu(submenu)
        }
        if let actionItem = topLevelUpdateActionItem {
            switch updateManager.state {
            case .downloading(let release, let received, let total):
                let percent = total > 0 ? Int((Double(received) / Double(total)) * 100.0) : 0
                actionItem.title = "Downloading Update \(release.versionString)… \(percent)%"
                actionItem.action = nil
                actionItem.isEnabled = false
            case .readyToInstall(let release, _):
                actionItem.title = "Install Verified Update (\(release.versionString))…"
                actionItem.action = #selector(promptInstallReadyUpdate)
                actionItem.target = self
                actionItem.isEnabled = true
                topLevelCancelDownloadItem?.isHidden = true
            case .updateAvailable(let release, _):
                actionItem.title = "Update Available: \(release.versionString)…"
                actionItem.action = #selector(downloadAvailableUpdate)
                actionItem.target = self
                actionItem.isEnabled = true
                topLevelCancelDownloadItem?.isHidden = true
            default:
                break
            }
        }
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

    // MARK: - Update Actions

    @objc private func checkForUpdatesInteractive() {
        Task { @MainActor in
            let state = await updateManager.checkForUpdates()
            switch state {
            case .upToDate(_, let latestVersion, let fingerprint):
                let alert = Self.createAlert()
                alert.messageText = "OneFiler is Up to Date"
                alert.informativeText = "OneFiler \(updateManager.currentVersionString) is the latest verified release (published \(latestVersion), root \(fingerprint))."
                NSApp.activate(ignoringOtherApps: true)
                alert.runModal()
            case .updateAvailable(let release, _):
                presentUpdateAvailablePrompt(release)
            case .readyToInstall(let release, let fileURL):
                presentInstallerReadyPrompt(release: release, fileURL: fileURL)
            case .failed(let message, _):
                let alert = Self.createAlert()
                alert.messageText = "Update Check Failed"
                alert.informativeText = message
                alert.alertStyle = .critical
                NSApp.activate(ignoringOtherApps: true)
                alert.runModal()
            case .managedByAppStore:
                openAppStoreUpdates()
            case .idle, .checking, .downloading:
                break
            }
        }
    }

    @objc private func downloadAvailableUpdate() {
        switch updateManager.state {
        case .updateAvailable(let release, _):
            presentUpdateAvailablePrompt(release)
        case .readyToInstall(let release, let fileURL):
            presentInstallerReadyPrompt(release: release, fileURL: fileURL)
        default:
            break
        }
    }

    private func presentUpdateAvailablePrompt(_ release: VerifiedRelease) {
        let sizeText = ByteCountFormatter.string(fromByteCount: release.artifact.sizeBytes, countStyle: .file)
        let alert = Self.createAlert()
        alert.messageText = "Update Available: OneFiler \(release.versionString)"
        alert.informativeText = "You are running OneFiler \(updateManager.currentVersionString). Version \(release.versionString) (\(sizeText)) is signed by Refinio (root \(release.rootFingerprint)). Download and verify the installer now?"
        alert.addButton(withTitle: "Download Update")
        alert.addButton(withTitle: "Later")

        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        Task { @MainActor in
            do {
                let fileURL = try await updateManager.downloadUpdate(release)
                presentInstallerReadyPrompt(release: release, fileURL: fileURL)
            } catch {
                if (error as? CancellationError) != nil || (error as NSError).code == NSURLErrorCancelled {
                    return
                }
                let failure = Self.createAlert()
                failure.messageText = "Update Download Failed"
                failure.informativeText = error.localizedDescription
                failure.alertStyle = .critical
                NSApp.activate(ignoringOtherApps: true)
                failure.runModal()
            }
        }
    }

    @objc private func promptInstallReadyUpdate() {
        guard case .readyToInstall(let release, let fileURL) = updateManager.state else { return }
        presentInstallerReadyPrompt(release: release, fileURL: fileURL)
    }

    private func presentInstallerReadyPrompt(release: VerifiedRelease, fileURL: URL) {
        let alert = Self.createAlert()
        alert.messageText = "OneFiler \(release.versionString) Verified & Ready"
        alert.informativeText = "The disk image passed Refinio signature and SHA-256 verification. Quit OneFiler before dragging OneFiler.app to Applications so local ONE storage closes cleanly."
        alert.addButton(withTitle: "Open Installer & Quit")
        alert.addButton(withTitle: "Open Installer")
        alert.addButton(withTitle: "Later")

        NSApp.activate(ignoringOtherApps: true)
        let response = alert.runModal()
        switch response {
        case .alertFirstButtonReturn:
            NSWorkspace.shared.open(fileURL)
            NSApplication.shared.terminate(nil)
        case .alertSecondButtonReturn:
            NSWorkspace.shared.open(fileURL)
        default:
            break
        }
    }

    @objc private func cancelUpdateDownload() {
        updateManager.cancelDownload()
    }

    @objc private func toggleAutomaticUpdateChecks() {
        updateManager.automaticChecksEnabled.toggle()
        updateMenu()
    }

    @objc private func openDownloadsPage() {
        NSWorkspace.shared.open(updateManager.downloadsPageURL)
    }

    @objc private func openAppStoreUpdates() {
        NSWorkspace.shared.open(UpdateManager.appStoreUpdatesURL)
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
        guard menu === self.menu else { return }
        isMenuOpen = true
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

    func menuDidClose(_ menu: NSMenu) {
        guard menu === self.menu else { return }
        isMenuOpen = false
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
