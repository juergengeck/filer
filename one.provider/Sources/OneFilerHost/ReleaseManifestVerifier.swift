import Foundation
import CryptoKit

/// Cryptographic verifier for Refinio's 42 signed release manifests (`current-release.json`).
/// Verifies the pinned Ed25519 release root, publisher certificate validity window and signature,
/// manifest hash signature, canonical artifact leaf hashes, Merkle proofs, and artifact signatures.
struct ReleaseManifestVerifier {
    static let defaultManifestURL = URL(string: "https://refinio.one/downloads/filer/current-release.json")!
    static let defaultDownloadsPageURL = URL(string: "https://refinio.one/downloads/")!
    /// Pinned 42 release root Ed25519 public key (fingerprint b0b99db40b635d8a).
    static let pinnedReleaseRootPublicKey = "5e76f9484830a557134fe10abb240f066838cd20461a7fe4fc892a612cf84a20"
    static let maxArtifactSizeBytes: Int64 = 2 * 1024 * 1024 * 1024

    let pinnedRootPublicKey: String
    let allowedHost: String
    let now: () -> Date

    init(
        pinnedRootPublicKey: String = ReleaseManifestVerifier.pinnedReleaseRootPublicKey,
        allowedHost: String = "refinio.one",
        now: @escaping () -> Date = Date.init
    ) {
        self.pinnedRootPublicKey = pinnedRootPublicKey.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        self.allowedHost = allowedHost.lowercased()
        self.now = now
    }

    func verify(manifestData: Data) throws -> VerifiedRelease {
        let manifest: RefinioReleaseManifest
        do {
            manifest = try JSONDecoder().decode(RefinioReleaseManifest.self, from: manifestData)
        } catch {
            throw ReleaseVerificationError.invalidManifestFormat(error.localizedDescription)
        }
        return try verify(manifest: manifest)
    }

    func verify(manifest: RefinioReleaseManifest) throws -> VerifiedRelease {
        guard manifest.schemaVersion == 1 else {
            throw ReleaseVerificationError.unsupportedSchemaVersion(manifest.schemaVersion)
        }
        guard ["latest", "preview"].contains(manifest.channel) else {
            throw ReleaseVerificationError.invalidField("Unsupported release channel: \(manifest.channel)")
        }
        guard let version = SemanticVersion(manifest.releaseVersion) else {
            throw ReleaseVerificationError.invalidField("Invalid release version: \(manifest.releaseVersion)")
        }

        let manifestRootKey = manifest.releaseRootPublicKey.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard manifestRootKey == pinnedRootPublicKey else {
            throw ReleaseVerificationError.untrustedReleaseRoot("Release root public key does not match the pinned Refinio release root.")
        }

        let expectedFingerprint = try Self.rootFingerprint(forPublicKeyHex: manifestRootKey)
        guard manifest.releaseRootFingerprint.lowercased() == expectedFingerprint else {
            throw ReleaseVerificationError.untrustedReleaseRoot("Release root fingerprint does not match the release root public key.")
        }

        guard !manifest.artifacts.isEmpty else {
            throw ReleaseVerificationError.invalidField("Release manifest contains no artifacts.")
        }

        let nowMs = Int64(now().timeIntervalSince1970 * 1000.0)

        for artifact in manifest.artifacts {
            let expectedLeafHash = try Self.computeArtifactLeafHash(
                channel: manifest.channel,
                releaseVersion: manifest.releaseVersion,
                artifact: artifact
            )
            guard artifact.leafHash.lowercased() == expectedLeafHash else {
                throw ReleaseVerificationError.invalidArtifact("Artifact leaf hash mismatch for \(artifact.sourceFilename).")
            }

            let proofValid = try Self.verifyMerkleProof(
                leafHash: expectedLeafHash,
                proof: artifact.merkleProof,
                expectedRootHash: manifest.merkleRoot
            )
            guard proofValid else {
                throw ReleaseVerificationError.invalidArtifact("Merkle proof failed for \(artifact.sourceFilename).")
            }

            guard let chainString = artifact.signatureChain, !chainString.isEmpty,
                  let chainData = chainString.data(using: .utf8),
                  let chain = try? JSONDecoder().decode(PackageSignatureChain.self, from: chainData) else {
                throw ReleaseVerificationError.invalidSignature("Artifact signature chain is missing or malformed for \(artifact.sourceFilename).")
            }

            try Self.verifySignatureChain(
                chain,
                expectedDataHash: artifact.sha256.lowercased(),
                pinnedRootPublicKey: pinnedRootPublicKey,
                nowMs: nowMs
            )
        }

        let manifestHash = try Self.computeManifestHash(manifest)
        try Self.verifySignatureChain(
            manifest.manifestSignatureChain,
            expectedDataHash: manifestHash,
            pinnedRootPublicKey: pinnedRootPublicKey,
            nowMs: nowMs
        )

        guard let macArtifact = Self.selectMacArtifact(from: manifest.artifacts) else {
            throw ReleaseVerificationError.missingMacOSArtifact
        }

        let downloadURL = try validateDownloadArtifact(macArtifact)

        return VerifiedRelease(
            channel: manifest.channel,
            version: version,
            versionString: manifest.releaseVersion,
            publishedAt: manifest.publishedAt,
            rootFingerprint: expectedFingerprint,
            manifestHash: manifestHash,
            artifact: VerifiedDownloadArtifact(
                arch: macArtifact.arch,
                label: macArtifact.label,
                downloadURL: downloadURL,
                filename: macArtifact.sourceFilename,
                sizeBytes: macArtifact.sizeBytes,
                sha256: macArtifact.sha256.lowercased()
            )
        )
    }

    // MARK: - Artifact Validation & Selection

    private func validateDownloadArtifact(_ artifact: RefinioReleaseArtifact) throws -> URL {
        guard artifact.sizeBytes > 0, artifact.sizeBytes <= Self.maxArtifactSizeBytes else {
            throw ReleaseVerificationError.invalidArtifact("Artifact size is out of bounds: \(artifact.sizeBytes)")
        }
        guard Self.isHex(artifact.sha256, exactLength: 64) else {
            throw ReleaseVerificationError.invalidArtifact("Artifact SHA-256 digest is invalid.")
        }
        guard Self.isSafeInstallerFilename(artifact.sourceFilename) else {
            throw ReleaseVerificationError.invalidArtifact("Artifact filename is unsafe: \(artifact.sourceFilename)")
        }
        guard let components = URLComponents(string: artifact.stableUrl),
              components.scheme?.lowercased() == "https",
              components.host?.lowercased() == allowedHost,
              components.user == nil,
              components.password == nil,
              let url = components.url,
              url.lastPathComponent == artifact.sourceFilename else {
            throw ReleaseVerificationError.invalidArtifact("Artifact download URL is not a trusted \(allowedHost) HTTPS URL matching \(artifact.sourceFilename).")
        }
        return url
    }

    static func isSafeInstallerFilename(_ filename: String) -> Bool {
        guard !filename.isEmpty,
              !filename.contains("/"),
              !filename.contains("\\"),
              !filename.contains(".."),
              filename.lowercased().hasSuffix(".dmg") else {
            return false
        }
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._+-")
        guard let first = filename.unicodeScalars.first,
              CharacterSet.alphanumerics.contains(first) else {
            return false
        }
        return filename.unicodeScalars.allSatisfy { allowed.contains($0) }
    }

    static func currentMacArch() -> String {
        #if arch(arm64)
        return "arm64"
        #elseif arch(x86_64)
        return "x64"
        #else
        return "universal"
        #endif
    }

    static func selectMacArtifact(from artifacts: [RefinioReleaseArtifact], currentArch: String = currentMacArch()) -> RefinioReleaseArtifact? {
        let macArtifacts = artifacts.filter { $0.platform.lowercased() == "macos" }
        if let universal = macArtifacts.first(where: { $0.arch.lowercased() == "universal" }) {
            return universal
        }
        if let exact = macArtifacts.first(where: { $0.arch.lowercased() == currentArch.lowercased() }) {
            return exact
        }
        return nil
    }

    // MARK: - Cryptographic Primitives

    static func rootFingerprint(forPublicKeyHex publicKeyHex: String) throws -> String {
        let bytes = try hexToData(publicKeyHex)
        let digest = sha256Hex(bytes)
        return String(digest.prefix(16))
    }

    static func computeArtifactLeafHash(
        channel: String,
        releaseVersion: String,
        artifact: RefinioReleaseArtifact
    ) throws -> String {
        let json = try canonicalJSONObject([
            ("channel", try canonicalJSONString(channel)),
            ("releaseVersion", try canonicalJSONString(releaseVersion)),
            ("platform", try canonicalJSONString(artifact.platform)),
            ("arch", try canonicalJSONString(artifact.arch)),
            ("label", try canonicalJSONString(artifact.label)),
            ("stableUrl", try canonicalJSONString(artifact.stableUrl)),
            ("sourceFilename", try canonicalJSONString(artifact.sourceFilename)),
            ("sizeBytes", String(artifact.sizeBytes)),
            ("sha256", try canonicalJSONString(artifact.sha256)),
            ("packageMetadataHash", try canonicalJSONString(artifact.packageMetadataHash)),
            ("signatureChain", try canonicalJSONString(artifact.signatureChain ?? "")),
        ])
        return sha256Hex(Data(json.utf8))
    }

    static func computeManifestHash(_ manifest: RefinioReleaseManifest) throws -> String {
        let sorted = manifest.artifacts.sorted { left, right in
            if left.platform != right.platform { return left.platform.localizedCompare(right.platform) == .orderedAscending }
            if left.arch != right.arch { return left.arch.localizedCompare(right.arch) == .orderedAscending }
            if left.stableUrl != right.stableUrl { return left.stableUrl.localizedCompare(right.stableUrl) == .orderedAscending }
            return left.sourceFilename.localizedCompare(right.sourceFilename) == .orderedAscending
        }
        let encodedArtifacts = try sorted.map { artifact -> String in
            let encodedProof = try artifact.merkleProof.map { step in
                try canonicalJSONObject([
                    ("siblingHash", try canonicalJSONString(step.siblingHash)),
                    ("position", try canonicalJSONString(step.position)),
                ])
            }.joined(separator: ",")
            return try canonicalJSONObject([
                ("platform", try canonicalJSONString(artifact.platform)),
                ("arch", try canonicalJSONString(artifact.arch)),
                ("label", try canonicalJSONString(artifact.label)),
                ("stableUrl", try canonicalJSONString(artifact.stableUrl)),
                ("sourceFilename", try canonicalJSONString(artifact.sourceFilename)),
                ("sizeBytes", String(artifact.sizeBytes)),
                ("sha256", try canonicalJSONString(artifact.sha256)),
                ("packageMetadataHash", try canonicalJSONString(artifact.packageMetadataHash)),
                ("signatureChain", try canonicalJSONString(artifact.signatureChain ?? "")),
                ("leafHash", try canonicalJSONString(artifact.leafHash)),
                ("merkleProof", "[\(encodedProof)]"),
            ])
        }.joined(separator: ",")

        let json = try canonicalJSONObject([
            ("schemaVersion", "1"),
            ("channel", try canonicalJSONString(manifest.channel)),
            ("releaseVersion", try canonicalJSONString(manifest.releaseVersion)),
            ("publishedAt", try canonicalJSONString(manifest.publishedAt)),
            ("releaseRootPublicKey", try canonicalJSONString(manifest.releaseRootPublicKey)),
            ("releaseRootFingerprint", try canonicalJSONString(manifest.releaseRootFingerprint)),
            ("merkleRoot", try canonicalJSONString(manifest.merkleRoot)),
            ("artifacts", "[\(encodedArtifacts)]"),
        ])
        return sha256Hex(Data(json.utf8))
    }

    static func verifyMerkleProof(
        leafHash: String,
        proof: [MerkleProofStep],
        expectedRootHash: String
    ) throws -> Bool {
        var current = try hexToData(leafHash)
        for step in proof {
            let sibling = try hexToData(step.siblingHash)
            var combined = Data(capacity: current.count + sibling.count)
            switch step.position {
            case "left":
                combined.append(sibling)
                combined.append(current)
            case "right":
                combined.append(current)
                combined.append(sibling)
            default:
                throw ReleaseVerificationError.invalidArtifact("Invalid Merkle proof position: \(step.position)")
            }
            current = Data(SHA256.hash(data: combined))
        }
        return hexString(current) == expectedRootHash.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    static func verifySignatureChain(
        _ chain: PackageSignatureChain,
        expectedDataHash: String,
        pinnedRootPublicKey: String,
        nowMs: Int64
    ) throws {
        let rootKeyHex = chain.rootPublicKey.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard rootKeyHex == pinnedRootPublicKey else {
            throw ReleaseVerificationError.invalidSignature("Signature chain root key does not match the pinned release root.")
        }
        guard chain.publisherCert.issuerPublicKey.lowercased() == rootKeyHex else {
            throw ReleaseVerificationError.invalidSignature("Publisher certificate issuer does not match the release root.")
        }
        guard chain.publisherCert.claims.canSign, chain.publisherCert.claims.purposes == ["signing"] else {
            throw ReleaseVerificationError.invalidSignature("Publisher certificate lacks signing capability.")
        }
        guard nowMs >= chain.publisherCert.validFrom else {
            throw ReleaseVerificationError.invalidSignature("Publisher certificate is not yet valid.")
        }
        guard nowMs <= chain.publisherCert.validUntil else {
            throw ReleaseVerificationError.invalidSignature("Publisher certificate has expired.")
        }

        let purposesJSON = try chain.publisherCert.claims.purposes.map { try canonicalJSONString($0) }.joined(separator: ",")
        let claimsJSON = try canonicalJSONObject([
            ("canSign", chain.publisherCert.claims.canSign ? "true" : "false"),
            ("purposes", "[\(purposesJSON)]"),
        ])
        let certPayload = [
            chain.publisherCert.subject,
            chain.publisherCert.subjectPublicKey,
            chain.publisherCert.issuerPublicKey,
            String(chain.publisherCert.validFrom),
            String(chain.publisherCert.validUntil),
            claimsJSON
        ].joined(separator: "|")

        guard try verifyEd25519(
            payload: Data(certPayload.utf8),
            signatureHex: chain.publisherCert.signature,
            publicKeyHex: rootKeyHex
        ) else {
            throw ReleaseVerificationError.invalidSignature("Publisher certificate signature is invalid.")
        }

        guard chain.packageSignature.dataHash.lowercased() == expectedDataHash.lowercased() else {
            throw ReleaseVerificationError.invalidSignature("Package signature hash does not match the expected payload hash.")
        }
        guard chain.packageSignature.publisherPublicKey.lowercased() == chain.publisherCert.subjectPublicKey.lowercased() else {
            throw ReleaseVerificationError.invalidSignature("Package signature key does not match the publisher certificate.")
        }

        let packagePayload = [
            chain.packageSignature.dataHash,
            chain.packageSignature.publisherPublicKey,
            String(chain.packageSignature.signedAt)
        ].joined(separator: "|")

        guard try verifyEd25519(
            payload: Data(packagePayload.utf8),
            signatureHex: chain.packageSignature.signature,
            publicKeyHex: chain.publisherCert.subjectPublicKey
        ) else {
            throw ReleaseVerificationError.invalidSignature("Package Ed25519 signature is invalid.")
        }
    }

    static func verifyEd25519(payload: Data, signatureHex: String, publicKeyHex: String) throws -> Bool {
        let keyData = try hexToData(publicKeyHex)
        let signatureData = try hexToData(signatureHex)
        let publicKey: Curve25519.Signing.PublicKey
        do {
            publicKey = try Curve25519.Signing.PublicKey(rawRepresentation: keyData)
        } catch {
            throw ReleaseVerificationError.invalidSignature("Invalid Ed25519 public key: \(error.localizedDescription)")
        }
        return publicKey.isValidSignature(signatureData, for: payload)
    }

    static func canonicalJSONEncode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        return try encoder.encode(value)
    }

    /// Serializes a JSON object with guaranteed property order matching JavaScript's JSON.stringify.
    static func canonicalJSONObject(_ entries: [(String, String)]) throws -> String {
        let pairs = try entries.map { key, rawJSONValue in
            "\(try canonicalJSONString(key)):\(rawJSONValue)"
        }
        return "{\(pairs.joined(separator: ","))}"
    }

    /// Encodes a JSON string using RFC 8259 minimal escaping without escaping forward slashes.
    static func canonicalJSONString(_ value: String) throws -> String {
        let data = try canonicalJSONEncode(value)
        guard let encoded = String(data: data, encoding: .utf8) else {
            throw ReleaseVerificationError.invalidField("Failed to encode canonical JSON string.")
        }
        return encoded
    }

    static func sha256Hex(_ data: Data) -> String {
        hexString(Data(SHA256.hash(data: data)))
    }

    static func hexString(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    static func hexToData(_ hex: String) throws -> Data {
        let normalized = hex.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !normalized.isEmpty, normalized.count % 2 == 0 else {
            throw ReleaseVerificationError.invalidHex(hex)
        }
        var data = Data(capacity: normalized.count / 2)
        var index = normalized.startIndex
        while index < normalized.endIndex {
            let next = normalized.index(index, offsetBy: 2)
            guard let byte = UInt8(normalized[index..<next], radix: 16) else {
                throw ReleaseVerificationError.invalidHex(hex)
            }
            data.append(byte)
            index = next
        }
        return data
    }

    static func isHex(_ value: String, exactLength: Int) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard trimmed.count == exactLength else { return false }
        return trimmed.unicodeScalars.allSatisfy { scalar in
            (scalar.value >= 48 && scalar.value <= 57) || (scalar.value >= 97 && scalar.value <= 102)
        }
    }
}

// MARK: - Wire Models & Verified Types

struct RefinioReleaseManifest: Codable, Equatable {
    let schemaVersion: Int
    let channel: String
    let releaseVersion: String
    let publishedAt: String
    let releaseRootPublicKey: String
    let releaseRootFingerprint: String
    let merkleRoot: String
    let artifacts: [RefinioReleaseArtifact]
    let manifestSignatureChain: PackageSignatureChain
}

struct RefinioReleaseArtifact: Codable, Equatable {
    let platform: String
    let arch: String
    let label: String
    let stableUrl: String
    let sourceFilename: String
    let sizeBytes: Int64
    let sha256: String
    let packageMetadataHash: String
    let signatureChain: String?
    let leafHash: String
    let merkleProof: [MerkleProofStep]
}

struct MerkleProofStep: Codable, Equatable {
    let siblingHash: String
    let position: String
}

struct PackageSignatureChain: Codable, Equatable {
    let rootPublicKey: String
    let publisherCert: PublisherCertificate
    let packageSignature: PackageSignature
}

struct PublisherCertificate: Codable, Equatable {
    let subject: String
    let subjectPublicKey: String
    let issuerPublicKey: String
    let validFrom: Int64
    let validUntil: Int64
    let claims: PublisherCertificateClaims
    let signature: String
}

struct PublisherCertificateClaims: Codable, Equatable {
    let canSign: Bool
    let purposes: [String]
}

struct PackageSignature: Codable, Equatable {
    let dataHash: String
    let publisherPublicKey: String
    let signedAt: Int64
    let signature: String
}

struct VerifiedDownloadArtifact: Equatable {
    let arch: String
    let label: String
    let downloadURL: URL
    let filename: String
    let sizeBytes: Int64
    let sha256: String
}

struct VerifiedRelease: Equatable {
    let channel: String
    let version: SemanticVersion
    let versionString: String
    let publishedAt: String
    let rootFingerprint: String
    let manifestHash: String
    let artifact: VerifiedDownloadArtifact
}

enum ReleaseVerificationError: LocalizedError, Equatable {
    case invalidManifestFormat(String)
    case unsupportedSchemaVersion(Int)
    case invalidField(String)
    case untrustedReleaseRoot(String)
    case invalidArtifact(String)
    case invalidSignature(String)
    case missingMacOSArtifact
    case invalidHex(String)

    var errorDescription: String? {
        switch self {
        case .invalidManifestFormat(let detail):
            return "Invalid release manifest format: \(detail)"
        case .unsupportedSchemaVersion(let version):
            return "Unsupported release manifest schema version: \(version)"
        case .invalidField(let detail):
            return detail
        case .untrustedReleaseRoot(let detail):
            return detail
        case .invalidArtifact(let detail):
            return detail
        case .invalidSignature(let detail):
            return detail
        case .missingMacOSArtifact:
            return "No compatible macOS installer was found in the release manifest."
        case .invalidHex(let value):
            return "Invalid hexadecimal value in release metadata (\(value.prefix(16)))."
        }
    }
}

// MARK: - Semantic Versioning

struct SemanticVersion: Comparable, Equatable, CustomStringConvertible {
    let major: Int
    let minor: Int
    let patch: Int
    let prerelease: [String]

    init?(_ rawValue: String) {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let withoutPrefix = trimmed.hasPrefix("v") ? String(trimmed.dropFirst()) : trimmed
        let withoutBuild = withoutPrefix.split(separator: "+", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        let parts = withoutBuild.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        let coreParts = parts[0].split(separator: ".", omittingEmptySubsequences: false)
        guard coreParts.count == 2 || coreParts.count == 3 else { return nil }
        guard let major = Int(coreParts[0]), major >= 0,
              let minor = Int(coreParts[1]), minor >= 0 else { return nil }
        let patch: Int
        if coreParts.count == 3 {
            guard let parsedPatch = Int(coreParts[2]), parsedPatch >= 0 else { return nil }
            patch = parsedPatch
        } else {
            patch = 0
        }
        let prerelease: [String]
        if parts.count == 2 {
            let identifiers = parts[1].split(separator: ".", omittingEmptySubsequences: false).map(String.init)
            guard !identifiers.isEmpty, identifiers.allSatisfy({ !$0.isEmpty }) else { return nil }
            prerelease = identifiers
        } else {
            prerelease = []
        }
        self.major = major
        self.minor = minor
        self.patch = patch
        self.prerelease = prerelease
    }

    var description: String {
        let core = "\(major).\(minor).\(patch)"
        return prerelease.isEmpty ? core : "\(core)-\(prerelease.joined(separator: "."))"
    }

    static func < (lhs: SemanticVersion, rhs: SemanticVersion) -> Bool {
        if lhs.major != rhs.major { return lhs.major < rhs.major }
        if lhs.minor != rhs.minor { return lhs.minor < rhs.minor }
        if lhs.patch != rhs.patch { return lhs.patch < rhs.patch }
        if lhs.prerelease.isEmpty && rhs.prerelease.isEmpty { return false }
        if lhs.prerelease.isEmpty { return false } // release > prerelease
        if rhs.prerelease.isEmpty { return true }  // prerelease < release
        for (left, right) in zip(lhs.prerelease, rhs.prerelease) where left != right {
            switch (Int(left), Int(right)) {
            case let (l?, r?): return l < r
            case (.some, .none): return true  // numeric < alphanumeric per SemVer 2.0
            case (.none, .some): return false
            case (.none, .none): return left < right
            }
        }
        return lhs.prerelease.count < rhs.prerelease.count
    }
}
