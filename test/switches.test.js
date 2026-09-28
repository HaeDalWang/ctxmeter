const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { listSwitches, planSwitch } = require('../src/switches');
const { MEASURED_STATUS } = require('../src/mcp-cost');

function fixtureHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-switch-'));
}

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

function snapshotFor(home, harnesses = {}) {
  return {
    target: { home, workspace: home },
    harnesses: {
      claude: { skillGroups: [], enabledPlugins: [], ...harnesses.claude },
      codex: { skillGroups: [], enabledPlugins: [], ...harnesses.codex },
      kiro: { skillGroups: [], enabledPlugins: [], ...harnesses.kiro },
    },
  };
}

function cacheFor(home, servers) {
  return { home, measuredAt: '2026-09-28T00:00:00.000Z', servers };
}

function byTarget(switches) {
  return Object.fromEntries(switches.map((item) => [item.target, item]));
}

test('lists Codex MCP servers that are on and off, keeping a cached cost for the off one', () => {
  // Arrange
  const home = fixtureHome();
  write(home, '.codex/config.toml', '[mcp_servers.live]\ncommand = "a"\n\n[mcp_servers.parked]\ncommand = "b"\nenabled = false\n');
  const mcpCost = cacheFor(home, [{ harness: 'codex', name: 'parked', status: MEASURED_STATUS, toolCount: 3, estimatedTokens: 700 }]);

  // Act
  const switches = byTarget(listSwitches({ home, snapshot: snapshotFor(home), mcpCost }));

  // Assert
  assert.equal(switches['codex/live'].enabled, true);
  assert.equal(switches['codex/live'].tokens, null, 'never measured, so unknown');
  assert.equal(switches['codex/parked'].enabled, false);
  assert.equal(switches['codex/parked'].tokens, 700);
});

test('lists Kiro servers with their disabled flag', () => {
  // Arrange
  const home = fixtureHome();
  write(home, '.kiro/settings/mcp.json', JSON.stringify({ mcpServers: { on: { command: 'a' }, off: { command: 'b', disabled: true } } }));

  // Act
  const switches = byTarget(listSwitches({ home, snapshot: snapshotFor(home), mcpCost: null }));

  // Assert
  assert.equal(switches['kiro/on'].enabled, true);
  assert.equal(switches['kiro/off'].enabled, false);
  assert.equal(switches['kiro/off'].format, 'json');
});

test('lists Claude plugins from settings.json, with the metadata cost of enabled ones', () => {
  // Arrange
  const home = fixtureHome();
  write(home, '.claude/settings.json', JSON.stringify({ enabledPlugins: { 'a@m': true, 'b@m': false } }));
  const snapshot = snapshotFor(home, { claude: { skillGroups: [{ id: 'a@m', metadataTokenEstimate: 420, skillCount: 3 }] } });

  // Act
  const switches = byTarget(listSwitches({ home, snapshot, mcpCost: null }));

  // Assert
  assert.equal(switches['claude/plugin:a@m'].enabled, true);
  assert.equal(switches['claude/plugin:a@m'].tokens, 420);
  assert.equal(switches['claude/plugin:a@m'].kind, 'plugin-group');
  assert.equal(switches['claude/plugin:b@m'].enabled, false);
  assert.equal(switches['claude/plugin:b@m'].tokens, null);
});

test('lists Codex plugin groups on and off', () => {
  // Arrange
  const home = fixtureHome();
  write(home, '.codex/config.toml', '[plugins."on@m"]\nenabled = true\n\n[plugins."off@m"]\nenabled = false\n');

  // Act
  const switches = byTarget(listSwitches({ home, snapshot: snapshotFor(home), mcpCost: null }));

  // Assert
  assert.equal(switches['codex/plugin:on@m'].enabled, true);
  assert.equal(switches['codex/plugin:off@m'].enabled, false);
});

test('Claude MCP servers are listed as manual switches', () => {
  // Arrange
  const home = fixtureHome();
  write(home, '.claude.json', JSON.stringify({ mcpServers: { docs: { command: 'a' } }, projects: { [home]: { disabledMcpServers: ['gone'] } } }));

  // Act
  const switches = byTarget(listSwitches({ home, snapshot: snapshotFor(home), mcpCost: null }));

  // Assert
  assert.equal(switches['claude/docs'].format, 'manual');
  assert.equal(switches['claude/docs'].enabled, true);
  assert.match(switches['claude/docs'].instruction, /\/mcp/);
});

test('a cache measured in another home contributes no costs', () => {
  // Arrange
  const home = fixtureHome();
  write(home, '.codex/config.toml', '[mcp_servers.x]\ncommand = "a"\n');
  const mcpCost = cacheFor('/another/home', [{ harness: 'codex', name: 'x', status: MEASURED_STATUS, toolCount: 1, estimatedTokens: 999 }]);

  // Act
  const [item] = listSwitches({ home, snapshot: snapshotFor(home), mcpCost });

  // Assert
  assert.equal(item.tokens, null);
});

test('enabling a parked Codex server sets enabled = true in place', () => {
  // Arrange
  const home = fixtureHome();
  write(home, '.codex/config.toml', '[mcp_servers.parked]\ncommand = "b"\nenabled = false\n');
  const item = byTarget(listSwitches({ home, snapshot: snapshotFor(home), mcpCost: null }))['codex/parked'];

  // Act
  const plan = planSwitch(item, true);

  // Assert
  assert.equal(plan.changed, true);
  assert.equal(plan.after, '[mcp_servers.parked]\ncommand = "b"\nenabled = true\n');
});

test('enabling a Kiro server clears its disabled flag', () => {
  // Arrange
  const home = fixtureHome();
  write(home, '.kiro/settings/mcp.json', JSON.stringify({ mcpServers: { off: { command: 'b', disabled: true } } }, null, 2));
  const item = byTarget(listSwitches({ home, snapshot: snapshotFor(home), mcpCost: null }))['kiro/off'];

  // Act
  const plan = planSwitch(item, true);

  // Assert
  assert.equal(JSON.parse(plan.after).mcpServers.off.disabled, false);
});

test('switching a Claude plugin flips only its enabledPlugins value', () => {
  // Arrange
  const home = fixtureHome();
  write(home, '.claude/settings.json', JSON.stringify({ model: 'x', enabledPlugins: { 'a@m': true, 'b@m': false } }, null, 2));
  const item = byTarget(listSwitches({ home, snapshot: snapshotFor(home), mcpCost: null }))['claude/plugin:a@m'];

  // Act
  const plan = planSwitch(item, false);

  // Assert
  assert.deepEqual(JSON.parse(plan.after), { model: 'x', enabledPlugins: { 'a@m': false, 'b@m': false } });
});

test('a manual switch is refused with its instruction instead of writing', () => {
  // Arrange
  const home = fixtureHome();
  write(home, '.claude.json', JSON.stringify({ mcpServers: { docs: { command: 'a' } } }));
  const item = byTarget(listSwitches({ home, snapshot: snapshotFor(home), mcpCost: null }))['claude/docs'];

  // Act + Assert
  assert.throws(() => planSwitch(item, false), /\/mcp/);
});
