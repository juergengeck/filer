import Foundation
import CryptoKit

/// Versioned complete-file request. Redelivery of the same base and bytes keeps its identity.
struct ContentWriteRequest {
    let path: String
    let content: Data
    let baseVersion: Data?

    var parameters: [String: Any] {
        var result: [String: Any] = ["path": path, "content": content.base64EncodedString()]
        if let baseVersion {
            result["baseVersion"] = baseVersion.base64EncodedString()
            result["operationId"] = operationId
        }
        return result
    }

    /// Length framing prevents ambiguous concatenations; the base distinguishes deliberate later edits.
    var operationId: String {
        var hash = SHA256()
        for part in [Data("filer.content-write.v1".utf8), Data(path.utf8), baseVersion ?? Data(), content] {
            var length = UInt64(part.count).bigEndian
            withUnsafeBytes(of: &length) { hash.update(data: Data($0)) }
            hash.update(data: part)
        }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }
}
