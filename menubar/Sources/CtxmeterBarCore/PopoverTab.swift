import Foundation

/// Overview plus one tab per harness, in a fixed order.
///
/// The selected tab also decides what the menu bar shows, so there is one
/// selector rather than two competing ones.
public enum PopoverTab: Hashable, Sendable, CaseIterable {
    case overview
    case harness(Harness)

    public static var allCases: [PopoverTab] {
        [.overview] + Harness.allCases.map(PopoverTab.harness)
    }

    public var title: String {
        switch self {
        case .overview: "Overview"
        case .harness(let harness): harness.displayName == "Claude Code" ? "Claude" : harness.displayName
        }
    }

    public var storageKey: String {
        switch self {
        case .overview: "overview"
        case .harness(let harness): harness.rawValue
        }
    }

    public init(storageKey: String?) {
        guard let storageKey, let harness = Harness(rawValue: storageKey) else {
            self = .overview
            return
        }
        self = .harness(harness)
    }
}

public enum AgentAppLocator {
    /// Codex ships no app of its own, so the vendor's app stands in for it.
    private static let appNames: [Harness: [String]] = [
        .claude: ["Claude.app"],
        .codex: ["ChatGPT.app"],
        .kiro: ["Kiro.app", "Kiro CLI.app"],
    ]

    public static func candidates(for harness: Harness, home: String = NSHomeDirectory()) -> [String] {
        (appNames[harness] ?? []).flatMap { name in
            ["/Applications/\(name)", "\(home)/Applications/\(name)"]
        }
    }

    public static func resolve(
        for harness: Harness,
        home: String = NSHomeDirectory(),
        exists: (String) -> Bool = { FileManager.default.fileExists(atPath: $0) }
    ) -> String? {
        candidates(for: harness, home: home).first(where: exists)
    }

    /// Used when the vendor app is not installed. Long-standing SF Symbols only.
    public static func fallbackSymbol(for harness: Harness) -> String {
        switch harness {
        case .claude: "sparkle"
        case .codex: "hexagon"
        case .kiro: "cube"
        }
    }
}
