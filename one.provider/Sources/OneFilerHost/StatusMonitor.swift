/// A one-shot snapshot of local runtime ownership for the menu.
/// Opening the menu replaces this snapshot; no legacy status file or timer is used.
struct StatusMonitor {
    let states: [String: RuntimePool.State]
    let errorDescription: String?

    init(states: [String: RuntimePool.State] = [:], errorDescription: String? = nil) {
        self.states = states
        self.errorDescription = errorDescription
    }

    func getStatus(for domain: String) -> String {
        if errorDescription != nil { return "Unavailable" }
        return states[domain]?.rawValue ?? "Checking…"
    }
}
