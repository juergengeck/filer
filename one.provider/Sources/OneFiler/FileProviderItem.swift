import FileProvider
import UniformTypeIdentifiers

class FileProviderItem: NSObject, NSFileProviderItem {
    
    private let oneObject: ONEObject
    
    init(oneObject: ONEObject) {
        self.oneObject = oneObject
        super.init()
    }
    
    // Create root container item
    static func rootItem() -> FileProviderItem {
        let rootObject = ONEObject(
            id: NSFileProviderItemIdentifier.rootContainer.rawValue,
            name: "ONE Database",
            type: .folder,
            size: 0,
            modified: Date()
        )
        return FileProviderItem(oneObject: rootObject)
    }
    
    // Create standard folder items (must match Node.js mounted filesystems)
    static func standardFolders() -> [FileProviderItem] {
        return [
            FileProviderItem(oneObject: ONEObject(
                id: "chats",
                name: "Chats",
                type: .folder,
                parentId: NSFileProviderItemIdentifier.rootContainer.rawValue
            )),
            FileProviderItem(oneObject: ONEObject(
                id: "debug",
                name: "Debug",
                type: .folder,
                parentId: NSFileProviderItemIdentifier.rootContainer.rawValue
            )),
            FileProviderItem(oneObject: ONEObject(
                id: "invites",
                name: "Invites",
                type: .folder,
                parentId: NSFileProviderItemIdentifier.rootContainer.rawValue
            )),
            FileProviderItem(oneObject: ONEObject(
                id: "objects",
                name: "Objects",
                type: .folder,
                parentId: NSFileProviderItemIdentifier.rootContainer.rawValue
            )),
            FileProviderItem(oneObject: ONEObject(
                id: "profiles",
                name: "Profiles",
                type: .folder,
                parentId: NSFileProviderItemIdentifier.rootContainer.rawValue
            )),
            FileProviderItem(oneObject: ONEObject(
                id: "questionnaires",
                name: "Questionnaires",
                type: .folder,
                parentId: NSFileProviderItemIdentifier.rootContainer.rawValue
            )),
            FileProviderItem(oneObject: ONEObject(
                id: "types",
                name: "Types",
                type: .folder,
                parentId: NSFileProviderItemIdentifier.rootContainer.rawValue
            ))
        ]
    }
    
    // MARK: - Required Properties
    
    var itemIdentifier: NSFileProviderItemIdentifier {
        if oneObject.id == NSFileProviderItemIdentifier.rootContainer.rawValue {
            return .rootContainer
        }
        return NSFileProviderItemIdentifier(oneObject.id)
    }
    
    var parentItemIdentifier: NSFileProviderItemIdentifier {
        if let parentId = oneObject.parentId {
            return NSFileProviderItemIdentifier(parentId)
        }
        return .rootContainer
    }
    
    var filename: String {
        oneObject.name
    }
    
    var contentType: UTType {
        if oneObject.type == .folder {
            return .folder
        }
        
        // Determine from extension
        if let ext = oneObject.fileExtension {
            if let type = UTType(filenameExtension: ext) {
                return type
            }
        }
        
        // Determine from MIME type
        if let mimeType = oneObject.mimeType {
            if let type = UTType(mimeType: mimeType) {
                return type
            }
        }
        
        // Default to generic data
        return .data
    }
    
    // MARK: - Metadata
    
    var documentSize: NSNumber? {
        oneObject.type == .file ? NSNumber(value: oneObject.size) : nil
    }
    
    var creationDate: Date? {
        oneObject.created
    }
    
    var contentModificationDate: Date? {
        oneObject.modified
    }
    
    var lastUsedDate: Date? {
        oneObject.accessed
    }
    
    var itemVersion: NSFileProviderItemVersion {
        // Generate version data from item properties
        // For content version, use combination of id + size + modification date
        let contentString = "\(oneObject.id):\(oneObject.size):\(oneObject.modified.timeIntervalSince1970)"
        let contentData = contentString.data(using: .utf8) ?? Data()

        // For metadata version, use id + name
        let metadataString = "\(oneObject.id):\(oneObject.name)"
        let metadataData = metadataString.data(using: .utf8) ?? Data()

        return NSFileProviderItemVersion(
            contentVersion: contentData,
            metadataVersion: metadataData
        )
    }
    
    // MARK: - Capabilities
    
    var capabilities: NSFileProviderItemCapabilities {
        var caps: NSFileProviderItemCapabilities = [.allowsReading]
        
        // Add capabilities based on permissions
        if oneObject.permissions.contains(.write) {
            caps.insert([
                .allowsWriting,
                .allowsRenaming,
                .allowsReparenting
            ])
        }
        
        if oneObject.permissions.contains(.delete) {
            caps.insert([
                .allowsDeleting,
                .allowsTrashing
            ])
        }
        
        if oneObject.type == .folder {
            caps.insert([.allowsAddingSubItems, .allowsContentEnumerating])
        }
        
        // Allow evicting for space management (deprecated, but needed for compatibility)
        if #available(macOS 13.0, *) {
            // On macOS 13+, content policy is handled differently
            // This capability is deprecated but may still be needed for older systems
        } else {
            caps.insert(.allowsEvicting)
        }
        
        return caps
    }
    
    // MARK: - Extended Attributes
    
    var extendedAttributes: [String: Data] {
        var attrs: [String: Data] = [:]
        
        // Add ONE-specific metadata
        if let hash = oneObject.sha256Hash {
            attrs["one.hash.sha256"] = hash.data(using: .utf8)
        }
        
        if let typeId = oneObject.typeId {
            attrs["one.type.id"] = typeId.data(using: .utf8)
        }
        
        // Add instance identifier
        attrs["one.instance.id"] = oneObject.id.data(using: .utf8)
        
        return attrs
    }
    
    // MARK: - File Provider Flags
    
    var fileSystemFlags: NSFileProviderFileSystemFlags {
        var flags = NSFileProviderFileSystemFlags()
        
        // Set user-executable for folders
        if oneObject.type == .folder {
            flags.insert(.userExecutable)
        }
        
        // Set user-readable/writable based on permissions
        if oneObject.permissions.contains(.read) {
            flags.insert(.userReadable)
        }
        
        if oneObject.permissions.contains(.write) {
            flags.insert(.userWritable)
        }
        
        return flags
    }
    
    // MARK: - Thumbnails
    
    var thumbnailData: Data? {
        oneObject.thumbnail
    }
    
    // MARK: - Content State (Modern API)

    /// Content policy determines when the system should download the item
    @available(macOS 12.0, *)
    var contentPolicy: NSFileProviderContentPolicy {
        if oneObject.type == .folder {
            return .downloadLazily  // Folders don't have content to download
        }
        // For files, allow eager downloading (download on first access)
        return .downloadEagerlyAndKeepDownloaded
    }

    // MARK: - Download State

    var isDownloaded: Bool {
        // Since we generate content on-demand via fetchContents,
        // report files as always downloaded
        oneObject.type == .folder ? true : true
    }

    var isDownloading: Bool {
        false
    }

    var uploadingError: Error? {
        nil
    }

    var downloadingError: Error? {
        nil
    }

    var isMostRecentVersionDownloaded: Bool {
        true
    }
}