import CryptoKit
import Foundation
import XCTest
@testable import OneFilerHostSupport

final class ReleaseManifestVerifierTests: XCTestCase {
    /// Verifies the exact published 1.0.4 manifest from refinio.one byte-for-byte against
    /// our Swift canonical JSON hashing, Merkle proof, and Ed25519 signature chain logic.
    func testVerifiesPublishedRefinioOneManifest() throws {
        let publishedJSON = #"""
        {
          "schemaVersion": 1,
          "channel": "latest",
          "releaseVersion": "1.0.4",
          "publishedAt": "2026-11-22T21:37:23.570Z",
          "releaseRootPublicKey": "5e76f9484830a557134fe10abb240f066838cd20461a7fe4fc892a612cf84a20",
          "releaseRootFingerprint": "b0b99db40b635d8a",
          "merkleRoot": "0b0cbde8a8902895aa2c4d6804b49d8dc1d71e83b94a45b9488cb4fbff680739",
          "artifacts": [
            {
              "platform": "macos",
              "arch": "universal",
              "label": "OneFiler macOS disk image",
              "stableUrl": "https://refinio.one/installers/filer/OneFiler-1.0.4.dmg",
              "sourceFilename": "OneFiler-1.0.4.dmg",
              "sizeBytes": 152021635,
              "sha256": "5c83d99c088f9fcf2b96a55668aa23f30f1d2a342992365bb8838cdb50658240",
              "packageMetadataHash": "6e8f1c8ac17b3cb0e0ba13feedb47e455c16bd00d60a26b562d199e06c3b539e",
              "signatureChain": "{\"rootPublicKey\":\"5e76f9484830a557134fe10abb240f066838cd20461a7fe4fc892a612cf84a20\",\"publisherCert\":{\"subject\":\"42-release\",\"subjectPublicKey\":\"486a747b64ec710138d194fb5e840f7ce298c9d3c9b9d27b49469a9975097711\",\"issuerPublicKey\":\"5e76f9484830a557134fe10abb240f066838cd20461a7fe4fc892a612cf84a20\",\"validFrom\":1795383443576,\"validUntil\":1826919443576,\"claims\":{\"canSign\":true,\"purposes\":[\"signing\"]},\"signature\":\"806d524af01d42783c190a929b2fd28da635358c76e4b2dd625c1d5d95f8c11083a262c67411eca37c0f2fc51be8bee6f8cc87d9be41d412756b69dc7a0b8309\"},\"packageSignature\":{\"dataHash\":\"5c83d99c088f9fcf2b96a55668aa23f30f1d2a342992365bb8838cdb50658240\",\"publisherPublicKey\":\"486a747b64ec710138d194fb5e840f7ce298c9d3c9b9d27b49469a9975097711\",\"signedAt\":1795383443728,\"signature\":\"f7a65f7c09dcd0b7de1e5f777fa3be7e476616a3de3f84bd443e0f0deb7e1d1e44360403ccfc8467e99ecb041cf64bb237c39504a09639b3c26edc9d59153204\"}}",
              "leafHash": "0b0cbde8a8902895aa2c4d6804b49d8dc1d71e83b94a45b9488cb4fbff680739",
              "merkleProof": []
            }
          ],
          "manifestSignatureChain": {
            "rootPublicKey": "5e76f9484830a557134fe10abb240f066838cd20461a7fe4fc892a612cf84a20",
            "publisherCert": {
              "subject": "42-release",
              "subjectPublicKey": "486a747b64ec710138d194fb5e840f7ce298c9d3c9b9d27b49469a9975097711",
              "issuerPublicKey": "5e76f9484830a557134fe10abb240f066838cd20461a7fe4fc892a612cf84a20",
              "validFrom": 1795383443576,
              "validUntil": 1826919443576,
              "claims": {
                "canSign": true,
                "purposes": [
                  "signing"
                ]
              },
              "signature": "806d524af01d42783c190a929b2fd28da635358c76e4b2dd625c1d5d95f8c11083a262c67411eca37c0f2fc51be8bee6f8cc87d9be41d412756b69dc7a0b8309"
            },
            "packageSignature": {
              "dataHash": "ac6b4a7449ed311986acf8f06b27a6203ea46566f4c4cc2cb267547e407aec0e",
              "publisherPublicKey": "486a747b64ec710138d194fb5e840f7ce298c9d3c9b9d27b49469a9975097711",
              "signedAt": 1795383443731,
              "signature": "7d41b4d235f62299f015e84cba229325e003dbcabe2ce1f55b79084a04eb6b39def401c334e29d1704b84c86ee826163bc0632bb75ea85d161e8a66f5795f90a"
            }
          }
        }
        """#

        // Fixed timestamp inside the published certificate window (Nov 2026).
        let verifier = ReleaseManifestVerifier(now: { Date(timeIntervalSince1970: 1_795_400_000) })
        let verified = try verifier.verify(manifestData: Data(publishedJSON.utf8))

        XCTAssertEqual(verified.versionString, "1.0.4")
        XCTAssertEqual(verified.version, SemanticVersion("1.0.4"))
        XCTAssertEqual(verified.rootFingerprint, "b0b99db40b635d8a")
        XCTAssertEqual(verified.manifestHash, "ac6b4a7449ed311986acf8f06b27a6203ea46566f4c4cc2cb267547e407aec0e")
        XCTAssertEqual(verified.artifact.filename, "OneFiler-1.0.4.dmg")
        XCTAssertEqual(verified.artifact.sizeBytes, 152_021_635)
        XCTAssertEqual(verified.artifact.downloadURL.absoluteString, "https://refinio.one/installers/filer/OneFiler-1.0.4.dmg")
    }

    func testRejectsUntrustedRootExpiredCertAndTamperedArtifact() throws {
        let rootKey = Curve25519.Signing.PrivateKey()
        let rootPubHex = ReleaseManifestVerifier.hexString(rootKey.publicKey.rawRepresentation)
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let dmgBytes = Data("verified-dmg-content".utf8)

        let signed = try SignedManifestFixture.make(
            rootKey: rootKey,
            version: "1.0.5",
            dmgBytes: dmgBytes,
            validFromMs: Int64((now.timeIntervalSince1970 - 60) * 1000),
            validUntilMs: Int64((now.timeIntervalSince1970 + 3600) * 1000)
        )

        let validVerifier = ReleaseManifestVerifier(pinnedRootPublicKey: rootPubHex, now: { now })
        let verified = try validVerifier.verify(manifestData: signed.manifestData)
        XCTAssertEqual(verified.versionString, "1.0.5")

        // Different pinned root key must be rejected.
        let otherRootHex = ReleaseManifestVerifier.hexString(Curve25519.Signing.PrivateKey().publicKey.rawRepresentation)
        let wrongRootVerifier = ReleaseManifestVerifier(pinnedRootPublicKey: otherRootHex, now: { now })
        XCTAssertThrowsError(try wrongRootVerifier.verify(manifestData: signed.manifestData))

        // Expired publisher certificate must be rejected.
        let expiredVerifier = ReleaseManifestVerifier(
            pinnedRootPublicKey: rootPubHex,
            now: { Date(timeIntervalSince1970: now.timeIntervalSince1970 + 7200) }
        )
        XCTAssertThrowsError(try expiredVerifier.verify(manifestData: signed.manifestData))

        // Tampered download URL must be rejected.
        let tamperedString = String(data: signed.manifestData, encoding: .utf8)!
            .replacingOccurrences(of: "https://refinio.one/installers/filer/OneFiler-1.0.5.dmg", with: "https://evil.example/OneFiler-1.0.5.dmg")
        XCTAssertThrowsError(try validVerifier.verify(manifestData: Data(tamperedString.utf8)))
    }

    func testRejectsUntrustedHostEvenWhenSignedByRoot() throws {
        let rootKey = Curve25519.Signing.PrivateKey()
        let rootPubHex = ReleaseManifestVerifier.hexString(rootKey.publicKey.rawRepresentation)
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let signed = try SignedManifestFixture.make(
            rootKey: rootKey,
            version: "1.0.5",
            dmgBytes: Data("payload".utf8),
            stableUrl: "https://untrusted.example/OneFiler-1.0.5.dmg",
            validFromMs: Int64((now.timeIntervalSince1970 - 60) * 1000),
            validUntilMs: Int64((now.timeIntervalSince1970 + 3600) * 1000)
        )
        let verifier = ReleaseManifestVerifier(pinnedRootPublicKey: rootPubHex, now: { now })
        XCTAssertThrowsError(try verifier.verify(manifestData: signed.manifestData))
    }

    func testSemanticVersionComparison() throws {
        let v104 = try XCTUnwrap(SemanticVersion("1.0.4"))
        let v105 = try XCTUnwrap(SemanticVersion("1.0.5"))
        let v110 = try XCTUnwrap(SemanticVersion("1.1.0"))
        let v105Beta1 = try XCTUnwrap(SemanticVersion("1.0.5-beta.1"))
        let v105Beta2 = try XCTUnwrap(SemanticVersion("1.0.5-beta.2"))

        XCTAssertLessThan(v104, v105)
        XCTAssertLessThan(v105, v110)
        XCTAssertLessThan(v105Beta1, v105Beta2)
        XCTAssertLessThan(v105Beta2, v105)
        XCTAssertEqual(SemanticVersion("v1.0.4"), v104)
        XCTAssertNil(SemanticVersion("not-a-version"))
    }
}

/// Helper that generates genuinely signed Ed25519 Refinio release manifests for tests.
enum SignedManifestFixture {
    struct Output {
        let manifest: RefinioReleaseManifest
        let manifestData: Data
        let dmgSHA256: String
    }

    static func make(
        rootKey: Curve25519.Signing.PrivateKey,
        version: String,
        dmgBytes: Data,
        filename: String? = nil,
        stableUrl: String? = nil,
        validFromMs: Int64 = 1_790_000_000_000,
        validUntilMs: Int64 = 1_900_000_000_000
    ) throws -> Output {
        let sourceFilename = filename ?? "OneFiler-\(version).dmg"
        let url = stableUrl ?? "https://refinio.one/installers/filer/\(sourceFilename)"
        let rootPubHex = ReleaseManifestVerifier.hexString(rootKey.publicKey.rawRepresentation)
        let rootFingerprint = try ReleaseManifestVerifier.rootFingerprint(forPublicKeyHex: rootPubHex)

        let publisherKey = Curve25519.Signing.PrivateKey()
        let publisherPubHex = ReleaseManifestVerifier.hexString(publisherKey.publicKey.rawRepresentation)
        let claims = PublisherCertificateClaims(canSign: true, purposes: ["signing"])
        let claimsJSON = try ReleaseManifestVerifier.canonicalJSONObject([
            ("canSign", "true"),
            ("purposes", "[\"signing\"]"),
        ])
        let certPayload = ["42-release", publisherPubHex, rootPubHex, String(validFromMs), String(validUntilMs), claimsJSON].joined(separator: "|")
        let certSig = ReleaseManifestVerifier.hexString(try rootKey.signature(for: Data(certPayload.utf8)))
        let cert = PublisherCertificate(
            subject: "42-release",
            subjectPublicKey: publisherPubHex,
            issuerPublicKey: rootPubHex,
            validFrom: validFromMs,
            validUntil: validUntilMs,
            claims: claims,
            signature: certSig
        )

        let dmgSHA256 = ReleaseManifestVerifier.sha256Hex(dmgBytes)
        let signedAt = validFromMs + 100
        let artifactSigPayload = [dmgSHA256, publisherPubHex, String(signedAt)].joined(separator: "|")
        let artifactSigHex = ReleaseManifestVerifier.hexString(try publisherKey.signature(for: Data(artifactSigPayload.utf8)))
        let artifactChain = PackageSignatureChain(
            rootPublicKey: rootPubHex,
            publisherCert: cert,
            packageSignature: PackageSignature(
                dataHash: dmgSHA256,
                publisherPublicKey: publisherPubHex,
                signedAt: signedAt,
                signature: artifactSigHex
            )
        )
        let artifactChainJSON = String(data: try ReleaseManifestVerifier.canonicalJSONEncode(artifactChain), encoding: .utf8)!

        let provisionalArtifact = RefinioReleaseArtifact(
            platform: "macos",
            arch: "universal",
            label: "OneFiler macOS disk image",
            stableUrl: url,
            sourceFilename: sourceFilename,
            sizeBytes: Int64(dmgBytes.count),
            sha256: dmgSHA256,
            packageMetadataHash: ReleaseManifestVerifier.sha256Hex(Data("meta-\(version)".utf8)),
            signatureChain: artifactChainJSON,
            leafHash: "",
            merkleProof: []
        )
        let leafHash = try ReleaseManifestVerifier.computeArtifactLeafHash(
            channel: "latest",
            releaseVersion: version,
            artifact: provisionalArtifact
        )
        let finalArtifact = RefinioReleaseArtifact(
            platform: provisionalArtifact.platform,
            arch: provisionalArtifact.arch,
            label: provisionalArtifact.label,
            stableUrl: provisionalArtifact.stableUrl,
            sourceFilename: provisionalArtifact.sourceFilename,
            sizeBytes: provisionalArtifact.sizeBytes,
            sha256: provisionalArtifact.sha256,
            packageMetadataHash: provisionalArtifact.packageMetadataHash,
            signatureChain: provisionalArtifact.signatureChain,
            leafHash: leafHash,
            merkleProof: []
        )

        let placeholderManifest = RefinioReleaseManifest(
            schemaVersion: 1,
            channel: "latest",
            releaseVersion: version,
            publishedAt: "2026-11-23T12:00:00.000Z",
            releaseRootPublicKey: rootPubHex,
            releaseRootFingerprint: rootFingerprint,
            merkleRoot: leafHash,
            artifacts: [finalArtifact],
            manifestSignatureChain: artifactChain
        )
        let manifestHash = try ReleaseManifestVerifier.computeManifestHash(placeholderManifest)
        let manifestSigPayload = [manifestHash, publisherPubHex, String(signedAt + 1)].joined(separator: "|")
        let manifestSigHex = ReleaseManifestVerifier.hexString(try publisherKey.signature(for: Data(manifestSigPayload.utf8)))
        let manifestChain = PackageSignatureChain(
            rootPublicKey: rootPubHex,
            publisherCert: cert,
            packageSignature: PackageSignature(
                dataHash: manifestHash,
                publisherPublicKey: publisherPubHex,
                signedAt: signedAt + 1,
                signature: manifestSigHex
            )
        )

        let manifest = RefinioReleaseManifest(
            schemaVersion: placeholderManifest.schemaVersion,
            channel: placeholderManifest.channel,
            releaseVersion: placeholderManifest.releaseVersion,
            publishedAt: placeholderManifest.publishedAt,
            releaseRootPublicKey: placeholderManifest.releaseRootPublicKey,
            releaseRootFingerprint: placeholderManifest.releaseRootFingerprint,
            merkleRoot: placeholderManifest.merkleRoot,
            artifacts: placeholderManifest.artifacts,
            manifestSignatureChain: manifestChain
        )
        let data = try ReleaseManifestVerifier.canonicalJSONEncode(manifest)
        return Output(manifest: manifest, manifestData: data, dmgSHA256: dmgSHA256)
    }
}
