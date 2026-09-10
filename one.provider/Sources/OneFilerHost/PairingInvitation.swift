import Foundation
#if SWIFT_PACKAGE
import OneFilerShared
#endif

/// Decode the URL without logging its bearer token or persisting it in domain configuration.
enum PairingInvitation {
    static func request(url text: String) throws -> Data {
        guard text.utf8.count <= 65536,
              let url = URLComponents(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              ["https", "http"].contains(url.scheme?.lowercased() ?? ""), url.host != nil,
              let fragment = url.fragment, let data = fragment.data(using: .utf8),
              let invitation = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = invitation["token"] as? String, !token.isEmpty,
              let publicKey = invitation["publicKey"] as? String, isHash(publicKey),
              let address = invitation["url"] as? String,
              let endpoint = URLComponents(string: address), endpoint.host != nil,
              ["wss", "ws"].contains(endpoint.scheme?.lowercased() ?? "") else {
            throw PrivateSocket.failure("Paste a complete ONE pairing invitation link.")
        }
        guard invitation["pairingProtocolVersion"] as? Int == 2 else {
            throw PrivateSocket.failure("This invitation uses an unsupported pairing version. Create a new invitation in the other app.")
        }
        return try JSONSerialization.data(withJSONObject: ["operation": "pairing:connectUsingInvitation",
            "request": ["invitation": invitation], "requestId": UUID().uuidString])
    }

    /// Validate transport success independently from clinical synchronization completion.
    static func validateResponse(_ bytes: Data) throws {
        guard let response = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              response["success"] as? Bool == true,
              let result = response["result"] as? [String: Any], result["status"] as? String == "connected" else {
            throw PrivateSocket.failure("Pairing failed. Check the invitation, domain identity, and the other app's connection status.")
        }
    }

    private static func isHash(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
}
