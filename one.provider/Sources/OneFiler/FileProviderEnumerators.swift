import FileProvider

/// Enumerate owner-produced snapshots and resumable changes for one stable container.
final class FilerEnumerator: NSObject, NSFileProviderEnumerator {
    private let container: String
    private let folderLanguage = FilerFolderNames.language(for: Locale.preferredLanguages)
    private let bridge: () async throws -> ONEBridge
    private let state = NSLock()
    private var tasks: [UUID: Task<Void, Never>] = [:]

    init(container: String, bridge: @escaping () async throws -> ONEBridge) {
        self.container = container
        self.bridge = bridge
        super.init()
    }

    func invalidate() {
        let active = state.withLock { let active = Array(tasks.values); tasks.removeAll(); return active }
        for task in active { task.cancel() }
    }

    /// Retain only active work, including when File Provider calls from different queues.
    private func start(_ operation: @escaping () async -> Void) {
        let id = UUID()
        state.withLock {
            tasks[id] = Task {
                await operation()
                _ = self.state.withLock { self.tasks.removeValue(forKey: id) }
            }
        }
    }

    func enumerateItems(for observer: NSFileProviderEnumerationObserver, startingAt page: NSFileProviderPage) {
        start { [self] in
            do {
                let client = try await bridge()
                let initial = page.rawValue == (NSFileProviderPage.initialPageSortedByName as Data) ||
                    page.rawValue == (NSFileProviderPage.initialPageSortedByDate as Data)
                let token = initial ? nil : page.rawValue
                let result = try await client.enumerateItems(container: container, page: token)
                try Task.checkCancellation()
                observer.didEnumerate(result.items.map { FileProviderItem(oneObject: $0, languages: [folderLanguage]) })
                observer.finishEnumerating(upTo: result.nextPage.map { NSFileProviderPage($0) })
            } catch { observer.finishEnumeratingWithError(error) }
        }
    }

    func enumerateChanges(for observer: NSFileProviderChangeObserver, from anchor: NSFileProviderSyncAnchor) {
        start { [self] in
            do {
                let client = try await bridge()
                let sourceAnchor = try sourceAnchor(anchor.rawValue)
                let result = try await client.getChanges(container: container, since: sourceAnchor)
                try Task.checkCancellation()
                observer.didDeleteItems(withIdentifiers: result.deleted.map { NSFileProviderItemIdentifier($0) })
                observer.didUpdate(result.updated.map { FileProviderItem(oneObject: $0, languages: [folderLanguage]) })
                observer.finishEnumeratingChanges(upTo: NSFileProviderSyncAnchor(displayAnchor(result.newAnchor)), moreComing: result.moreComing)
            } catch { observer.finishEnumeratingWithError(error) }
        }
    }

    /// Include display language in anchors for containers that enumerate owned folder labels.
    private var anchorPrefix: Data {
        ["root", "workingSet", "ONE", "/ONE", "ONE/System", "/ONE/System"].contains(container)
            ? Data("filer-folders-v1:\(folderLanguage):".utf8) : Data()
    }

    private func displayAnchor(_ source: Data) -> Data {
        anchorPrefix + source
    }

    /// Expire older or differently localized snapshots so Finder rebuilds its cached names.
    private func sourceAnchor(_ displayed: Data) throws -> Data {
        let prefix = anchorPrefix
        guard displayed.starts(with: prefix) else { throw NSFileProviderError(.syncAnchorExpired) }
        return Data(displayed.dropFirst(prefix.count))
    }

    func currentSyncAnchor(completionHandler: @escaping (NSFileProviderSyncAnchor?) -> Void) {
        start { [self] in
            do {
                let client = try await bridge()
                let anchor = try await client.getCurrentAnchor(container: container)
                try Task.checkCancellation()
                completionHandler(NSFileProviderSyncAnchor(displayAnchor(anchor)))
            } catch { completionHandler(nil) }
        }
    }
}
