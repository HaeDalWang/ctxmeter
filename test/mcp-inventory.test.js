const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { scanEnvironment } = require('../src/scanner');
const { auditReport } = require('../src/cli');

function fixtureHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-inv-test-'));
}

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

// A server the user switched off contributes nothing to the prompt, so counting
// it as unmeasured overstates what is unknown.
test('a disabled Claude server is not counted as configured', () => {
  // Arrange
  const home = fixtureHome();
  write(home, '.claude/mcp.json', JSON.stringify({
    mcpServers: {
      on: { command: 'node' },
      off: { command: 'node', disabled: true },
    },
  }));

  // Act
  const snapshot = scanEnvironment({ home, workspace: fixtureHome() });

  // Assert
  assert.equal(snapshot.harnesses.claude.configuredMcpServerCount, 1);
});

test('a Codex server with enabled = false is not counted as configured', () => {
  // Arrange
  const home = fixtureHome();
  write(home, '.codex/config.toml', [
    '[mcp_servers.on]',
    'command = "node"',
    '',
    '[mcp_servers.off]',
    'command = "node"',
    'enabled = false',
    '',
    '[mcp_servers.off.env]',
    'SOME_KEY = "value"',
    '',
  ].join('\n'));

  // Act
  const snapshot = scanEnvironment({ home, workspace: fixtureHome() });

  // Assert
  assert.equal(snapshot.harnesses.codex.configuredMcpServerCount, 1);
});

test('Kiro reports how many MCP servers it has configured', () => {
  // Arrange
  const home = fixtureHome();
  write(home, '.kiro/settings/mcp.json', JSON.stringify({
    mcpServers: {
      one: { command: 'node' },
      two: { url: 'https://example.invalid/mcp' },
      three: { command: 'node', disabled: true },
    },
  }));

  // Act
  const snapshot = scanEnvironment({ home, workspace: fixtureHome() });

  // Assert
  assert.equal(snapshot.harnesses.kiro.configuredMcpServerCount, 2);
});

test('the audit reports no unmeasured servers once every enabled one is measured', () => {
  // Arrange
  const home = fixtureHome();
  write(home, '.kiro/settings/mcp.json', JSON.stringify({
    mcpServers: {
      measured: { command: 'node' },
      switchedOff: { command: 'node', disabled: true },
    },
  }));
  const snapshot = scanEnvironment({ home, workspace: fixtureHome() });
  const mcpCost = {
    home,
    measuredAt: new Date().toISOString(),
    servers: [{ harness: 'kiro', name: 'measured', status: 'ok', toolCount: 1, schemaBytes: 400, estimatedTokens: 100 }],
  };

  // Act
  const report = auditReport(snapshot, { profiles: [] }, mcpCost);
  const kiro = report.harnesses.find((entry) => entry.id === 'kiro');

  // Assert
  assert.ok(kiro, 'kiro should appear in the audit');
  assert.ok(!kiro.unmeasured.some((note) => /MCP server/.test(note)), `expected no unmeasured MCP note, got ${JSON.stringify(kiro.unmeasured)}`);
});
