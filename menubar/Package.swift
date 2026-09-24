// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "AgentLensBar",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/apple/swift-testing", from: "0.12.0"),
    ],
    targets: [
        .target(name: "AgentLensBarCore"),
        .executableTarget(name: "AgentLensBar", dependencies: ["AgentLensBarCore"]),
        .testTarget(
            name: "AgentLensBarCoreTests",
            dependencies: [
                "AgentLensBarCore",
                .product(name: "Testing", package: "swift-testing"),
            ]
        ),
    ]
)
