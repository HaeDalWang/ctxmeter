import Foundation

/// One harness entry from `agentlens telemetry`.
///
/// Every numeric field is optional on purpose. Kiro records a percentage and no
/// token total, Claude and Codex record the reverse, and a model with no known
/// capacity has no percentage at all. The CLI never guesses, so neither does this.
public struct HarnessTelemetry: Codable, Sendable, Equatable {
    public let model: String?
    public let contextWindowTokens: Int?
    public let inputTokens: Int?
    public let usagePercent: Double?
    public let observedAt: String?
    public let store: String?
    public let source: String?

    public init(
        model: String?, contextWindowTokens: Int?, inputTokens: Int?,
        usagePercent: Double?, observedAt: String?, store: String?, source: String?
    ) {
        self.model = model
        self.contextWindowTokens = contextWindowTokens
        self.inputTokens = inputTokens
        self.usagePercent = usagePercent
        self.observedAt = observedAt
        self.store = store
        self.source = source
    }
}

public struct TelemetryTarget: Codable, Sendable, Equatable {
    public let home: String
    public let workspace: String

    public init(home: String, workspace: String) {
        self.home = home
        self.workspace = workspace
    }
}

public struct TelemetryReport: Codable, Sendable, Equatable {
    public let schemaVersion: String
    public let generatedAt: String
    public let target: TelemetryTarget
    public let harnesses: [String: HarnessTelemetry]

    public init(
        schemaVersion: String, generatedAt: String,
        target: TelemetryTarget, harnesses: [String: HarnessTelemetry]
    ) {
        self.schemaVersion = schemaVersion
        self.generatedAt = generatedAt
        self.target = target
        self.harnesses = harnesses
    }

    public func entry(_ harness: Harness) -> HarnessTelemetry? {
        harnesses[harness.rawValue]
    }
}

/// Display order is fixed here because a dictionary has none.
public enum Harness: String, CaseIterable, Sendable {
    case claude
    case codex
    case kiro

    public var displayName: String {
        switch self {
        case .claude: "Claude Code"
        case .codex: "Codex"
        case .kiro: "Kiro"
        }
    }

    /// Two letters keep the menu bar label unambiguous; `claude` and `codex`
    /// would otherwise collide on a single initial.
    public var shortCode: String {
        switch self {
        case .claude: "CC"
        case .codex: "CX"
        case .kiro: "KI"
        }
    }
}
