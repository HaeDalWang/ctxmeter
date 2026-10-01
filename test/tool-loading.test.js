const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { annotateLoading, claudeLoading, mcpLoading, startupTokens } = require('../src/tool-loading');
const { MEASURED_STATUS } = require('../src/mcp-cost');

function fixtureHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-loading-'));
}

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

test('Claude defers MCP schemas by default', () => {
  assert.equal(claudeLoading({ env: {} }).mode, 'deferred');
});

test('ENABLE_TOOL_SEARCH=false loads Claude MCP schemas up front', () => {
  assert.equal(claudeLoading({ env: { ENABLE_TOOL_SEARCH: 'false' } }).mode, 'upfront');
  assert.equal(claudeLoading({ env: { ENABLE_TOOL_SEARCH: 'true' } }).mode, 'deferred');
});

test('a third-party ANTHROPIC_BASE_URL turns tool search off unless forced on', () => {
  assert.equal(claudeLoading({ env: { ANTHROPIC_BASE_URL: 'https://proxy.example.com' } }).mode, 'upfront');
  assert.equal(claudeLoading({ env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' } }).mode, 'deferred');
  assert.equal(claudeLoading({ env: { ANTHROPIC_BASE_URL: 'https://proxy.example.com', ENABLE_TOOL_SEARCH: 'true' } }).mode, 'deferred');
});

test('disabling experimental betas keeps tool search off whatever else is set', () => {
  const env = { CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1', ENABLE_TOOL_SEARCH: 'true' };
  assert.equal(claudeLoading({ env }).mode, 'upfront');
});

test('auto defers only when all MCP schemas exceed the threshold share of the window', () => {
  const env = { ENABLE_TOOL_SEARCH: 'auto:5' };
  assert.equal(claudeLoading({ env, totalTokens: 6_000, contextWindowTokens: 100_000 }).mode, 'deferred');
  assert.equal(claudeLoading({ env, totalTokens: 4_000, contextWindowTokens: 100_000 }).mode, 'upfront');
  assert.equal(claudeLoading({ env: { ENABLE_TOOL_SEARCH: 'auto' }, totalTokens: 9_000, contextWindowTokens: 100_000 }).mode, 'upfront');
  // Without a window the threshold cannot be evaluated; count it as loaded.
  assert.equal(claudeLoading({ env, totalTokens: 6_000, contextWindowTokens: null }).mode, 'upfront');
});

test('a Claude server with alwaysLoad is loaded up front even when others are deferred', () => {
  assert.equal(claudeLoading({ env: {}, alwaysLoad: true }).mode, 'upfront');
});

test('Codex always defers MCP tools; Kiro is counted as loaded because nothing documents deferral', () => {
  assert.equal(mcpLoading('codex', {}).mode, 'deferred');
  const kiro = mcpLoading('kiro', {});
  assert.equal(kiro.mode, 'upfront');
  assert.match(kiro.reason, /not documented/);
});

test('annotateLoading reads Claude env from settings.json and alwaysLoad from the server config', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'repo');
  fs.mkdirSync(workspace);
  write(home, '.claude/settings.json', JSON.stringify({ env: { ENABLE_TOOL_SEARCH: 'true' } }));
  write(home, '.claude.json', JSON.stringify({ mcpServers: {
    eager: { command: 'x', alwaysLoad: true },
    lazy: { command: 'y' },
  } }));
  const cost = { home, servers: [
    { harness: 'claude', name: 'eager', status: MEASURED_STATUS, estimatedTokens: 500 },
    { harness: 'claude', name: 'lazy', status: MEASURED_STATUS, estimatedTokens: 700 },
    { harness: 'codex', name: 'graph', status: MEASURED_STATUS, estimatedTokens: 7_000 },
    { harness: 'kiro', name: 'pw', status: MEASURED_STATUS, estimatedTokens: 4_000 },
  ] };

  const annotated = annotateLoading(cost, { home, workspace, env: { ENABLE_TOOL_SEARCH: 'false' } });
  const byName = Object.fromEntries(annotated.servers.map((server) => [server.name, server]));

  // settings.json wins over the shell for the variable Claude reads.
  assert.equal(byName.lazy.loading.mode, 'deferred');
  assert.equal(byName.eager.loading.mode, 'upfront');
  assert.equal(byName.graph.loading.mode, 'deferred');
  assert.equal(byName.pw.loading.mode, 'upfront');
  assert.deepEqual(annotated.servers.map(startupTokens), [500, 0, 0, 4_000]);
  // The input is not modified.
  assert.equal(cost.servers[0].loading, undefined);
});

test('an unannotated server counts in full, so older callers keep their numbers', () => {
  assert.equal(startupTokens({ estimatedTokens: 1_234 }), 1_234);
  assert.equal(startupTokens({ estimatedTokens: null }), 0);
});

test('annotateLoading passes a missing cache through', () => {
  assert.equal(annotateLoading(null, { home: '/h', workspace: '/w', env: {} }), null);
});
