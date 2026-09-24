// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "CtxmeterBar",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/apple/swift-testing", from: "0.12.0"),
    ],
    targets: [
        .target(name: "CtxmeterBarCore"),
        .executableTarget(name: "CtxmeterBar", dependencies: ["CtxmeterBarCore"]),
        .testTarget(
            name: "CtxmeterBarCoreTests",
            dependencies: [
                "CtxmeterBarCore",
                .product(name: "Testing", package: "swift-testing"),
            ]
        ),
    ]
)
