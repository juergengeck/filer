import Foundation

/// Writes status updates to App Group for menu bar app to read
actor StatusWriter {

    struct DomainStatus: Codable {
        let state: String
        let lastUpdate: Date
        let errorMessage: String?
        let activeConnections: Int?
        let syncProgress: Double?
    }

    private let statusFileURL: URL?
    private var currentStatuses: [String: DomainStatus] = [:]

    init() {
        // Get App Group container
        if let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.one.filer"
        ) {
            statusFileURL = containerURL.appendingPathComponent("status.json")
            NSLog("✅ StatusWriter: Initialized with status file at \(containerURL.path)")
        } else {
            statusFileURL = nil
            NSLog("⚠️ StatusWriter: Failed to get App Group container URL")
        }
    }

    func updateStatus(domain: String, state: String, errorMessage: String? = nil, activeConnections: Int? = nil, syncProgress: Double? = nil) {
        let status = DomainStatus(
            state: state,
            lastUpdate: Date(),
            errorMessage: errorMessage,
            activeConnections: activeConnections,
            syncProgress: syncProgress
        )

        currentStatuses[domain] = status
        writeStatusFile()
    }

    func removeStatus(domain: String) {
        currentStatuses.removeValue(forKey: domain)
        writeStatusFile()
    }

    // MARK: - Private

    private func writeStatusFile() {
        guard let statusFileURL = statusFileURL else {
            NSLog("⚠️ StatusWriter: Cannot write status - no status file URL")
            return
        }

        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            let data = try encoder.encode(currentStatuses)
            try data.write(to: statusFileURL, options: .atomic)
            // NSLog("✅ StatusWriter: Wrote status for \(currentStatuses.count) domains")
        } catch {
            NSLog("⚠️ StatusWriter: Failed to write status file: \(error)")
        }
    }
}
