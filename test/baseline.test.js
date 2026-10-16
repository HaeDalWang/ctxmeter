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
    latest: { id: 'b', at: '2026-09-22T00:00:00Z', value: 20_000, version: null },
    drift: null,
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
  // "Latest" is the session written to most recently.
  fs.utimesSync(path.join(directory, 'two.jsonl'), new Date('2026-09-27T10:00:00Z'), new Date('2026-09-27T10:00:00Z'));
  fs.utimesSync(path.join(directory, 'one.jsonl'), new Date('2026-09-28T10:05:00Z'), new Date('2026-09-28T10:05:00Z'));

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

test('a session start well above the earlier ones is flagged, with the agent version change', () => {
  const at = (day) => `2026-10-${String(day).padStart(2, '0')}T00:00:00Z`;
  const entry = (id, day, value, version) => ({ ...session(id, at(day), [value]), version });
  const baseline = baselineFrom('tokens', [
    entry('a', 10, 30_000, '2.1.290'),
    entry('b', 11, 31_000, '2.1.290'),
    entry('c', 12, 29_000, '2.1.291'),
    entry('new', 14, 38_000, '2.1.301'),
  ]);
  assert.deepEqual(baseline.drift, { from: 30_000, to: 38_000, versionFrom: '2.1.291', versionTo: '2.1.301' });
});

test('small movements and a single session are not drift', () => {
  const at = (day) => `2026-10-${String(day).padStart(2, '0')}T00:00:00Z`;
  const entry = (id, day, value) => session(id, at(day), [value]);
  assert.equal(baselineFrom('tokens', [entry('a', 1, 30_000), entry('b', 2, 31_000)]).drift, null);
  assert.equal(baselineFrom('tokens', [entry('only', 1, 30_000)]).drift, null);
  // A drop is good news, not drift.
  assert.equal(baselineFrom('tokens', [entry('a', 1, 30_000), entry('b', 2, 30_000), entry('c', 3, 10_000)]).drift, null);
});

test('audit prints the rise and the version change under the agent', () => {
  const { auditReport, formatAudit } = require('../src/audit');
  const snapshot = { target: {}, harnesses: { claude: { alwaysOn: { claudeMd: { tokenEstimate: 3_000 } }, skillGroups: [] } } };
  const baselines = { claude: {
    unit: 'tokens', sessions: 4, lowest: 29_000, median: 30_500, latest: { id: 'n', value: 38_000 },
    drift: { from: 30_000, to: 38_000, versionFrom: '2.1.291', versionTo: '2.1.301' },
  } };
  const text = formatAudit(auditReport(snapshot, {}, null, baselines));
  assert.match(text, /^ {2}latest session started at 38,000 tokens, up from 30,000 \(Claude Code 2\.1\.291 → 2\.1\.301\)$/m);
});

test('Claude and Codex logs give each session its agent version', () => {
  const { home, workspace } = fixture();
  const directory = path.join(home, '.claude', 'projects', workspace.replace(/[^A-Za-z0-9]/g, '-'));
  writeLines(path.join(directory, 's.jsonl'), [claudeTurn('2026-10-16T00:00:00Z', 10_000, { version: '2.1.301' })]);
  const codexFile = path.join(home, '.codex', 'sessions', '2026', '10', '16', 'rollout.jsonl');
  writeLines(codexFile, [
    { type: 'session_meta', payload: { cwd: workspace, cli_version: '0.163.0' } },
    { type: 'token_usage_record', timestamp: '2026-10-16T00:00:00Z', payload: { usage: { input_tokens: 9_000 } } },
  ]);

  const { claude, codex } = startupBaselines({ home, workspace });

  assert.equal(claude.latest.version, '2.1.301');
  assert.equal(codex.latest.version, '0.163.0');
});
