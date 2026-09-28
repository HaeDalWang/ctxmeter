import AppKit
import CtxmeterBarCore
import SwiftUI

/// A menu bar app has no main window, so "quit after the last window closes"
/// is always wrong here. macOS can invalidate the status item's scene (seen on
/// macOS 26 at launch), and AppKit then counted that as the last window closing
/// and quit two seconds after every start.
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

@main
struct CtxmeterBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var store = TelemetryStore()
    /// Without this binding SwiftUI marks the item "terminate on removal", and
    /// macOS restores a remembered removal (`NSStatusItem Visible… = 0`) at launch,
    /// so the app quit two seconds after every start. Starting at `true` puts the
    /// item back; if the user removes it later, the app stays alive and
    /// `scripts/ctxmeter-bar.sh restart` brings it back.
    @State private var isInserted = true

    var body: some Scene {
        MenuBarExtra(isInserted: $isInserted) {
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
