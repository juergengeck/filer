import XCTest
@testable import OneFilerExtension

final class ContentHydrationTests: XCTestCase {
    func testModelItemsUseStableVersionsAndLazyContent() {
        var object = ONEObject(id: "models/qwen/revision/model.safetensors", name: "model.safetensors",
                               type: .file, size: 10)
        object.downloadOnDemand = true
        object.contentHash = "immutable-manifest"
        let first = FileProviderItem(oneObject: object)
        XCTAssertEqual(first.contentPolicy, .downloadLazily)
        object.modified = Date(timeIntervalSince1970: 1)
        let second = FileProviderItem(oneObject: object)
        XCTAssertEqual(first.itemVersion.contentVersion, second.itemVersion.contentVersion)
        XCTAssertFalse(first.capabilities.contains(.allowsWriting))
    }

    func testWritesBoundedShortReadsAndEmptyFiles() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        let expected = Data(repeating: 37, count: ContentHydration.chunkSize * 2 + 19)
        let progress = Progress(totalUnitCount: 0)
        var calls = 0
        try await ContentHydration.write(to: url, size: expected.count, progress: progress) { length, offset in
            XCTAssertLessThanOrEqual(length, ContentHydration.chunkSize)
            calls += 1
            return expected.subdata(in: offset..<min(offset + 310_000, offset + length))
        }
        XCTAssertGreaterThan(calls, 3)
        XCTAssertEqual(try Data(contentsOf: url), expected)
        XCTAssertEqual(progress.completedUnitCount, Int64(expected.count))
        try await ContentHydration.write(to: url, size: 0, progress: progress) { _, _ in
            XCTFail("An empty file must not request content")
            return Data()
        }
        XCTAssertEqual(try Data(contentsOf: url).count, 0)
    }

    func testRemovesTruncatedAndCancelledDownloads() async throws {
        for cancelled in [false, true] {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            let progress = Progress(totalUnitCount: 10)
            do {
                try await ContentHydration.write(to: url, size: 10, progress: progress) { _, _ in
                    if cancelled { progress.cancel(); return Data([1]) }
                    return Data()
                }
                XCTFail("Incomplete hydration must fail")
            } catch {
                XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
            }
        }
    }
}
