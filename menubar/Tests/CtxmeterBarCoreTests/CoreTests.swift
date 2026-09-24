import Foundation
import Testing

@testable import CtxmeterBarCore

private let sampleJSON = """
{
  "schemaVersion": "0.1.0",
  "generatedAt": "2026-09-24T10:15:26.346Z",
  "target": { "home": "/Users/x", "workspace": "/Users/x/work/Token_Optimized" },
  "harnesses": {
    "claude": { "model": "claude-opus-5-5", "contextWindowTokens": null, "inputTokens": 188381,
                "usagePercent": null, "observedAt": "c-time", "store": null, "source": "local-jsonl" },
    "codex":  { "model": "gpt-5.6-sol", "contextWindowTokens": 258400, "inputTokens": 69784,
                "usagePercent": 27.006191950464398, "observedAt": "x-time", "store": null, "source": "local-jsonl" },
    "kiro":   { "model": "claude-opus-5", "contextWindowTokens": 1000000, "inputTokens": null,
                "usagePercent": 31.0, "observedAt": "k-time", "store": "ide", "source": "local-session" }
  }
}
"""

@Test func decodesTelemetryIncludingNullCapacities() throws {
    let report = try TelemetryLoader.decode(Data(sampleJSON.utf8))

    #expect(report.schemaVersion == "0.1.0")
    #expect(report.target.workspace == "/Users/x/work/Token_Optimized")
    #expect(report.harnesses["claude"]?.inputTokens == 188381)
    #expect(report.harnesses["claude"]?.contextWindowTokens == nil)
    #expect(report.harnesses["claude"]?.usagePercent == nil)
    #expect(report.harnesses["kiro"]?.usagePercent == 31.0)
    #expect(report.harnesses["kiro"]?.inputTokens == nil)
    #expect(report.harnesses["kiro"]?.store == "ide")
}

@Test func decodeReportsMalformedPayloadInsteadOfCrashing() {
    #expect(throws: TelemetryLoader.LoadError.self) {
        try TelemetryLoader.decode(Data("{ not json".utf8))
    }
}

@Test func harnessOrderIsStableForDisplay() {
    #expect(Harness.allCases.map(\.rawValue) == ["claude", "codex", "kiro"])
    #expect(Harness.kiro.displayName == "Kiro")
    #expect(Harness.codex.shortCode == "CX")
}

@Test func menuBarLabelOmitsHarnessesWithoutAPercentage() throws {
    let report = try TelemetryLoader.decode(Data(sampleJSON.utf8))

    #expect(Format.menuBarLabel(report) == "CX 27% · KI 31%")
}

@Test func menuBarLabelFallsBackWhenNothingIsObserved() {
    #expect(Format.menuBarLabel(nil) == "ctxmeter")

    let empty = TelemetryReport(
        schemaVersion: "0.1.0", generatedAt: "t",
        target: .init(home: "/h", workspace: "/w"),
        harnesses: ["claude": .init(model: nil, contextWindowTokens: nil, inputTokens: nil,
                                   usagePercent: nil, observedAt: nil, store: nil, source: nil)]
    )
    #expect(Format.menuBarLabel(empty) == "ctxmeter")
}

@Test func compactTokensMatchesDashboardStyle() {
    #expect(Format.compactTokens(nil) == "미측정")
    #expect(Format.compactTokens(0) == "0")
    #expect(Format.compactTokens(940) == "940")
    #expect(Format.compactTokens(69784) == "69.8k")
    #expect(Format.compactTokens(188381) == "188k")
    #expect(Format.compactTokens(1000000) == "1m")
}

@Test func percentTextKeepsUnknownExplicit() {
    #expect(Format.percentText(nil) == "용량 미확인")
    #expect(Format.percentText(31.0) == "31.0%")
    #expect(Format.percentText(27.006191950464398) == "27.0%")
}

@Test func refreshIntervalIsClampedToAllowedRange() {
    #expect(AppSettings.clampRefresh(30) == 30)
    #expect(AppSettings.clampRefresh(1) == AppSettings.minimumRefreshSeconds)
    #expect(AppSettings.clampRefresh(9999) == AppSettings.maximumRefreshSeconds)
    #expect(AppSettings.clampRefresh(.nan) == AppSettings.defaultRefreshSeconds)
    #expect(AppSettings.defaultRefreshSeconds == 30)
    #expect(AppSettings.minimumRefreshSeconds == 5)
}

@Test func nodeLocatorPrefersOverrideThenKnownInstallPaths() {
    let present: Set<String> = ["/opt/homebrew/bin/node", "/custom/node"]
    let exists: (String) -> Bool = { present.contains($0) }

    #expect(NodeLocator.resolve(override: "/custom/node", exists: exists) == "/custom/node")
    #expect(NodeLocator.resolve(override: "  ", exists: exists) == "/opt/homebrew/bin/node")
    #expect(NodeLocator.resolve(override: "/missing/node", exists: exists) == "/opt/homebrew/bin/node")
    #expect(NodeLocator.resolve(override: nil, exists: { _ in false }) == nil)
}

@Test func observedAgeDescribesStaleReadings() {
    let now = Date(timeIntervalSince1970: 1_000_000)
    #expect(Format.relativeAge(nil, now: now) == "기록 없음")
    #expect(Format.relativeAge(now.addingTimeInterval(-20), now: now) == "20초 전")
    #expect(Format.relativeAge(now.addingTimeInterval(-3 * 60), now: now) == "3분 전")
    #expect(Format.relativeAge(now.addingTimeInterval(-2 * 3600), now: now) == "2시간 전")
}
