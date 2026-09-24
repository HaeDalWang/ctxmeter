import AgentLensBarCore
import SwiftUI

@main
struct AgentLensBarApp: App {
    @State private var store = TelemetryStore()

    var body: some Scene {
        MenuBarExtra {
            PopoverView(store: store)
        } label: {
            // One icon and one number. Three percentages crowded the menu bar,
            // so overview collapses to whichever harness is closest to its limit
            // and the full summary moves to the hover tooltip.
            HStack(spacing: 3) {
                if let harness = store.menuBarFocus {
                    AgentIconView(harness: harness, size: 16)
                } else {
                    TabIconView(tab: .overview, size: 16)
                }
                Text(store.menuBarText).monospacedDigit()
            }
            .help(store.summaryLabel)
            .accessibilityLabel(store.summaryLabel)
        }
        .menuBarExtraStyle(.window)

        Window("AgentLens 상세", id: DetailWindowID.value) {
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
