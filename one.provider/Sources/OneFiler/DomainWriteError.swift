import Foundation
import FileProvider

/// Preserve an owning service's actionable failure at the native provider boundary.
enum DomainWriteError {
    static func fromRPC(code: Int, message: String) -> NSError {
        let rpcError = NSError(domain: "one.filer.rpc", code: code,
                               userInfo: [NSLocalizedDescriptionKey: message])
        // A rejected save must stay unsynchronized until the user edits/resaves it.
        // The domain conflict/validation code remains available as the underlying error.
        if code == -32010 || code == -32012 || code == -32014 {
            return NSError(domain: NSFileProviderErrorDomain,
                           code: NSFileProviderError.Code.cannotSynchronize.rawValue,
                           userInfo: [NSLocalizedDescriptionKey: message, NSUnderlyingErrorKey: rpcError])
        }
        if code == -32011 {
            return NSError(domain: NSCocoaErrorDomain,
                           code: CocoaError.Code.fileWriteNoPermission.rawValue,
                           userInfo: [NSLocalizedDescriptionKey: message])
        }
        return rpcError
    }
}
