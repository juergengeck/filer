import Foundation

/// Materialize a file with bounded memory and remove incomplete output on failure or cancellation.
enum ContentHydration {
    static let chunkSize = 1024 * 1024

    static func write(to destination: URL, size: Int, progress: Progress,
                      read: (Int, Int) async throws -> Data) async throws {
        guard size >= 0 else { throw ONEBridgeError.invalidResponse }
        guard FileManager.default.createFile(atPath: destination.path, contents: nil) else {
            throw CocoaError(.fileWriteUnknown)
        }
        let handle = try FileHandle(forWritingTo: destination)
        var complete = false
        defer {
            try? handle.close()
            if !complete { try? FileManager.default.removeItem(at: destination) }
        }
        progress.totalUnitCount = Int64(size)
        var offset = 0
        while offset < size {
            try Task.checkCancellation()
            if progress.isCancelled { throw CancellationError() }
            let count = min(chunkSize, size - offset)
            let bytes = try await read(count, offset)
            guard !bytes.isEmpty, bytes.count <= count else { throw ONEBridgeError.invalidResponse }
            try Task.checkCancellation()
            if progress.isCancelled { throw CancellationError() }
            try handle.write(contentsOf: bytes)
            offset += bytes.count
            progress.completedUnitCount = Int64(offset)
        }
        try handle.synchronize()
        try handle.close()
        complete = true
    }
}
