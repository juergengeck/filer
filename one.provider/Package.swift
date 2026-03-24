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
            targets: ["OneFilerExtension"]),
        .executable(
            name: "onefiler",
            targets: ["OneFilerCLI"])
    ],
    dependencies: [],
    targets: [
        // File Provider extension library
        .target(
            name: "OneFilerExtension",
            dependencies: [],
            path: "Sources/OneFiler",
            resources: [
                .copy("../../node-runtime/lib")
            ]
        ),

        // CLI tool for domain management
        .executableTarget(
            name: "OneFilerCLI",
            dependencies: [],
            path: "Sources/OneFilerCLI"
        ),

        // Tests
        .testTarget(
            name: "OneFilerTests",
            dependencies: ["OneFilerExtension"],
            path: "Tests/OneFilerTests"
        )
    ]
)