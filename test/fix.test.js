const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { applyPlan, fixProposals, formatProposals, planProposal } = require('../src/fix');
const { MEASURED_STATUS } = require('../src/mcp-cost');

function fixtureHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-fix-test-'));
}

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

/// The smallest snapshot shape fixProposals reads, so a test states its inputs
/// rather than running a full scan.
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

function mcpCostFor(home, servers) {
  return { home, measuredAt: '2026-09-24T00:00:00.000Z', servers };
}

test('ranks proposals by the tokens each one would free', () => {
  // Arrange
  const home = fixtureHome();
  write(home, '.codex/config.toml', '[mcp_servers.big]\ncommand = "a"\n\n[mcp_servers.small]\ncommand = "b"\n');
  const mcpCost = mcpCostFor(home, [
    { harness: 'codex', name: 'small', status: MEASURED_STATUS, toolCount: 2, estimatedTokens: 500 },
    { harness: 'codex', name: 'big', status: MEASURED_STATUS, toolCount: 30, estimatedTokens: 7298 },
  ]);

  // Act
  const proposals = fixProposals({ home, snapshot: snapshotFor(home), mcpCost });

  // Assert
  assert.deepEqual(proposals.map((proposal) => proposal.target), ['codex/big', 'codex/small']);
  assert.equal(proposals[0].tokens, 7298);
});

test('offers nothing when no MCP measurement exists, rather than guessing', () => {
  // Arrange
  const home = fixtureHome();
  write(home, '.codex/config.toml', '[mcp_servers.big]\ncommand = "a"\n');

  // Act
  const proposals = fixProposals({ home, snapshot: snapshotFor(home), mcpCost: null });

  // Assert
  assert.deepEqual(proposals, []);
});

test('ignores a cache measured on another machine', () => {
  // Arrange
  const home = fixtureHome();
  write(home, '.codex/config.toml', '[mcp_servers.big]\ncommand = "a"\n');
  const foreign = mcpCostFor('/somewhere/else', [
    { harness: 'codex', name: 'big', status: MEASURED_STATUS, toolCount: 30, estimatedTokens: 7298 },
  ]);

  // Act
  const proposals = fixProposals({ home, snapshot: snapshotFor(home), mcpCost: foreign });

  // Assert
  assert.deepEqual(proposals, []);
});

test('skips servers that failed to measure, since their cost is unknown', () => {
  // Arrange
  const home = fixtureHome();
  write(home, '.codex/config.toml', '[mcp_servers.broken]\ncommand = "a"\n');
  const mcpCost = mcpCostFor(home, [
    { harness: 'codex', name: 'broken', status: 'failed', toolCount: null, estimatedTokens: null },
  ]);

  // Act
  const proposals = fixProposals({ home, snapshot: snapshotFor(home), mcpCost });

  // Assert
  assert.deepEqual(proposals, []);
});

test('points each harness at its own file and format', () => {
  // Arrange
  const home = fixtureHome();
  write(home, '.claude/mcp.json', JSON.stringify({ mcpServers: { c: { command: 'a' } } }, null, 2));
  write(home, '.kiro/settings/mcp.json', JSON.stringify({ mcpServers: { k: { command: 'a' } } }, null, 2));
  write(home, '.codex/config.toml', '[mcp_servers.x]\ncommand = "a"\n');
  const mcpCost = mcpCostFor(home, [
    { harness: 'claude', name: 'c', status: MEASURED_STATUS, toolCount: 1, estimatedTokens: 300 },
    { harness: 'kiro', name: 'k', status: MEASURED_STATUS, toolCount: 1, estimatedTokens: 200 },
    { harness: 'codex', name: 'x', status: MEASURED_STATUS, toolCount: 1, estimatedTokens: 100 },
  ]);

  // Act
  const byTarget = Object.fromEntries(fixProposals({ home, snapshot: snapshotFor(home), mcpCost })
    .map((proposal) => [proposal.target, proposal]));

  // Assert
  assert.equal(byTarget['claude/c'].format, 'json');
  assert.equal(byTarget['claude/c'].file, path.join(home, '.claude', 'mcp.json'));
  assert.equal(byTarget['kiro/k'].format, 'json');
  assert.equal(byTarget['kiro/k'].file, path.join(home, '.kiro', 'settings', 'mcp.json'));
  assert.equal(byTarget['codex/x'].format, 'toml');
  assert.equal(byTarget['codex/x'].section, 'mcp_servers.x');
});

test('offers an enabled Codex plugin group with a measured metadata cost', () => {
  // Arrange
  const home = fixtureHome();
  write(home, '.codex/config.toml', '[plugins."github@openai-curated"]\nenabled = true\n');
  const snapshot = snapshotFor(home, {
    codex: {
      enabledPlugins: ['github@openai-curated'],
      skillGroups: [
        { id: 'github@openai-curated', skillCount: 4, metadataTokenEstimate: 323 },
        { id: 'user-and-system-skills', skillCount: 10, metadataTokenEstimate: 1340 },
      ],
    },
  });

  // Act
  const proposals = fixProposals({ home, snapshot, mcpCost: null });

  // Assert
  assert.equal(proposals.length, 1, 'only the plugin-backed group is a configuration toggle');
  assert.equal(proposals[0].target, 'codex/plugin:github@openai-curated');
  assert.equal(proposals[0].section, 'plugins."github@openai-curated"');
  assert.equal(proposals[0].tokens, 323);
});

test('a plan shows the exact line it would change without writing anything', () => {
  // Arrange
  const home = fixtureHome();
  const file = write(home, '.codex/config.toml', '[mcp_servers.x]\ncommand = "a"\n');
  const before = fs.readFileSync(file, 'utf8');
  const mcpCost = mcpCostFor(home, [{ harness: 'codex', name: 'x', status: MEASURED_STATUS, toolCount: 1, estimatedTokens: 100 }]);
  const [proposal] = fixProposals({ home, snapshot: snapshotFor(home), mcpCost });

  // Act
  const plan = planProposal(proposal);

  // Assert
  assert.equal(plan.line, 2);
  assert.match(plan.change, /enabled = false/);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'planning must not write');
});

test('applying writes a backup beside the original and reports how to undo it', () => {
  // Arrange
  const home = fixtureHome();
  const file = write(home, '.codex/config.toml', '[mcp_servers.x]\ncommand = "a"\n');
  const before = fs.readFileSync(file, 'utf8');
  const mcpCost = mcpCostFor(home, [{ harness: 'codex', name: 'x', status: MEASURED_STATUS, toolCount: 1, estimatedTokens: 100 }]);
  const [proposal] = fixProposals({ home, snapshot: snapshotFor(home), mcpCost });

  // Act
  const result = applyPlan(planProposal(proposal));

  // Assert
  assert.equal(path.dirname(result.backup), path.dirname(file), 'the backup belongs next to the original');
  assert.equal(fs.readFileSync(result.backup, 'utf8'), before);
  assert.match(fs.readFileSync(file, 'utf8'), /^enabled = false$/m);
  assert.match(result.rollback, /^cp /);
  assert.ok(result.rollback.includes(result.backup) && result.rollback.includes(file));
});

test('the printed rollback command actually restores the file', () => {
  // Arrange
  const home = fixtureHome();
  const file = write(home, '.kiro/settings/mcp.json', `${JSON.stringify({ mcpServers: { k: { command: 'a' } } }, null, 2)}\n`);
  const before = fs.readFileSync(file, 'utf8');
  const mcpCost = mcpCostFor(home, [{ harness: 'kiro', name: 'k', status: MEASURED_STATUS, toolCount: 1, estimatedTokens: 200 }]);
  const [proposal] = fixProposals({ home, snapshot: snapshotFor(home), mcpCost });
  const result = applyPlan(planProposal(proposal));
  assert.notEqual(fs.readFileSync(file, 'utf8'), before, 'precondition: the file changed');

  // Act
  require('node:child_process').execSync(result.rollback);

  // Assert
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('applying twice is refused rather than silently rewriting', () => {
  // Arrange
  const home = fixtureHome();
  write(home, '.codex/config.toml', '[mcp_servers.x]\ncommand = "a"\n');
  const mcpCost = mcpCostFor(home, [{ harness: 'codex', name: 'x', status: MEASURED_STATUS, toolCount: 1, estimatedTokens: 100 }]);
  const [proposal] = fixProposals({ home, snapshot: snapshotFor(home), mcpCost });
  applyPlan(planProposal(proposal));

  // Act & Assert
  assert.throws(() => applyPlan(planProposal(proposal)), /already/i);
});

test('the dry run names the target, the file, and the saving', () => {
  // Arrange
  const home = fixtureHome();
  write(home, '.codex/config.toml', '[mcp_servers.chatty]\ncommand = "a"\n');
  const mcpCost = mcpCostFor(home, [{ harness: 'codex', name: 'chatty', status: MEASURED_STATUS, toolCount: 30, estimatedTokens: 7298 }]);

  // Act
  const text = formatProposals(fixProposals({ home, snapshot: snapshotFor(home), mcpCost }));

  // Assert
  assert.match(text, /codex\/chatty/);
  assert.match(text, /7,298/);
  assert.match(text, /30 tools/);
  assert.match(text, /config\.toml/);
  assert.match(text, /--apply/);
});

test('an empty setup says so instead of printing an empty list', () => {
  // Arrange
  const home = fixtureHome();

  // Act
  const text = formatProposals(fixProposals({ home, snapshot: snapshotFor(home), mcpCost: null }));

  // Assert
  assert.match(text, /nothing/i);
  assert.match(text, /mcp-scan/, 'it should say how to get measurements');
});
