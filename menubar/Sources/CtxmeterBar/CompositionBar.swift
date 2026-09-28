import CtxmeterBarCore
import SwiftUI

/// What the context window is made of: estimated parts, the unattributed rest,
/// the autocompact reserve, and what is still free. Replaces the web dashboard's
/// budget view (develop/decisions/06).
struct CompositionBar: View {
    let details: HarnessDetails

    private struct Part: Identifiable {
        let id: String
        let label: String
        let tokens: Int
        let color: Color
        var hatched = false
    }

    static let segmentColors: [String: Color] = [
        "instructions": Color(red: 0.93, green: 0.42, blue: 0.62),
        "skills": Color(red: 0.96, green: 0.72, blue: 0.25),
        "mcp": Color(red: 0.62, green: 0.48, blue: 0.98),
        "other": Color(red: 0.42, green: 0.55, blue: 0.98),
    ]

    private var parts: [Part] {
        var parts = details.segments.filter { $0.tokens > 0 }.map {
            Part(id: $0.id, label: $0.label, tokens: $0.tokens, color: Self.segmentColors[$0.id] ?? .gray)
        }
        if let reserve = details.autocompactBufferTokens, reserve > 0 {
            parts.append(Part(id: "reserve", label: "Autocompact reserve", tokens: reserve, color: .gray, hatched: true))
        }
        return parts
    }

    /// The window when known; otherwise the parts themselves, so the bar still
    /// shows proportions without claiming a capacity.
    private var total: Int {
        let used = parts.reduce(0) { $0 + $1.tokens }
        return max(details.contextWindowTokens ?? used, used, 1)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { geometry in
                HStack(spacing: 1) {
                    ForEach(parts) { part in
                        Rectangle()
                            .fill(part.hatched ? AnyShapeStyle(part.color.opacity(0.35)) : AnyShapeStyle(part.color))
                            .frame(width: max(geometry.size.width * CGFloat(part.tokens) / CGFloat(total), 2))
                            .help("\(part.label): \(Format.compactTokens(part.tokens))")
                    }
                    Spacer(minLength: 0)
                }
                .background(.quaternary)
                .clipShape(RoundedRectangle(cornerRadius: 4))
            }
            .frame(height: 14)

            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 10, verticalSpacing: 3) {
                ForEach(parts) { part in
                    GridRow {
                        RoundedRectangle(cornerRadius: 2).fill(part.hatched ? part.color.opacity(0.35) : part.color).frame(width: 9, height: 9)
                        Text(part.label)
                        Text(Format.compactTokens(part.tokens)).monospacedDigit().gridColumnAlignment(.trailing)
                        Text(share(part.tokens)).monospacedDigit().foregroundStyle(.secondary).gridColumnAlignment(.trailing)
                    }
                }
                if let window = details.contextWindowTokens {
                    let used = parts.reduce(0) { $0 + $1.tokens }
                    GridRow {
                        RoundedRectangle(cornerRadius: 2).strokeBorder(.quaternary).frame(width: 9, height: 9)
                        Text("Free")
                        Text(Format.compactTokens(max(window - used, 0))).monospacedDigit()
                        Text(share(max(window - used, 0))).monospacedDigit().foregroundStyle(.secondary)
                    }
                }
            }
            .font(.system(size: 11))

            Text(footnote).font(.system(size: 10)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func share(_ tokens: Int) -> String {
        guard let window = details.contextWindowTokens, window > 0 else { return "" }
        return String(format: "%.1f%%", Double(tokens) / Double(window) * 100)
    }

    private var footnote: String {
        if details.observedInputTokens == nil {
            return "No token count is recorded for this session, so only the file estimates are shown and nothing is attributed to messages."
        }
        return "Instructions, skills, and MCP are estimates (bytes ÷ 4); the rest of the observed input is messages, the system prompt, and built-in tools."
    }
}
