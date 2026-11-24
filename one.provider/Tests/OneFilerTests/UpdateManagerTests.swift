import CryptoKit
import Foundation
import XCTest
@testable import OneFilerHostSupport

final class UpdateManagerTests: XCTestCase {
    private var tempDir: URL!
    private var defaultsSuiteName: String!
    private var defaults: UserDefaults!

    override func setUpWithError() throws {
        tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("OneFilerUpdateTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defaultsSuiteName = "one.filer.tests.updates.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: defaultsSuiteName)!
        MockUpdateURLProtocol.reset()
    }

    override func tearDownWithError() throws {
        MockUpdateURLProtocol.reset()
        defaults?.removePersistentDomain(forName: defaultsSuiteName)
        if let tempDir {
            try? FileManager.default.removeItem(at: tempDir)
        }
    }

    private func makeMockSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockUpdateURLProtocol.self]
        return URLSession(configuration: config)
    }

    @MainActor
    func testDetectsUpToDateAndUpdateAvailableAndDownloadsVerifiedInstaller() async throws {
        let rootKey = Curve25519.Signing.PrivateKey()
        let rootPubHex = ReleaseManifestVerifier.hexString(rootKey.publicKey.rawRepresentation)
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let dmgPayload = Data(repeating: 0x42, count: 64 * 1024)

        let fixture = try SignedManifestFixture.make(
            rootKey: rootKey,
            version: "1.0.5",
            dmgBytes: dmgPayload
        )

        MockUpdateURLProtocol.register(
            url: ReleaseManifestVerifier.defaultManifestURL,
            statusCode: 200,
            data: fixture.manifestData
        )
        let dmgURL = URL(string: "https://refinio.one/installers/filer/OneFiler-1.0.5.dmg")!
        MockUpdateURLProtocol.register(url: dmgURL, statusCode: 200, data: dmgPayload)

        let verifier = ReleaseManifestVerifier(pinnedRootPublicKey: rootPubHex, now: { now })

        // Already at 1.0.5 -> up to date.
        let currentManager = UpdateManager(
            currentVersion: "1.0.5",
            distribution: .direct,
            verifier: verifier,
            session: makeMockSession(),
            defaults: defaults,
            updatesDirectory: tempDir,
            now: { now }
        )
        let upToDateState = await currentManager.checkForUpdates()
        guard case .upToDate(_, let latestVersion, _) = upToDateState else {
            return XCTFail("Expected upToDate, got \(upToDateState)")
        }
        XCTAssertEqual(latestVersion, "1.0.5")

        // Running 1.0.4 -> update available -> download & verify SHA-256.
        let outdatedManager = UpdateManager(
            currentVersion: "1.0.4",
            distribution: .direct,
            verifier: verifier,
            session: makeMockSession(),
            defaults: defaults,
            updatesDirectory: tempDir,
            now: { now }
        )
        let availableState = await outdatedManager.checkForUpdates()
        guard case .updateAvailable(let release, _) = availableState else {
            return XCTFail("Expected updateAvailable, got \(availableState)")
        }
        XCTAssertEqual(release.versionString, "1.0.5")

        let downloadedURL = try await outdatedManager.downloadUpdate(release)
        XCTAssertTrue(FileManager.default.fileExists(atPath: downloadedURL.path))
        XCTAssertEqual(try Data(contentsOf: downloadedURL), dmgPayload)
        XCTAssertEqual(outdatedManager.state, .readyToInstall(release, fileURL: downloadedURL))

        // Re-checking when verified DMG is already cached goes straight to readyToInstall.
        let recheckState = await outdatedManager.checkForUpdates()
        XCTAssertEqual(recheckState, .readyToInstall(release, fileURL: downloadedURL))
    }

    @MainActor
    func testDiscardsCorruptedInstallerDownloadOnChecksumMismatch() async throws {
        let rootKey = Curve25519.Signing.PrivateKey()
        let rootPubHex = ReleaseManifestVerifier.hexString(rootKey.publicKey.rawRepresentation)
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let signedPayload = Data(repeating: 0xAA, count: 8192)
        let corruptedPayload = Data(repeating: 0xBB, count: 8192)

        let fixture = try SignedManifestFixture.make(
            rootKey: rootKey,
            version: "1.0.6",
            dmgBytes: signedPayload
        )
        MockUpdateURLProtocol.register(
            url: ReleaseManifestVerifier.defaultManifestURL,
            statusCode: 200,
            data: fixture.manifestData
        )
        let dmgURL = URL(string: "https://refinio.one/installers/filer/OneFiler-1.0.6.dmg")!
        MockUpdateURLProtocol.register(url: dmgURL, statusCode: 200, data: corruptedPayload)

        let manager = UpdateManager(
            currentVersion: "1.0.4",
            distribution: .direct,
            verifier: ReleaseManifestVerifier(pinnedRootPublicKey: rootPubHex, now: { now }),
            session: makeMockSession(),
            defaults: defaults,
            updatesDirectory: tempDir,
            now: { now }
        )
        guard case .updateAvailable(let release, _) = await manager.checkForUpdates() else {
            return XCTFail("Expected updateAvailable")
        }

        do {
            _ = try await manager.downloadUpdate(release)
            XCTFail("Expected checksum mismatch error")
        } catch let error as UpdateError {
            XCTAssertEqual(error, .checksumMismatch)
        }

        let entries = try FileManager.default.contentsOfDirectory(atPath: tempDir.path)
        XCTAssertTrue(entries.isEmpty, "Corrupted installer must not remain on disk")
    }

    @MainActor
    func testPersistsAutomaticChecksPreferenceAndRespectsAppStoreMode() async {
        let directManager = UpdateManager(
            currentVersion: "1.0.4",
            distribution: .direct,
            session: makeMockSession(),
            defaults: defaults,
            updatesDirectory: tempDir
        )
        XCTAssertTrue(directManager.automaticChecksEnabled)
        directManager.automaticChecksEnabled = false
        XCTAssertFalse(directManager.automaticChecksEnabled)

        let reloaded = UpdateManager(
            currentVersion: "1.0.4",
            distribution: .direct,
            session: makeMockSession(),
            defaults: defaults,
            updatesDirectory: tempDir
        )
        XCTAssertFalse(reloaded.automaticChecksEnabled)

        let appStoreManager = UpdateManager(
            currentVersion: "1.0.4",
            distribution: .appStore,
            session: makeMockSession(),
            defaults: defaults,
            updatesDirectory: tempDir
        )
        XCTAssertEqual(appStoreManager.state, .managedByAppStore)
        let checked = await appStoreManager.checkForUpdates()
        XCTAssertEqual(checked, .managedByAppStore)
    }
}

private final class MockUpdateURLProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var responses: [URL: (Int, Data)] = [:]

    static func reset() {
        lock.lock()
        responses.removeAll()
        lock.unlock()
    }

    static func register(url: URL, statusCode: Int, data: Data) {
        lock.lock()
        responses[url] = (statusCode, data)
        lock.unlock()
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        Self.lock.lock()
        let entry = Self.responses[url]
        Self.lock.unlock()

        guard let (statusCode, data) = entry else {
            client?.urlProtocol(self, didFailWithError: URLError(.fileDoesNotExist))
            return
        }
        let response = HTTPURLResponse(
            url: url,
            statusCode: statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Length": String(data.count)]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
