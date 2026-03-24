import FileProvider
import os.log

// MARK: - Root Enumerator

class RootEnumerator: NSObject, NSFileProviderEnumerator {

    private weak var fileProviderExtension: FileProviderExtension?
    private var currentAnchor: Data?
    private let logger = Logger(subsystem: "one.filer", category: "RootEnum")

    init(extension: FileProviderExtension) {
        self.fileProviderExtension = `extension`
        super.init()
        logger.info("🎯 RootEnumerator CREATED")
    }

    func invalidate() {
        logger.info("❌ RootEnumerator INVALIDATED")
        // Cancel any ongoing operations
    }

    func enumerateItems(
        for observer: NSFileProviderEnumerationObserver,
        startingAt page: NSFileProviderPage
    ) {
        logger.info("🔄 ROOT ENUMERATE ITEMS CALLED")
        Task {
            logger.info("  → Getting standard folders...")
            // Return standard top-level folders
            let items = FileProviderItem.standardFolders()
            logger.info("  → Got \(items.count) folders")
            observer.didEnumerate(items)
            logger.info("  → Finishing enumeration")
            observer.finishEnumerating(upTo: nil)
            logger.info("✅ ROOT ENUMERATE COMPLETE")
        }
    }
    
    func enumerateChanges(
        for observer: NSFileProviderChangeObserver,
        from anchor: NSFileProviderSyncAnchor
    ) {
        // Root-level synthetic folders never change
        // Report no changes and use the same anchor
        logger.info("🔄 ROOT ENUMERATE CHANGES (no changes - synthetic folders)")
        observer.finishEnumeratingChanges(upTo: anchor, moreComing: false)
    }

    func currentSyncAnchor(completionHandler: @escaping (NSFileProviderSyncAnchor?) -> Void) {
        // Root-level synthetic folders never change, return fixed anchor
        logger.info("📍 ROOT CURRENT SYNC ANCHOR (fixed)")
        let fixedAnchor = NSFileProviderSyncAnchor("root-v1".data(using: .utf8)!)
        completionHandler(fixedAnchor)
    }
}

// MARK: - Objects Enumerator

class ObjectsEnumerator: NSObject, NSFileProviderEnumerator {

    private weak var fileProviderExtension: FileProviderExtension?
    private let containerIdentifier: NSFileProviderItemIdentifier

    init(extension: FileProviderExtension, containerIdentifier: NSFileProviderItemIdentifier) {
        self.fileProviderExtension = `extension`
        self.containerIdentifier = containerIdentifier
        super.init()
    }

    func invalidate() {
        // Cancel any ongoing operations
    }

    func enumerateItems(
        for observer: NSFileProviderEnumerationObserver,
        startingAt page: NSFileProviderPage
    ) {
        Task {
            do {
                guard let ext = self.fileProviderExtension else {
                    throw NSFileProviderError(.serverUnreachable)
                }
                let bridge = try await ext.getBridge()

                // Get children from ONE database
                let children = try await bridge.getChildren(parentId: containerIdentifier.rawValue)
                let items = children.map { FileProviderItem(oneObject: $0) }

                observer.didEnumerate(items)
                observer.finishEnumerating(upTo: nil)

            } catch {
                observer.finishEnumeratingWithError(error)
            }
        }
    }
    
    func enumerateChanges(
        for observer: NSFileProviderChangeObserver,
        from anchor: NSFileProviderSyncAnchor
    ) {
        // For now, don't track changes in subfolders
        // Future: Implement per-folder change tracking
        observer.finishEnumeratingChanges(upTo: anchor, moreComing: false)
    }
}

// MARK: - Generic Enumerator (for other folders)

class GenericEnumerator: NSObject, NSFileProviderEnumerator {

    private weak var fileProviderExtension: FileProviderExtension?
    private let containerIdentifier: NSFileProviderItemIdentifier
    private let logger = Logger(subsystem: "one.filer", category: "GenericEnum")

    init(extension: FileProviderExtension, containerIdentifier: NSFileProviderItemIdentifier) {
        self.fileProviderExtension = `extension`
        self.containerIdentifier = containerIdentifier
        super.init()
        logger.info("🎯 GenericEnumerator CREATED for: \(containerIdentifier.rawValue)")
    }

    func invalidate() {
        logger.info("❌ GenericEnumerator INVALIDATED for: \(self.containerIdentifier.rawValue)")
        // Cancel any ongoing operations
    }

    func enumerateItems(
        for observer: NSFileProviderEnumerationObserver,
        startingAt page: NSFileProviderPage
    ) {
        logger.info("🔄 ENUMERATE ITEMS for: \(self.containerIdentifier.rawValue)")
        Task {
            do {
                logger.info("  → Getting extension...")
                guard let ext = self.fileProviderExtension else {
                    logger.error("  ❌ Extension is nil!")
                    throw NSFileProviderError(.serverUnreachable)
                }
                logger.info("  → Getting bridge...")
                let bridge = try await ext.getBridge()
                logger.info("  → Got bridge, calling getChildren...")

                // Get children from ONE database
                let children = try await bridge.getChildren(parentId: self.containerIdentifier.rawValue)
                logger.info("  → Got \(children.count) children from IPC")
                let items = children.map { FileProviderItem(oneObject: $0) }
                logger.info("  → Converted to \(items.count) FileProviderItems")

                observer.didEnumerate(items)
                logger.info("  → Called didEnumerate with \(items.count) items")
                observer.finishEnumerating(upTo: nil)
                logger.info("✅ ENUMERATE COMPLETE for: \(self.containerIdentifier.rawValue)")

            } catch {
                logger.error("❌ ENUMERATE FAILED for \(self.containerIdentifier.rawValue): \(error.localizedDescription)")
                observer.finishEnumeratingWithError(error)
            }
        }
    }
    
    func enumerateChanges(
        for observer: NSFileProviderChangeObserver,
        from anchor: NSFileProviderSyncAnchor
    ) {
        // For now, don't track changes in subfolders
        observer.finishEnumeratingChanges(upTo: anchor, moreComing: false)
    }
}