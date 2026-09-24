import Foundation

public enum Format {
    private static let thousand = 1_000
    private static let million = 1_000_000

    /// Mirrors the web dashboard's `compact()` so both surfaces read the same.
    public static func compactTokens(_ value: Int?) -> String {
        guard let value else { return "not measured" }
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
        guard let value, value.isFinite else { return "capacity unknown" }
        return String(format: "%.1f%%", value)
    }

    /// The full multi-harness summary. Too wide for the menu bar itself, so it
    /// serves as the tooltip and accessibility label instead.
    public static func menuBarLabel(_ report: TelemetryReport?) -> String {
        guard let report else { return "ctxmeter" }
        let parts = Harness.allCases.compactMap { harness -> String? in
            guard let percent = report.entry(harness)?.usagePercent, percent.isFinite else { return nil }
            return "\(harness.shortCode) \(Int(percent.rounded()))%"
        }
        return parts.isEmpty ? "ctxmeter" : parts.joined(separator: " · ")
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
            return tab == .overview ? "ctxmeter" : "—"
        }
        guard let percent = report?.entry(harness)?.usagePercent, percent.isFinite else { return "—" }
        return "\(Int(percent.rounded()))%"
    }

    /// The glyph that marks this item as ctxmeter's. Several agent monitors render
    /// a vendor icon beside a percentage, so the icon alone does not identify the
    /// app — the operator genuinely could not tell theirs from CodexBar's.
    public static let menuBarSymbol = "gauge.medium"

    /// What hovering the menu bar item says. Names the tool, then gives the full
    /// summary that is too wide to display. It also states what the number
    /// measures: a neighbouring quota monitor reads high-is-good, and this reads
    /// high-is-bad, so the percentage alone is ambiguous.
    public static func menuBarTooltip(_ report: TelemetryReport?) -> String {
        "ctxmeter · context window used\n\(menuBarLabel(report))"
    }

    public static func relativeAge(_ observedAt: Date?, now: Date = Date()) -> String {
        guard let observedAt else { return "no record" }
        let seconds = Int(now.timeIntervalSince(observedAt).rounded())
        if seconds < 60 { return "\(max(seconds, 0))s ago" }
        if seconds < 3_600 { return "\(seconds / 60)m ago" }
        if seconds < 86_400 { return "\(seconds / 3_600)h ago" }
        return "\(seconds / 86_400)d ago"
    }

    public static func timestamp(_ isoText: String?) -> Date? {
        guard let isoText else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return withFraction.date(from: isoText) ?? ISO8601DateFormatter().date(from: isoText)
    }
}
