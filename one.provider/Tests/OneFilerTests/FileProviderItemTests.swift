import XCTest
import FileProvider
import UniformTypeIdentifiers
@testable import OneFilerExtension

final class FileProviderItemTests: XCTestCase {

    // MARK: - Basic Item Creation

    func testFileItemCreation() {
        let object = ONEObject(
            id: "test-file-123",
            name: "test.txt",
            type: .file,
            size: 1024,
            modified: Date(),
            parentId: "parent-folder"
        )

        let item = FileProviderItem(oneObject: object)

        XCTAssertEqual(item.filename, "test.txt")
        XCTAssertEqual(item.itemIdentifier.rawValue, "test-file-123")
        XCTAssertEqual(item.parentItemIdentifier.rawValue, "parent-folder")
        XCTAssertEqual(item.documentSize?.intValue, 1024)
        XCTAssertTrue(item.capabilities.contains(.allowsReading))
    }

    func testFolderItemCreation() {
        let object = ONEObject(
            id: "test-folder-456",
            name: "My Folder",
            type: .folder,
            parentId: NSFileProviderItemIdentifier.rootContainer.rawValue
        )

        let item = FileProviderItem(oneObject: object)

        XCTAssertEqual(item.filename, "My Folder")
        XCTAssertEqual(item.contentType, .folder)
        XCTAssertNil(item.documentSize)
        XCTAssertFalse(item.capabilities.contains(.allowsAddingSubItems))
    }

    // MARK: - Root Item

    func testRootItem() {
        let rootItem = FileProviderItem.rootItem()

        XCTAssertEqual(rootItem.itemIdentifier, .rootContainer)
        XCTAssertEqual(rootItem.filename, "ONE Database")
        XCTAssertEqual(rootItem.contentType, .folder)
    }

    // MARK: - Content Types

    func testFileExtensionDetection() {
        let txtObject = ONEObject(
            id: "file1",
            name: "document.txt",
            type: .file
        )

        let pngObject = ONEObject(
            id: "file2",
            name: "image.png",
            type: .file
        )

        let txtItem = FileProviderItem(oneObject: txtObject)
        let pngItem = FileProviderItem(oneObject: pngObject)

        XCTAssertEqual(txtObject.fileExtension, "txt")
        XCTAssertEqual(pngObject.fileExtension, "png")

        // Content types should be determined from extension
        XCTAssertTrue(txtItem.contentType.conforms(to: .text))
        XCTAssertTrue(pngItem.contentType.conforms(to: .image))
    }

    func testFolderContentType() {
        let folderObject = ONEObject(
            id: "folder1",
            name: "Test Folder",
            type: .folder
        )

        let item = FileProviderItem(oneObject: folderObject)
        XCTAssertEqual(item.contentType, .folder)
    }

    // MARK: - Parent Relationships

    func testItemWithNoParentDefaultsToRoot() {
        let object = ONEObject(
            id: "orphan",
            name: "orphan.txt",
            type: .file
        )

        let item = FileProviderItem(oneObject: object)
        XCTAssertEqual(item.parentItemIdentifier, .rootContainer)
    }

    func testItemWithExplicitParent() {
        let object = ONEObject(
            id: "child",
            name: "child.txt",
            type: .file,
            parentId: "parent-folder"
        )

        let item = FileProviderItem(oneObject: object)
        XCTAssertEqual(item.parentItemIdentifier.rawValue, "parent-folder")
    }

    // MARK: - Capabilities

    func testReadOnlyCapabilities() {
        var object = ONEObject(
            id: "readonly",
            name: "readonly.txt",
            type: .file
        )
        object.permissions = [.read]

        let item = FileProviderItem(oneObject: object)

        XCTAssertTrue(item.capabilities.contains(.allowsReading))
        XCTAssertFalse(item.capabilities.contains(.allowsWriting))
        XCTAssertFalse(item.capabilities.contains(.allowsDeleting))
    }

    func testWritableCapabilities() {
        var object = ONEObject(
            id: "writable",
            name: "writable.txt",
            type: .file
        )
        object.permissions = [.read, .write]

        let item = FileProviderItem(oneObject: object)

        XCTAssertTrue(item.capabilities.contains(.allowsReading))
        XCTAssertTrue(item.capabilities.contains(.allowsWriting))
        XCTAssertTrue(item.capabilities.contains(.allowsRenaming))
        XCTAssertTrue(item.capabilities.contains(.allowsReparenting))
    }

    func testDeletableCapabilities() {
        var object = ONEObject(
            id: "deletable",
            name: "deletable.txt",
            type: .file
        )
        object.permissions = [.read, .write, .delete]

        let item = FileProviderItem(oneObject: object)

        XCTAssertTrue(item.capabilities.contains(.allowsDeleting))
        XCTAssertTrue(item.capabilities.contains(.allowsTrashing))
    }

    func testFolderAllowsAddingSubItems() {
        var object = ONEObject(
            id: "folder",
            name: "folder",
            type: .folder
        )

        object.permissions = [.read, .write]
        let item = FileProviderItem(oneObject: object)
        XCTAssertTrue(item.capabilities.contains(.allowsAddingSubItems))
    }

    // MARK: - Versioning

    func testItemVersionUsesHashes() {
        var object = ONEObject(
            id: "versioned",
            name: "versioned.txt",
            type: .file
        )
        object.contentHash = "content-hash-123"
        object.metadataHash = "metadata-hash-456"

        let item = FileProviderItem(oneObject: object)
        let version = item.itemVersion

        XCTAssertNotNil(version.contentVersion)
        XCTAssertNotNil(version.metadataVersion)
    }

    // MARK: - Extended Attributes

    func testExtendedAttributesIncludeONEMetadata() {
        var object = ONEObject(
            id: "with-meta",
            name: "file.txt",
            type: .file
        )
        object.sha256Hash = "abc123"
        object.typeId = "type-456"

        let item = FileProviderItem(oneObject: object)
        let attrs = item.extendedAttributes

        XCTAssertNotNil(attrs["one.hash.sha256"])
        XCTAssertNotNil(attrs["one.type.id"])
        XCTAssertNotNil(attrs["one.instance.id"])
    }

    // MARK: - File System Flags

    func testFolderIsExecutable() {
        let object = ONEObject(
            id: "folder",
            name: "folder",
            type: .folder
        )

        let item = FileProviderItem(oneObject: object)
        XCTAssertTrue(item.fileSystemFlags.contains(.userExecutable))
    }

    func testReadableFlag() {
        var object = ONEObject(
            id: "file",
            name: "file.txt",
            type: .file
        )
        object.permissions = [.read]

        let item = FileProviderItem(oneObject: object)
        XCTAssertTrue(item.fileSystemFlags.contains(.userReadable))
    }

    func testWritableFlag() {
        var object = ONEObject(
            id: "file",
            name: "file.txt",
            type: .file
        )
        object.permissions = [.read, .write]

        let item = FileProviderItem(oneObject: object)
        XCTAssertTrue(item.fileSystemFlags.contains(.userWritable))
    }

    // MARK: - Download Status

    func testItemDownloadStatus() {
        let object = ONEObject(
            id: "file",
            name: "file.txt",
            type: .file
        )

        let item = FileProviderItem(oneObject: object)

        // For now, all items are assumed downloaded
        XCTAssertTrue(item.isDownloaded)
        XCTAssertFalse(item.isDownloading)
        XCTAssertNil(item.downloadingError)
        XCTAssertNil(item.uploadingError)
        XCTAssertTrue(item.isMostRecentVersionDownloaded)
    }
}
