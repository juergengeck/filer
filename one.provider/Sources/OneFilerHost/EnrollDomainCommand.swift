import Darwin
import FileProvider
import Foundation
#if SWIFT_PACKAGE
import OneFilerShared
#endif

/// Slice-1 signed-host CLI surface: Cube IoM enrollment plus read-only inspection.
///
/// All output is a machine-readable JSON envelope carrying the host protocol
/// version. Nothing here starts a second storage owner, opens another store,
/// or contacts the network; enrollment and inspection reuse the existing
/// DomainManager configuration and the existing authenticated private socket.
enum EnrollDomainCommand {
    /// Version of the machine-readable CLI envelope. Cube preflight rejects
    /// hosts whose envelope carries another version.
    static let protocolVersion = 1

    /// Relay used when a domain stores no explicit relay. Mirrors the runtime
    /// bootstrap default in RuntimeService.createRuntime.
    static let defaultRelay = "wss://comm10.dev.refinio.one"

    // MARK: - Envelope

    static func success(_ result: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "success": true, "protocolVersion": protocolVersion, "result": result
        ], options: [.sortedKeys])
    }

    static func failure(_ message: String) -> Data {
        (try? JSONSerialization.data(withJSONObject: [
            "success": false, "protocolVersion": protocolVersion,
            "error": ["message": message]
        ], options: [.sortedKeys])) ?? Data(message.utf8)
    }

    // MARK: - Owner binding

    /// The CLI names the exact expected owner; consent is given by invoking
    /// `--enroll-domain` with it, matching the menu Pair dialog's Enroll consent.
    static func validateOwner(_ value: String) throws -> String {
        let owner = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard owner.utf8.count == 64,
              owner.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            throw PrivateSocket.failure("The owner must be a 64-character lowercase hex person id.")
        }
        return owner
    }

    /// Frame a `pairing:acceptDeviceEnrollment` request bound to one exact owner.
    /// The invitation's enrollment owner must equal `--owner`, and its account
    /// email must match the domain's stored email (case-insensitive).
    static func enrollRequest(invitationURL: String, domainEmail: String, expectedOwner: String) throws -> Data {
        let expected = try validateOwner(expectedOwner)
        let envelope = try PairingInvitation.envelope(url: invitationURL)
        guard case .deviceEnrollment = envelope.kind else {
            throw PrivateSocket.failure("This invitation pairs a distinct person, not a device enrollment.")
        }
        guard envelope.enrollmentOwner == expected else {
            throw PrivateSocket.failure("This invitation enrolls a different owner than --owner names. Create a new invitation in the other app.")
        }
        return try PairingInvitation.enrollRequest(url: invitationURL, domainEmail: domainEmail, consented: true)
    }

    // MARK: - Read-only inspection

    static func domainView(name: String, config: LocalDomainConfiguration) -> [String: Any] {
        var view: [String: Any] = [
            "name": name,
            "displayName": config.resolvedDisplayName(fallback: name),
            "storageId": config.storageId.uuidString,
            "email": config.email,
            "effectiveRelay": config.commServerUrl ?? defaultRelay
        ]
        view["commServerUrl"] = config.commServerUrl ?? NSNull()
        view["instanceName"] = config.instanceName ?? NSNull()
        view["glueApiBase"] = config.glueApiBase ?? NSNull()
        return view
    }

    static func listView(domains: [String: LocalDomainConfiguration]) -> [String: Any] {
        ["domains": domains.keys.sorted().map { domainView(name: $0, config: domains[$0]!) }]
    }

    /// Best-effort File Provider status. The user-visible CloudStorage URL is
    /// resolved by Finder inside the extension process; `documentStorageURL` is
    /// not available to the host CLI SDK, so the CLI reports registration only
    /// and leaves the URL null for a future host-side addition. Never throws.
    static func fileProviderStatus(domain name: String) -> [String: Any] {
        let providerDomain = NSFileProviderDomain(
            identifier: NSFileProviderDomainIdentifier(rawValue: name), displayName: name)
        let registered = NSFileProviderManager(for: providerDomain) != nil
        return ["registered": registered, "url": NSNull(),
                "note": registered
                    ? "Finder resolves the user-visible URL; the host CLI reports registration only."
                    : "Domain is not currently registered with File Provider."]
    }

    /// Connect-only running-host probe. No frames are sent and no operations
    /// are invoked, so the probe neither mutates state nor starts an owner.
    static func isHostRunning() -> Bool {
        guard let path = try? RuntimeSecurity.container().appendingPathComponent(RuntimeSecurity.socketName).path,
              let fd = try? PrivateSocket.connect(path: path, requirement: RuntimeSecurity.hostRequirement) else {
            return false
        }
        Darwin.close(fd)
        return true
    }

    static func inspectView(name: String, config: LocalDomainConfiguration,
                            fileProvider: [String: Any], hostRunning: Bool) -> [String: Any] {
        ["domain": domainView(name: name, config: config),
         "fileProvider": fileProvider,
         "host": ["running": hostRunning,
                  "owner": NSNull(),
                  "instance": NSNull(),
                  "note": "Running owner/Instance are bootstrap-validated inside the host and not yet exposed over the product socket."]]
    }

    // MARK: - Entry point (wired by main.swift, covered by EnrollDomainCLITests)

    /// Execute `--enroll-domain NAME --owner PERSON_ID` (invitation on standard
    /// input), `--list-domains`, or `--inspect NAME`. Returns the envelope bytes
    /// and the process exit code. Only `--enroll-domain` touches the private
    /// socket, over the existing host requirement with the same framing as
    /// `--pair-domain`. Standard input is passed in so tests can drive every
    /// validation path without a host process.
    static func run(arguments: [String], standardInput: Data) throws -> (Data, Int32) {
        if arguments.count == 2, arguments[1] == "--list-domains" {
            return (try success(listView(domains: try DomainManager().listDomains())), 0)
        }
        if arguments.count == 3, arguments[1] == "--inspect" {
            let name = arguments[2]
            guard let config = try DomainManager().listDomains()[name] else {
                throw PrivateSocket.failure("Unknown domain.")
            }
            return (try success(inspectView(name: name, config: config,
                                            fileProvider: fileProviderStatus(domain: name),
                                            hostRunning: isHostRunning())), 0)
        }
        let name = arguments[2]
        let owner = try validateOwner(arguments[4])
        guard let url = String(data: standardInput, encoding: .utf8), !url.isEmpty else {
            throw PrivateSocket.failure("Supply one pairing invitation URL on standard input.")
        }
        guard let email = try DomainManager().listDomains()[name]?.email else {
            throw PrivateSocket.failure("Unknown domain.")
        }
        let request = try JSONSerialization.jsonObject(
            with: enrollRequest(invitationURL: url, domainEmail: email, expectedOwner: owner))
        let fd = try PrivateSocket.connect(
            path: RuntimeSecurity.container().appendingPathComponent(RuntimeSecurity.socketName).path,
            requirement: RuntimeSecurity.hostRequirement)
        defer { Darwin.close(fd) }
        try PrivateSocket.writeFrame(fd, JSONSerialization.data(
            withJSONObject: ["domain": name, "request": request]))
        try PairingInvitation.validateResponse(PrivateSocket.readFrame(fd))
        return (try success(["domain": name, "owner": owner, "status": "connected"]), 0)
    }
}
