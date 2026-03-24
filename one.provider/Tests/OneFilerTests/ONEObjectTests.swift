import XCTest
@testable import OneFilerExtension

final class ONEObjectTests: XCTestCase {

    // MARK: - Basic Object Creation

    func testFileObjectCreation() {
        let file = ONEObject(
            id: "file-123",
            name: "test.txt",
            type: .file,
            size: 1024,
            modified: Date(),
            parentId: "parent-id"
        )

        XCTAssertEqual(file.id, "file-123")
        XCTAssertEqual(file.name, "test.txt")
        XCTAssertEqual(file.type, .file)
        XCTAssertEqual(file.size, 1024)
        XCTAssertEqual(file.parentId, "parent-id")
    }

    func testFolderObjectCreation() {
        let folder = ONEObject(
            id: "folder-456",
            name: "My Folder",
            type: .folder
        )

        XCTAssertEqual(folder.id, "folder-456")
        XCTAssertEqual(folder.name, "My Folder")
        XCTAssertEqual(folder.type, .folder)
        XCTAssertEqual(folder.size, 0)
        XCTAssertNil(folder.parentId)
    }

    // MARK: - File Extension Detection

    func testFileExtensionForTextFile() {
        let file = ONEObject(
            id: "1",
            name: "document.txt",
            type: .file
        )

        XCTAssertEqual(file.fileExtension, "txt")
    }

    func testFileExtensionForImageFile() {
        let file = ONEObject(
            id: "2",
            name: "photo.png",
            type: .file
        )

        XCTAssertEqual(file.fileExtension, "png")
    }

    func testFileExtensionForMultipleDots() {
        let file = ONEObject(
            id: "3",
            name: "archive.tar.gz",
            type: .file
        )

        XCTAssertEqual(file.fileExtension, "gz")
    }

    func testFileExtensionForNoExtension() {
        let file = ONEObject(
            id: "4",
            name: "README",
            type: .file
        )

        XCTAssertNil(file.fileExtension)
    }

    func testFileExtensionForFolder() {
        let folder = ONEObject(
            id: "5",
            name: "folder.something",
            type: .folder
        )

        XCTAssertNil(folder.fileExtension)
    }

    // MARK: - Permissions

    func testDefaultPermissions() {
        let obj = ONEObject(
            id: "1",
            name: "test",
            type: .file
        )

        XCTAssertEqual(obj.permissions, [.read])
    }

    func testReadWritePermissions() {
        var obj = ONEObject(
            id: "2",
            name: "test",
            type: .file
        )
        obj.permissions = [.read, .write]

        XCTAssertTrue(obj.permissions.contains(.read))
        XCTAssertTrue(obj.permissions.contains(.write))
        XCTAssertFalse(obj.permissions.contains(.delete))
    }

    func testAllPermissions() {
        var obj = ONEObject(
            id: "3",
            name: "test",
            type: .file
        )
        obj.permissions = [.read, .write, .delete]

        XCTAssertTrue(obj.permissions.contains(.read))
        XCTAssertTrue(obj.permissions.contains(.write))
        XCTAssertTrue(obj.permissions.contains(.delete))
    }

    // MARK: - Optional Properties

    func testOptionalPropertiesDefaults() {
        let obj = ONEObject(
            id: "1",
            name: "test",
            type: .file
        )

        XCTAssertNil(obj.created)
        XCTAssertNil(obj.accessed)
        XCTAssertNil(obj.sha256Hash)
        XCTAssertNil(obj.typeId)
        XCTAssertNil(obj.mimeType)
        XCTAssertNil(obj.thumbnail)
        XCTAssertEqual(obj.contentHash, "")
        XCTAssertEqual(obj.metadataHash, "")
    }

    func testSettingOptionalProperties() {
        var obj = ONEObject(
            id: "1",
            name: "test.txt",
            type: .file
        )

        obj.created = Date()
        obj.accessed = Date()
        obj.sha256Hash = "abc123"
        obj.typeId = "type-456"
        obj.mimeType = "text/plain"
        obj.thumbnail = Data([1, 2, 3])
        obj.contentHash = "content-hash"
        obj.metadataHash = "metadata-hash"

        XCTAssertNotNil(obj.created)
        XCTAssertNotNil(obj.accessed)
        XCTAssertEqual(obj.sha256Hash, "abc123")
        XCTAssertEqual(obj.typeId, "type-456")
        XCTAssertEqual(obj.mimeType, "text/plain")
        XCTAssertEqual(obj.thumbnail, Data([1, 2, 3]))
        XCTAssertEqual(obj.contentHash, "content-hash")
        XCTAssertEqual(obj.metadataHash, "metadata-hash")
    }
}
