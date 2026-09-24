import Foundation

public enum Format {
    private static let thousand = 1_000
    private static let million = 1_000_000

    /// Mirrors the web dashboard's `compact()` so both surfaces read the same.
    public static func compactTokens(_ value: Int?) -> String {
        guard let value else { return "미측정" }
        if value >= million {
            let scaled = Double(value) / Double(million)
            return value % million == 0 ? "\(Int(scaled))m" : String(format: "%.1fm", scaled)
        }
        if value >= thousand {
            let scaled = Double(value) / Double(thousand)
            return value >= 100_000 ? String(format: "%.0fk", scaled) : String(format: "%.1fk", scaled)
        }
        return "\(value)"
    }

    public static func percentText(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "용량 미확인" }
        return String(format: "%.1f%%", value)
    }

    /// The full multi-harness summary. Too wide for the menu bar itself, so it
    /// serves as the tooltip and accessibility label instead.
    public static func menuBarLabel(_ report: TelemetryReport?) -> String {
        guard let report else { return "AgentLens" }
        let parts = Harness.allCases.compactMap { harness -> String? in
            guard let percent = report.entry(harness)?.usagePercent, percent.isFinite else { return nil }
            return "\(harness.shortCode) \(Int(percent.rounded()))%"
        }
        return parts.isEmpty ? "AgentLens" : parts.joined(separator: " · ")
    }

    /// Whose icon belongs in the menu bar. On a harness tab it is that harness.
    /// On overview it is whichever harness sits closest to its limit, which is
    /// the one number worth glancing at. Ties fall to display order.
    public static func menuBarFocus(_ report: TelemetryReport?, tab: PopoverTab) -> Harness? {
        switch tab {
        case .harness(let harness):
            return harness
        case .overview:
            return Harness.allCases
                .compactMap { harness -> (Harness, Double)? in
                    guard let percent = report?.entry(harness)?.usagePercent, percent.isFinite else { return nil }
                    return (harness, percent)
                }
                .max { left, right in left.1 < right.1 }?
                .0
        }
    }

    /// One number, because three of them crowd the menu bar out.
    public static func menuBarText(_ report: TelemetryReport?, tab: PopoverTab) -> String {
        guard let harness = menuBarFocus(report, tab: tab) else {
            return tab == .overview ? "AgentLens" : "—"
        }
        guard let percent = report?.entry(harness)?.usagePercent, percent.isFinite else { return "—" }
        return "\(Int(percent.rounded()))%"
    }

    public static func relativeAge(_ observedAt: Date?, now: Date = Date()) -> String {
        guard let observedAt else { return "기록 없음" }
        let seconds = Int(now.timeIntervalSince(observedAt).rounded())
        if seconds < 60 { return "\(max(seconds, 0))초 전" }
        if seconds < 3_600 { return "\(seconds / 60)분 전" }
        if seconds < 86_400 { return "\(seconds / 3_600)시간 전" }
        return "\(seconds / 86_400)일 전"
    }

    public static func timestamp(_ isoText: String?) -> Date? {
        guard let isoText else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return withFraction.date(from: isoText) ?? ISO8601DateFormatter().date(from: isoText)
    }
}
