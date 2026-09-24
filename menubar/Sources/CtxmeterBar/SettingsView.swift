import CtxmeterBarCore
import AppKit
import SwiftUI

struct SettingsView: View {
    @Bindable var store: TelemetryStore

    var body: some View {
        Form {
            Section("Refresh") {
                LabeledContent("Interval") {
                    HStack(spacing: 8) {
                        Slider(
                            value: $store.refreshSeconds,
                            in: AppSettings.minimumRefreshSeconds...AppSettings.maximumRefreshSeconds,
                            step: 5
                        )
                        Text("\(Int(store.refreshSeconds))s").monospacedDigit().frame(width: 46, alignment: .trailing)
                    }
                }
                Text("Minimum \(Int(AppSettings.minimumRefreshSeconds))s. Reads session usage only, not the inventory scan, so it costs tens of milliseconds.")
                    .font(.system(size: 10)).foregroundStyle(.secondary)
            }

            Section("Workspace") {
                LabeledContent("Path") {
                    HStack(spacing: 8) {
                        Text(store.workspace).lineLimit(1).truncationMode(.head)
                        Spacer(minLength: 4)
                        Button("Change…") { chooseWorkspace() }
                    }
                }
                Text("One workspace at a time.")
                    .font(.system(size: 10)).foregroundStyle(.secondary)
            }

            Section("node path") {
                TextField("Auto-detect", text: $store.nodePathOverride, prompt: Text(NodeLocator.knownPaths[0]))
                Text("A menu bar app inherits a minimal PATH and may not find node on its own. Leave blank to search the known install paths in order.")
                    .font(.system(size: 10)).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .frame(width: 440)
    }

    private func chooseWorkspace() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.directoryURL = URL(fileURLWithPath: store.workspace)
        if panel.runModal() == .OK, let url = panel.url {
            store.workspace = url.path
        }
    }
}
