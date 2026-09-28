const assert = require('node:assert/strict');
const test = require('node:test');

const { buildDetails } = require('../src/details');

function snapshot(harnesses) {
  return { target: { home: '/h', workspace: '/w' }, harnesses };
}

const CLAUDE = {
  alwaysOn: { claudeMd: { tokenEstimate: 2_000 }, ruleBytes: 4_000, ruleFiles: 2 },
  skillGroups: [
    { id: 'user-skills', metadataTokenEstimate: 3_000, skillCount: 10 },
    { id: 'a@m', metadataTokenEstimate: 1_000, skillCount: 2 },
    { id: 'empty', metadataTokenEstimate: 0, skillCount: 0 },
  ],
  hookCount: 4,
  configuredMcpServerCount: 0,
};

const SWITCHES = [
  { target: 'claude/plugin:a@m', harness: 'claude', kind: 'plugin-group', name: 'a@m', enabled: true, tokens: 1_000, format: 'json-plugin' },
  { target: 'claude/plugin:off@m', harness: 'claude', kind: 'plugin-group', name: 'off@m', enabled: false, tokens: null, format: 'json-plugin' },
  { target: 'codex/big', harness: 'codex', kind: 'mcp-server', name: 'big', enabled: true, tokens: 7_000, detail: '30 tools', format: 'toml' },
  { target: 'codex/parked', harness: 'codex', kind: 'mcp-server', name: 'parked', enabled: false, tokens: null, format: 'toml' },
];

function claudeOnly(telemetry) {
  return buildDetails({ snapshot: snapshot({ claude: CLAUDE }), switches: SWITCHES, telemetry: { claude: telemetry }, profiles: {} }).claude;
}

test('segments split the observed context into estimates and the remainder', () => {
  // Arrange + Act
  const claude = claudeOnly({ model: 'm', contextWindowTokens: 100_000, inputTokens: 20_000, usagePercent: 20 });

  // Assert: instructions 2,000 + rules 1,000 = 3,000; skills 4,000; the rest is messages.
  assert.deepEqual(claude.segments.map((segment) => [segment.id, segment.tokens]), [
    ['instructions', 3_000], ['skills', 4_000], ['mcp', 0], ['other', 13_000],
  ]);
});

test('estimates never exceed what was observed', () => {
  // Arrange + Act
  const claude = claudeOnly({ model: 'm', contextWindowTokens: 100_000, inputTokens: 5_000, usagePercent: 5 });

  // Assert
  const total = claude.segments.reduce((sum, segment) => sum + segment.tokens, 0);
  assert.equal(total, 5_000);
  assert.equal(claude.segments.find((segment) => segment.id === 'other').tokens, 0);
});

test('without an observed token count there is no remainder segment', () => {
  // Arrange + Act
  const claude = claudeOnly({ model: 'm', contextWindowTokens: null, inputTokens: null, usagePercent: 30 });

  // Assert
  assert.equal(claude.segments.some((segment) => segment.id === 'other'), false);
  assert.equal(claude.observedInputTokens, null);
});

test('items carry the switch for anything that has one, including plugins that are off', () => {
  // Arrange + Act
  const claude = claudeOnly({ model: 'm', contextWindowTokens: 100_000, inputTokens: 20_000, usagePercent: 20 });
  const byId = Object.fromEntries(claude.items.map((item) => [item.id, item]));

  // Assert
  assert.equal(byId['skills:user-skills'].switch, null, 'the user\'s own skills are content, not a switch');
  assert.equal(byId['skills:a@m'].switch.target, 'claude/plugin:a@m');
  assert.equal(byId['skills:off@m'].switch.enabled, false);
  assert.equal(byId['skills:off@m'].tokens, null);
  assert.equal(byId['skills:empty'], undefined, 'a zero-cost group without a switch is noise');
  assert.equal(byId.instructions.switch, null);
});

test('MCP servers are listed per server, on and off, with their measured cost', () => {
  // Arrange + Act
  const { codex } = buildDetails({
    snapshot: snapshot({ codex: { alwaysOn: {}, skillGroups: [], hookCount: 0 } }),
    switches: SWITCHES,
    telemetry: { codex: { model: 'x', contextWindowTokens: 200_000, inputTokens: 50_000, usagePercent: 25 } },
    profiles: {},
  });
  const byId = Object.fromEntries(codex.items.map((item) => [item.id, item]));

  // Assert
  assert.equal(byId['mcp:big'].tokens, 7_000);
  assert.equal(byId['mcp:big'].detail, '30 tools');
  assert.equal(byId['mcp:parked'].switch.enabled, false);
  assert.equal(codex.segments.find((segment) => segment.id === 'mcp').tokens, 7_000, 'only servers that are on count');
});

test('items are ranked by cost, unknown costs last', () => {
  // Arrange + Act
  const claude = claudeOnly({ model: 'm', contextWindowTokens: 100_000, inputTokens: 20_000, usagePercent: 20 });

  // Assert
  const tokens = claude.items.map((item) => item.tokens);
  assert.deepEqual(tokens, [3_000, 3_000, 1_000, null]);
});

test('the autocompact reserve comes from the model profile when known', () => {
  // Arrange + Act
  const { claude } = buildDetails({
    snapshot: snapshot({ claude: CLAUDE }),
    switches: [],
    telemetry: { claude: { model: 'opus', contextWindowTokens: 1_000_000, inputTokens: 1, usagePercent: 0 } },
    profiles: { profiles: [{ harness: 'claude', id: 'opus', autocompactBufferTokens: 33_000 }] },
  });

  // Assert
  assert.equal(claude.autocompactBufferTokens, 33_000);
});

test('hooks are reported as unmeasured rather than guessed', () => {
  // Arrange + Act
  const claude = claudeOnly({ model: 'm', contextWindowTokens: 100_000, inputTokens: 20_000, usagePercent: 20 });

  // Assert
  assert.deepEqual(claude.unmeasured.map((item) => item.id), ['hooks']);
});

test('a plugin with no skills says its other content is unmeasured instead of implying zero', () => {
  // Arrange
  const harness = { ...CLAUDE, skillGroups: [{ id: 'mcp-only@m', metadataTokenEstimate: 0, skillCount: 0 }] };
  const switches = [{ target: 'claude/plugin:mcp-only@m', harness: 'claude', kind: 'plugin-group', name: 'mcp-only@m', enabled: true, tokens: null, format: 'json-plugin' }];

  // Act
  const { claude } = buildDetails({ snapshot: snapshot({ claude: harness }), switches, telemetry: {}, profiles: {} });

  // Assert
  const item = claude.items.find((entry) => entry.id === 'skills:mcp-only@m');
  assert.equal(item.tokens, null);
  assert.match(item.detail, /not measured/);
});
