import Foundation
import CryptoKit

/// Manages update discovery, cryptographic release verification, and verified DMG downloads
/// for the OneFiler menu bar host.
@MainActor
final class UpdateManager {
    enum DistributionChannel: Equatable {
        case direct
        case appStore
    }

    enum State: Equatable {
        case managedByAppStore
        case idle
        case checking
        case upToDate(checkedAt: Date, latestVersion: String, rootFingerprint: String)
        case updateAvailable(VerifiedRelease, checkedAt: Date)
        case downloading(VerifiedRelease, bytesReceived: Int64, totalBytes: Int64)
        case readyToInstall(VerifiedRelease, fileURL: URL)
        case failed(String, checkedAt: Date)
    }

    nonisolated static let automaticChecksDefaultsKey = "one.filer.updates.automaticChecksEnabled"
    nonisolated static let lastCheckedDefaultsKey = "one.filer.updates.lastCheckedAt"
    nonisolated static let appStoreUpdatesURL = URL(string: "macappstore://showUpdatesPage")!
    nonisolated static let defaultCheckInterval: TimeInterval = 6 * 60 * 60
    nonisolated private static let maxManifestBytes = 1024 * 1024

    let currentVersionString: String
    let currentVersion: SemanticVersion?
    let distribution: DistributionChannel
    let manifestURL: URL
    let downloadsPageURL: URL

    private let verifier: ReleaseManifestVerifier
    private let session: URLSession
    private let defaults: UserDefaults
    private let updatesDirectory: URL
    private let checkInterval: TimeInterval
    private let now: () -> Date
    private let onStateChange: (State) -> Void

    private var timer: Timer?
    private var activeDownload: StreamingDownload?
    private(set) var state: State {
        didSet {
            if oldValue != state {
                onStateChange(state)
            }
        }
    }

    init(
        currentVersion: String = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0",
        distribution: DistributionChannel = UpdateManager.detectDistribution(),
        manifestURL: URL = ReleaseManifestVerifier.defaultManifestURL,
        downloadsPageURL: URL = ReleaseManifestVerifier.defaultDownloadsPageURL,
        verifier: ReleaseManifestVerifier = ReleaseManifestVerifier(),
        session: URLSession = UpdateManager.makeDefaultSession(),
        defaults: UserDefaults = .standard,
        updatesDirectory: URL = UpdateManager.defaultUpdatesDirectory(),
        checkInterval: TimeInterval = UpdateManager.defaultCheckInterval,
        now: @escaping () -> Date = Date.init,
        onStateChange: @escaping (State) -> Void = { _ in }
    ) {
        self.currentVersionString = currentVersion
        self.currentVersion = SemanticVersion(currentVersion)
        self.distribution = distribution
        self.manifestURL = manifestURL
        self.downloadsPageURL = downloadsPageURL
        self.verifier = verifier
        self.session = session
        self.defaults = defaults
        self.updatesDirectory = updatesDirectory
        self.checkInterval = checkInterval
        self.now = now
        self.onStateChange = onStateChange
        self.state = distribution == .appStore ? .managedByAppStore : .idle
    }

    nonisolated static func detectDistribution(bundle: Bundle = .main) -> DistributionChannel {
        if let receiptURL = bundle.appStoreReceiptURL,
           FileManager.default.fileExists(atPath: receiptURL.path) {
            return .appStore
        }
        return .direct
    }

    nonisolated static func makeDefaultSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 600
        return URLSession(configuration: config)
    }

    nonisolated static func defaultUpdatesDirectory() -> URL {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("OneFilerUpdates", isDirectory: true)
    }

    var automaticChecksEnabled: Bool {
        get {
            if defaults.object(forKey: Self.automaticChecksDefaultsKey) == nil {
                return true
            }
            return defaults.bool(forKey: Self.automaticChecksDefaultsKey)
        }
        set {
            defaults.set(newValue, forKey: Self.automaticChecksDefaultsKey)
            if distribution == .direct {
                if newValue {
                    scheduleTimer()
                } else {
                    timer?.invalidate()
                    timer = nil
                }
            }
        }
    }

    var lastCheckedAt: Date? {
        defaults.object(forKey: Self.lastCheckedDefaultsKey) as? Date
    }

    func startAutomaticChecks() {
        guard distribution == .direct, automaticChecksEnabled else { return }
        scheduleTimer()
        Task { [weak self] in
            _ = await self?.checkForUpdates()
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        activeDownload?.cancel()
        activeDownload = nil
    }

    private func scheduleTimer() {
        timer?.invalidate()
        let interval = max(60, checkInterval)
        let scheduled = Timer(timeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.automaticChecksEnabled else { return }
                _ = await self.checkForUpdates()
            }
        }
        RunLoop.main.add(scheduled, forMode: .common)
        timer = scheduled
    }

    @discardableResult
    func checkForUpdates() async -> State {
        if distribution == .appStore {
            state = .managedByAppStore
            return state
        }
        switch state {
        case .checking, .downloading:
            return state
        default:
            break
        }

        state = .checking
        let checkedAt = now()
        do {
            var request = URLRequest(url: manifestURL)
            request.cachePolicy = .reloadIgnoringLocalCacheData
            request.timeoutInterval = 20
            request.setValue("application/json", forHTTPHeaderField: "Accept")

            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw UpdateError.network("Unexpected response while checking for updates.")
            }
            guard (200...299).contains(http.statusCode) else {
                throw UpdateError.network("Update server returned HTTP \(http.statusCode).")
            }
            guard !data.isEmpty, data.count <= Self.maxManifestBytes else {
                throw UpdateError.network("Release manifest payload size is invalid.")
            }

            let verified = try verifier.verify(manifestData: data)
            defaults.set(checkedAt, forKey: Self.lastCheckedDefaultsKey)

            guard let installed = currentVersion else {
                throw UpdateError.invalidInstalledVersion(currentVersionString)
            }

            if verified.version > installed {
                if let cachedURL = verifiedCachedInstaller(for: verified) {
                    state = .readyToInstall(verified, fileURL: cachedURL)
                } else {
                    state = .updateAvailable(verified, checkedAt: checkedAt)
                }
            } else {
                state = .upToDate(
                    checkedAt: checkedAt,
                    latestVersion: verified.versionString,
                    rootFingerprint: verified.rootFingerprint
                )
            }
            return state
        } catch {
            state = .failed(error.localizedDescription, checkedAt: checkedAt)
            return state
        }
    }

    func cancelDownload() {
        activeDownload?.cancel()
        activeDownload = nil
    }

    func downloadUpdate(_ release: VerifiedRelease) async throws -> URL {
        guard distribution == .direct else {
            throw UpdateError.managedByAppStore
        }
        if let existing = verifiedCachedInstaller(for: release) {
            state = .readyToInstall(release, fileURL: existing)
            return existing
        }

        try FileManager.default.createDirectory(at: updatesDirectory, withIntermediateDirectories: true)
        let partialURL = updatesDirectory.appendingPathComponent(".\(release.artifact.filename).\(UUID().uuidString).part")
        let destinationURL = updatesDirectory.appendingPathComponent(release.artifact.filename)

        state = .downloading(release, bytesReceived: 0, totalBytes: release.artifact.sizeBytes)

        let downloader = StreamingDownload(
            sessionConfiguration: session.configuration,
            expectedSize: release.artifact.sizeBytes,
            expectedSHA256: release.artifact.sha256,
            partialURL: partialURL
        ) { [weak self] source, received, total in
            Task { @MainActor [weak self] in
                guard let self, self.activeDownload === source else { return }
                self.state = .downloading(release, bytesReceived: received, totalBytes: total)
            }
        }
        activeDownload = downloader
        defer {
            if activeDownload === downloader {
                activeDownload = nil
            }
        }

        do {
            try await downloader.run(url: release.artifact.downloadURL)
            if FileManager.default.fileExists(atPath: destinationURL.path) {
                try FileManager.default.removeItem(at: destinationURL)
            }
            try FileManager.default.moveItem(at: partialURL, to: destinationURL)
            pruneOldInstallers(keeping: destinationURL.lastPathComponent)
            state = .readyToInstall(release, fileURL: destinationURL)
            return destinationURL
        } catch {
            try? FileManager.default.removeItem(at: partialURL)
            if (error as? CancellationError) != nil || (error as NSError).code == NSURLErrorCancelled {
                state = .updateAvailable(release, checkedAt: lastCheckedAt ?? now())
            } else {
                state = .failed(error.localizedDescription, checkedAt: now())
            }
            throw error
        }
    }

    /// Re-verifies an already-downloaded installer on disk before trusting it.
    func verifiedCachedInstaller(for release: VerifiedRelease) -> URL? {
        let candidate = updatesDirectory.appendingPathComponent(release.artifact.filename)
        guard FileManager.default.fileExists(atPath: candidate.path) else { return nil }
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: candidate.path),
              let fileSize = (attributes[.size] as? NSNumber)?.int64Value,
              fileSize == release.artifact.sizeBytes else {
            return nil
        }
        guard let digest = try? Self.sha256File(at: candidate),
              digest == release.artifact.sha256 else {
            try? FileManager.default.removeItem(at: candidate)
            return nil
        }
        return candidate
    }

    private func pruneOldInstallers(keeping filename: String) {
        guard let entries = try? FileManager.default.contentsOfDirectory(at: updatesDirectory, includingPropertiesForKeys: nil) else {
            return
        }
        for url in entries where url.lastPathComponent != filename {
            try? FileManager.default.removeItem(at: url)
        }
    }

    static func sha256File(at url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while true {
            let chunk = try handle.read(upToCount: 256 * 1024) ?? Data()
            if chunk.isEmpty { break }
            hasher.update(data: chunk)
        }
        return ReleaseManifestVerifier.hexString(Data(hasher.finalize()))
    }
}

enum UpdateError: LocalizedError, Equatable {
    case managedByAppStore
    case invalidInstalledVersion(String)
    case network(String)
    case sizeMismatch(expected: Int64, actual: Int64)
    case checksumMismatch

    var errorDescription: String? {
        switch self {
        case .managedByAppStore:
            return "Updates for this build are managed through the Mac App Store."
        case .invalidInstalledVersion(let version):
            return "The installed OneFiler version (\(version)) could not be parsed."
        case .network(let detail):
            return detail
        case .sizeMismatch(let expected, let actual):
            return "Downloaded installer size (\(actual) bytes) did not match the signed manifest (\(expected) bytes)."
        case .checksumMismatch:
            return "Downloaded installer failed SHA-256 verification against the signed Refinio release manifest and was discarded."
        }
    }
}

/// Streams a download directly to disk while computing SHA-256 incrementally and enforcing
/// the signed byte-size ceiling without buffering the installer in memory.
private final class StreamingDownload: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let sessionConfiguration: URLSessionConfiguration
    private let expectedSize: Int64
    private let expectedSHA256: String
    private let partialURL: URL
    private let onProgress: (StreamingDownload, Int64, Int64) -> Void

    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var fileHandle: FileHandle?
    private var hasher = SHA256()
    private var bytesReceived: Int64 = 0
    private var lastReportedBytes: Int64 = 0
    private var streamError: Error?
    private var continuation: CheckedContinuation<Void, Error>?
    private let lock = NSLock()

    init(
        sessionConfiguration: URLSessionConfiguration,
        expectedSize: Int64,
        expectedSHA256: String,
        partialURL: URL,
        onProgress: @escaping (StreamingDownload, Int64, Int64) -> Void
    ) {
        self.sessionConfiguration = sessionConfiguration
        self.expectedSize = expectedSize
        self.expectedSHA256 = expectedSHA256.lowercased()
        self.partialURL = partialURL
        self.onProgress = onProgress
    }

    func run(url: URL) async throws {
        FileManager.default.createFile(atPath: partialURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
        fileHandle = try FileHandle(forWritingTo: partialURL)

        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        let urlSession = URLSession(configuration: sessionConfiguration, delegate: self, delegateQueue: queue)
        self.session = urlSession

        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            self.lock.lock()
            self.continuation = continuation
            let dataTask = urlSession.dataTask(with: request)
            self.task = dataTask
            self.lock.unlock()
            dataTask.resume()
        }
    }

    func cancel() {
        lock.lock()
        let activeTask = task
        lock.unlock()
        activeTask?.cancel()
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard let http = response as? HTTPURLResponse else {
            streamError = UpdateError.network("Unexpected response while downloading update.")
            completionHandler(.cancel)
            return
        }
        guard (200...299).contains(http.statusCode) else {
            streamError = UpdateError.network("Installer download failed with HTTP \(http.statusCode).")
            completionHandler(.cancel)
            return
        }
        if http.expectedContentLength > 0 && http.expectedContentLength != expectedSize {
            streamError = UpdateError.sizeMismatch(expected: expectedSize, actual: http.expectedContentLength)
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard streamError == nil else { return }
        let nextTotal = bytesReceived + Int64(data.count)
        if nextTotal > expectedSize {
            streamError = UpdateError.sizeMismatch(expected: expectedSize, actual: nextTotal)
            dataTask.cancel()
            return
        }
        do {
            try fileHandle?.write(contentsOf: data)
            hasher.update(data: data)
            bytesReceived = nextTotal
            let step = max(Int64(256 * 1024), expectedSize / 100)
            if bytesReceived == expectedSize || bytesReceived - lastReportedBytes >= step {
                lastReportedBytes = bytesReceived
                onProgress(self, bytesReceived, expectedSize)
            }
        } catch {
            streamError = error
            dataTask.cancel()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        try? fileHandle?.close()
        fileHandle = nil
        session.finishTasksAndInvalidate()

        let result: Result<Void, Error>
        if let streamError {
            result = .failure(streamError)
        } else if let error {
            result = .failure(error)
        } else if bytesReceived != expectedSize {
            result = .failure(UpdateError.sizeMismatch(expected: expectedSize, actual: bytesReceived))
        } else {
            let actualSHA256 = ReleaseManifestVerifier.hexString(Data(hasher.finalize()))
            if actualSHA256 == expectedSHA256 {
                result = .success(())
            } else {
                result = .failure(UpdateError.checksumMismatch)
            }
        }

        lock.lock()
        let pending = continuation
        continuation = nil
        self.task = nil
        self.session = nil
        lock.unlock()

        pending?.resume(with: result)
    }
}
