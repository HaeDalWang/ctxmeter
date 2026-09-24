import CtxmeterBarCore
import AppKit
import SwiftUI

/// Resolves each harness icon from the vendor app installed on this Mac.
///
/// Reading `NSWorkspace.icon(forFile:)` avoids bundling trademarked brand art
/// and always matches what the user sees in Finder. `.icns` files are not parsed
/// directly because vendors name them inconsistently — Claude and ChatGPT both
/// ship theirs as `electron.icns`.
@MainActor
final class AgentIcon {
    static let shared = AgentIcon()

    private var cache: [Harness: NSImage] = [:]

    func image(for harness: Harness, size: CGFloat) -> NSImage? {
        if let cached = cache[harness] {
            return resized(cached, to: size)
        }
        guard let appPath = AgentAppLocator.resolve(for: harness) else { return nil }
        let icon = NSWorkspace.shared.icon(forFile: appPath)
        cache[harness] = icon
        return resized(icon, to: size)
    }

    private func resized(_ image: NSImage, to size: CGFloat) -> NSImage {
        let copy = image.copy() as? NSImage ?? image
        copy.size = NSSize(width: size, height: size)
        return copy
    }
}

/// Vendor icon when the app is installed, SF Symbol otherwise.
struct AgentIconView: View {
    let harness: Harness
    let size: CGFloat

    var body: some View {
        if let image = AgentIcon.shared.image(for: harness, size: size) {
            Image(nsImage: image).frame(width: size, height: size)
        } else {
            Image(systemName: AgentAppLocator.fallbackSymbol(for: harness))
                .font(.system(size: size * 0.8))
                .frame(width: size, height: size)
        }
    }
}

struct TabIconView: View {
    let tab: PopoverTab
    let size: CGFloat

    var body: some View {
        switch tab {
        case .overview:
            Image(systemName: "square.grid.2x2.fill")
                .font(.system(size: size * 0.78))
                .frame(width: size, height: size)
        case .harness(let harness):
            AgentIconView(harness: harness, size: size)
        }
    }
}
