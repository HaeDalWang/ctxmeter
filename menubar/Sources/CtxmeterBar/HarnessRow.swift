import CtxmeterBarCore
import SwiftUI

struct HarnessRow: View {
    let harness: Harness
    let entry: HarnessTelemetry?
    var showsIcon = true
    var isMenuBarFocus = false

    private var tint: Color { harnessTint[harness] ?? .accentColor }
    private var fraction: Double {
        guard let percent = entry?.usagePercent, percent.isFinite else { return 0 }
        return min(max(percent / 100, 0), 1)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                if showsIcon {
                    AgentIconView(harness: harness, size: 14)
                } else {
                    Circle().fill(tint).frame(width: 7, height: 7)
                }
                Text(harness.displayName).font(.system(size: 12, weight: .semibold))
                if isMenuBarFocus {
                    Text("menu bar")
                        .font(.system(size: 9, weight: .medium))
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(tint.opacity(0.22), in: Capsule())
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Text(Format.percentText(entry?.usagePercent))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(entry?.usagePercent == nil ? .secondary : .primary)
                    .monospacedDigit()
            }

            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(.quaternary)
                    Capsule().fill(tint).frame(width: max(geometry.size.width * fraction, fraction > 0 ? 3 : 0))
                }
            }
            .frame(height: 5)

            HStack(spacing: 5) {
                Text(entry?.model ?? "no session")
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 6)
                Text(detailText)
                    .monospacedDigit()
            }
            .font(.system(size: 10))
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 3)
    }

    /// Kiro has no token total to show, so it reports its sample source instead.
    private var detailText: String {
        guard let entry else { return "—" }
        if let tokens = entry.inputTokens {
            let window = entry.contextWindowTokens.map { " / \(Format.compactTokens($0))" } ?? ""
            return "\(Format.compactTokens(tokens))\(window) tokens"
        }
        if let store = entry.store { return "percentage only · \(store)" }
        return "not measured"
    }
}
