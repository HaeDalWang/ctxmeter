const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { claudePromptShape, summariseShape } = require('../src/claude-prompt');

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-prompt-'));
  const workspace = path.join(home, 'project');
  fs.mkdirSync(workspace);
  const directory = path.join(home, '.claude', 'projects', workspace.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(directory, { recursive: true });
  return { home, workspace, directory };
}

function tool(name, size, extra = {}) {
  return { name, description: 'd'.repeat(size), input_schema: { type: 'object' }, ...extra };
}

function shapeRow(at, tools, systemSizes = [100, 400]) {
  return {
    type: 'api-request-shape', sessionId: 's', shapeHash: at, timestamp: at, version: '2.1.301',
    shape: { system: systemSizes.map((size) => ({ type: 'text', text: 's'.repeat(size) })), tools },
  };
}

test('a shape splits into system prompt, built-in tools, upfront MCP tools, and deferred placeholders', () => {
  // Arrange
  const row = shapeRow('2026-10-16T00:00:00Z', [
    tool('Bash', 800),
    tool('Read', 400),
    tool('mcp__plugin_aws-core_aws-mcp__run_script', 2_000),
    tool('mcp__github__search', 1_000),
    tool('mcp__github__read', 600),
    { name: 'DeferredToolPlaceholder', defer_loading: true, description: 'x' },
  ]);

  // Act
  const summary = summariseShape(row);

  // Assert
  assert.equal(summary.at, '2026-10-16T00:00:00Z');
  assert.equal(summary.version, '2.1.301');
  assert.equal(summary.system.blocks, 2);
  assert.ok(summary.system.tokens > 120 && summary.system.tokens < 200);
  assert.equal(summary.builtin.tools, 2);
  assert.equal(summary.deferredPlaceholders, 1);
  assert.deepEqual(summary.mcp.map((server) => [server.server, server.tools]), [['plugin_aws-core_aws-mcp', 1], ['github', 2]]);
  assert.equal(summary.totalTokens, summary.system.tokens + summary.builtin.tokens + summary.mcp.reduce((total, server) => total + server.tokens, 0) + summary.deferredTokens);
});

test('the summary carries sizes only, never prompt or tool text', () => {
  // Arrange
  const row = shapeRow('t', [tool('Secretive', 50, { description: 'PRIVATE-DESCRIPTION' })], [10]);
  row.shape.system[0].text = 'PRIVATE-SYSTEM-PROMPT';

  // Act
  const text = JSON.stringify(summariseShape(row));

  // Assert
  assert.doesNotMatch(text, /PRIVATE/);
});

test('reads the newest shape of the newest session that has one, and never parses message blobs', () => {
  // Arrange
  const { home, workspace, directory } = fixture();
  const older = path.join(directory, 'old.jsonl');
  const newer = path.join(directory, 'new.jsonl');
  fs.writeFileSync(older, `${JSON.stringify(shapeRow('2026-10-14T00:00:00Z', [tool('Bash', 10)]))}\n`);
  fs.writeFileSync(newer, [
    JSON.stringify(shapeRow('2026-10-16T00:00:00Z', [tool('Bash', 10)])),
    // A torn, unparseable blob: if it were parsed, nothing would break, but it must not even be read as a shape.
    '{"type":"api-request-blob","message":{"content":"PRIVATE',
    JSON.stringify(shapeRow('2026-10-16T01:00:00Z', [tool('Bash', 10), tool('Read', 10)])),
    '',
  ].join('\n'));
  fs.utimesSync(older, new Date('2026-10-14'), new Date('2026-10-14'));

  // Act
  const shape = claudePromptShape(home, workspace);

  // Assert
  assert.equal(shape.at, '2026-10-16T01:00:00Z');
  assert.equal(shape.builtin.tools, 2);
});

test('no shape in any session is null, so older Claude versions keep working', () => {
  const { home, workspace, directory } = fixture();
  fs.writeFileSync(path.join(directory, 'a.jsonl'), '{"type":"assistant"}\n');
  assert.equal(claudePromptShape(home, workspace), null);
});

const SENT = {
  at: '2026-10-16T12:00:00Z', version: '2.1.301',
  system: { blocks: 3, tokens: 3_000 }, builtin: { tools: 13, tokens: 17_000 },
  mcp: [{ server: 'aws', tools: 1, tokens: 500 }], deferredPlaceholders: 3, deferredTokens: 400, totalTokens: 20_900,
};

function claudeSnapshot() {
  return {
    target: { home: '/h', workspace: '/w' },
    harnesses: {
      claude: {
        alwaysOn: { claudeMd: { tokenEstimate: 1_000 }, ruleFiles: 0, ruleBytes: 0 },
        skillGroups: [], enabledPlugins: [], hookCount: 0, configuredMcpServerCount: 0,
        sessionTelemetry: { currentModel: 'claude-opus-5-5', latestUsage: { inputTokens: 60_000 } },
      },
    },
  };
}

test('audit reports the measured system prompt and built-in tools of the last request', () => {
  const { auditReport, formatAudit } = require('../src/audit');
  const report = auditReport(claudeSnapshot(), {}, null, {}, { claude: SENT });
  const text = formatAudit(report);
  assert.equal(report.harnesses[0].sentPrompt.totalTokens, 20_900);
  assert.match(text, /^ {2}agent's own prompt: 20,900 tokens \(system 3,000 · 13 built-in tools 17,000 · MCP 500 · deferred list 400\), from the last request$/m);
});

test('details splits the agent\'s own prompt out of the unexplained remainder', () => {
  const { buildDetails } = require('../src/details');
  const details = buildDetails({
    snapshot: claudeSnapshot(), switches: [],
    telemetry: { claude: { model: 'claude-opus-5-5', inputTokens: 60_000 } },
    prompts: { claude: SENT },
  });
  const segments = Object.fromEntries(details.claude.segments.map((segment) => [segment.id, segment.tokens]));
  // The prompt's MCP tools stay out: the mcp segment already accounts for them.
  assert.equal(segments.agent, 3_000 + 17_000 + 400);
  assert.equal(segments.other, 60_000 - 1_000 - 20_400);
  assert.equal(details.claude.segments.find((segment) => segment.id === 'other').label, 'Messages and everything else');
  assert.equal(details.claude.sentPrompt.version, '2.1.301');
});

test('without a measured prompt, details keep the old single remainder', () => {
  const { buildDetails } = require('../src/details');
  const details = buildDetails({
    snapshot: claudeSnapshot(), switches: [],
    telemetry: { claude: { model: 'claude-opus-5-5', inputTokens: 60_000 } },
  });
  assert.deepEqual(details.claude.segments.map((segment) => segment.id), ['instructions', 'skills', 'mcp', 'other']);
  assert.equal(details.claude.segments.at(-1).label, 'Messages, system prompt, and tools');
});

test('with a measured prompt the headline accounts for the gap instead of guessing it', () => {
  const { auditReport, formatAudit } = require('../src/audit');
  const baselines = { claude: { unit: 'tokens', sessions: 3, lowest: 25_000, median: 26_000, latest: { value: 25_000 } } };
  const text = formatAudit(auditReport(claudeSnapshot(), {}, null, baselines, { claude: SENT }));
  assert.match(text, /^Your setup is 1,000 of those tokens; Claude Code's own prompt and tools measure 20,900\. The rest is your first message and anything not measured\.$/m);
});
