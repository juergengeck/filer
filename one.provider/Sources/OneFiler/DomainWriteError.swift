import Foundation
import FileProvider

/// Preserve an owning service's actionable failure at the native provider boundary.
enum DomainWriteError {
    static func fromRPC(code: Int, message: String) -> NSError {
        let rpcError = NSError(domain: "one.filer.rpc", code: code,
                               userInfo: [NSLocalizedDescriptionKey: message])
        if code == -32020 { return NSFileProviderError(.syncAnchorExpired) as NSError }
        if code == -32022 { return NSFileProviderError(.versionNoLongerAvailable) as NSError }
        if code == -32021 { return CocoaError(.featureUnsupported) as NSError }
        if code == -2 { return NSFileProviderError(.noSuchItem) as NSError }
        if code == -30 || code == -13 { return CocoaError(.fileWriteNoPermission) as NSError }
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
