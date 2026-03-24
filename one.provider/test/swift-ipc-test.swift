#!/usr/bin/env swift

import Foundation

// MARK: - Simple IPC Bridge Test

class IPCBridgeTest {
    private var nodeProcess: Process?
    private var stdinPipe: Pipe?
    private var stdoutPipe: Pipe?
    private var requestId = 0
    private var stdoutBuffer = Data()

    func run() async throws {
        print("🧪 Starting IPC Bridge Test...")

        // Find node binary and IPC server
        let resourcesPath = URL(fileURLWithPath: #file)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("node-runtime")

        // Use system node for testing
        let nodePath = URL(fileURLWithPath: "/opt/homebrew/bin/node")

        let serverPath = resourcesPath.appendingPathComponent("lib/index.js")

        print("📁 Node binary: \(nodePath.path)")
        print("📁 Server script: \(serverPath.path)")
        print("📁 Resources: \(resourcesPath.path)")

        // Check files exist
        guard FileManager.default.fileExists(atPath: nodePath.path) else {
            throw TestError.nodeNotFound(nodePath.path)
        }
        guard FileManager.default.fileExists(atPath: serverPath.path) else {
            throw TestError.serverNotFound(serverPath.path)
        }

        // Create writable test instance directory
        let testInstancePath = FileManager.default.temporaryDirectory
            .appendingPathComponent("swift-ipc-test-instance-\(ProcessInfo.processInfo.processIdentifier)")

        try? FileManager.default.removeItem(at: testInstancePath)
        try FileManager.default.createDirectory(at: testInstancePath, withIntermediateDirectories: true)

        print("📁 Test instance: \(testInstancePath.path)")

        // Set up Node.js process
        let process = Process()
        process.executableURL = nodePath
        process.arguments = [serverPath.path]
        process.currentDirectoryURL = resourcesPath

        // Set environment
        var environment = ProcessInfo.processInfo.environment
        environment["NODE_PATH"] = resourcesPath.appendingPathComponent("node_modules").path
        process.environment = environment

        // Set up pipes
        let stdin = Pipe()
        let stdout = Pipe()
        let stderr = Pipe()

        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = stderr

        self.stdinPipe = stdin
        self.stdoutPipe = stdout

        // Capture stderr
        stderr.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty {
                handle.readabilityHandler = nil
                return
            }
            if let output = String(data: data, encoding: .utf8) {
                print("📝 Node.js: \(output.trimmingCharacters(in: .whitespacesAndNewlines))")
            }
        }

        // Start process
        try process.run()
        self.nodeProcess = process

        print("✅ Node.js process started (PID: \(process.processIdentifier))")

        // Give it a moment to start
        try await Task.sleep(nanoseconds: 500_000_000) // 0.5s

        // Test 1: Initialize
        print("\n🧪 Test 1: Initialize filesystem")
        let initResult = try await sendRequest(
            method: "initialize",
            params: ["instancePath": testInstancePath.path]
        )
        print("✅ Initialize result: \(initResult)")

        // Test 2: Read root directory
        print("\n🧪 Test 2: Read root directory")
        let rootResult = try await sendRequest(
            method: "readDir",
            params: ["path": "/"]
        )
        print("✅ Root directory: \(rootResult)")

        // Test 3: Read invites directory
        print("\n🧪 Test 3: Read invites directory")
        let invitesResult = try await sendRequest(
            method: "readDir",
            params: ["path": "/invites"]
        )
        print("✅ Invites directory: \(invitesResult)")

        // Test 4: Stat invites directory
        print("\n🧪 Test 4: Stat /invites")
        let statResult = try await sendRequest(
            method: "stat",
            params: ["path": "/invites"]
        )
        print("✅ Stat result: \(statResult)")

        // Cleanup
        print("\n🧹 Cleaning up...")
        process.terminate()
        try? FileManager.default.removeItem(at: testInstancePath)

        print("\n✅ All tests passed!")
    }

    private func sendRequest(method: String, params: [String: Any]) async throws -> [String: Any] {
        requestId += 1
        let id = requestId

        let request: [String: Any] = [
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "id": id
        ]

        let data = try JSONSerialization.data(withJSONObject: request)
        var dataWithNewline = data
        dataWithNewline.append(contentsOf: "\n".utf8)

        print("📤 Sending: \(method) (id: \(id))")

        try stdinPipe?.fileHandleForWriting.write(contentsOf: dataWithNewline)

        // Read response
        return try await withCheckedThrowingContinuation { continuation in
            readResponse(id: id, continuation: continuation)
        }
    }

    private func readResponse(id: Int, continuation: CheckedContinuation<[String: Any], Error>) {
        guard let stdout = stdoutPipe?.fileHandleForReading else {
            continuation.resume(throwing: TestError.noPipe)
            return
        }

        // Read available data
        let data = stdout.availableData
        guard !data.isEmpty else {
            continuation.resume(throwing: TestError.emptyResponse)
            return
        }

        stdoutBuffer.append(data)

        // Try to parse complete JSON-RPC messages
        if let string = String(data: stdoutBuffer, encoding: .utf8) {
            let lines = string.components(separatedBy: "\n")

            for (index, line) in lines.enumerated() {
                guard !line.isEmpty else { continue }

                do {
                    if let jsonData = line.data(using: .utf8),
                       let response = try JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
                       let responseId = response["id"] as? Int {

                        if responseId == id {
                            // Remove processed data from buffer
                            if let consumed = lines[...index].joined(separator: "\n").data(using: .utf8) {
                                stdoutBuffer.removeFirst(min(consumed.count + 1, stdoutBuffer.count))
                            }

                            if let error = response["error"] as? [String: Any] {
                                continuation.resume(throwing: TestError.ipcError(error))
                            } else if let result = response["result"] as? [String: Any] {
                                continuation.resume(returning: result)
                            } else {
                                continuation.resume(throwing: TestError.invalidResponse)
                            }
                            return
                        }
                    }
                } catch {
                    // Not a complete JSON yet, keep buffering
                    continue
                }
            }
        }

        // Need more data - read again
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.1) {
            self.readResponse(id: id, continuation: continuation)
        }
    }

    enum TestError: Error, LocalizedError {
        case nodeNotFound(String)
        case serverNotFound(String)
        case noPipe
        case emptyResponse
        case ipcError([String: Any])
        case invalidResponse

        var errorDescription: String? {
            switch self {
            case .nodeNotFound(let path):
                return "Node.js binary not found at: \(path)"
            case .serverNotFound(let path):
                return "IPC server not found at: \(path)"
            case .noPipe:
                return "No stdout pipe available"
            case .emptyResponse:
                return "Empty response from Node.js"
            case .ipcError(let error):
                return "IPC error: \(error)"
            case .invalidResponse:
                return "Invalid response format"
            }
        }
    }
}

// Run test
Task {
    do {
        let test = IPCBridgeTest()
        try await test.run()
        exit(0)
    } catch {
        print("❌ Test failed: \(error)")
        exit(1)
    }
}

// Keep running
RunLoop.main.run()
