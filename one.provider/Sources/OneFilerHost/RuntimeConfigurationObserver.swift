import Foundation
import Darwin

/// Watch the directory so atomic replacement of domains.json does not detach the observation.
final class RuntimeConfigurationObserver {
    private let source: DispatchSourceFileSystemObject

    init(directory: URL, onReady: @escaping () -> Void = {}, onChange: @escaping () -> Void) throws {
        let fd = Darwin.open(directory.path, O_EVTONLY | O_CLOEXEC)
        guard fd >= 0 else { throw CocoaError(.fileReadNoPermission) }
        source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: .write,
            queue: DispatchQueue(label: "one.filer.runtime.configuration"))
        source.setRegistrationHandler(handler: onReady)
        source.setEventHandler(handler: onChange)
        source.setCancelHandler { Darwin.close(fd) }
        source.resume()
    }

    func stop() { source.cancel() }
    deinit { source.cancel() }
}
