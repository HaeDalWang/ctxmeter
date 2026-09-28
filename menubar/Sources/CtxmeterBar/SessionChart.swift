import CtxmeterBarCore
import SwiftUI

/// Context per turn for one session. Bars are scaled to the session's own peak so
/// the shape is readable even at 19% of a 1m window; the caption states what that
/// peak is as a share of the window. A red tick marks a compaction. Hovering a bar
/// names its turn and value.
struct SessionChart: View {
    let harness: Harness
    let session: SessionRecord
    let unit: HistoryUnit
    /// The context window in the chart's unit (tokens, or 100 for percent), when known.
    let window: Double?
    var height: CGFloat = 54
    var showsCaption = true

    @State private var hovered: Int?

    private var samples: [HistorySample] { session.samples ?? [] }
    private var tint: Color { harnessTint[harness] ?? .accentColor }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if showsCaption { caption }
            bars
        }
    }

    private var caption: some View {
        HStack(spacing: 4) {
            if let index = hovered, samples.indices.contains(index) {
                Text("turn \(index + 1)").foregroundStyle(.secondary)
                Text(Format.historyValue(samples[index].value, unit: unit)).monospacedDigit()
                if samples[index].compactedBefore {
                    Text("after compaction").foregroundStyle(.red)
                }
            } else {
                Text("this session").foregroundStyle(.secondary)
                Text("peak \(Format.historyValue(session.peak, unit: unit))").monospacedDigit()
                if unit == .tokens, let window, window > 0 {
                    Text(String(format: "%.0f%%", session.peak / window * 100)).monospacedDigit().foregroundStyle(.secondary)
                        .help("Peak as a share of the context window")
                }
                Text("· \(session.turns) turns").foregroundStyle(.secondary)
                if session.compactions > 0 {
                    Text("· \(session.compactions)× compacted").foregroundStyle(.red)
                }
            }
            Spacer(minLength: 0)
        }
        .lineLimit(1)
        .font(.system(size: 10))
    }

    private var bars: some View {
        let heights = Chart.heights(samples.map(\.value), ceiling: nil)
        return GeometryReader { geometry in
            let gap: CGFloat = heights.count > 40 ? 1 : 2
            let width = max((geometry.size.width - gap * CGFloat(max(heights.count - 1, 0))) / CGFloat(max(heights.count, 1)), 1)
            HStack(alignment: .bottom, spacing: gap) {
                ForEach(Array(heights.enumerated()), id: \.offset) { index, fraction in
                    ZStack(alignment: .bottom) {
                        Rectangle().fill(.clear)
                        RoundedRectangle(cornerRadius: 1)
                            .fill(tint.opacity(hovered == nil || hovered == index ? 1 : 0.45))
                            .frame(height: max(geometry.size.height * fraction, 1.5))
                        if samples[index].compactedBefore {
                            Rectangle().fill(.red).frame(width: 1.5)
                                .frame(maxHeight: .infinity, alignment: .bottom)
                                .offset(x: -width / 2 - gap / 2)
                        }
                    }
                    .frame(width: width)
                    .contentShape(Rectangle())
                    .onHover { inside in hovered = inside ? index : (hovered == index ? nil : hovered) }
                }
            }
        }
        .frame(height: height)
        .background(alignment: .bottom) {
            Rectangle().fill(.quaternary).frame(height: 1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Context per turn, peak \(Format.historyValue(session.peak, unit: unit)) over \(session.turns) turns")
    }
}

/// The largest sessions of the last week, each as a bar against the biggest.
struct TopSessions: View {
    let harness: Harness
    let history: HarnessHistory
    let days: Int

    private var tint: Color { harnessTint[harness] ?? .accentColor }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("Largest sessions · last \(days) days")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.secondary)
            if history.top.isEmpty {
                Text("No session in this period.").font(.system(size: 10)).foregroundStyle(.secondary)
            }
            let largest = history.top.map(\.peak).max() ?? 0
            ForEach(history.top, id: \.id) { session in
                HStack(spacing: 6) {
                    Text(day(session.updatedAt)).frame(width: 38, alignment: .leading).foregroundStyle(.secondary)
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            Capsule().fill(.quaternary)
                            Capsule().fill(tint.opacity(session.id == history.current?.id ? 1 : 0.6))
                                .frame(width: largest > 0 ? max(geometry.size.width * session.peak / largest, 3) : 0)
                        }
                    }
                    .frame(height: 5)
                    Text(Format.historyValue(session.peak, unit: history.unit)).monospacedDigit().frame(width: 44, alignment: .trailing)
                    Text("\(session.turns)t").foregroundStyle(.secondary).monospacedDigit().frame(width: 34, alignment: .trailing)
                }
                .font(.system(size: 10))
                .help("\(session.turns) turns, \(session.compactions) compaction\(session.compactions == 1 ? "" : "s") · \(session.model ?? "unknown model")")
            }
        }
    }

    private func day(_ iso: String?) -> String {
        guard let date = Format.timestamp(iso) else { return "—" }
        return date.formatted(.dateTime.month(.defaultDigits).day())
    }
}
