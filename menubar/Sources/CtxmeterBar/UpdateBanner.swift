import AppKit
import CtxmeterBarCore
import SwiftUI

/// "A newer release exists." Links to the release and copies the upgrade
/// command; installing stays a step the user runs.
struct UpdateBanner: View {
    let update: AvailableUpdate
    @State private var copied = false

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "arrow.down.circle.fill").foregroundStyle(.tint)
            VStack(alignment: .leading, spacing: 1) {
                Text("v\(update.version) available").font(.system(size: 11, weight: .semibold))
                Text(copied ? "Copied — run it in the repo" : UpdateCheck.upgradeCommand)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: 4)
            Button(copied ? "Copied" : "Copy") { copyCommand() }
                .controlSize(.small)
                .help("Copy the upgrade command")
            Button("Release") { NSWorkspace.shared.open(update.url) }
                .controlSize(.small)
                .help("Open the release notes on GitHub")
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.accentColor.opacity(0.12)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Version \(update.version) available")
    }

    private func copyCommand() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(UpdateCheck.upgradeCommand, forType: .string)
        copied = true
    }
}
