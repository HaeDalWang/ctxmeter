import Foundation
import Testing

@testable import CtxmeterBarCore

private func mcpItem(tokens: Int?, deferred: Int?) -> DetailItem {
    DetailItem(id: "mcp:graph", category: "mcp", label: "graph", tokens: tokens, detail: "30 tools · loads on use",
               switch: SwitchRef(target: "codex/graph", enabled: true, format: "toml", instruction: nil),
               deferredTokens: deferred)
}

@Test func decodesADeferredMcpItemAndAnOlderPayloadWithoutTheField() throws {
    let deferred = #"{ "id": "mcp:g", "category": "mcp", "label": "g", "tokens": null, "detail": null, "switch": null, "deferredTokens": 7000 }"#
    let older = #"{ "id": "mcp:g", "category": "mcp", "label": "g", "tokens": 500, "detail": null, "switch": null }"#
    #expect(try JSONDecoder().decode(DetailItem.self, from: Data(deferred.utf8)).deferredTokens == 7000)
    #expect(try JSONDecoder().decode(DetailItem.self, from: Data(older.utf8)).deferredTokens == nil)
}

@Test func costTextSaysOnUseForADeferredItemAndUnknownOnlyWhenUnmeasured() {
    #expect(Format.itemCost(mcpItem(tokens: nil, deferred: 7000)) == "on use")
    #expect(Format.itemCost(mcpItem(tokens: nil, deferred: nil)) == "unknown")
    #expect(Format.itemCost(mcpItem(tokens: 4352, deferred: nil)) == Format.compactTokens(4352))
}

@Test func switchingOffADeferredServerDoesNotPromiseAStartupSaving() {
    let prompt = SwitchPrompt.make(item: mcpItem(tokens: nil, deferred: 7000), harness: .codex)
    #expect(prompt.message.contains("loads its 7,000 tokens of tool schemas only when a tool is used"))
    #expect(!prompt.message.contains("frees about"))
}
