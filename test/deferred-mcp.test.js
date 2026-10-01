const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { auditReport, formatAudit } = require('../src/audit');
const { buildDetails } = require('../src/details');
const { fixProposals } = require('../src/fix');
const { MEASURED_STATUS, formatMcpCost } = require('../src/mcp-cost');
const { listSwitches } = require('../src/switches');

const DEFERRED = { mode: 'deferred', reason: 'Codex defers MCP tools behind tool search' };
const UPFRONT = { mode: 'upfront', reason: 'counted as loaded' };

function fixtureHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-deferred-'));
}

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function setup() {
  const home = fixtureHome();
  write(home, '.codex/config.toml', '[mcp_servers.graph]\ncommand = "graph"\n');
  write(home, '.kiro/settings/mcp.json', JSON.stringify({ mcpServers: { pw: { command: 'pw' } } }));
  const snapshot = {
    target: { home, workspace: home },
    harnesses: {
      codex: { skillGroups: [], enabledPlugins: [], configuredMcpServerCount: 1 },
      kiro: { skillGroups: [], enabledPlugins: [], configuredMcpServerCount: 1 },
    },
  };
  const mcpCost = {
    home,
    measuredAt: '2026-09-29T00:00:00.000Z',
    servers: [
      { harness: 'codex', name: 'graph', status: MEASURED_STATUS, estimatedTokens: 7_000, toolCount: 30, loading: DEFERRED },
      { harness: 'kiro', name: 'pw', status: MEASURED_STATUS, estimatedTokens: 4_000, toolCount: 25, loading: UPFRONT },
    ],
    totalEstimatedTokens: 11_000,
    totalToolCount: 55,
  };
  return { home, snapshot, mcpCost };
}

test('audit counts only schemas loaded at startup and reports deferred ones apart', () => {
  const { snapshot, mcpCost } = setup();
  const report = auditReport(snapshot, {}, mcpCost);
  const codex = report.harnesses.find((harness) => harness.id === 'codex');
  const kiro = report.harnesses.find((harness) => harness.id === 'kiro');

  assert.equal(codex.measuredStartupTokens, 0);
  assert.deepEqual(codex.deferredMcp, { tokens: 7_000, servers: 1, tools: 30 });
  assert.equal(kiro.measuredStartupTokens, 4_000);
  assert.equal(report.totalMeasuredStartupTokens, 4_000);
  // A deferred server is measured, so it is not listed as unmeasured either.
  assert.equal(codex.unmeasured.length, 0);

  const text = formatAudit(report);
  assert.match(text, /Codex: 0 tokens/);
  assert.match(text, /7,000 tokens of MCP schemas \(1 server, 30 tools\) load only on use/);
});

test('a deferred server is not offered by fix, but keeps its full cost for the switch list', () => {
  const { home, snapshot, mcpCost } = setup();
  const switches = listSwitches({ home, snapshot, mcpCost });
  const graph = switches.find((item) => item.target === 'codex/graph');

  assert.equal(graph.tokens, null);
  assert.equal(graph.deferredTokens, 7_000);
  assert.equal(graph.loading, 'deferred');
  assert.match(graph.detail, /30 tools · loads on use/);
  assert.deepEqual(fixProposals({ home, snapshot, mcpCost }).map((item) => item.target), ['kiro/pw']);
});

test('details leaves deferred schemas out of the startup composition', () => {
  const { home, snapshot, mcpCost } = setup();
  const details = buildDetails({ snapshot, switches: listSwitches({ home, snapshot, mcpCost }), mcpCost });
  const mcp = (harness) => details[harness].segments.find((segment) => segment.id === 'mcp').tokens;
  assert.equal(mcp('codex'), 0);
  assert.equal(mcp('kiro'), 4_000);
  const graph = details.codex.items.find((item) => item.id === 'mcp:graph');
  assert.equal(graph.tokens, null);
  assert.equal(graph.deferredTokens, 7_000);
});

test('mcp-scan output splits loaded from deferred', () => {
  const { mcpCost } = setup();
  const text = formatMcpCost(mcpCost);
  assert.match(text, /4,000 tokens load at startup; 7,000 more load only when a tool is used/);
  assert.match(text, /codex\/graph: 7,000 tokens, 30 tools — deferred/);
  assert.match(text, /kiro\/pw: 4,000 tokens, 25 tools$/m);
});

test('mcp-scan output without loading information keeps the old headline', () => {
  const { mcpCost } = setup();
  const plain = { ...mcpCost, servers: mcpCost.servers.map(({ loading, ...server }) => server) };
  assert.match(formatMcpCost(plain), /^MCP tool schemas cost 11,000 tokens across 55 tools\./);
});
