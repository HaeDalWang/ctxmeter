const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  describeDryRun,
  measureMcpCost,
  mcpServerEntries,
  toolSchemaBytes,
} = require('../src/mcp-cost');

function fixtureHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-mcp-test-'));
}

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/// A minimal stdio MCP server: newline-delimited JSON-RPC, three tools.
function fakeServer(root, name, toolCount) {
  const script = `
const tools = Array.from({ length: ${toolCount} }, (_, i) => ({
  name: 'tool_' + i,
  description: 'Does thing number ' + i,
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  annotations: { audience: ['assistant'] },
}));
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\\n')) !== -1) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.method === 'initialize') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: row.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: '${name}', version: '1.0.0' } } }) + '\\n');
    }
    if (row.method === 'tools/list') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: row.id, result: { tools } }) + '\\n');
    }
  }
});
`;
  write(root, `servers/${name}.js`, script);
  return path.join(root, `servers/${name}.js`);
}

test('tool schema bytes count only the fields a model is shown', () => {
  const tools = [{
    name: 'search',
    description: 'Search the index',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    // Server-side extras that never reach the prompt must not be counted.
    _meta: { internal: 'x'.repeat(5_000) },
    annotations: { audience: ['assistant'] },
  }];

  const bytes = toolSchemaBytes(tools);

  assert.equal(bytes, Buffer.byteLength(JSON.stringify([{
    name: 'search',
    description: 'Search the index',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  }])));
  assert.equal(bytes < 5_000, true);
  assert.equal(toolSchemaBytes([]), 0);
  assert.equal(toolSchemaBytes(null), 0);
});

test('server entries come from both harnesses and skip disabled ones', () => {
  const home = fixtureHome();
  write(home, '.claude/mcp.json', JSON.stringify({
    mcpServers: {
      local: { command: 'node', args: ['server.js'], env: { TOKEN: 'SECRET VALUE' } },
      remote: { url: 'https://example.test/mcp', type: 'http' },
      off: { command: 'node', args: ['x.js'], disabled: true },
    },
  }));
  write(home, '.codex/config.toml', [
    '[mcp_servers.docs]',
    'command = "uvx"',
    'args = ["docs-server@latest"]',
    '[mcp_servers.docs.env]',
    'KEY = "ANOTHER SECRET"',
    '[mcp_servers."quoted-name"]',
    'command = "node"',
  ].join('\n'));

  const entries = mcpServerEntries(home);

  assert.deepEqual(entries.map((entry) => `${entry.harness}/${entry.name}`).sort(), [
    'claude/local', 'claude/remote', 'codex/docs', 'codex/quoted-name',
  ]);
  assert.equal(entries.find((entry) => entry.name === 'local').transport, 'stdio');
  assert.equal(entries.find((entry) => entry.name === 'remote').transport, 'http');
  assert.deepEqual(entries.find((entry) => entry.name === 'docs').args, ['docs-server@latest']);
});

test('dry run states exactly what would be executed and hides env values', () => {
  const home = fixtureHome();
  write(home, '.claude/mcp.json', JSON.stringify({
    mcpServers: {
      local: { command: 'node', args: ['server.js'], env: { TOKEN: 'SECRET VALUE' } },
      remote: { url: 'https://example.test/mcp' },
    },
  }));

  const text = describeDryRun(mcpServerEntries(home));

  assert.match(text, /node server\.js/);
  assert.match(text, /https:\/\/example\.test\/mcp/);
  assert.match(text, /TOKEN/);
  assert.equal(text.includes('SECRET VALUE'), false);
});

test('measuring a live stdio server returns tool count and schema size only', async () => {
  const home = fixtureHome();
  const scriptPath = fakeServer(home, 'fixture', 12);
  write(home, '.claude/mcp.json', JSON.stringify({
    mcpServers: { fixture: { command: process.execPath, args: [scriptPath] } },
  }));

  const result = await measureMcpCost(mcpServerEntries(home), { timeoutMs: 10_000 });
  const server = result.servers[0];

  assert.equal(server.name, 'fixture');
  assert.equal(server.status, 'measured');
  assert.equal(server.toolCount, 12);
  assert.equal(server.schemaBytes > 0, true);
  assert.equal(server.estimatedTokens, Math.round(server.schemaBytes / 4));
  assert.equal(result.totalEstimatedTokens, server.estimatedTokens);
  assert.equal(result.totalToolCount, 12);
  // Schema text itself must never be retained.
  assert.equal(JSON.stringify(result).includes('inputSchema'), false);
  assert.equal(JSON.stringify(result).includes('tool_0'), false);
});

test('a server that never answers is timed out and reported, not fatal', async () => {
  const home = fixtureHome();
  write(home, 'servers/silent.js', 'setInterval(() => {}, 1000);');
  write(home, '.claude/mcp.json', JSON.stringify({
    mcpServers: {
      silent: { command: process.execPath, args: [path.join(home, 'servers/silent.js')] },
      missing: { command: path.join(home, 'no-such-binary'), args: [] },
    },
  }));

  const result = await measureMcpCost(mcpServerEntries(home), { timeoutMs: 300 });

  assert.equal(result.servers.length, 2);
  assert.equal(result.servers.find((server) => server.name === 'silent').status, 'timeout');
  assert.equal(result.servers.find((server) => server.name === 'silent').estimatedTokens, null);
  assert.equal(result.servers.find((server) => server.name === 'missing').status, 'failed');
  assert.equal(result.totalEstimatedTokens, 0);
});

test('remote servers are skipped unless the caller opts into network calls', async () => {
  const home = fixtureHome();
  write(home, '.claude/mcp.json', JSON.stringify({
    mcpServers: { remote: { url: 'https://example.invalid/mcp', type: 'http' } },
  }));

  const result = await measureMcpCost(mcpServerEntries(home), { timeoutMs: 300 });

  assert.equal(result.servers[0].status, 'skipped-remote');
  assert.equal(result.servers[0].estimatedTokens, null);
});


const { auditReport, formatAudit } = require('../src/cli');

function snapshotWithMcp(count) {
  return {
    generatedAt: '2026-09-24T10:00:00.000Z',
    target: { home: '/h', workspace: '/w' },
    harnesses: {
      claude: {
        alwaysOn: { claudeMd: { tokenEstimate: 100 }, ruleFiles: 1, ruleBytes: 0 },
        skillGroups: [{ id: 'g', skillCount: 2, metadataTokenEstimate: 900 }],
        hookCount: 0,
        configuredMcpServerCount: count,
        enabledPlugins: [],
      },
    },
  };
}

test('audit folds a cached MCP measurement into the ranked findings', () => {
  const mcpCost = {
    measuredAt: '2026-09-24T11:00:00.000Z',
    home: '/h',
    servers: [
      { harness: 'claude', name: 'big', status: 'measured', toolCount: 30, estimatedTokens: 7_298 },
      { harness: 'claude', name: 'small', status: 'measured', toolCount: 7, estimatedTokens: 1_124 },
      { harness: 'codex', name: 'other', status: 'measured', toolCount: 4, estimatedTokens: 500 },
      { harness: 'claude', name: 'remote', status: 'skipped-remote', toolCount: null, estimatedTokens: null },
    ],
  };

  const report = auditReport(snapshotWithMcp(3), { profiles: [] }, mcpCost);
  const claude = report.harnesses.find((entry) => entry.id === 'claude');

  // MCP is now the largest item, so it must lead the ranked list.
  assert.equal(claude.findings[0].id, 'mcp');
  assert.equal(claude.findings[0].tokens, 8_422);
  assert.match(claude.findings[0].detail, /37 tools across 2 servers/);
  assert.equal(claude.measuredStartupTokens, 8_422 + 900 + 100);
  // A server that was skipped still has to be declared.
  assert.equal(claude.unmeasured.find((item) => item.id === 'mcp').count, 1);
  assert.match(formatAudit(report), /8,422/);
});

test('audit without a cached measurement tells the user how to get one', () => {
  const report = auditReport(snapshotWithMcp(4), { profiles: [] });
  const claude = report.harnesses.find((entry) => entry.id === 'claude');

  assert.equal(claude.findings.some((finding) => finding.id === 'mcp'), false);
  assert.equal(claude.unmeasured.find((item) => item.id === 'mcp').count, 4);
  assert.match(formatAudit(report), /mcp-scan/);
});


test('audit ignores an MCP cache measured against a different home', () => {
  const snapshot = snapshotWithMcp(3);
  snapshot.target.home = '/home/real';
  const foreignCache = {
    measuredAt: '2026-09-24T11:00:00.000Z',
    home: '/home/someone-else',
    servers: [{ harness: 'claude', name: 'big', status: 'measured', toolCount: 30, estimatedTokens: 7_298 }],
  };

  const report = auditReport(snapshot, { profiles: [] }, foreignCache);
  const claude = report.harnesses.find((entry) => entry.id === 'claude');

  // A cache from another machine or another --home must not be reported as this one's cost.
  assert.equal(claude.findings.some((finding) => finding.id === 'mcp'), false);
  assert.equal(report.mcpMeasuredAt, null);
  assert.equal(claude.unmeasured.find((item) => item.id === 'mcp').count, 3);

  // The same cache with a matching home is used.
  const matching = auditReport(snapshot, { profiles: [] }, { ...foreignCache, home: '/home/real' });
  assert.equal(matching.harnesses[0].findings[0].id, 'mcp');
});

test('a cache with no recorded home is treated as untrusted', () => {
  const snapshot = snapshotWithMcp(1);
  snapshot.target.home = '/home/real';
  const report = auditReport(snapshot, { profiles: [] }, {
    measuredAt: 't', servers: [{ harness: 'claude', name: 'x', status: 'measured', toolCount: 1, estimatedTokens: 500 }],
  });

  assert.equal(report.mcpMeasuredAt, null);
  assert.equal(report.harnesses[0].findings.some((finding) => finding.id === 'mcp'), false);
});

test('a flooding server is cut off instead of consuming unbounded memory', async () => {
  const home = fixtureHome();
  write(home, 'servers/flood.js', `
process.stdin.on('data', () => {});
const chunk = 'x'.repeat(64 * 1024);
setInterval(() => process.stdout.write(chunk), 1);
`);
  write(home, '.claude/mcp.json', JSON.stringify({
    mcpServers: { flood: { command: process.execPath, args: [path.join(home, 'servers/flood.js')] } },
  }));

  const result = await measureMcpCost(mcpServerEntries(home), { timeoutMs: 4_000 });

  assert.equal(result.servers[0].status, 'failed');
  assert.match(result.servers[0].detail, /too much output/);
  assert.equal(result.servers[0].estimatedTokens, null);
});
