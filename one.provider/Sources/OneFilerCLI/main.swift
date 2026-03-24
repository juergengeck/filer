import Foundation
import FileProvider

/// OneFiler CLI - Manages macOS File Provider domains
enum OneFilerCLI {
    static func run() async {
        let args = CommandLine.arguments
        guard args.count > 1 else {
            printUsage()
            exit(1)
        }

        let command = args[1]

        do {
            switch command {
            case "register":
                try await registerDomain(args: Array(args.dropFirst(2)))
            case "unregister":
                try await unregisterDomain(args: Array(args.dropFirst(2)))
            case "list":
                try await listDomains()
            case "status":
                try await checkStatus()
            case "help", "--help", "-h":
                printUsage()
            default:
                print("❌ Unknown command: \(command)")
                printUsage()
                exit(1)
            }
        } catch {
            print("❌ Error: \(error)")
            exit(1)
        }
    }

    static func printUsage() {
        print("""
        OneFiler - macOS File Provider Domain Manager

        Usage:
          onefiler register --name <name> --path <instance-path>
          onefiler unregister --name <name>
          onefiler list
          onefiler status
          onefiler help

        Commands:
          register    Register a new File Provider domain
          unregister  Unregister an existing domain
          list        List all registered domains
          status      Check File Provider extension status and installation
          help        Show this help message

        Options:
          --name      Domain display name (required for register/unregister)
          --path      ONE instance storage path (required for register)

        Examples:
          onefiler register --name "ONE" --path "/Users/user/.refinio/instance"
          onefiler unregister --name "ONE"
          onefiler list
        """)
    }

    static func registerDomain(args: [String]) async throws {
        var name: String?
        var path: String?

        var i = 0
        while i < args.count {
            switch args[i] {
            case "--name":
                guard i + 1 < args.count else {
                    throw CLIError.missingArgument("--name requires a value")
                }
                name = args[i + 1]
                i += 2
            case "--path":
                guard i + 1 < args.count else {
                    throw CLIError.missingArgument("--path requires a value")
                }
                path = args[i + 1]
                i += 2
            default:
                throw CLIError.unknownArgument(args[i])
            }
        }

        guard let domainName = name else {
            throw CLIError.missingArgument("--name is required")
        }
        guard let instancePath = path else {
            throw CLIError.missingArgument("--path is required")
        }

        // Read credentials from environment variables (set by refinio.api)
        let email = ProcessInfo.processInfo.environment["REFINIO_INSTANCE_EMAIL"]
        let secret = ProcessInfo.processInfo.environment["REFINIO_INSTANCE_SECRET"]
        let instanceName = ProcessInfo.processInfo.environment["REFINIO_INSTANCE_NAME"]

        // Create domain identifier from name (lowercase, replace spaces with dashes)
        let identifier = domainName
            .lowercased()
            .replacingOccurrences(of: " ", with: "-")
            .replacingOccurrences(of: "_", with: "-")

        let domainIdentifier = NSFileProviderDomainIdentifier(rawValue: identifier)
        let domain = NSFileProviderDomain(identifier: domainIdentifier, displayName: domainName)

        // Write domain configuration to App Group container (including credentials)
        try writeDomainConfig(
            identifier: identifier,
            path: instancePath,
            email: email,
            secret: secret,
            instanceName: instanceName
        )

        // Register domain with macOS
        do {
            try await NSFileProviderManager.add(domain)
            print("✅ Domain registered successfully")
            print("   Name: \(domainName)")
            print("   ID: \(identifier)")
            print("   Path: \(instancePath)")
        } catch NSFileProviderError.providerNotFound {
            // Domain may already exist - not a fatal error
            print("⚠️  Domain already exists, configuration updated")
            print("   Name: \(domainName)")
            print("   ID: \(identifier)")
            print("   Path: \(instancePath)")
        } catch {
            // Domain might already exist - check if we can get a manager for it
            if let _ = NSFileProviderManager(for: domain) {
                print("⚠️  Domain already exists, configuration updated")
                print("   Name: \(domainName)")
                print("   ID: \(identifier)")
                print("   Path: \(instancePath)")
            } else {
                throw CLIError.registrationFailed("Failed to register domain: \(error)")
            }
        }

        // Signal macOS to load the File Provider extension and create the mount point
        // This works whether the domain is new or already existed
        if let manager = NSFileProviderManager(for: domain) {
            do {
                try await manager.signalEnumerator(for: .workingSet)
                print("✅ Signaled File Provider to create mount point")
                print("   Mount will appear at: ~/Library/CloudStorage/OneFiler-\(domainName)")
            } catch {
                print("⚠️  Warning: Failed to signal enumerator: \(error)")
                print("   The mount point may not appear immediately")
            }
        }
    }

    static func unregisterDomain(args: [String]) async throws {
        var name: String?

        var i = 0
        while i < args.count {
            switch args[i] {
            case "--name":
                guard i + 1 < args.count else {
                    throw CLIError.missingArgument("--name requires a value")
                }
                name = args[i + 1]
                i += 2
            default:
                throw CLIError.unknownArgument(args[i])
            }
        }

        guard let domainName = name else {
            throw CLIError.missingArgument("--name is required")
        }

        let identifier = domainName
            .lowercased()
            .replacingOccurrences(of: " ", with: "-")
            .replacingOccurrences(of: "_", with: "-")

        let domainIdentifier = NSFileProviderDomainIdentifier(rawValue: identifier)
        let domains = try await NSFileProviderManager.domains()

        guard let domain = domains.first(where: { $0.identifier == domainIdentifier }) else {
            throw CLIError.domainNotFound("Domain '\(domainName)' not found")
        }

        try await NSFileProviderManager.remove(domain)

        // Remove from config
        try removeDomainConfig(identifier: identifier)

        print("✅ Domain unregistered successfully")
        print("   Name: \(domainName)")
        print("   ID: \(identifier)")
    }

    static func listDomains() async throws {
        let domains = try await NSFileProviderManager.domains()

        if domains.isEmpty {
            print("No File Provider domains registered")
            return
        }

        print("Registered File Provider Domains:")
        print("")

        for domain in domains {
            print("  • \(domain.displayName)")
            print("    ID: \(domain.identifier.rawValue)")

            // Try to read instance path from config
            if let domainConfig = try? readDomainConfig(identifier: domain.identifier.rawValue) {
                print("    Path: \(domainConfig.path)")
            }
            print("")
        }
    }

    static func checkStatus() async throws {
        print("🔍 OneFiler File Provider Status Check\n")
        print("=" + String(repeating: "=", count: 70))

        var allChecksPass = true

        // 1. Check if running from /Applications
        print("\n1️⃣ Installation Location")
        let bundlePath = Bundle.main.bundlePath
        let isInApplications = bundlePath.hasPrefix("/Applications/")

        if isInApplications {
            print("   ✅ OneFiler.app is installed in /Applications")
            print("   📍 Location: \(bundlePath)")
        } else {
            print("   ⚠️  OneFiler.app is NOT in /Applications")
            print("   📍 Current location: \(bundlePath)")
            print("   ℹ️  For File Provider to work, the app must be in /Applications")
            print("   💡 Run: sudo cp -R \(bundlePath) /Applications/")
            allChecksPass = false
        }

        // 2. Check code signing
        print("\n2️⃣ Code Signing")
        let appPath = isInApplications ? "/Applications/OneFiler.app" : bundlePath
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/codesign")
        task.arguments = ["-dv", appPath]

        let pipe = Pipe()
        task.standardError = pipe
        task.standardOutput = pipe

        do {
            try task.run()
            task.waitUntilExit()

            if task.terminationStatus == 0 {
                print("   ✅ App is properly code signed")

                // Read signing info
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                if let output = String(data: data, encoding: .utf8) {
                    if let teamLine = output.components(separatedBy: "\n").first(where: { $0.contains("TeamIdentifier") }) {
                        print("   👤 \(teamLine.trimmingCharacters(in: .whitespaces))")
                    }
                }
            } else {
                print("   ⚠️  Code signing verification failed")
                allChecksPass = false
            }
        } catch {
            print("   ⚠️  Could not verify code signing: \(error.localizedDescription)")
            allChecksPass = false
        }

        // 3. Check if extension is registered with pluginkit
        print("\n3️⃣ Extension Registration")
        let pkTask = Process()
        pkTask.executableURL = URL(fileURLWithPath: "/usr/bin/pluginkit")
        pkTask.arguments = ["-m", "-v", "-p", "com.apple.fileprovider-nonui"]

        let pkPipe = Pipe()
        pkTask.standardOutput = pkPipe
        pkTask.standardError = pkPipe

        do {
            try pkTask.run()
            pkTask.waitUntilExit()

            let data = pkPipe.fileHandleForReading.readDataToEndOfFile()
            if let output = String(data: data, encoding: .utf8) {
                if output.contains("com.one.filer.extension") {
                    print("   ✅ Extension is registered with macOS")
                    if let extensionLine = output.components(separatedBy: "\n").first(where: { $0.contains("com.one.filer.extension") }) {
                        print("   📦 \(extensionLine.trimmingCharacters(in: .whitespaces).components(separatedBy: "\t").first ?? "")")
                    }
                } else {
                    print("   ⚠️  Extension is NOT registered with macOS")
                    print("   ℹ️  The extension may need to be enabled in System Settings")
                    allChecksPass = false
                }
            }
        } catch {
            print("   ⚠️  Could not check extension registration: \(error.localizedDescription)")
            allChecksPass = false
        }

        // 4. Check registered domains
        print("\n4️⃣ Registered Domains")
        let domains = try await NSFileProviderManager.domains()

        if domains.isEmpty {
            print("   ℹ️  No File Provider domains registered")
            print("   💡 Use 'onefiler register --name <name> --path <path>' to register a domain")
        } else {
            print("   ✅ \(domains.count) domain(s) registered:")
            for domain in domains {
                print("      • \(domain.displayName) (ID: \(domain.identifier.rawValue))")

                // Try to get manager and signal enumerator to test if extension can be loaded
                if let manager = NSFileProviderManager(for: domain) {
                    do {
                        try await manager.signalEnumerator(for: .workingSet)
                        print("        ✅ Extension can be loaded for this domain")
                    } catch let error as NSError {
                        if error.code == -2001 {
                            print("        ⚠️  Extension cannot be loaded (not enabled)")
                            allChecksPass = false
                        } else {
                            print("        ⚠️  Extension signal failed: \(error.localizedDescription)")
                            allChecksPass = false
                        }
                    }
                }
            }
        }

        // 5. Check CloudStorage mount points
        print("\n5️⃣ CloudStorage Mount Points")
        let cloudStoragePath = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/CloudStorage")

        if FileManager.default.fileExists(atPath: cloudStoragePath.path) {
            do {
                let contents = try FileManager.default.contentsOfDirectory(atPath: cloudStoragePath.path)
                let oneFilerMounts = contents.filter { $0.hasPrefix("OneFiler-") }

                if oneFilerMounts.isEmpty {
                    print("   ℹ️  No OneFiler mount points found")
                    print("   💡 Mount points appear when:")
                    print("      1. Extension is enabled in System Settings")
                    print("      2. A domain is registered")
                    print("      3. macOS loads the extension (happens on first file access)")
                } else {
                    print("   ✅ Found \(oneFilerMounts.count) OneFiler mount(s):")
                    for mount in oneFilerMounts {
                        print("      • ~/Library/CloudStorage/\(mount)")
                    }
                }
            } catch {
                print("   ⚠️  Could not read CloudStorage directory: \(error.localizedDescription)")
            }
        }

        // Summary
        print("\n" + String(repeating: "=", count: 70))
        if allChecksPass && !domains.isEmpty {
            print("✅ All checks passed! File Provider is ready to use.")
        } else {
            print("\n⚠️  Setup incomplete. Please address the issues above.\n")
            print("📋 Setup Steps:")
            if !isInApplications {
                print("   1. Install OneFiler.app to /Applications")
                print("      sudo cp -R \(bundlePath) /Applications/")
            }
            print("   2. Open System Settings")
            print("   3. Go to: Privacy & Security → Extensions → File Provider")
            print("   4. Enable the 'OneFiler' extension")
            if domains.isEmpty {
                print("   5. Register a domain:")
                print("      onefiler register --name MyDomain --path /path/to/instance")
            }
            print("\n   After completing these steps, run 'onefiler status' again to verify.")
        }
        print("")
    }

    // MARK: - Domain Configuration Management

    static func getContainerPath() -> URL? {
        let fileManager = FileManager.default
        let containerURL = fileManager
            .containerURL(forSecurityApplicationGroupIdentifier: "group.one.filer")
        return containerURL
    }

    struct DomainConfig: Codable {
        let path: String
        let email: String?
        let secret: String?
        let name: String?
    }

    static func writeDomainConfig(
        identifier: String,
        path: String,
        email: String?,
        secret: String?,
        instanceName: String?
    ) throws {
        guard let containerURL = getContainerPath() else {
            throw CLIError.configurationFailed("Failed to access App Group container")
        }

        let configURL = containerURL.appendingPathComponent("domains.json")

        // Read existing config or create new
        var config: [String: DomainConfig] = [:]
        if FileManager.default.fileExists(atPath: configURL.path) {
            let data = try Data(contentsOf: configURL)
            config = try JSONDecoder().decode([String: DomainConfig].self, from: data)
        }

        // Add/update domain
        config[identifier] = DomainConfig(
            path: path,
            email: email,
            secret: secret,
            name: instanceName
        )

        // Write back
        let data = try JSONEncoder().encode(config)
        try data.write(to: configURL)
    }

    static func removeDomainConfig(identifier: String) throws {
        guard let containerURL = getContainerPath() else {
            return
        }

        let configURL = containerURL.appendingPathComponent("domains.json")

        guard FileManager.default.fileExists(atPath: configURL.path) else {
            return
        }

        let data = try Data(contentsOf: configURL)
        var config = try JSONDecoder().decode([String: DomainConfig].self, from: data)
        config.removeValue(forKey: identifier)

        let newData = try JSONEncoder().encode(config)
        try newData.write(to: configURL)
    }

    static func readDomainConfig(identifier: String) throws -> DomainConfig? {
        guard let containerURL = getContainerPath() else {
            return nil
        }

        let configURL = containerURL.appendingPathComponent("domains.json")

        guard FileManager.default.fileExists(atPath: configURL.path) else {
            return nil
        }

        let data = try Data(contentsOf: configURL)
        let config = try JSONDecoder().decode([String: DomainConfig].self, from: data)
        return config[identifier]
    }
}

// MARK: - Error Types

enum CLIError: LocalizedError {
    case missingArgument(String)
    case unknownArgument(String)
    case domainNotFound(String)
    case registrationFailed(String)
    case configurationFailed(String)

    var errorDescription: String? {
        switch self {
        case .missingArgument(let msg),
             .unknownArgument(let msg),
             .domainNotFound(let msg),
             .registrationFailed(let msg),
             .configurationFailed(let msg):
            return msg
        }
    }
}

// Top-level code - entry point for main.swift
import Darwin

// Run the async main function
let task = Task {
    await OneFilerCLI.run()
    Darwin.exit(0)
}

// Keep the main thread alive until the task completes
dispatchMain()
