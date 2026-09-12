import XCTest
import FileProvider
@testable import OneFilerExtension

final class FileProviderEnumeratorTests: XCTestCase {

    // MARK: - Item Conversion

    func testONEObjectToFileProviderItem() {
        let object = ONEObject(
            id: "test-123",
            name: "test-file.txt",
            type: .file,
            size: 512,
            parentId: "invites"
        )

        let item = FileProviderItem(oneObject: object)

        XCTAssertEqual(item.itemIdentifier.rawValue, "test-123")
        XCTAssertEqual(item.filename, "test-file.txt")
        XCTAssertEqual(item.parentItemIdentifier.rawValue, "invites")
        XCTAssertEqual(item.documentSize?.intValue, 512)
    }

    func testMultipleONEObjectsConversion() {
        let objects = [
            ONEObject(id: "1", name: "file1.txt", type: .file, parentId: "invites"),
            ONEObject(id: "2", name: "file2.txt", type: .file, parentId: "invites"),
            ONEObject(id: "3", name: "file3.png", type: .file, parentId: "invites"),
            ONEObject(id: "4", name: "file4.txt", type: .file, parentId: "invites")
        ]

        let items = objects.map { FileProviderItem(oneObject: $0) }

        XCTAssertEqual(items.count, 4)
        XCTAssertEqual(items[0].filename, "file1.txt")
        XCTAssertEqual(items[1].filename, "file2.txt")
        XCTAssertEqual(items[2].filename, "file3.png")
        XCTAssertEqual(items[3].filename, "file4.txt")

        // All should have invites as parent
        for item in items {
            XCTAssertEqual(item.parentItemIdentifier.rawValue, "invites")
        }
    }
}
