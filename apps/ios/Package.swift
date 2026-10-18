// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "TranVotingDemo",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .executable(name: "TranVotingDemo", targets: ["TranVotingDemo"]),
    ],
    targets: [
        .executableTarget(
            name: "TranVotingDemo",
            path: "Sources/TranVotingDemo"
        ),
    ]
)
