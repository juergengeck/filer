import FileProvider
import UniformTypeIdentifiers
import os.log

@available(macOS 11.0, *)
@objc(FileProviderExtension)
class FileProviderExtension: NSObject, NSFileProviderReplicatedExtension {

    private struct BridgeSetupContext: Sendable {
        let domainDisplayName: String
        let domainIdentifier: String
        let appGroupIdentifier: String
        let debugLogger: DebugLogger
        let statusWriter: StatusWriter
    }

    private actor BridgeManager {
        private let context: BridgeSetupContext
        private var bridge: ONEBridge?
        private var bridgeTask: Task<ONEBridge, Error>?

        init(context: BridgeSetupContext) {
            self.context = context
        }

        func getBridge() async throws -> ONEBridge {
            if let bridge {
                return bridge
            }

            if let bridgeTask {
                return try await bridgeTask.value
            }

            let task = Task<ONEBridge, Error> {
                try await FileProviderExtension.setupBridge(using: self.context)
            }
            bridgeTask = task

            do {
                let bridge = try await task.value
                self.bridge = bridge
                self.bridgeTask = nil
                return bridge
            } catch {
                self.bridgeTask = nil
                throw error
            }
        }

        func invalidate() async {
            let activeTask = bridgeTask
            let activeBridge = bridge

            bridgeTask = nil
            bridge = nil

            activeTask?.cancel()
            if let activeTask {
                let connectingBridge = try? await activeTask.value
                await connectingBridge?.disconnect()
            }
            await activeBridge?.disconnect()
        }
    }

    private let domain: NSFileProviderDomain
    private let bridgeManager: BridgeManager
    private let logger = Logger(subsystem: "one.filer", category: "Extension")
    private let debugLogger: DebugLogger
    private let statusWriter: StatusWriter

    required init(domain: NSFileProviderDomain) {
        logger.info("🚀 EXTENSION INIT: domain=\(domain.displayName)")
        NSLog("OneFiler Extension: init() called for domain: \(domain.displayName)")
        self.domain = domain

        // Initialize debug logger (must succeed or throw)
        do {
            self.debugLogger = try DebugLogger(component: "extension")
        } catch {
            NSLog("OneFiler Extension: FATAL - Failed to initialize debug logger: \(error)")
            fatalError("Failed to initialize debug logger: \(error)")
        }
        self.statusWriter = StatusWriter()
        self.bridgeManager = BridgeManager(
            context: BridgeSetupContext(
                domainDisplayName: domain.displayName,
                domainIdentifier: domain.identifier.rawValue,
                appGroupIdentifier: "group.one.filer",
                debugLogger: self.debugLogger,
                statusWriter: self.statusWriter
            )
        )

        super.init()

        Task {
            await debugLogger.info("=== Extension Initialized ===")
            await debugLogger.info("Domain: \(domain.displayName)")
            await debugLogger.info("Domain identifier: \(domain.identifier.rawValue)")

            // Write initial status
            await statusWriter.updateStatus(
                domain: domain.identifier.rawValue,
                state: "disconnected"
            )
        }

        logger.info("✅ EXTENSION INIT COMPLETE")
        NSLog("OneFiler Extension: init() completed - bridge will initialize on first use")
    }

    private static func setupBridge(using context: BridgeSetupContext) async throws -> ONEBridge {
        let bridge = try ONEBridge(config: ONEInstanceConfig(name: context.domainIdentifier))
        try await bridge.connect()
        // Update status to connected
        await context.statusWriter.updateStatus(
            domain: context.domainIdentifier,
            state: "connected"
        )

        return bridge
    }

    internal func getBridge() async throws -> ONEBridge {
        do {
            return try await bridgeManager.getBridge()
        } catch {
            NSLog("OneFiler: Failed to connect to ONE instance: \(error)")
            throw NSFileProviderError(.serverUnreachable)
        }
    }
    
    // MARK: - Invalidation

    func invalidate() {
        Task {
            await debugLogger.info("=== Extension Invalidate Called ===")

            // Update status to disconnected
            await statusWriter.updateStatus(
                domain: domain.identifier.rawValue,
                state: "disconnected"
            )

            await bridgeManager.invalidate()
            await debugLogger.info("=== Extension Invalidate Completed ===")
        }
    }
    
    // MARK: - Item Management

    func item(
        for identifier: NSFileProviderItemIdentifier,
        request: NSFileProviderRequest,
        completionHandler: @escaping (NSFileProviderItem?, Error?) -> Void
    ) -> Progress {
        logger.info("📁 ITEM REQUESTED: id=\(identifier.rawValue)")
        let progress = Progress(totalUnitCount: 1)

        Task {
            do {
                logger.info("🔌 Getting bridge...")
                await debugLogger.info("item(for:): Getting bridge for \(identifier.rawValue)")
                let bridge = try await getBridge()
                logger.info("🔍 Fetching item...")
                await debugLogger.info("item(for:): Fetching item for \(identifier.rawValue)")
                let item = try await fetchItem(for: identifier, using: bridge)
                logger.info("✅ Item fetched successfully")
                await debugLogger.info("item(for:): Item fetched successfully for \(identifier.rawValue)")
                completionHandler(item, nil)
                progress.completedUnitCount = 1
            } catch {
                logger.error("❌ ITEM FETCH FAILED: \(error.localizedDescription)")
                NSLog("🔥🔥🔥 ITEM FETCH ERROR: \(error)")
                await debugLogger.error("Item fetch failed for \(identifier.rawValue): \(error)")
                completionHandler(nil, error)
            }
        }

        return progress
    }
    
    private func fetchItem(for identifier: NSFileProviderItemIdentifier, using bridge: ONEBridge) async throws -> NSFileProviderItem {
        // Handle special identifiers
        if identifier == .rootContainer {
            return FileProviderItem.rootItem()
        }

        // Reject system identifiers we don't support
        if identifier == .trashContainer {
            logger.info("Rejecting trash container request - not supported")
            throw NSFileProviderError(.noSuchItem)
        }

        if identifier == .workingSet {
            logger.info("Rejecting working set request - not supported")
            throw NSFileProviderError(.noSuchItem)
        }

        // Fetch from ONE database
        let oneObject = try await bridge.getObject(id: identifier.rawValue)
        return FileProviderItem(oneObject: oneObject)
    }
    
    // MARK: - Content Fetching
    
    func fetchContents(
        for itemIdentifier: NSFileProviderItemIdentifier,
        version requestedVersion: NSFileProviderItemVersion?,
        request: NSFileProviderRequest,
        completionHandler: @escaping (URL?, NSFileProviderItem?, Error?) -> Void
    ) -> Progress {
        logger.info("📥 FETCH CONTENTS: item=\(itemIdentifier.rawValue)")
        NSLog("🔥🔥🔥 FETCH CONTENTS CALLED: \(itemIdentifier.rawValue)")

        let progress = Progress(totalUnitCount: 100)

        Task {
            do {
                await debugLogger.info("fetchContents: Getting bridge...")
                let bridge = try await getBridge()

                // Get object metadata
                await debugLogger.info("fetchContents: Getting object metadata for \(itemIdentifier.rawValue)")
                let object = try await bridge.getObject(id: itemIdentifier.rawValue)

                if let requestedVersion, !object.contentHash.isEmpty,
                   requestedVersion.contentVersion != Data(object.contentHash.utf8) {
                    throw NSFileProviderError(.versionNoLongerAvailable)
                }

                // Create temporary file
                let tempDir = FileManager.default.temporaryDirectory
                let tempURL = tempDir.appendingPathComponent(UUID().uuidString)
                    .appendingPathExtension(object.fileExtension ?? "dat")

                await debugLogger.info("fetchContents: Created temp file at \(tempURL.path)")

                // Read content from ONE database
                await debugLogger.info("fetchContents: Reading content...")
                try await bridge.copyContent(id: object.id, to: tempURL, size: object.size, progress: progress, version: object.contentHash)
                await debugLogger.info("fetchContents: Wrote to temp file")

                // Return file and updated item
                let item = FileProviderItem(oneObject: object)
                logger.info("📥 FETCH CONTENTS SUCCESS: \(tempURL.path)")
                NSLog("🔥🔥🔥 FETCH CONTENTS SUCCESS: \(tempURL.path)")
                completionHandler(tempURL, item, nil)
                progress.completedUnitCount = progress.totalUnitCount

            } catch {
                logger.error("📥 FETCH CONTENTS FAILED: \(error.localizedDescription)")
                NSLog("🔥🔥🔥 FETCH CONTENTS ERROR: \(error)")
                await debugLogger.error("fetchContents failed: \(error)")
                completionHandler(nil, nil, error)
            }
        }

        return progress
    }
    
    // MARK: - Enumeration
    
    func enumerator(
        for containerItemIdentifier: NSFileProviderItemIdentifier,
        request: NSFileProviderRequest
    ) throws -> NSFileProviderEnumerator {
        logger.info("📂 ENUMERATOR REQUESTED: container=\(containerItemIdentifier.rawValue)")
        NSLog("🔥🔥🔥 ENUMERATOR FACTORY: Creating enumerator for \(containerItemIdentifier.rawValue)")

        let container: String
        switch containerItemIdentifier {
        case .rootContainer: container = "root"
        case .workingSet: container = "workingSet"
        default: container = containerItemIdentifier.rawValue
        }
        return FilerEnumerator(container: container) { [weak self] in
            guard let self else { throw NSFileProviderError(.serverUnreachable) }
            return try await self.getBridge()
        }
    }
    

    // MARK: - Creation

    func createItem(
        basedOn itemTemplate: NSFileProviderItem,
        fields: NSFileProviderItemFields,
        contents url: URL?,
        options: NSFileProviderCreateItemOptions = [],
        request: NSFileProviderRequest,
        completionHandler: @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?) -> Void
    ) -> Progress {
        let progress = Progress(totalUnitCount: 1)

        Task {
            do {
                let bridge = try await getBridge()
                let parent = itemTemplate.parentItemIdentifier == .rootContainer
                    ? "/" : itemTemplate.parentItemIdentifier.rawValue
                let data = try url.map { try Data(contentsOf: $0) }
                if options.contains(.mayAlreadyExist), let existing = try await bridge.reconcileImportedItem(
                    parentId: parent, name: itemTemplate.filename, data: data,
                    isDirectory: itemTemplate.contentType == .folder
                ) {
                    completionHandler(FileProviderItem(oneObject: existing), [], false, nil)
                    progress.completedUnitCount = 1
                    return
                }
                let object = try await bridge.createItem(
                    parentId: parent, name: itemTemplate.filename, data: data,
                    isDirectory: itemTemplate.contentType == .folder
                )
                completionHandler(FileProviderItem(oneObject: object), [], false, nil)
                progress.completedUnitCount = 1
            } catch {
                completionHandler(nil, fields, false, error)
            }
        }

        return progress
    }

    // MARK: - Modification

    func modifyItem(
        _ item: NSFileProviderItem,
        baseVersion: NSFileProviderItemVersion,
        changedFields: NSFileProviderItemFields,
        contents contentsURL: URL?,
        options: NSFileProviderModifyItemOptions = [],
        request: NSFileProviderRequest,
        completionHandler: @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?) -> Void
    ) -> Progress {
        let progress = Progress(totalUnitCount: 100)

        Task {
            do {
                let bridge = try await getBridge()

                let stillPendingFields = NSFileProviderItemFields()
                var acceptedContentVersion: String?

                // Handle content changes
                if changedFields.contains(.contents), let url = contentsURL {
                    let data = try Data(contentsOf: url)
                    acceptedContentVersion = try await bridge.writeContent(
                        id: item.itemIdentifier.rawValue,
                        data: data,
                        baseVersion: baseVersion.contentVersion
                    )
                    progress.completedUnitCount = 80
                }

                // Handle rename
                if changedFields.contains(.filename) {
                    try await bridge.rename(id: item.itemIdentifier.rawValue, newName: item.filename)
                    progress.completedUnitCount = 90
                }

                // Get updated item
                let updatedObject = try await bridge.getObject(id: item.itemIdentifier.rawValue)
                if let acceptedContentVersion, updatedObject.contentHash != acceptedContentVersion {
                    throw ONEBridgeError.invalidResponse
                }
                let updatedItem = FileProviderItem(oneObject: updatedObject)

                completionHandler(updatedItem, stillPendingFields, false, nil)
                progress.completedUnitCount = 100

            } catch {
                completionHandler(nil, NSFileProviderItemFields(), false, error)
            }
        }

        return progress
    }
    
    // MARK: - Deletion
    
    func deleteItem(
        identifier: NSFileProviderItemIdentifier,
        baseVersion: NSFileProviderItemVersion,
        options: NSFileProviderDeleteItemOptions,
        request: NSFileProviderRequest,
        completionHandler: @escaping (Error?) -> Void
    ) -> Progress {
        let progress = Progress(totalUnitCount: 1)

        Task {
            do {
                let bridge = try await getBridge()
                try await bridge.deleteObject(id: identifier.rawValue)
                completionHandler(nil)
                progress.completedUnitCount = 1
            } catch {
                completionHandler(error)
            }
        }

        return progress
    }

    // MARK: - Materialization

    func materializedItemsDidChange(completionHandler: @escaping () -> Void) {
        completionHandler()
    }

    // MARK: - Import (Required by NSFileProviderReplicatedExtension)

    func importDidFinish(completionHandler: @escaping () -> Void) {
        NSLog("OneFiler: importDidFinish called")
        completionHandler()
    }

    // MARK: - Synchronization Anchor (Required)

    func currentSyncAnchor(completionHandler: @escaping (Data?) -> Void) {
        NSLog("OneFiler: currentSyncAnchor requested")
        // Return nil for now - this means "no changes to track"
        completionHandler(nil)
    }
}
