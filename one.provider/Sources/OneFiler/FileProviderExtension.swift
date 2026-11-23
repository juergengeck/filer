import FileProvider
import OneFilerCore
import UniformTypeIdentifiers
import os.log

@available(macOS 11.0, *)
@objc(FileProviderExtension)
class FileProviderExtension: NSObject, NSFileProviderReplicatedExtension, NSFileProviderCustomAction {

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
            do {
                return try await connect()
            } catch {
                NSLog("OneFiler: Failed to connect to ONE instance: \(error)")
                throw NSFileProviderError(.serverUnreachable)
            }
        }

        private func connect() async throws -> ONEBridge {
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
    private let reads: OneFilerCore.FileProviderExtension
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
        let bridgeManager = BridgeManager(
            context: BridgeSetupContext(
                domainDisplayName: domain.displayName,
                domainIdentifier: domain.identifier.rawValue,
                appGroupIdentifier: "group.one.filer",
                debugLogger: self.debugLogger,
                statusWriter: self.statusWriter
            )
        )

        self.bridgeManager = bridgeManager
        self.reads = OneFilerCore.FileProviderExtension { [weak bridgeManager] in
            guard let bridgeManager else { throw NSFileProviderError(.serverUnreachable) }
            return try await bridgeManager.getBridge()
        }

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

    // MARK: - Shared File Provider reads

    func item(
        for identifier: NSFileProviderItemIdentifier,
        request: NSFileProviderRequest,
        completionHandler: @escaping (NSFileProviderItem?, Error?) -> Void
    ) -> Progress {
        reads.item(for: identifier, completionHandler: completionHandler)
    }

    func fetchContents(
        for itemIdentifier: NSFileProviderItemIdentifier,
        version requestedVersion: NSFileProviderItemVersion?,
        request: NSFileProviderRequest,
        completionHandler: @escaping (URL?, NSFileProviderItem?, Error?) -> Void
    ) -> Progress {
        reads.fetchContents(for: itemIdentifier, version: requestedVersion, completionHandler: completionHandler)
    }

    func enumerator(
        for containerItemIdentifier: NSFileProviderItemIdentifier,
        request: NSFileProviderRequest
    ) throws -> NSFileProviderEnumerator {
        reads.enumerator(for: containerItemIdentifier)
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
                let bridge = try await bridgeManager.getBridge()
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
                let bridge = try await bridgeManager.getBridge()

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
                let bridge = try await bridgeManager.getBridge()
                try await bridge.deleteObject(id: identifier.rawValue)
                completionHandler(nil)
                progress.completedUnitCount = 1
            } catch {
                completionHandler(error)
            }
        }

        return progress
    }

    // MARK: - Custom Actions

    func performAction(
        identifier actionIdentifier: NSFileProviderExtensionActionIdentifier,
        onItemsWithIdentifiers itemIdentifiers: [NSFileProviderItemIdentifier],
        completionHandler: @escaping (Error?) -> Void
    ) -> Progress {
        let progress = Progress(totalUnitCount: 1)

        let task = Task {
            do {
                let bridge = try await bridgeManager.getBridge()
                try Task.checkCancellation()
                try await bridge.performAction(
                    identifier: actionIdentifier.rawValue,
                    itemIdentifiers: itemIdentifiers.map(\.rawValue)
                )
                // Mount state changed server-side; ask Finder to re-enumerate
                // the working set and each acted item so an open window,
                // badges, and action availability update together.
                if let manager = NSFileProviderManager(for: self.domain) {
                    manager.signalEnumerator(for: .workingSet) { _ in
                        for acted in itemIdentifiers {
                            manager.signalEnumerator(for: acted) { _ in }
                        }
                        completionHandler(nil)
                        progress.completedUnitCount = 1
                    }
                } else {
                    logger.error("performAction: no FileProviderManager for domain, skipping re-enumeration")
                    completionHandler(nil)
                    progress.completedUnitCount = 1
                }
            } catch is CancellationError {
                completionHandler(CocoaError(.userCancelled))
            } catch {
                logger.error("performAction \(actionIdentifier.rawValue) failed: \(error.localizedDescription)")
                completionHandler(error)
            }
        }
        progress.cancellationHandler = { task.cancel() }

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
