import AuthenticationServices
import Cocoa
import Foundation
#if SWIFT_PACKAGE
import OneFilerShared
#endif

/// Verified Glue device enrollment outcome returned by `@refinio/filer.runtime --glue-enroll`.
struct GlueEnrollmentResult: Codable, Equatable, Sendable {
    let identity: String
    let handle: String
    let email: String
    let instanceName: String
    let personId: String
    let instanceId: String
    let apiBase: String
    let commServerUrl: String

    /// Normalized lowercase Finder domain name derived from the verified Glue handle.
    var normalizedDomainName: String {
        handle.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}

enum GlueEnrollmentError: LocalizedError, Equatable {
    case cancelled
    case conflict(String)
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .cancelled:
            return "glue.one sign-in was cancelled."
        case .conflict(let message), .failed(let message):
            return message
        }
    }
}

/// Runs the sandboxed `@refinio/filer.runtime --glue-enroll` child process over stdin/stdout.
/// Private keys and Keychain secrets never leave Node custody; only the public auth URL and
/// deep-link callback URL cross into `ASWebAuthenticationSession`.
final class GlueEnrollmentProcess: @unchecked Sendable {
    typealias AuthSessionHandler = @Sendable (URL, String) async throws -> URL

    private static let maxLineBytes = 1024 * 1024

    static func run(
        node: URL,
        entry: URL,
        preload: URL,
        directory: URL,
        loginHint: String,
        storageSecret: String,
        apiBase: String? = nil,
        commServerUrl: String? = nil,
        authPopupUrl: String? = nil,
        openAuthSession: @escaping AuthSessionHandler
    ) async throws -> GlueEnrollmentResult {
        let process = Process()
        let input = Pipe()
        let output = Pipe()
        let errorPipe = Pipe()

        process.executableURL = node
        process.currentDirectoryURL = entry.deletingLastPathComponent()
        process.arguments = ["--jitless", "--require", preload.path, entry.path, "--glue-enroll"]
        process.environment = [
            "HOME": NSHomeDirectory(),
            "TMPDIR": NSTemporaryDirectory(),
            "NODE_ENV": "production"
        ]
        process.standardInput = input
        process.standardOutput = output
        process.standardError = errorPipe

        let errorAccumulator = StderrAccumulator()
        errorPipe.fileHandleForReading.readabilityHandler = { handle in
            let chunk = handle.availableData
            if !chunk.isEmpty {
                errorAccumulator.append(chunk)
            }
        }

        try process.run()

        defer {
            errorPipe.fileHandleForReading.readabilityHandler = nil
            try? input.fileHandleForWriting.close()
            if process.isRunning {
                process.terminate()
                process.waitUntilExit()
            }
        }

        var request: [String: String] = [
            "directory": directory.path,
            "loginHint": loginHint,
            "storageSecret": storageSecret
        ]
        if let apiBase, !apiBase.isEmpty { request["apiBase"] = apiBase }
        if let commServerUrl, !commServerUrl.isEmpty { request["commServerUrl"] = commServerUrl }
        if let authPopupUrl, !authPopupUrl.isEmpty { request["authPopupUrl"] = authPopupUrl }

        try writeLine(request, to: input.fileHandleForWriting)

        let reader = LinePipeReader(handle: output.fileHandleForReading, maxLineBytes: maxLineBytes)
        var userCancelled = false

        while let line = try await reader.nextLine() {
            guard let object = try JSONSerialization.jsonObject(with: line) as? [String: Any] else {
                throw GlueEnrollmentError.failed("Invalid response from Glue enrollment helper.")
            }

            if object["event"] as? String == "openAuthUrl" {
                guard let urlString = object["url"] as? String,
                      let authURL = URL(string: urlString),
                      let scheme = object["callbackScheme"] as? String, !scheme.isEmpty else {
                    throw GlueEnrollmentError.failed("Glue enrollment helper emitted an invalid auth URL.")
                }

                do {
                    let callbackURL = try await openAuthSession(authURL, scheme)
                    try writeLine(["callbackUrl": callbackURL.absoluteString], to: input.fileHandleForWriting)
                } catch {
                    if case GlueEnrollmentError.cancelled = error {
                        userCancelled = true
                    }
                    try? writeLine(["error": error.localizedDescription], to: input.fileHandleForWriting)
                }
                continue
            }

            if let success = object["success"] as? Bool {
                try? input.fileHandleForWriting.close()
                await waitForExit(process)
                if success {
                    guard let rawResult = object["result"] else {
                        throw GlueEnrollmentError.failed("Glue enrollment completed without a receipt.")
                    }
                    let resultBytes = try JSONSerialization.data(withJSONObject: rawResult)
                    return try JSONDecoder().decode(GlueEnrollmentResult.self, from: resultBytes)
                }
                if userCancelled {
                    throw GlueEnrollmentError.cancelled
                }
                let message = (object["error"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
                throw GlueEnrollmentError.failed(message?.isEmpty == false ? message! : "glue.one sign-in failed.")
            }
        }

        await waitForExit(process)
        if userCancelled {
            throw GlueEnrollmentError.cancelled
        }
        let stderrText = errorAccumulator.snapshot().trimmingCharacters(in: .whitespacesAndNewlines)
        if !stderrText.isEmpty {
            NSLog("OneFiler Glue enrollment stderr: %@", stderrText)
        }
        throw GlueEnrollmentError.failed("glue.one enrollment ended unexpectedly.")
    }

    private static func writeLine(_ object: [String: String], to handle: FileHandle) throws {
        let data = try JSONSerialization.data(withJSONObject: object)
        try handle.write(contentsOf: data + Data([10]))
    }

    private static func waitForExit(_ process: Process) async {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                if process.isRunning {
                    process.waitUntilExit()
                }
                continuation.resume()
            }
        }
    }
}

/// Presents `ASWebAuthenticationSession` from an `LSUIElement` menu-bar host using a temporary
/// non-key presentation anchor window and cooperative activation handoff to the default browser
/// so WebAuthn / TrustKey ceremonies receive document focus without requiring an extra click.
@MainActor
final class GlueWebAuthPresenter: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var anchorWindow: NSWindow?
    private var session: ASWebAuthenticationSession?
    private var sheetObserver: NSObjectProtocol?
    private var targetURL: URL?

    static func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        let presenter = GlueWebAuthPresenter()
        return try await presenter.start(url: url, callbackScheme: callbackScheme)
    }

    private func start(url: URL, callbackScheme: String) async throws -> URL {
        self.targetURL = url
        NSLog("OneFiler Glue auth: starting ASWebAuthenticationSession (scheme=%@, host=%@)", callbackScheme, url.host ?? "unknown")
        return try await withCheckedThrowingContinuation { continuation in
            let authSession = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: callbackScheme
            ) { [weak self] callbackURL, error in
                Task { @MainActor in
                    self?.cleanup()
                    if let error {
                        let nsError = error as NSError
                        NSLog("OneFiler Glue auth: session ended with error %@ (%ld): %@", nsError.domain, nsError.code, nsError.localizedDescription)
                        if let authError = error as? ASWebAuthenticationSessionError,
                           authError.code == .canceledLogin {
                            continuation.resume(throwing: GlueEnrollmentError.cancelled)
                        } else {
                            continuation.resume(throwing: GlueEnrollmentError.failed(error.localizedDescription))
                        }
                        return
                    }
                    guard let callbackURL else {
                        NSLog("OneFiler Glue auth: session ended with nil callback URL")
                        continuation.resume(throwing: GlueEnrollmentError.failed("glue.one did not return a callback URL."))
                        return
                    }
                    NSLog("OneFiler Glue auth: received callback (scheme=%@, host=%@)", callbackURL.scheme ?? "", callbackURL.host ?? "")
                    continuation.resume(returning: callbackURL)
                }
            }
            authSession.presentationContextProvider = self
            // Keep non-ephemeral so Safari / macOS Touch ID passkeys are accessible.
            authSession.prefersEphemeralWebBrowserSession = false
            self.session = authSession
            if !authSession.start() {
                self.cleanup()
                NSLog("OneFiler Glue auth: ASWebAuthenticationSession.start() returned false")
                continuation.resume(throwing: GlueEnrollmentError.failed("Could not start macOS web authentication session."))
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        if let existing = NSApp.keyWindow {
            return existing
        }
        if let anchorWindow {
            return anchorWindow
        }
        // Keep the anchor window non-key so OneFilerHost never steals focus from the
        // browser's WebAuthn / TrustKey popup once the system consent sheet finishes.
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1, height: 1),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.isReleasedWhenClosed = false
        window.alphaValue = 0
        window.center()
        window.orderFront(nil)
        self.anchorWindow = window
        sheetObserver = NotificationCenter.default.addObserver(
            forName: NSWindow.didEndSheetNotification,
            object: window,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.handoffFocusToDefaultBrowser()
            }
        }
        return window
    }

    private func handoffFocusToDefaultBrowser() {
        anchorWindow?.orderOut(nil)
        guard let targetURL,
              let browserURL = NSWorkspace.shared.urlForApplication(toOpen: targetURL),
              let browserBundleId = Bundle(url: browserURL)?.bundleIdentifier,
              let browserApp = NSRunningApplication.runningApplications(withBundleIdentifier: browserBundleId).first else {
            return
        }
        if #available(macOS 14.0, *) {
            NSApp.yieldActivation(to: browserApp)
        }
        browserApp.activate(options: [])
    }

    private func cleanup() {
        if let sheetObserver {
            NotificationCenter.default.removeObserver(sheetObserver)
            self.sheetObserver = nil
        }
        session = nil
        targetURL = nil
        anchorWindow?.orderOut(nil)
        anchorWindow = nil
    }
}

/// Coordinates native `glue.one` passkey enrollment with `DomainManager` and App Group storage.
enum GlueEnrollmentSession {
    /// Extract the lowercase handle from a login hint such as `gecko` or `gecko@glue.one`.
    static func candidateHandle(from loginHint: String) -> String {
        let trimmed = loginHint.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let at = trimmed.firstIndex(of: "@") {
            return String(trimmed[..<at])
        }
        return trimmed
    }

    /// Reject case-insensitive domain identifier or Finder display name collisions so APFS
    /// CloudStorage folders (`OneFiler-<displayName>`) never collide.
    static func validateNoDomainConflict(
        handle: String,
        existingDomains: [String: LocalDomainConfiguration]
    ) throws {
        let normalized = handle.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !normalized.isEmpty else {
            throw GlueEnrollmentError.failed("Enter your glue.one name (for example, gecko).")
        }
        for (identifier, config) in existingDomains {
            let displayName = config.resolvedDisplayName(fallback: identifier)
            if identifier.lowercased() == normalized || displayName.lowercased() == normalized {
                throw GlueEnrollmentError.conflict(
                    "A domain named '\(displayName)' already exists. Unregister '\(displayName)' first before signing in as '\(normalized)'."
                )
            }
        }
    }

    /// Enroll a fresh OneFiler device under `glue.one` and register its Finder domain.
    static func signIn(
        loginHint: String,
        domainManager: DomainManager,
        apiBase: String? = nil
    ) async throws -> GlueEnrollmentResult {
        let trimmedHint = loginHint.trimmingCharacters(in: .whitespacesAndNewlines)
        let candidate = candidateHandle(from: trimmedHint)
        try validateNoDomainConflict(handle: candidate, existingDomains: try domainManager.listDomains())

        let paths = try RuntimeService.runtimePaths()
        let storageId = UUID()
        let directory = try RuntimeSecurity.container()
            .appendingPathComponent("instances")
            .appendingPathComponent(storageId.uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        var registered = false
        defer {
            if !registered {
                try? FileManager.default.removeItem(at: directory)
            }
        }

        let secret = try InstanceSecrets.getOrCreate(instance: storageId)
        let result = try await GlueEnrollmentProcess.run(
            node: paths.node,
            entry: paths.entry,
            preload: paths.preload,
            directory: directory,
            loginHint: trimmedHint,
            storageSecret: secret,
            apiBase: apiBase,
            openAuthSession: { url, scheme in
                try await GlueWebAuthPresenter.authenticate(url: url, callbackScheme: scheme)
            }
        )

        let domainName = result.normalizedDomainName
        try validateNoDomainConflict(handle: domainName, existingDomains: try domainManager.listDomains())

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            do {
                try domainManager.registerDomain(
                    name: domainName,
                    displayName: domainName,
                    email: result.email,
                    commServerUrl: result.commServerUrl,
                    storageId: storageId,
                    instanceName: result.instanceName,
                    glueApiBase: result.apiBase
                ) { error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else {
                        continuation.resume()
                    }
                }
            } catch {
                continuation.resume(throwing: error)
            }
        }
        registered = true
        return result
    }
}

private final class StderrAccumulator: @unchecked Sendable {
    private let lock = NSLock()
    private var data = Data()
    private let maxBytes = 64 * 1024

    func append(_ chunk: Data) {
        lock.lock()
        defer { lock.unlock() }
        if data.count < maxBytes {
            data.append(chunk.prefix(maxBytes - data.count))
        }
    }

    func snapshot() -> String {
        lock.lock()
        defer { lock.unlock() }
        return String(data: data, encoding: .utf8) ?? ""
    }
}

private actor LinePipeReader {
    private let handle: FileHandle
    private let maxLineBytes: Int
    private var buffer = Data()
    private var eof = false

    init(handle: FileHandle, maxLineBytes: Int) {
        self.handle = handle
        self.maxLineBytes = maxLineBytes
    }

    func nextLine() async throws -> Data? {
        while true {
            if let newline = buffer.firstIndex(of: 10) {
                let line = Data(buffer[..<newline])
                buffer.removeSubrange(...newline)
                return line
            }
            if eof {
                if buffer.isEmpty { return nil }
                let tail = buffer
                buffer.removeAll()
                return tail
            }
            let chunk = await readChunk()
            if chunk.isEmpty {
                eof = true
            } else {
                buffer.append(chunk)
                if buffer.count > maxLineBytes {
                    throw GlueEnrollmentError.failed("Glue enrollment helper response exceeded size limit.")
                }
            }
        }
    }

    private func readChunk() async -> Data {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                // `availableData` returns immediately once any bytes arrive on the pipe
                // (unlike `read(upToCount:)`, which blocks until EOF or the full byte count).
                let data = self.handle.availableData
                continuation.resume(returning: data)
            }
        }
    }
}
