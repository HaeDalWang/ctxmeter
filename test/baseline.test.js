const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { BASELINE_SESSIONS, baselineFrom, startupBaselines } = require('../src/session-history');

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-baseline-'));
  const workspace = path.join(home, 'project');
  fs.mkdirSync(workspace);
  return { home, workspace };
}

function writeLines(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function claudeTurn(at, cacheRead, extra = {}) {
  return {
    type: 'assistant',
    timestamp: at,
    message: { model: 'claude-opus-5-5', usage: { input_tokens: 10, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0 } },
    ...extra,
  };
}

function session(id, updatedAt, values, firstCompacted = false) {
  return {
    id,
    updatedAt,
    samples: values.map((value, index) => ({ at: updatedAt, value, compactedBefore: index === 0 && firstCompacted })),
  };
}

test('the baseline is the first request of each session: lowest, median, and the latest one', () => {
  const sessions = [
    session('a', '2026-09-20T00:00:00Z', [30_000, 90_000]),
    session('b', '2026-09-22T00:00:00Z', [20_000, 40_000]),
    session('c', '2026-09-21T00:00:00Z', [25_000]),
  ];
  const baseline = baselineFrom('tokens', sessions);
  assert.deepEqual(baseline, {
    unit: 'tokens', sessions: 3, lowest: 20_000, median: 25_000,
    latest: { id: 'b', at: '2026-09-22T00:00:00Z', value: 20_000 },
  });
});

test('a session that opens on a compaction summary is not a fresh start and is skipped', () => {
  const baseline = baselineFrom('tokens', [
    session('fresh', '2026-09-20T00:00:00Z', [30_000]),
    session('continued', '2026-09-22T00:00:00Z', [5_000], true),
  ]);
  assert.equal(baseline.sessions, 1);
  assert.equal(baseline.lowest, 30_000);
});

test('only the most recent sessions count, so an old setup does not set today\'s floor', () => {
  const old = session('old', '2026-01-01T00:00:00Z', [1_000]);
  const recent = Array.from({ length: BASELINE_SESSIONS }, (_, index) => session(`s${index}`, `2026-09-${String(10 + index).padStart(2, '0')}T00:00:00Z`, [50_000 + index]));
  const baseline = baselineFrom('tokens', [old, ...recent]);
  assert.equal(baseline.sessions, BASELINE_SESSIONS);
  assert.equal(baseline.lowest, 50_000);
});

test('no sessions means no baseline rather than zero', () => {
  assert.equal(baselineFrom('tokens', []), null);
  assert.equal(baselineFrom('tokens', [null]), null);
});

test('the median of an even count is the mean of the middle two', () => {
  const baseline = baselineFrom('tokens', [
    session('a', '2026-09-20T00:00:00Z', [10]), session('b', '2026-09-21T00:00:00Z', [20]),
    session('c', '2026-09-22T00:00:00Z', [30]), session('d', '2026-09-23T00:00:00Z', [40]),
  ]);
  assert.equal(baseline.median, 25);
});

test('reads Claude session logs for the workspace, ignoring subagent rows', () => {
  const { home, workspace } = fixture();
  const directory = path.join(home, '.claude', 'projects', workspace.replace(/[^A-Za-z0-9]/g, '-'));
  writeLines(path.join(directory, 'one.jsonl'), [
    claudeTurn('2026-09-28T10:00:00Z', 1_000, { isSidechain: true }),
    claudeTurn('2026-09-28T10:00:01Z', 60_000),
    claudeTurn('2026-09-28T10:05:00Z', 80_000),
  ]);
  writeLines(path.join(directory, 'two.jsonl'), [claudeTurn('2026-09-27T10:00:00Z', 50_000)]);

  const { claude, codex, kiro } = startupBaselines({ home, workspace });

  assert.equal(claude.sessions, 2);
  assert.equal(claude.lowest, 50_010);
  assert.equal(claude.latest.value, 60_010);
  assert.equal(codex, null);
  assert.equal(kiro, null);
});


test('audit leads with the observed session start and says how much of it the setup explains', () => {
  const { auditReport, formatAudit } = require('../src/audit');
  const snapshot = {
    target: { home: '/h', workspace: '/w' },
    harnesses: {
      claude: { alwaysOn: { claudeMd: { tokenEstimate: 3_000 }, ruleBytes: 0, ruleFiles: 0 }, skillGroups: [] },
      kiro: { steering: { tokenEstimate: 2_000, fileCount: 2 }, skillGroups: [] },
    },
  };
  const baselines = {
    claude: { unit: 'tokens', sessions: 4, lowest: 69_435, median: 70_129, latest: { value: 71_036 } },
    codex: null,
    kiro: { unit: 'percent', sessions: 2, lowest: 4.57, median: 5.12, latest: { value: 5.67 } },
  };

  const report = auditReport(snapshot, { profiles: [] }, null, baselines);
  const claude = report.harnesses.find((harness) => harness.id === 'claude');
  assert.equal(claude.observedStart.lowest, 69_435);

  const text = formatAudit(report);
  assert.match(text, /^Measured in your session logs, a new session starts at:\n  Claude Code 69,435 tokens · Kiro 4\.6% of its window\n/);
  assert.match(text, /Your setup is 3,000 of those tokens; the rest is each agent's built-in prompt and tools\./);
  assert.match(text, /session start: 69,435 tokens observed \(lowest of 4 sessions, incl\. first message\)/);
  assert.match(text, /session start: 4\.6% of the window observed \(lowest of 2 sessions/);
});

test('audit without session logs keeps the estimate as its headline', () => {
  const { auditReport, formatAudit } = require('../src/audit');
  const snapshot = { target: {}, harnesses: { claude: { alwaysOn: { claudeMd: { tokenEstimate: 3_000 } }, skillGroups: [] } } };
  const text = formatAudit(auditReport(snapshot, { profiles: [] }));
  assert.match(text, /^Your agent setup costs 3,000 tokens before you type anything\./);
  assert.doesNotMatch(text, /session start/);
});
