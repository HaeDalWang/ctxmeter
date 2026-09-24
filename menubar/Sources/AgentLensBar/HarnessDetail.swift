import AgentLensBarCore
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
            row("입력 토큰", Format.compactTokens(entry?.inputTokens))
            row("컨텍스트 창", entry?.contextWindowTokens.map { "\(Format.compactTokens($0)) tokens" } ?? "용량 미확인")
            row("점유율", Format.percentText(entry?.usagePercent))
            row("관측", relativeObserved)
            row("출처", entry?.source ?? "없음")
            if let store = entry?.store {
                row("세션 저장소", store)
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
        guard let date = Format.timestamp(entry?.observedAt) else { return entry?.observedAt ?? "없음" }
        return Format.relativeAge(date)
    }

    /// States the measurement limit that applies to this harness specifically.
    private var limitNote: String? {
        if entry == nil { return "이 작업공간에서 로컬 세션을 찾지 못했습니다." }
        if entry?.inputTokens == nil {
            return "Kiro는 로컬에 절대 토큰 수를 남기지 않습니다. 점유율만 관측값이며 토큰 환산은 하지 않습니다."
        }
        if entry?.contextWindowTokens == nil {
            return "이 모델의 컨텍스트 용량 프로파일이 없어 점유율을 계산하지 않았습니다. 용량은 추측하지 않습니다."
        }
        return nil
    }
}
