import Foundation

public enum AppSettings {
    public static let minimumRefreshSeconds: Double = 5
    public static let defaultRefreshSeconds: Double = 30
    public static let maximumRefreshSeconds: Double = 300

    public static let refreshKey = "refreshSeconds"
    public static let workspaceKey = "workspacePath"
    public static let nodePathKey = "nodePathOverride"
    public static let selectedTabKey = "selectedTab"

    /// A stored value can be absent, corrupt, or hostile to a Timer. Fail to the
    /// default rather than scheduling something unbounded.
    public static func clampRefresh(_ seconds: Double) -> Double {
        guard seconds.isFinite, seconds > 0 else { return defaultRefreshSeconds }
        return min(max(seconds, minimumRefreshSeconds), maximumRefreshSeconds)
    }
}

public enum NodeLocator {
    /// A GUI app inherits a minimal PATH, so `env node` cannot be relied on.
    public static let knownPaths = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ]

    public static func resolve(
        override: String?,
        candidates: [String] = knownPaths,
        exists: (String) -> Bool = { FileManager.default.isExecutableFile(atPath: $0) }
    ) -> String? {
        let trimmed = override?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !trimmed.isEmpty, exists(trimmed) { return trimmed }
        return candidates.first(where: exists)
    }
}
