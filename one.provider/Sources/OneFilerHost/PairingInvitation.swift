import Foundation
#if SWIFT_PACKAGE
import OneFilerShared
#endif

/// Decode the URL without logging its Bearer [REDACTED] or persisting it in domain configuration.
enum PairingInvitation {
    /// Product-level invitation kind, mirroring Flexibel's IoM/IoP invitation modes.
    enum Kind: Equatable {
        case partner
        case deviceEnrollment(email: String?, owner: String?)
    }

    /// Transport-validated invitation plus its product-level enrollment metadata.
    struct Envelope {
        let kind: Kind
        let invitation: [String: Any]
        /// Account email from the `fe` query parameter (present on Flexibel-built invites).
        let email: String?
        /// Enrollment owner: the `fdi` query parameter, falling back to the
        /// fragment's deviceEnrollmentPersonId.
        let enrollmentOwner: String?
    }

    /// Parse and transport-validate the link, classifying partner vs enrollment.
    static func envelope(url text: String) throws -> Envelope {
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
        let query = url.queryItems ?? []
        let email = query.first { $0.name == "fe" }.flatMap { $0.value }.flatMap { $0.isEmpty ? nil : $0 }
        let queryOwner = query.first { $0.name == "fdi" }.flatMap { $0.value }.flatMap { $0.isEmpty ? nil : $0 }
        let fragmentOwner = invitation["deviceEnrollmentPersonId"] as? String
        if let queryOwner, let fragmentOwner, queryOwner != fragmentOwner {
            throw PrivateSocket.failure("This invitation names conflicting enrollment owners. Create a new invitation in the other app.")
        }
        let owner = queryOwner ?? fragmentOwner
        let relation = invitation["identityRelation"] as? String
        let mode = invitation["mode"] as? String
        let kind: Kind
        if mode == "IoM" || relation == "same-person" || relation == "device-enrollment" || owner != nil {
            kind = .deviceEnrollment(email: email, owner: owner)
        } else {
            kind = .partner
        }
        return Envelope(kind: kind, invitation: invitation, email: email, enrollmentOwner: owner)
    }

    static func kind(url text: String) throws -> Kind {
        try envelope(url: text).kind
    }

    /// Partner (distinct-person) pairing only. Enrollment invites carry another
    /// identity and must go through enrollRequest after explicit user consent.
    static func request(url text: String) throws -> Data {
        let envelope = try envelope(url: text)
        guard envelope.kind == .partner else {
            throw PrivateSocket.failure("This invitation enrolls a device for another identity. Accept it through the Pair dialog's device enrollment.")
        }
        return try frame(operation: "pairing:connectUsingInvitation",
                         request: ["invitation": envelope.invitation])
    }

    /// Bind device enrollment to one exact owner. The domain's identity email
    /// must match the invitation's account email so the local Person is the
    /// inviter's Person; the runtime enforces the same binding on its side.
    static func enrollRequest(url text: String, domainEmail: String, consented: Bool) throws -> Data {
        let envelope = try envelope(url: text)
        guard case .deviceEnrollment = envelope.kind else {
            throw PrivateSocket.failure("This invitation pairs a distinct person, not a device enrollment.")
        }
        guard consented else {
            throw PrivateSocket.failure("Device enrollment requires explicit consent in the Pair dialog.")
        }
        guard let owner = envelope.enrollmentOwner, isHash(owner) else {
            throw PrivateSocket.failure("This enrollment invitation names no verifiable owner. Create a new invitation in the other app.")
        }
        if let email = envelope.email {
            let expected = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let actual = domainEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard !expected.isEmpty, expected == actual else {
                throw PrivateSocket.failure("This invitation enrolls a device for \(email). This domain uses \(domainEmail); register a domain with the matching email first.")
            }
        }
        return try frame(operation: "pairing:acceptDeviceEnrollment",
                         request: ["invitation": envelope.invitation, "expectedOwnerPersonId": owner])
    }

    /// Validate transport success independently from clinical synchronization completion.
    static func validateResponse(_ bytes: Data) throws {
        guard let response = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              response["success"] as? Bool == true,
              let result = response["result"] as? [String: Any], result["status"] as? String == "connected" else {
            throw PrivateSocket.failure("Pairing failed. Check the invitation, domain identity, and the other app's connection status.")
        }
    }

    private static func frame(operation: String, request: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: ["operation": operation,
            "request": request, "requestId": UUID().uuidString])
    }

    private static func isHash(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
}
