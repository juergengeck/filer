import Foundation

protocol StatusMonitorDelegate: AnyObject {
    func statusDidChange(for domain: String, state: StatusMonitor.ConnectionState)
}

class StatusMonitor {

    enum ConnectionState: String {
        case connected
        case disconnected
        case syncing
        case error

        var description: String {
            switch self {
            case .connected: return "Connected"
            case .disconnected: return "Disconnected"
            case .syncing: return "Syncing"
            case .error: return "Error"
            }
        }
    }

    struct DomainStatus: Codable {
        let state: String
        let lastUpdate: Date
        let errorMessage: String?
        let activeConnections: Int?
        let syncProgress: Double?

        var connectionState: ConnectionState {
            ConnectionState(rawValue: state) ?? .disconnected
        }
    }

    weak var delegate: StatusMonitorDelegate?
    private let domainManager: DomainManager
    private var statusCache: [String: DomainStatus] = [:]
    private var timer: Timer?
    private let statusFileURL: URL?

    init(domainManager: DomainManager) {
        self.domainManager = domainManager

        // Get App Group container
        if let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.one.filer"
        ) {
            statusFileURL = containerURL.appendingPathComponent("status.json")
        } else {
            statusFileURL = nil
            NSLog("⚠️ StatusMonitor: Failed to get App Group container URL")
        }
    }

    func startMonitoring() {
        // Poll status every 2 seconds
        timer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            self?.updateStatus()
        }
        timer?.tolerance = 0.5

        // Initial update
        updateStatus()
    }

    func stopMonitoring() {
        timer?.invalidate()
        timer = nil
    }

    func getStatus(for domain: String) -> ConnectionState {
        statusCache[domain]?.connectionState ?? .disconnected
    }

    // MARK: - Private

    private func updateStatus() {
        guard let statusFileURL = statusFileURL else {
            // No status file - mark all domains as disconnected
            updateAllDomainsDisconnected()
            return
        }

        // Check if status file exists
        guard FileManager.default.fileExists(atPath: statusFileURL.path) else {
            // No status file yet - extension hasn't written status
            updateAllDomainsDisconnected()
            return
        }

        do {
            let data = try Data(contentsOf: statusFileURL)
            let statuses = try JSONDecoder().decode([String: DomainStatus].self, from: data)

            // Update cache and notify delegates of changes
            for (domain, status) in statuses {
                let oldState = statusCache[domain]?.connectionState
                statusCache[domain] = status

                if oldState != status.connectionState {
                    delegate?.statusDidChange(for: domain, state: status.connectionState)
                }
            }

            // Check for domains that are no longer in status file
            let currentDomains = Set(domainManager.listDomains().keys)
            let statusDomains = Set(statuses.keys)
            for domain in currentDomains.subtracting(statusDomains) {
                if statusCache[domain]?.connectionState != .disconnected {
                    statusCache[domain] = DomainStatus(
                        state: "disconnected",
                        lastUpdate: Date(),
                        errorMessage: nil,
                        activeConnections: nil,
                        syncProgress: nil
                    )
                    delegate?.statusDidChange(for: domain, state: .disconnected)
                }
            }

        } catch {
            NSLog("⚠️ StatusMonitor: Failed to read status file: \(error)")
            updateAllDomainsDisconnected()
        }
    }

    private func updateAllDomainsDisconnected() {
        let domains = domainManager.listDomains()
        for (identifier, _) in domains {
            if statusCache[identifier]?.connectionState != .disconnected {
                statusCache[identifier] = DomainStatus(
                    state: "disconnected",
                    lastUpdate: Date(),
                    errorMessage: nil,
                    activeConnections: nil,
                    syncProgress: nil
                )
                delegate?.statusDidChange(for: identifier, state: .disconnected)
            }
        }
    }
}
