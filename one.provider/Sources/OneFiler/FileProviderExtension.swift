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

    struct DomainConfig: Codable {
        let path: String
        let email: String?
        let secret: String?
        let name: String?
    }

    private static func setupBridge(using context: BridgeSetupContext) async throws -> ONEBridge {
        await context.debugLogger.info("=== Setup Bridge Started ===")

        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: context.appGroupIdentifier
        ) else {
            NSLog("OneFiler: Failed to get App Group container URL")
            await context.debugLogger.critical("Failed to get App Group container URL")
            throw NSFileProviderError(.serverUnreachable)
        }

        await context.debugLogger.debug("App Group container: \(containerURL.path)")

        let configURL = containerURL.appendingPathComponent("domains.json")

        guard FileManager.default.fileExists(atPath: configURL.path) else {
            NSLog("OneFiler: domains.json not found at \(configURL.path)")
            await context.debugLogger.error("domains.json not found at \(configURL.path)")
            throw NSFileProviderError(.serverUnreachable)
        }

        let data = try Data(contentsOf: configURL)
        let allConfigs = try JSONDecoder().decode([String: DomainConfig].self, from: data)

        await context.debugLogger.debug("Found \(allConfigs.count) domain configs")

        guard let domainConfig = allConfigs[context.domainIdentifier] else {
            NSLog("OneFiler: Domain \(context.domainIdentifier) not found in domains.json")
            await context.debugLogger.error(
                "Domain \(context.domainIdentifier) not found in domains.json"
            )
            throw NSFileProviderError(.serverUnreachable)
        }

        NSLog("OneFiler: Found registered instance path: \(domainConfig.path)")
        await context.debugLogger.info("Found registered instance path: \(domainConfig.path)")
        if domainConfig.email != nil {
            NSLog("OneFiler: Found credentials in config")
            await context.debugLogger.debug("Found credentials in config")
        }

        let config = ONEInstanceConfig(
            name: context.domainDisplayName,
            directory: domainConfig.path,
            email: domainConfig.email,
            secret: domainConfig.secret,
            instanceName: domainConfig.name
        )

        await context.debugLogger.info("Creating ONEBridge...")
        let bridge = try ONEBridge(config: config)
        await context.debugLogger.info("Connecting ONEBridge...")
        try await bridge.connect()
        NSLog("OneFiler: Connected to ONE instance at \(domainConfig.path)")
        await context.debugLogger.info("Connected to ONE instance at \(domainConfig.path)")
        await context.debugLogger.info("=== Setup Bridge Completed ===")

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

        // Handle synthetic top-level folders (don't go to Node.js for these)
        let syntheticFolders = ["chats", "debug", "invites", "objects", "profiles", "questionnaires", "types"]
        if syntheticFolders.contains(identifier.rawValue) {
            if let folder = FileProviderItem.standardFolders().first(where: { $0.itemIdentifier == identifier }) {
                return folder
            }
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

                // Create temporary file
                let tempDir = FileManager.default.temporaryDirectory
                let tempURL = tempDir.appendingPathComponent(UUID().uuidString)
                    .appendingPathExtension(object.fileExtension ?? "dat")

                await debugLogger.info("fetchContents: Created temp file at \(tempURL.path)")

                // Read content from ONE database
                await debugLogger.info("fetchContents: Reading content...")
                let content = try await bridge.readContent(id: object.id)
                await debugLogger.info("fetchContents: Got \(content.count) bytes")

                try content.write(to: tempURL)
                await debugLogger.info("fetchContents: Wrote to temp file")

                // Return file and updated item
                let item = FileProviderItem(oneObject: object)
                logger.info("📥 FETCH CONTENTS SUCCESS: \(tempURL.path)")
                NSLog("🔥🔥🔥 FETCH CONTENTS SUCCESS: \(tempURL.path)")
                completionHandler(tempURL, item, nil)
                progress.completedUnitCount = 100

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

        // Return appropriate enumerator based on container
        // The enumerator itself will wait for bridge to be ready
        switch containerItemIdentifier {
        case .rootContainer:
            logger.info("  → Creating RootEnumerator")
            NSLog("🔥🔥🔥 ENUMERATOR TYPE: RootEnumerator")
            return RootEnumerator(extension: self)

        case .workingSet:
            NSLog("🔥🔥🔥 ENUMERATOR TYPE: WorkingSetEnumerator (empty)")
            // Return empty enumerator for working set - we don't track recently accessed files yet
            return RootEnumerator(extension: self)  // Temporarily use RootEnumerator

        case let id where id.rawValue == "objects" || id.rawValue.hasPrefix("objects/"):
            NSLog("🔥🔥🔥 ENUMERATOR TYPE: ObjectsEnumerator for \(id.rawValue)")
            return ObjectsEnumerator(extension: self, containerIdentifier: containerItemIdentifier)

        case let id where id.rawValue == "chats" || id.rawValue.hasPrefix("chats/"):
            NSLog("🔥🔥🔥 ENUMERATOR TYPE: GenericEnumerator(chats) for \(id.rawValue)")
            return GenericEnumerator(extension: self, containerIdentifier: containerItemIdentifier)

        case let id where id.rawValue == "types" || id.rawValue.hasPrefix("types/"):
            NSLog("🔥🔥🔥 ENUMERATOR TYPE: GenericEnumerator(types) for \(id.rawValue)")
            return GenericEnumerator(extension: self, containerIdentifier: containerItemIdentifier)

        case let id where id.rawValue == "invites" || id.rawValue.hasPrefix("invites/"):
            NSLog("🔥🔥🔥 ENUMERATOR TYPE: GenericEnumerator(invites) for \(id.rawValue)")
            return GenericEnumerator(extension: self, containerIdentifier: containerItemIdentifier)

        case let id where id.rawValue == "debug" || id.rawValue.hasPrefix("debug/"):
            NSLog("🔥🔥🔥 ENUMERATOR TYPE: GenericEnumerator(debug) for \(id.rawValue)")
            return GenericEnumerator(extension: self, containerIdentifier: containerItemIdentifier)

        case let id where id.rawValue == "profiles" || id.rawValue.hasPrefix("profiles/"):
            NSLog("🔥🔥🔥 ENUMERATOR TYPE: GenericEnumerator(profiles) for \(id.rawValue)")
            return GenericEnumerator(extension: self, containerIdentifier: containerItemIdentifier)

        case let id where id.rawValue == "questionnaires" || id.rawValue.hasPrefix("questionnaires/"):
            NSLog("🔥🔥🔥 ENUMERATOR TYPE: GenericEnumerator(questionnaires) for \(id.rawValue)")
            return GenericEnumerator(extension: self, containerIdentifier: containerItemIdentifier)

        default:
            NSLog("🔥🔥🔥 ENUMERATOR ERROR: No match for \(containerItemIdentifier.rawValue)")
            throw NSFileProviderError(.noSuchItem)
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

        // TODO: Implement item creation
        completionHandler(nil, NSFileProviderItemFields(), false, NSFileProviderError(.notAuthenticated))

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

                // Handle content changes
                if changedFields.contains(.contents), let url = contentsURL {
                    let data = try Data(contentsOf: url)
                    try await bridge.writeContent(id: item.itemIdentifier.rawValue, data: data)
                    progress.completedUnitCount = 80
                }

                // Handle rename
                if changedFields.contains(.filename) {
                    try await bridge.rename(id: item.itemIdentifier.rawValue, newName: item.filename)
                    progress.completedUnitCount = 90
                }

                // Get updated item
                let updatedObject = try await bridge.getObject(id: item.itemIdentifier.rawValue)
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
