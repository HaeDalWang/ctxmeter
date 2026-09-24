import CtxmeterBarCore
import SwiftUI

/// Single-harness view used by both the popover tab and the detail window.
struct HarnessDetail: View {
    let harness: Harness
    let entry: HarnessTelemetry?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HarnessRow(harness: harness, entry: entry)
            Divider()
            grid
            if let note = limitNote {
                Text(note)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var grid: some View {
        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 4) {
            row("Input tokens", Format.compactTokens(entry?.inputTokens))
            row("Context window", entry?.contextWindowTokens.map { "\(Format.compactTokens($0)) tokens" } ?? "capacity unknown")
            row("Share", Format.percentText(entry?.usagePercent))
            row("Observed", relativeObserved)
            row("Source", entry?.source ?? "none")
            if let store = entry?.store {
                row("Session store", store)
            }
        }
        .font(.system(size: 11))
    }

    private func row(_ label: String, _ value: String) -> some View {
        GridRow {
            Text(label).foregroundStyle(.secondary).gridColumnAlignment(.leading)
            Text(value).monospacedDigit().lineLimit(1).truncationMode(.middle)
        }
    }

    private var relativeObserved: String {
        guard let date = Format.timestamp(entry?.observedAt) else { return entry?.observedAt ?? "none" }
        return Format.relativeAge(date)
    }

    /// States the measurement limit that applies to this harness specifically.
    private var limitNote: String? {
        if entry == nil { return "No local session found for this workspace." }
        if entry?.inputTokens == nil {
            return "Kiro records no absolute token count locally. Only the percentage is observed; no token figure is derived from it."
        }
        if entry?.contextWindowTokens == nil {
            return "No context capacity profile for this model, so no share was computed. Capacity is never guessed."
        }
        return nil
    }
}
