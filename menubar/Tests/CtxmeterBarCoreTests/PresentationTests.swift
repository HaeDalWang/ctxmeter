import AppKit
import Foundation
import Testing

@testable import CtxmeterBarCore

private let report = TelemetryReport(
    schemaVersion: "0.1.0", generatedAt: "t",
    target: .init(home: "/h", workspace: "/w"),
    harnesses: [
        "claude": .init(model: "claude-opus-5-5", contextWindowTokens: 1_000_000, inputTokens: 188_381,
                        usagePercent: 18.84, observedAt: "c", store: nil, source: "local-jsonl"),
        "codex": .init(model: "gpt-5.6-sol", contextWindowTokens: 258_400, inputTokens: 69_784,
                       usagePercent: 27.01, observedAt: "x", store: nil, source: "local-jsonl"),
        "kiro": .init(model: "claude-opus-5", contextWindowTokens: 1_000_000, inputTokens: nil,
                      usagePercent: 37.13, observedAt: "k", store: "ide", source: "local-session"),
    ]
)

@Test func popoverTabsLeadWithOverviewAndCoverEveryHarness() {
    #expect(PopoverTab.allCases.count == 4)
    #expect(PopoverTab.allCases.first == .overview)
    #expect(PopoverTab.allCases.dropFirst() == [.harness(.claude), .harness(.codex), .harness(.kiro)])
    #expect(PopoverTab.overview.title == "Overview")
    #expect(PopoverTab.harness(.kiro).title == "Kiro")
}

@Test func popoverTabRoundTripsThroughItsStorageKey() {
    for tab in PopoverTab.allCases {
        #expect(PopoverTab(storageKey: tab.storageKey) == tab)
    }
    #expect(PopoverTab.harness(.codex).storageKey == "codex")
    #expect(PopoverTab(storageKey: "nonsense") == .overview)
    #expect(PopoverTab(storageKey: nil) == .overview)
}

@Test func menuBarTextShowsOnlyTheSelectedHarness() {
    #expect(Format.menuBarText(report, tab: .harness(.kiro)) == "37%")
    #expect(Format.menuBarText(report, tab: .harness(.claude)) == "19%")
}

@Test func overviewCollapsesToTheHighestHarnessToSaveMenuBarWidth() {
    // Kiro is highest at 37.13, so the bar shows its icon and its number only.
    #expect(Format.menuBarText(report, tab: .overview) == "37%")
    #expect(Format.menuBarFocus(report, tab: .overview) == .kiro)

    // The full summary stays available for the tooltip and accessibility label.
    #expect(Format.menuBarLabel(report) == "CC 19% · CX 27% · KI 37%")
}

@Test func overviewFocusFollowsWhicheverHarnessIsClosestToItsLimit() {
    let claudeLeads = TelemetryReport(
        schemaVersion: "0.1.0", generatedAt: "t", target: .init(home: "/h", workspace: "/w"),
        harnesses: [
            "claude": .init(model: "a", contextWindowTokens: 100, inputTokens: 90, usagePercent: 90,
                            observedAt: nil, store: nil, source: nil),
            "kiro": .init(model: "b", contextWindowTokens: 100, inputTokens: nil, usagePercent: 12,
                          observedAt: nil, store: nil, source: nil),
        ]
    )

    #expect(Format.menuBarFocus(claudeLeads, tab: .overview) == .claude)
    #expect(Format.menuBarText(claudeLeads, tab: .overview) == "90%")
}

@Test func overviewFocusBreaksTiesByDisplayOrder() {
    let tied = TelemetryReport(
        schemaVersion: "0.1.0", generatedAt: "t", target: .init(home: "/h", workspace: "/w"),
        harnesses: [
            "codex": .init(model: "b", contextWindowTokens: 100, inputTokens: 50, usagePercent: 50,
                           observedAt: nil, store: nil, source: nil),
            "kiro": .init(model: "c", contextWindowTokens: 100, inputTokens: nil, usagePercent: 50,
                          observedAt: nil, store: nil, source: nil),
        ]
    )

    #expect(Format.menuBarFocus(tied, tab: .overview) == .codex)
}

@Test func menuBarFocusOnAHarnessTabIsThatHarnessRegardlessOfData() {
    #expect(Format.menuBarFocus(report, tab: .harness(.claude)) == .claude)
    #expect(Format.menuBarFocus(nil, tab: .harness(.codex)) == .codex)
    #expect(Format.menuBarFocus(nil, tab: .overview) == nil)
}

@Test func menuBarTextMarksAnUnknownHarnessCompactly() {
    let sparse = TelemetryReport(
        schemaVersion: "0.1.0", generatedAt: "t", target: .init(home: "/h", workspace: "/w"),
        harnesses: ["claude": .init(model: "unlisted", contextWindowTokens: nil, inputTokens: 500,
                                    usagePercent: nil, observedAt: nil, store: nil, source: nil)]
    )

    #expect(Format.menuBarText(sparse, tab: .harness(.claude)) == "—")
    #expect(Format.menuBarText(sparse, tab: .overview) == "ctxmeter")
    #expect(Format.menuBarFocus(sparse, tab: .overview) == nil)
    #expect(Format.menuBarText(nil, tab: .harness(.kiro)) == "—")
    #expect(Format.menuBarText(nil, tab: .overview) == "ctxmeter")
}

@Test func agentAppLocatorFindsVendorAppsInPreferenceOrder() {
    let present: Set<String> = ["/Applications/Kiro CLI.app", "/Applications/Kiro.app", "/Applications/ChatGPT.app"]
    let exists: (String) -> Bool = { present.contains($0) }

    #expect(AgentAppLocator.resolve(for: .kiro, exists: exists) == "/Applications/Kiro.app")
    #expect(AgentAppLocator.resolve(for: .codex, exists: exists) == "/Applications/ChatGPT.app")
    #expect(AgentAppLocator.resolve(for: .claude, exists: exists) == nil)
}

@Test func agentAppLocatorAlsoLooksInTheUserApplicationsFolder() {
    let candidates = AgentAppLocator.candidates(for: .claude, home: "/Users/tester")

    #expect(candidates.contains("/Applications/Claude.app"))
    #expect(candidates.contains("/Users/tester/Applications/Claude.app"))
    #expect(candidates.firstIndex(of: "/Applications/Claude.app")! < candidates.firstIndex(of: "/Users/tester/Applications/Claude.app")!)
}

@Test func everyHarnessHasASymbolFallbackWhenNoAppIsInstalled() {
    for harness in Harness.allCases {
        #expect(!AgentAppLocator.fallbackSymbol(for: harness).isEmpty)
    }
    #expect(AgentAppLocator.resolve(for: .kiro, exists: { _ in false }) == nil)
}


// Several agent monitors render a vendor icon beside a percentage, and the
// operator could not tell which menu bar item belonged to ctxmeter. Hovering has
// to answer that, so the tooltip names the tool in every state.
@Test func theTooltipNamesTheToolSoItCanBeToldApartFromOtherMonitors() {
    #expect(Format.menuBarTooltip(report).hasPrefix("ctxmeter"))
    #expect(Format.menuBarTooltip(report).contains("CC 19%"))
}

@Test func theTooltipStillNamesTheToolWithNothingObserved() {
    #expect(Format.menuBarTooltip(nil).hasPrefix("ctxmeter"))
}

@Test func theTooltipExplainsWhatTheNumberMeasures() {
    // "19%" is ambiguous next to a quota monitor showing "96%", where high is good
    // and here high is bad. The tooltip has to say which direction it runs.
    #expect(Format.menuBarTooltip(nil).lowercased().contains("context"))
}

@Test func aGaugeGlyphMarksTheItemInEveryState() {
    #expect(!Format.menuBarSymbol.isEmpty)
}


// A symbol name that does not exist on the running OS renders as nothing, so the
// glyph meant to identify the item would be silently absent. This resolves it the
// same way Image(systemName:) does.
@Test func theGaugeGlyphResolvesToARealSymbolOnThisSystem() throws {
    let image = NSImage(systemSymbolName: Format.menuBarSymbol, accessibilityDescription: nil)
    #expect(image != nil, "\(Format.menuBarSymbol) is not an SF Symbol on this OS")
}
