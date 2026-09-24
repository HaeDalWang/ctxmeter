import CtxmeterBarCore
import SwiftUI

enum DetailWindowID {
    static let value = "ctxmeter-detail"
}

struct DetailView: View {
    let store: TelemetryStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Session context detail").font(.title3.weight(.semibold))
                    Text(store.workspace).font(.system(size: 11)).foregroundStyle(.secondary)
                }

                ForEach(Harness.allCases, id: \.self) { harness in
                    HarnessDetail(harness: harness, entry: store.report?.entry(harness))
                        .padding(12)
                        .background(.quaternary.opacity(0.25), in: RoundedRectangle(cornerRadius: 10))
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Measurement limits").font(.system(size: 11, weight: .semibold))
                    Text(limitsText)
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, 2)
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minWidth: 480, minHeight: 500)
    }

    private var limitsText: String {
        """
        Claude and Codex shares are observed input tokens divided by a known context window; \
        Kiro reports a percentage its session recorded directly. A model with no profile stays \
        unknown rather than guessed. Icons are read from the vendor apps installed on this Mac. \
        Per-item configuration cost and the skill inventory live in ctxmeter dashboard.
        """
    }
}
