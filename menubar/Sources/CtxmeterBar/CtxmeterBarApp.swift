import CtxmeterBarCore
import SwiftUI

@main
struct CtxmeterBarApp: App {
    @State private var store = TelemetryStore()

    var body: some Scene {
        MenuBarExtra {
            PopoverView(store: store)
        } label: {
            // One icon and one number. Three percentages crowded the menu bar,
            // so overview collapses to whichever harness is closest to its limit
            // and the full summary moves to the hover tooltip.
            //
            // The gauge glyph leads because a vendor icon plus a percentage is
            // what several agent monitors look like, and telling them apart at a
            // glance was a real problem.
            HStack(spacing: 3) {
                Image(systemName: Format.menuBarSymbol)
                    .imageScale(.small)
                    .foregroundStyle(.secondary)
                if let harness = store.menuBarFocus {
                    AgentIconView(harness: harness, size: 16)
                } else {
                    TabIconView(tab: .overview, size: 16)
                }
                Text(store.menuBarText).monospacedDigit()
            }
            .help(store.tooltip)
            .accessibilityLabel(store.tooltip)
        }
        .menuBarExtraStyle(.window)

        Window("ctxmeter detail", id: DetailWindowID.value) {
            DetailView(store: store)
        }
        .windowResizability(.contentMinSize)

        Settings {
            SettingsView(store: store)
        }
    }

    init() {
        store.start()
    }
}
