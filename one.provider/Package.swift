// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "OneFiler",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .library(
            name: "OneFilerExtension",
            targets: ["OneFilerExtension"])
    ],
    dependencies: [],
    targets: [
        .target(name: "OneFilerShared", path: "Sources/OneFilerShared"),        // File Provider extension library
        .target(
            name: "OneFilerExtension",
            dependencies: ["OneFilerShared"],
            path: "Sources/OneFiler"
        ),

        // Tests
        .target(
            name: "OneFilerHostSupport",
            dependencies: ["OneFilerShared"],
            path: "Sources/OneFilerHost",
            exclude: ["main.swift", "MenuBarApp.swift", "StatusMonitor.swift"],
            sources: ["DomainManager.swift", "NodeRuntimeProcess.swift", "InstanceSecrets.swift", "RuntimeService.swift", "RuntimePool.swift", "RuntimeConfigurationObserver.swift", "PairingInvitation.swift"]
        ),
        .testTarget(
            name: "OneFilerTests",
            dependencies: ["OneFilerExtension", "OneFilerHostSupport"],
            path: "Tests/OneFilerTests"
        )
    ]
)
