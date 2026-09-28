import AppKit
import CtxmeterBarCore
import SwiftUI

enum DetailWindowID {
    static let value = "ctxmeter-detail"
}

/// The management surface: what each agent's context is made of, and a switch
/// on everything that has one. Every switch asks first.
struct DetailView: View {
    @Bindable var store: TelemetryStore
    @State private var harness: Harness = .claude
    @State private var pending: DetailItem?

    private var details: HarnessDetails? { store.details?.entry(harness) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header.padding(18)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    banners
                    if let details {
                        section("Context window") { CompositionBar(details: details) }
                        section("What loads at startup") { itemList(details) }
                        if !details.unmeasured.isEmpty {
                            section("Not measured") { unmeasuredList(details) }
                        }
                    } else if store.isLoadingDetails {
                        ProgressView("Scanning configuration…").frame(maxWidth: .infinity).padding(.top, 40)
                    }
                }
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(minWidth: 560, minHeight: 620)
        .task { if store.details == nil { await store.loadDetails() } }
        .alert(prompt?.title ?? "", isPresented: isPrompting, presenting: pending) { item in
            Button(prompt?.confirmLabel ?? "OK", role: item.switch?.enabled == true ? .destructive : nil) {
                Task { await store.toggle(item, harness: harness) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text(prompt?.message ?? "")
        }
    }

    private var prompt: SwitchPrompt? { pending.map { SwitchPrompt.make(item: $0, harness: harness) } }

    private var isPrompting: Binding<Bool> {
        Binding(get: { pending != nil }, set: { if !$0 { pending = nil } })
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Context and configuration").font(.title3.weight(.semibold))
                Text(store.workspace).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1).truncationMode(.head)
            }
            Spacer()
            Picker("Agent", selection: $harness) {
                ForEach(Harness.allCases, id: \.self) { Text($0.displayName).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 260)
            Button {
                Task { await store.loadDetails() }
            } label: {
                if store.isLoadingDetails { ProgressView().controlSize(.small) } else { Image(systemName: "arrow.clockwise") }
            }
            .buttonStyle(.borderless)
            .disabled(store.isLoadingDetails)
            .help("Rescan configuration")
        }
    }

    @ViewBuilder
    private var banners: some View {
        if let error = store.detailsError {
            Label(error, systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 11)).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
        }
        if store.restartNeeded.contains(harness) {
            HStack(spacing: 8) {
                Image(systemName: "arrow.triangle.2.circlepath").foregroundStyle(.orange)
                Text("Restart \(harness.displayName) for the change to take effect.").font(.system(size: 11, weight: .medium))
                Spacer()
                Button("Done") { store.acknowledgeRestart(harness) }.controlSize(.small)
            }
            .padding(10)
            .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
        }
        if let change = store.lastToggle {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(change.enabled ? "Switched on" : "Switched off") \(change.target)").font(.system(size: 11, weight: .medium))
                HStack(spacing: 6) {
                    Text("Undo: \(change.rollback)").font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary)
                        .lineLimit(1).truncationMode(.middle).textSelection(.enabled)
                    Button("Copy") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(change.rollback, forType: .string)
                    }
                    .controlSize(.mini)
                }
            }
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 12, weight: .semibold))
            content()
        }
    }

    private func itemList(_ details: HarnessDetails) -> some View {
        let largest = details.items.compactMap(\.tokens).max() ?? 0
        return VStack(spacing: 0) {
            ForEach(details.items) { item in
                ItemRow(item: item, largest: largest, isBusy: store.togglingTarget == item.switch?.target,
                        isLocked: store.togglingTarget != nil) {
                    pending = item
                }
                if item.id != details.items.last?.id { Divider() }
            }
        }
        .padding(.horizontal, 10)
        .background(.quaternary.opacity(0.25), in: RoundedRectangle(cornerRadius: 8))
    }

    private func unmeasuredList(_ details: HarnessDetails) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(details.unmeasured, id: \.id) { item in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(item.label).font(.system(size: 11))
                    Text(item.reason).font(.system(size: 10)).foregroundStyle(.secondary)
                }
            }
        }
    }
}

/// One configuration item: cost bar, and its switch when it has one.
private struct ItemRow: View {
    let item: DetailItem
    let largest: Int
    let isBusy: Bool
    let isLocked: Bool
    let requestToggle: () -> Void

    private var isOn: Bool { item.switch?.enabled ?? true }
    private var color: Color { CompositionBar.segmentColors[item.category] ?? .gray }

    var body: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 2).fill(color.opacity(isOn ? 1 : 0.3)).frame(width: 4, height: 26)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(item.label).font(.system(size: 12, weight: .medium)).lineLimit(1).truncationMode(.middle)
                    Text(item.category == "mcp" ? "MCP" : item.category == "skills" ? "skills" : "instructions")
                        .font(.system(size: 9)).padding(.horizontal, 4).padding(.vertical, 1)
                        .background(color.opacity(0.18), in: Capsule()).foregroundStyle(.secondary)
                }
                Text([item.detail, item.switch == nil ? "your own content, not a switch" : nil].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            costBar.frame(width: 90)
            Text(item.tokens.map { Format.compactTokens($0) } ?? "unknown")
                .font(.system(size: 11)).monospacedDigit()
                .foregroundStyle(item.tokens == nil ? .secondary : .primary)
                .frame(width: 58, alignment: .trailing)
            // A fixed slot even when empty, so every row's columns line up.
            ZStack(alignment: .trailing) { Color.clear; control }.frame(width: 64, height: 20)
        }
        .padding(.vertical, 7)
        .opacity(isOn ? 1 : 0.6)
    }

    private var costBar: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(.quaternary)
                if let tokens = item.tokens, largest > 0 {
                    Capsule().fill(color).frame(width: max(geometry.size.width * CGFloat(tokens) / CGFloat(largest), 3))
                }
            }
        }
        .frame(height: 5)
    }

    @ViewBuilder
    private var control: some View {
        if let ref = item.switch {
            if ref.isManual {
                Text("/mcp").font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary)
                    .help(ref.instruction ?? "Switch this in the agent itself.")
            } else if isBusy {
                ProgressView().controlSize(.small)
            } else {
                Toggle("", isOn: Binding(get: { ref.enabled }, set: { _ in requestToggle() }))
                    .toggleStyle(.switch).controlSize(.mini).labelsHidden()
                    .disabled(isLocked)
                    .help(ref.enabled ? "Switch off \(item.label)" : "Switch on \(item.label)")
            }
        }
    }
}
