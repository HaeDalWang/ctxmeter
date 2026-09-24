import AgentLensBarCore
import SwiftUI

/// Colors follow the web dashboard's category palette so both surfaces match.
let harnessTint: [Harness: Color] = [
    .claude: Color(red: 0.84, green: 0.45, blue: 0.29),
    .codex: Color(red: 0.18, green: 0.78, blue: 0.71),
    .kiro: Color(red: 0.98, green: 0.62, blue: 0.11),
]

func accent(for tab: PopoverTab) -> Color {
    switch tab {
    case .overview: .accentColor
    case .harness(let harness): harnessTint[harness] ?? .accentColor
    }
}

struct TabBar: View {
    @Binding var selection: PopoverTab

    var body: some View {
        HStack(spacing: 4) {
            ForEach(PopoverTab.allCases, id: \.self) { tab in
                TabButton(tab: tab, isSelected: tab == selection) { selection = tab }
            }
        }
    }
}

private struct TabButton: View {
    let tab: PopoverTab
    let isSelected: Bool
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            VStack(spacing: 3) {
                TabIconView(tab: tab, size: 19)
                Text(tab.title)
                    .font(.system(size: 10, weight: isSelected ? .semibold : .regular))
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 7)
            .background(background)
            .overlay(alignment: .bottom) { underline }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(isSelected ? .primary : .secondary)
        .onHover { isHovering = $0 }
        .accessibilityLabel(tab.title)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    private var background: some View {
        RoundedRectangle(cornerRadius: 7)
            .fill(isSelected ? Color.primary.opacity(0.09) : (isHovering ? Color.primary.opacity(0.05) : .clear))
    }

    private var underline: some View {
        RoundedRectangle(cornerRadius: 1)
            .fill(accent(for: tab))
            .frame(height: 2)
            .padding(.horizontal, 10)
            .opacity(isSelected ? 1 : 0.28)
    }
}
