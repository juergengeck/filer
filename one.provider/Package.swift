// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "OneFiler",
    platforms: [
        .macOS("13.5")
    ],
    products: [
        .library(
            name: "OneFilerExtension",
            targets: ["OneFilerExtension"])
    ],
    dependencies: [.package(path: "../../one/packages/filer.swift")],
    targets: [
        .target(name: "OneFilerShared", path: "Sources/OneFilerShared"),        // File Provider extension library
        .target(
            name: "OneFilerExtension",
            dependencies: ["OneFilerShared", .product(name: "OneFilerCore", package: "filer.swift")],
            path: "Sources/OneFiler"
        ),

        // Tests
        .target(
            name: "OneFilerHostSupport",
            dependencies: ["OneFilerShared"],
            path: "Sources/OneFilerHost",
            exclude: ["main.swift", "MenuBarApp.swift", "StatusMonitor.swift"],
            sources: ["DomainManager.swift", "DomainRegistrationForm.swift", "NodeRuntimeProcess.swift", "InstanceSecrets.swift", "RuntimeService.swift", "RuntimePool.swift", "RuntimeConfigurationObserver.swift", "PairingInvitation.swift", "FilerQAProgress.swift", "MainMenu.swift", "EnrollDomainCommand.swift", "GlueEnrollmentSession.swift"]
        ),
        .testTarget(
            name: "OneFilerTests",
            dependencies: [
                "OneFilerExtension", "OneFilerHostSupport",
                .product(name: "OneFilerCore", package: "filer.swift")
            ],
            path: "Tests/OneFilerTests"
        )
    ]
)
