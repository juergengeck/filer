import XCTest
import FileProvider
@testable import OneFilerExtension

final class FilerFolderNamesTests: XCTestCase {
    func testPreferredSupportedLanguage() {
        XCTAssertEqual(FilerFolderNames.language(for: ["de-DE", "en"]), "de")
        XCTAssertEqual(FilerFolderNames.language(for: ["fr-FR", "de-CH", "en"]), "de")
        XCTAssertEqual(FilerFolderNames.language(for: ["en-GB", "de"]), "en")
        XCTAssertEqual(FilerFolderNames.language(for: ["fr"]), "en")
    }

    func testLocalizedRootKeepsIdentityAndContentVersion() {
        var object = ONEObject(id: "filer:" + String(repeating: "a", count: 64), name: "contacts", type: .folder)
        object.path = "/contacts"
        object.metadataHash = "metadata"
        object.contentHash = "content"
        let german = FileProviderItem(oneObject: object, languages: ["de"])
        let english = FileProviderItem(oneObject: object, languages: ["en"])
        XCTAssertEqual(german.filename, "Kontakte")
        XCTAssertEqual(english.filename, "Contacts")
        XCTAssertEqual(german.itemIdentifier, english.itemIdentifier)
        XCTAssertEqual(german.parentItemIdentifier, .rootContainer)
        XCTAssertEqual(german.itemVersion.contentVersion, english.itemVersion.contentVersion)
        XCTAssertNotEqual(german.itemVersion.metadataVersion, english.itemVersion.metadataVersion)
    }

    func testOnlyOwnedFoldersAreLocalized() {
        for (path, english, german) in [("Files", "Files", "Dateien"), ("Fotos", "Photos", "Fotos"),
                                        ("Gesundheit", "Health", "Gesundheit"), ("ONE/settings", "Settings", "Einstellungen")] {
            let object = ONEObject(id: path, name: path.components(separatedBy: "/").last!, type: .folder)
            XCTAssertEqual(FileProviderItem(oneObject: object, languages: ["en"]).filename, english)
            XCTAssertEqual(FileProviderItem(oneObject: object, languages: ["de"]).filename, german)
        }
        let custom = ONEObject(id: "Files/contacts", name: "contacts", type: .folder)
        XCTAssertEqual(FileProviderItem(oneObject: custom, languages: ["de"]).filename, "contacts")
        let file = ONEObject(id: "contacts", name: "contacts", type: .file)
        XCTAssertEqual(FileProviderItem(oneObject: file, languages: ["de"]).filename, "contacts")
    }
}
