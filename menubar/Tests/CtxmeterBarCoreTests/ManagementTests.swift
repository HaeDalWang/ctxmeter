import Foundation
import Testing

@testable import CtxmeterBarCore

private let historyJSON = """
{
  "schemaVersion": "0.1.0", "generatedAt": "t", "days": 7,
  "target": { "home": "/h", "workspace": "/w" },
  "harnesses": {
    "claude": {
      "unit": "tokens",
      "current": { "id": "s1", "model": "claude-opus-5-5", "startedAt": "a", "updatedAt": "b",
                   "turns": 3, "peak": 91000, "compactions": 1,
                   "samples": [ { "at": "a", "value": 21000, "compactedBefore": false },
                                { "at": "b", "value": 91000, "compactedBefore": false },
                                { "at": "c", "value": 11000, "compactedBefore": true } ] },
      "top": [ { "id": "s1", "model": "m", "startedAt": "a", "updatedAt": "b", "turns": 3, "peak": 91000, "compactions": 1 } ]
    },
    "codex": { "unit": "tokens", "current": null, "top": [] },
    "kiro": { "unit": "percent",
              "current": { "id": "k", "model": null, "startedAt": "a", "updatedAt": "b", "turns": 1, "peak": 27.5,
                           "compactions": 0, "samples": [ { "at": "a", "value": 27.5, "compactedBefore": false } ] },
              "top": [] }
  }
}
"""

private let detailsJSON = """
{
  "schemaVersion": "0.1.0", "generatedAt": "t", "mcpMeasuredAt": null,
  "target": { "home": "/h", "workspace": "/w" },
  "harnesses": {
    "codex": {
      "model": "gpt-5.6-sol", "contextWindowTokens": 258400, "observedInputTokens": 69784,
      "usagePercent": 27.0, "autocompactBufferTokens": null,
      "segments": [ { "id": "instructions", "label": "Instructions and rules", "tokens": 586 },
                    { "id": "mcp", "label": "MCP tool schemas", "tokens": 8963 },
                    { "id": "other", "label": "Messages", "tokens": 60235 } ],
      "items": [
        { "id": "mcp:big", "category": "mcp", "label": "big", "tokens": 7298, "detail": "30 tools",
          "switch": { "target": "codex/big", "enabled": true, "format": "toml", "instruction": null } },
        { "id": "mcp:parked", "category": "mcp", "label": "parked", "tokens": null, "detail": null,
          "switch": { "target": "codex/parked", "enabled": false, "format": "toml", "instruction": null } },
        { "id": "instructions", "category": "instructions", "label": "Global instructions", "tokens": 586,
          "detail": "AGENTS.md", "switch": null }
      ],
      "unmeasured": [ { "id": "hooks", "label": "10 hooks", "count": 10, "tokens": null, "reason": "runtime" } ]
    }
  }
}
"""

@Test func decodesHistoryWithTokenAndPercentUnits() throws {
    let report = try CLIDecoder.decode(HistoryReport.self, from: Data(historyJSON.utf8))

    #expect(report.entry(.claude)?.unit == .tokens)
    #expect(report.entry(.claude)?.current?.samples?.count == 3)
    #expect(report.entry(.claude)?.current?.samples?.last?.compactedBefore == true)
    #expect(report.entry(.claude)?.top.first?.samples == nil)
    #expect(report.entry(.codex)?.current == nil)
    #expect(report.entry(.kiro)?.unit == .percent)
    #expect(report.entry(.kiro)?.current?.peak == 27.5)
}

@Test func decodesDetailsWithSwitchesAndUnknownCosts() throws {
    let report = try CLIDecoder.decode(DetailsReport.self, from: Data(detailsJSON.utf8))
    let codex = try #require(report.entry(.codex))

    #expect(codex.segments.map(\.id) == ["instructions", "mcp", "other"])
    #expect(codex.items[0].switch?.target == "codex/big")
    #expect(codex.items[1].tokens == nil)
    #expect(codex.items[1].switch?.enabled == false)
    #expect(codex.items[2].switch == nil)
    #expect(codex.unmeasured.first?.label == "10 hooks")
    #expect(report.entry(.claude) == nil)
}

@Test func decodesToggleResult() throws {
    let json = #"{ "target": "codex/big", "file": "/h/.codex/config.toml", "backup": "/h/b.bak", "tokens": 7298, "enabled": false, "rollback": "cp 'a' 'b'" }"#
    let result = try CLIDecoder.decode(ToggleResult.self, from: Data(json.utf8))

    #expect(result.enabled == false)
    #expect(result.rollback == "cp 'a' 'b'")
}

@Test func commandsBuildTheArgumentsTheCLIExpects() {
    #expect(CtxmeterCommand.telemetry.arguments(workspace: "/w") == ["telemetry", "--workspace", "/w"])
    #expect(CtxmeterCommand.history.arguments(workspace: "/w") == ["history", "--workspace", "/w"])
    #expect(CtxmeterCommand.details.arguments(workspace: "/w") == ["details", "--workspace", "/w"])
    #expect(CtxmeterCommand.toggle(target: "codex/big", enabled: false).arguments(workspace: "/w")
        == ["fix", "--disable", "codex/big", "--json", "--workspace", "/w"])
    #expect(CtxmeterCommand.toggle(target: "kiro/x", enabled: true).arguments(workspace: "/w")
        == ["fix", "--enable", "kiro/x", "--json", "--workspace", "/w"])
}

@Test func chartScalesToTheContextWindowWhenKnown() {
    let heights = Chart.heights([250, 500, 1000], ceiling: 1000)

    #expect(heights == [0.25, 0.5, 1.0])
}

@Test func chartScalesToThePeakWhenTheWindowIsUnknown() {
    let heights = Chart.heights([50, 100], ceiling: nil)

    #expect(heights == [0.5, 1.0])
}

@Test func chartNeverOverflowsOrDividesByZero() {
    #expect(Chart.heights([0, 0], ceiling: nil) == [0, 0])
    #expect(Chart.heights([2000], ceiling: 1000) == [1.0])
    #expect(Chart.heights([], ceiling: 10).isEmpty)
}

@Test func switchingOffPromptStatesTheSavingTheBackupAndTheRestart() {
    let item = DetailItem(id: "mcp:big", category: "mcp", label: "big", tokens: 7298, detail: "30 tools",
                          switch: .init(target: "codex/big", enabled: true, format: "toml", instruction: nil))

    let prompt = SwitchPrompt.make(item: item, harness: .codex)

    #expect(prompt.title == "Switch off big?")
    #expect(prompt.message.contains("7,298 tokens"))
    #expect(prompt.message.contains("backup"))
    #expect(prompt.message.contains("Restart Codex"))
    #expect(prompt.confirmLabel == "Switch Off")
}

@Test func switchingOnPromptSaysTheCostIsUnknownWhenItIs() {
    let item = DetailItem(id: "mcp:parked", category: "mcp", label: "parked", tokens: nil, detail: nil,
                          switch: .init(target: "codex/parked", enabled: false, format: "toml", instruction: nil))

    let prompt = SwitchPrompt.make(item: item, harness: .codex)

    #expect(prompt.title == "Switch on parked?")
    #expect(prompt.message.contains("not been measured"))
    #expect(prompt.confirmLabel == "Switch On")
}

@Test func manualSwitchesAreNotFlippedByTheApp() {
    let item = DetailItem(id: "mcp:docs", category: "mcp", label: "docs", tokens: 100, detail: nil,
                          switch: .init(target: "claude/docs", enabled: true, format: "manual", instruction: "run /mcp"))

    #expect(item.switch?.isManual == true)
}

@Test func historyValuesFormatInTheirOwnUnit() {
    #expect(Format.historyValue(91000, unit: .tokens) == "91.0k")
    #expect(Format.historyValue(27.54, unit: .percent) == "27.5%")
}
