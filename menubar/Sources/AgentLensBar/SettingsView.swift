import AgentLensBarCore
import AppKit
import SwiftUI

struct SettingsView: View {
    @Bindable var store: TelemetryStore

    var body: some View {
        Form {
            Section("갱신") {
                LabeledContent("주기") {
                    HStack(spacing: 8) {
                        Slider(
                            value: $store.refreshSeconds,
                            in: AppSettings.minimumRefreshSeconds...AppSettings.maximumRefreshSeconds,
                            step: 5
                        )
                        Text("\(Int(store.refreshSeconds))초").monospacedDigit().frame(width: 46, alignment: .trailing)
                    }
                }
                Text("최소 \(Int(AppSettings.minimumRefreshSeconds))초. 인벤토리 스캔이 아니라 세션 사용량만 읽으므로 비용은 수십 ms입니다.")
                    .font(.system(size: 10)).foregroundStyle(.secondary)
            }

            Section("작업공간") {
                LabeledContent("경로") {
                    HStack(spacing: 8) {
                        Text(store.workspace).lineLimit(1).truncationMode(.head)
                        Spacer(minLength: 4)
                        Button("변경…") { chooseWorkspace() }
                    }
                }
                Text("한 번에 하나의 작업공간만 표시합니다.")
                    .font(.system(size: 10)).foregroundStyle(.secondary)
            }

            Section("node 경로") {
                TextField("자동 탐색", text: $store.nodePathOverride, prompt: Text(NodeLocator.knownPaths[0]))
                Text("메뉴바 앱은 축소된 PATH를 물려받아 node를 자동으로 못 찾을 수 있습니다. 비워두면 알려진 설치 경로를 순서대로 찾습니다.")
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
