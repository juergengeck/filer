import Foundation
import FileProvider
import os.log

// MARK: - Data Types

public struct ONEInstanceConfig {
    public let name: String
    public init(name: String) { self.name = name }
}

public struct ONEObject {
    public let id: String
    public let name: String
    public let type: ObjectType
    public var path: String?
    public var size: Int = 0
    public var modified: Date? = Date()
    public var created: Date?
    public var accessed: Date?
    public var parentId: String?
    public var contentHash: String = ""
    public var metadataHash: String = ""
    public var sha256Hash: String?
    public var typeId: String?
    public var mimeType: String?
    public var thumbnail: Data?
    public var permissions: Set<Permission> = [.read]
    public var downloadOnDemand: Bool = false

    public var fileExtension: String? {
        guard type == .file else { return nil }
        let components = name.split(separator: ".")
        guard components.count > 1 else { return nil }
        return String(components.last!)
    }

    public init(id: String, name: String, type: ObjectType, size: Int = 0, modified: Date? = Date(), parentId: String? = nil) {
        self.id = id
        self.name = name
        self.type = type
        self.size = size
        self.modified = modified
        self.parentId = parentId
    }

    public enum ObjectType {
        case file
        case folder
    }

    public enum Permission {
        case read
        case write
        case delete
    }
}

public struct ONEChanges {
    public let updated: [ONEObject]
    public let deleted: [String]
    public let newAnchor: Data
    public let moreComing: Bool

    public init(updated: [ONEObject] = [], deleted: [String] = [], newAnchor: Data = Data(), moreComing: Bool = false) {
        self.updated = updated
        self.deleted = deleted
        self.newAnchor = newAnchor
        self.moreComing = moreComing
    }
}

/// Thin authenticated RPC client for the refinio.api-owned filesystem.
public actor ONEBridge {

    private let config: ONEInstanceConfig
    private let logger = Logger(subsystem: "one.filer", category: "ONEBridge")
    private let debugLogger: DebugLogger
    private let invoke: (Data) async throws -> Data
    private let close: () async -> Void
    private var requestId: Int = 0

    public init(config: ONEInstanceConfig, invoke: ((Data) async throws -> Data)? = nil,
                close: (() async -> Void)? = nil) throws {
        self.config = config
        self.debugLogger = try DebugLogger(component: "bridge")
        let client = PrivateRuntimeClient(domain: config.name)
        self.invoke = invoke ?? { try await client.invoke($0) }
        self.close = close ?? { await client.disconnect() }
    }

    // MARK: - Lifecycle

    public func connect() async throws {
        logger.info("Connecting to the app-owned refinio.api runtime")
        await debugLogger.info("=== ONEBridge Connect Started ===")
        await debugLogger.info("Transport: private authenticated socket and inherited pipes")
        let result = try await self.sendRequest(method: "ping", params: [:])
        if result["status"] as? String != "ok" {
            await debugLogger.error("Health check failed: invalid response")
            throw ONEBridgeError.invalidResponse
        }
        logger.info("refinio.api filesystem RPC connected")
        await debugLogger.info("refinio.api filesystem RPC connected")
        await debugLogger.info("=== ONEBridge Connect Completed ===")
    }

    public func disconnect() async {
        await close()
        logger.info("Disconnecting from refinio.api")
        await debugLogger.info("=== ONEBridge Disconnect Started ===")
        await debugLogger.info("=== ONEBridge Disconnect Completed ===")
    }

    // MARK: - IPC Communication

    private func sendRequest(method: String, params: [String: Any]) async throws -> [String: Any] {
        requestId += 1
        let id = requestId

        let request: [String: Any] = [
            "operation": "filer:\(method)", "request": params, "requestId": String(id)
        ]
        let data = try await invoke(JSONSerialization.data(withJSONObject: request))
        guard let response = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              response["requestId"] as? String == String(id) else {
            throw ONEBridgeError.invalidResponse
        }
        guard response["success"] as? Bool == true else {
            let failure = response["error"] as? [String: Any]
            throw NSError(domain: "one.filer.transport", code: 1,
                userInfo: [NSLocalizedDescriptionKey: failure?["message"] as? String ?? "Runtime operation failed"])
        }
        guard let json = response["result"] as? [String: Any] else { throw ONEBridgeError.invalidResponse }
        if let error = json["error"] as? [String: Any] {
            guard let message = error["message"] as? String,
                  let code = error["code"] as? Int else {
                throw ONEBridgeError.invalidResponse
            }
            await debugLogger.error("← RPC Error (id: \(id)): code=\(code)")
            throw DomainWriteError.fromRPC(code: code, message: message)
        }
        guard let result = json["result"] as? [String: Any] else {
            throw ONEBridgeError.invalidResponse
        }
        await debugLogger.debug("← RPC Response (id: \(id)): OK")
        return result
    }

    // MARK: - Public API

    public func getObject(id: String) async throws -> ONEObject {
        if id.hasPrefix("filer:") {
            return try decodeItem(await sendRequest(method: "getItem", params: ["id": id]))
        }
        // Normalize path: ensure it starts with /
        let normalizedPath = id.hasPrefix("/") ? id : "/\(id)"

        let result = try await sendRequest(method: "stat", params: ["path": normalizedPath])
        if let item = result["item"] as? [String: Any] { return try decodeItem(item) }
        guard let mode = result["mode"] as? Int, let size = result["size"] as? Int else {
            throw ONEBridgeError.invalidResponse
        }
        let isDirectory = (mode & 0o040000) != 0

        var obj = ONEObject(
            id: String(normalizedPath.dropFirst()),
            name: (normalizedPath as NSString).lastPathComponent,
            type: isDirectory ? .folder : .file,
            size: size
        )

        // Set parentId from the path
        // For "/invites/file.txt" → parentId = "invites"
        // For "/file.txt" → parentId = nil (root)
        let parentPath = (normalizedPath as NSString).deletingLastPathComponent
        if parentPath == "/" {
            // Direct child of root - parentId is nil (defaults to .rootContainer)
            obj.parentId = nil
        } else {
            // Remove leading slash to match synthetic folder IDs (e.g., "invites" not "/invites")
            obj.parentId = String(parentPath.dropFirst())
        }

        // Set permissions based on mode bits
        var permissions: Set<ONEObject.Permission> = []
        if (mode & 0o400) != 0 { // Owner read
            permissions.insert(.read)
        }
        if (mode & 0o200) != 0 { // Owner write
            permissions.insert(.write)
            permissions.insert(.delete)
        }
        obj.permissions = permissions
        obj.contentHash = result["contentHash"] as? String ?? ""
        obj.metadataHash = result["metadataHash"] as? String ?? ""
        obj.downloadOnDemand = result["downloadOnDemand"] as? Bool ?? false
        obj.mimeType = result["mimeType"] as? String

        // Set current date as modification/creation date (IFileSystem doesn't provide dates)
        let now = Date()
        obj.modified = now
        obj.created = now

        return obj
    }

    public func getChildren(parentId: String) async throws -> [ONEObject] {
        if parentId.hasPrefix("filer:") || parentId == "workingSet" {
            var result: [ONEObject] = []
            var page: Data?
            repeat {
                let batch = try await enumerateItems(container: parentId, page: page)
                result.append(contentsOf: batch.items); page = batch.nextPage
            } while page != nil
            return result
        }
        // Normalize path: ensure it starts with /
        let normalizedPath = parentId.hasPrefix("/") ? parentId : "/\(parentId)"

        logger.info("🔍 getChildren called for: \(parentId) (normalized: \(normalizedPath))")
        NSLog("🔥 ONEBridge.getChildren: parentId=\(parentId), normalized=\(normalizedPath)")

        let result = try await sendRequest(method: "readDir", params: ["path": normalizedPath])
        logger.info("  → readDir IPC completed")
        NSLog("🔥 ONEBridge.getChildren: readDir response received")

        guard let children = result["children"] as? [String] else {
            throw ONEBridgeError.invalidResponse
        }

        logger.info("  → Found \(children.count) children: \(children)")
        NSLog("🔥 ONEBridge.getChildren: Found \(children.count) children: \(children)")

        var objects: [ONEObject] = []
        for child in children {
            let childPath = normalizedPath == "/" ? "/\(child)" : "\(normalizedPath)/\(child)"
            var obj = try await getObject(id: childPath)
            if !obj.id.hasPrefix("filer:") {
                obj.parentId = normalizedPath == "/" ? nil : String(normalizedPath.dropFirst())
            }
            objects.append(obj)
        }

        logger.info("  → Returning \(objects.count) ONEObjects")
        NSLog("🔥 ONEBridge.getChildren: Returning \(objects.count) ONEObjects")
        return objects
    }

    public func readContent(id: String) async throws -> Data {
        // Normalize path: ensure it starts with /
        let normalizedPath = try await resolvePath(id)

        let result = try await sendRequest(method: "readFile", params: ["path": normalizedPath])
        guard let base64String = result["content"] as? String else {
            throw ONEBridgeError.invalidResponse
        }
        guard let data = Data(base64Encoded: base64String) else {
            throw ONEBridgeError.invalidResponse
        }
        return data
    }

    /// Hydrate directly to disk without retaining a model-sized RPC response in memory.
    public func copyContent(id: String, to destination: URL, size: Int, progress: Progress, version: String? = nil) async throws {
        let item = id.hasPrefix("filer:") ? try await getObject(id: id) : nil
        if let item, item.contentHash != version || item.size != size {
            throw DomainWriteError.fromRPC(code: -32022, message: "Requested content version is no longer current")
        }
        let normalizedPath = try await resolvePath(id)
        try await ContentHydration.write(to: destination, size: size, progress: progress) { length, position in
            let result: [String: Any]
            if let item {
                result = try await self.sendRequest(method: "readItemContent", params: [
                    "id": id, "version": item.contentHash, "length": length, "position": position])
            } else {
                result = try await self.sendRequest(method: "readFileInChunks", params: [
                    "path": normalizedPath, "length": length, "position": position])
            }
            guard let encoded = result["content"] as? String,
                  let bytes = Data(base64Encoded: encoded) else { throw ONEBridgeError.invalidResponse }
            return bytes
        }
    }

    @discardableResult
    public func writeContent(id: String, data: Data, baseVersion: Data? = nil) async throws -> String? {
        // Normalize path: ensure it starts with /
        let normalizedPath = try await resolvePath(id)

        logger.info("Writing \(data.count) bytes to \(normalizedPath)")
        let request = ContentWriteRequest(path: normalizedPath, content: data, baseVersion: baseVersion)
        let result = try await sendRequest(method: "writeFile", params: request.parameters)
        guard let status = result["status"] as? String else { throw ONEBridgeError.invalidResponse }
        if status == "ok" { return nil }
        guard status == "accepted" || status == "unchanged",
              let version = result["contentVersion"] as? String, !version.isEmpty,
              result["operationId"] as? String == request.operationId else {
            throw ONEBridgeError.invalidResponse
        }
        return version
    }

    /// Create an item through the owning filesystem and return its persisted metadata.
    public func createItem(parentId: String, name: String, data: Data?, isDirectory: Bool) async throws -> ONEObject {
        guard !name.isEmpty, !name.contains("/"), name != ".", name != ".." else {
            throw ONEBridgeError.operationFailed
        }
        let parentPath = try await resolvePath(parentId)
        let path = parentPath == "/" ? "/\(name)" : "\(parentPath)/\(name)"
        if isDirectory {
            _ = try await sendRequest(method: "createDir", params: ["path": path, "mode": 0o040755])
        } else {
            guard let data else { throw ONEBridgeError.operationFailed }
            try await writeContent(id: path, data: data)
        }
        return try await getObject(id: path)
    }

    /// Reconcile an OS reimport with the authoritative item without writing into a read-only mount.
    public func reconcileImportedItem(parentId: String, name: String, data: Data?, isDirectory: Bool) async throws -> ONEObject? {
        let parent = try await resolvePath(parentId)
        let path = parent == "/" ? "/\(name)" : "\(parent)/\(name)"
        let existing: ONEObject
        do { existing = try await getObject(id: path) }
        catch let error as NSError where error.domain == NSFileProviderErrorDomain && error.code == NSFileProviderError.Code.noSuchItem.rawValue {
            return nil
        }
        guard (existing.type == .folder) == isDirectory else { throw CocoaError(.fileWriteFileExists) }
        if let data, !isDirectory, data != (try await readContent(id: existing.id)) {
            throw CocoaError(.fileWriteNoPermission)
        }
        return existing
    }

    public func deleteObject(id: String) async throws {
        // Normalize path: ensure it starts with /
        let normalizedPath = try await resolvePath(id)

        logger.info("Deleting object \(normalizedPath)")
        _ = try await sendRequest(method: "unlink", params: ["path": normalizedPath])
    }

    public func rename(id: String, newName: String) async throws {
        // Normalize path: ensure it starts with /
        let normalizedPath = try await resolvePath(id)

        logger.info("Renaming \(normalizedPath) to \(newName)")
        let parentPath = (normalizedPath as NSString).deletingLastPathComponent
        let newPath = parentPath == "/" ? "/\(newName)" : "\(parentPath)/\(newName)"
        _ = try await sendRequest(method: "rename", params: ["src": normalizedPath, "dest": newPath])
    }

    /// Preserve stable identifiers, parent membership, and owner-produced versions at every RPC boundary.
    private func decodeItem(_ item: [String: Any]) throws -> ONEObject {
        guard let id = item["id"] as? String, Self.isItemID(id),
              let parent = item["parentId"] as? String, parent == "root" || Self.isItemID(parent),
              let name = item["name"] as? String, !name.isEmpty,
              let path = item["path"] as? String, path.hasPrefix("/"),
              let type = item["type"] as? String, type == "file" || type == "directory",
              let size = item["size"] as? Int, size >= 0,
              let contentVersion = item["contentVersion"] as? String, !contentVersion.isEmpty,
              let metadataVersion = item["metadataVersion"] as? String, !metadataVersion.isEmpty,
              let lazy = item["downloadOnDemand"] as? Bool else { throw ONEBridgeError.invalidResponse }
        var object = ONEObject(id: id, name: name, type: type == "file" ? .file : .folder,
                               size: size, modified: nil, parentId: parent == "root" ? nil : parent)
        object.path = path
        object.contentHash = contentVersion
        object.metadataHash = metadataVersion
        object.downloadOnDemand = lazy
        return object
    }

    /// Persistent identities are resolved by the owner; legacy addresses remain explicit paths.
    private func resolvePath(_ id: String) async throws -> String {
        if id.hasPrefix("filer:") {
            guard let path = try await getObject(id: id).path else { throw ONEBridgeError.invalidResponse }
            return path
        }
        return id.hasPrefix("/") ? id : "/\(id)"
    }

    private static func isItemID(_ value: String) -> Bool {
        let bytes = value.dropFirst(6).utf8
        return value.hasPrefix("filer:") && bytes.count == 64 && bytes.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }

    /// Read one bounded page from a captured snapshot. Root also exposes the existing unconverted mounts.
    public func enumerateItems(container: String, page: Data? = nil) async throws -> (items: [ONEObject], nextPage: Data?) {
        if container == "root" || (!container.hasPrefix("filer:") && container != "workingSet") {
            guard page == nil else { throw ONEBridgeError.invalidResponse }
            return (try await getChildren(parentId: container == "root" ? "/" : container), nil)
        }
        var params: [String: Any] = ["container": container, "limit": 100]
        if let page {
            guard let token = String(data: page, encoding: .utf8) else { throw ONEBridgeError.invalidResponse }
            params["page"] = token
        }
        let result = try await sendRequest(method: "enumerateItems", params: params)
        guard let rows = result["items"] as? [[String: Any]] else { throw ONEBridgeError.invalidResponse }
        let nextPage: Data?
        if let value = result["nextPage"] {
            guard let token = value as? String, !token.isEmpty else { throw ONEBridgeError.invalidResponse }
            nextPage = Data(token.utf8)
        } else { nextPage = nil }
        return (try rows.map(decodeItem), nextPage)
    }

    /// Return the server's exact continuation; never synthesize an anchor after a malformed response.
    public func getChanges(container: String, since anchor: Data) async throws -> ONEChanges {
        guard let token = String(data: anchor, encoding: .utf8), !token.isEmpty else { throw ONEBridgeError.invalidResponse }
        let result = try await sendRequest(method: "getChanges", params: ["container": container, "since": token, "limit": 100])
        guard let rows = result["updated"] as? [[String: Any]],
              let deleted = result["deleted"] as? [String], deleted.allSatisfy(Self.isItemID),
              let next = result["newAnchor"] as? String, !next.isEmpty,
              let more = result["moreComing"] as? Bool else { throw ONEBridgeError.invalidResponse }
        return ONEChanges(updated: try rows.map(decodeItem), deleted: deleted, newAnchor: Data(next.utf8), moreComing: more)
    }

    public func getCurrentAnchor(container: String) async throws -> Data {
        let result = try await sendRequest(method: "getCurrentAnchor", params: ["container": container])
        guard let anchor = result["anchor"] as? String, !anchor.isEmpty else { throw ONEBridgeError.invalidResponse }
        return Data(anchor.utf8)
    }

}

public enum ONEBridgeError: Error {
    case notConnected
    case notAuthenticated
    case timeout
    case invalidResponse
    case operationFailed
}
