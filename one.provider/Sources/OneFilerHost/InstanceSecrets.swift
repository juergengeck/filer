import Foundation
import Security

/// The app owns secrets in its Keychain; extensions receive only operation results.
enum InstanceSecrets {
    static func getOrCreate(instance: UUID) throws -> String {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "one.filer.instance", kSecAttrAccount as String: instance.uuidString]
        var item: CFTypeRef?
        var read = query
        read[kSecReturnData as String] = true
        let status = SecItemCopyMatching(read as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data, let secret = String(data: data, encoding: .utf8) {
            return secret
        }
        guard status == errSecItemNotFound else { throw failure(status) }
        var bytes = [UInt8](repeating: 0, count: 32)
        let randomStatus = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard randomStatus == errSecSuccess else { throw failure(randomStatus) }
        let secret = bytes.map { String(format: "%02x", $0) }.joined()
        var add = query
        add[kSecValueData as String] = Data(secret.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(add as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw failure(addStatus) }
        return secret
    }

    private static func failure(_ status: OSStatus) -> NSError {
        NSError(domain: NSOSStatusErrorDomain, code: Int(status),
                userInfo: [NSLocalizedDescriptionKey: "Filer cannot access its instance credential in Keychain."])
    }
}
