import Foundation

/// Structured debug logger that writes to App Group container
/// Provides persistent logs accessible without `log stream`
public actor DebugLogger {

    private let logDirectory: URL
    private let logFileName: String
    private let maxLogSize: Int
    private let maxLogFiles: Int

    /// Initialize logger with App Group container path
    /// - Parameters:
    ///   - component: Component name (e.g., "extension", "bridge")
    ///   - appGroupIdentifier: App Group identifier
    ///   - maxLogSize: Maximum size in bytes before rotation (default: 1MB)
    ///   - maxLogFiles: Maximum number of rotated log files to keep (default: 5)
    public init(component: String, appGroupIdentifier: String = "group.one.filer", maxLogSize: Int = 1_048_576, maxLogFiles: Int = 5) throws {
        guard let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier) else {
            throw DebugLoggerError.appGroupNotFound
        }

        let debugDir = containerURL.appendingPathComponent("debug", isDirectory: true)

        // Create debug directory if it doesn't exist
        try FileManager.default.createDirectory(at: debugDir, withIntermediateDirectories: true)

        self.logDirectory = debugDir
        self.logFileName = "\(component).log"
        self.maxLogSize = maxLogSize
        self.maxLogFiles = maxLogFiles
    }

    // MARK: - Logging Methods

    public func log(_ level: LogLevel, _ message: String, file: String = #file, function: String = #function, line: Int = #line) {
        let timestamp = ISO8601DateFormatter().string(from: Date())
        let fileName = (file as NSString).lastPathComponent
        let logLine = "[\(timestamp)] [\(level.rawValue)] [\(fileName):\(line)] \(function) - \(message)\n"

        write(logLine)
    }

    public func info(_ message: String, file: String = #file, function: String = #function, line: Int = #line) {
        log(.info, message, file: file, function: function, line: line)
    }

    public func debug(_ message: String, file: String = #file, function: String = #function, line: Int = #line) {
        log(.debug, message, file: file, function: function, line: line)
    }

    public func warning(_ message: String, file: String = #file, function: String = #function, line: Int = #line) {
        log(.warning, message, file: file, function: function, line: line)
    }

    public func error(_ message: String, file: String = #file, function: String = #function, line: Int = #line) {
        log(.error, message, file: file, function: function, line: line)
    }

    public func critical(_ message: String, file: String = #file, function: String = #function, line: Int = #line) {
        log(.critical, message, file: file, function: function, line: line)
    }

    // MARK: - File Operations

    private func write(_ content: String) {
        let logFile = logDirectory.appendingPathComponent(logFileName)

        guard let data = content.data(using: .utf8) else { return }

        // Check if log file needs rotation
        if shouldRotate(logFile) {
            rotateLogFile(logFile)
        }

        // Append to current log file
        if FileManager.default.fileExists(atPath: logFile.path) {
            if let fileHandle = try? FileHandle(forWritingTo: logFile) {
                fileHandle.seekToEndOfFile()
                fileHandle.write(data)
                try? fileHandle.close()
            }
        } else {
            try? data.write(to: logFile)
        }
    }

    private func shouldRotate(_ logFile: URL) -> Bool {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: logFile.path),
              let fileSize = attributes[.size] as? Int else {
            return false
        }
        return fileSize >= maxLogSize
    }

    private func rotateLogFile(_ logFile: URL) {
        // Remove oldest log file if we've hit the limit
        let oldestLog = logDirectory.appendingPathComponent("\(logFileName).\(maxLogFiles)")
        try? FileManager.default.removeItem(at: oldestLog)

        // Shift existing rotated logs
        for i in stride(from: maxLogFiles - 1, through: 1, by: -1) {
            let oldPath = logDirectory.appendingPathComponent("\(logFileName).\(i)")
            let newPath = logDirectory.appendingPathComponent("\(logFileName).\(i + 1)")
            try? FileManager.default.moveItem(at: oldPath, to: newPath)
        }

        // Rotate current log to .1
        let rotatedPath = logDirectory.appendingPathComponent("\(logFileName).1")
        try? FileManager.default.moveItem(at: logFile, to: rotatedPath)
    }

    // MARK: - Utility Methods

    /// Get path to current log file (for testing/inspection)
    public func getLogFilePath() -> String {
        logDirectory.appendingPathComponent(logFileName).path
    }

    /// Get all log files (current + rotated)
    public func getAllLogFiles() -> [String] {
        var files = [logDirectory.appendingPathComponent(logFileName).path]
        for i in 1...maxLogFiles {
            let rotatedFile = logDirectory.appendingPathComponent("\(logFileName).\(i)")
            if FileManager.default.fileExists(atPath: rotatedFile.path) {
                files.append(rotatedFile.path)
            }
        }
        return files
    }

    /// Clear all log files
    public func clearLogs() {
        for file in getAllLogFiles() {
            try? FileManager.default.removeItem(atPath: file)
        }
    }
}

// MARK: - Supporting Types

public enum LogLevel: String {
    case debug = "DEBUG"
    case info = "INFO"
    case warning = "WARNING"
    case error = "ERROR"
    case critical = "CRITICAL"
}

public enum DebugLoggerError: Error {
    case appGroupNotFound
    case writeError
}
