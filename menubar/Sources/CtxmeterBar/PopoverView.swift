import CtxmeterBarCore
import SwiftUI

struct PopoverView: View {
    @Bindable var store: TelemetryStore
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            TabBar(selection: $store.selectedTab)
            header

            if let errorMessage = store.errorMessage {
                Text(errorMessage)
                    .font(.system(size: 11))
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }

            content

            Divider()
            footer
        }
        .padding(12)
        .frame(width: 340)
    }

    @ViewBuilder
    private var content: some View {
        switch store.selectedTab {
        case .overview:
            VStack(spacing: 8) {
                ForEach(Harness.allCases, id: \.self) { harness in
                    HarnessRow(
                        harness: harness,
                        entry: store.report?.entry(harness),
                        isMenuBarFocus: harness == store.menuBarFocus
                    )
                }
            }
        case .harness(let harness):
            HarnessDetail(harness: harness, entry: store.report?.entry(harness))
        }
    }

    private var header: some View {
        HStack(spacing: 6) {
            VStack(alignment: .leading, spacing: 1) {
                Text(headerTitle).font(.system(size: 12, weight: .semibold))
                Text(workspaceName).font(.system(size: 10)).foregroundStyle(.secondary)
                    .lineLimit(1).truncationMode(.head)
            }
            Spacer(minLength: 8)
            Button {
                Task { await store.refresh() }
            } label: {
                if store.isRefreshing {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "arrow.clockwise")
                }
            }
            .buttonStyle(.borderless)
            .disabled(store.isRefreshing)
            .help("Refresh now")
        }
    }

    private var footer: some View {
        HStack(spacing: 8) {
            Text(refreshText).font(.system(size: 10)).foregroundStyle(.secondary)
            Spacer(minLength: 6)
            Button("Details") {
                ForegroundWindow.present { openWindow(id: DetailWindowID.value) }
            }
                .buttonStyle(.borderless).font(.system(size: 11))
            Button {
                ForegroundWindow.present { openSettings() }
            } label: {
                Image(systemName: "gearshape")
            }
            .buttonStyle(.borderless)
            .help("Settings")
            Button {
                NSApplication.shared.terminate(nil)
            } label: {
                Image(systemName: "power")
            }
            .buttonStyle(.borderless)
            .help("Quit")
        }
    }

    private var headerTitle: String {
        store.selectedTab == .overview ? "Context share" : "\(store.selectedTab.title) session"
    }

    private var workspaceName: String {
        URL(fileURLWithPath: store.workspace).lastPathComponent
    }

    private var refreshText: String {
        "updated \(Format.relativeAge(store.lastRefreshedAt)) · every \(Int(store.refreshSeconds))s"
    }
}
