import Foundation

// Types decoded from `ctxmeter history`, `ctxmeter details`, and
// `ctxmeter fix --enable|--disable --json`. As with telemetry, every value the CLI
// may not know is optional, and nothing here fills a gap with a guess.

// MARK: - history

public enum HistoryUnit: String, Codable, Sendable {
    /// Claude and Codex log token counts.
    case tokens
    /// Kiro logs only a percentage of its window.
    case percent
}

public struct HistorySample: Codable, Sendable, Equatable {
    public let at: String?
    public let value: Double
    /// A compaction happened between the previous sample and this one.
    public let compactedBefore: Bool
}

public struct SessionRecord: Codable, Sendable, Equatable {
    public let id: String
    public let model: String?
    public let startedAt: String?
    public let updatedAt: String?
    public let turns: Int
    public let peak: Double
    public let compactions: Int
    /// Present only for the current session; the ranked list omits it.
    public let samples: [HistorySample]?
}

public struct HarnessHistory: Codable, Sendable, Equatable {
    public let unit: HistoryUnit
    public let current: SessionRecord?
    public let top: [SessionRecord]
}

public struct HistoryReport: Codable, Sendable, Equatable {
    public let schemaVersion: String
    public let generatedAt: String
    public let days: Int
    public let target: TelemetryTarget
    public let harnesses: [String: HarnessHistory]

    public func entry(_ harness: Harness) -> HarnessHistory? { harnesses[harness.rawValue] }
}

// MARK: - details

public struct DetailSegment: Codable, Sendable, Equatable {
    public let id: String
    public let label: String
    public let tokens: Int
}

public struct SwitchRef: Codable, Sendable, Equatable {
    public let target: String
    public let enabled: Bool
    public let format: String
    public let instruction: String?

    public init(target: String, enabled: Bool, format: String, instruction: String?) {
        self.target = target
        self.enabled = enabled
        self.format = format
        self.instruction = instruction
    }

    /// Claude MCP servers are switched inside Claude; the app only says how.
    public var isManual: Bool { format == "manual" }
}

public struct DetailItem: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let category: String
    public let label: String
    public let tokens: Int?
    public let detail: String?
    public let `switch`: SwitchRef?

    public init(id: String, category: String, label: String, tokens: Int?, detail: String?, switch: SwitchRef?) {
        self.id = id
        self.category = category
        self.label = label
        self.tokens = tokens
        self.detail = detail
        self.switch = `switch`
    }
}

public struct UnmeasuredItem: Codable, Sendable, Equatable {
    public let id: String
    public let label: String
    public let reason: String
}

public struct HarnessDetails: Codable, Sendable, Equatable {
    public let model: String?
    public let contextWindowTokens: Int?
    public let observedInputTokens: Int?
    public let usagePercent: Double?
    public let autocompactBufferTokens: Int?
    public let segments: [DetailSegment]
    public let items: [DetailItem]
    public let unmeasured: [UnmeasuredItem]
}

public struct DetailsReport: Codable, Sendable, Equatable {
    public let schemaVersion: String
    public let generatedAt: String
    public let mcpMeasuredAt: String?
    public let target: TelemetryTarget
    public let harnesses: [String: HarnessDetails]

    public func entry(_ harness: Harness) -> HarnessDetails? { harnesses[harness.rawValue] }
}

// MARK: - toggle

public struct ToggleResult: Codable, Sendable, Equatable {
    public let target: String
    public let file: String
    public let backup: String
    public let tokens: Int?
    public let enabled: Bool
    public let rollback: String
}

// MARK: - presentation

public enum Chart {
    /// Bar heights in 0...1. The context window is the natural ceiling, so a
    /// chart reads as "how full". Without one, the session's own peak is used.
    public static func heights(_ values: [Double], ceiling: Double?) -> [Double] {
        let top = ceiling.flatMap { $0 > 0 ? $0 : nil } ?? values.max() ?? 0
        guard top > 0 else { return values.map { _ in 0 } }
        return values.map { min(max($0 / top, 0), 1) }
    }
}

public struct SwitchPrompt: Equatable, Sendable {
    public let title: String
    public let message: String
    public let confirmLabel: String

    /// Every write asks first (develop/decisions/06). The prompt states what
    /// changes, what it saves, that a backup is kept, and that a restart applies it.
    public static func make(item: DetailItem, harness: Harness) -> SwitchPrompt {
        let turningOn = !(item.switch?.enabled ?? true)
        let cost: String
        if let tokens = item.tokens {
            let amount = tokens.formatted(.number.locale(Locale(identifier: "en_US")))
            cost = turningOn ? "It adds about \(amount) tokens at startup." : "It frees about \(amount) tokens at startup."
        } else {
            cost = "Its cost has not been measured."
        }
        let message = "\(cost) ctxmeter keeps a backup of the config file and the change can be undone. Restart \(harness.displayName) for it to take effect."
        return SwitchPrompt(
            title: "\(turningOn ? "Switch on" : "Switch off") \(item.label)?",
            message: message,
            confirmLabel: turningOn ? "Switch On" : "Switch Off"
        )
    }
}

extension Format {
    public static func historyValue(_ value: Double, unit: HistoryUnit) -> String {
        switch unit {
        case .tokens: compactTokens(Int(value.rounded()))
        case .percent: String(format: "%.1f%%", value)
        }
    }
}
