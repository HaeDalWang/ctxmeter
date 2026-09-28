const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { MAX_SAMPLES, downsample, sessionHistory } = require('../src/session-history');

const NOW = Date.parse('2026-09-28T12:00:00.000Z');

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-history-'));
  const workspace = path.join(home, 'project');
  fs.mkdirSync(workspace);
  return { home, workspace };
}

function writeLines(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function claudeTurn(at, input, cacheRead = 0, extra = {}) {
  return {
    type: 'assistant',
    timestamp: at,
    message: { model: 'claude-opus-5-5', usage: { input_tokens: input, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0, output_tokens: 10 } },
    ...extra,
  };
}

function claudeDirectory(home, workspace) {
  return path.join(home, '.claude', 'projects', workspace.replace(/[^A-Za-z0-9]/g, '-'));
}

test('Claude: the current session is the most recent, with per-turn context and compaction marks', () => {
  // Arrange
  const { home, workspace } = fixture();
  const directory = claudeDirectory(home, workspace);
  writeLines(path.join(directory, 'old.jsonl'), [claudeTurn('2026-09-27T10:00:00Z', 100, 50_000)]);
  writeLines(path.join(directory, 'new.jsonl'), [
    claudeTurn('2026-09-28T10:00:00Z', 1_000, 20_000),
    claudeTurn('2026-09-28T10:05:00Z', 1_000, 90_000),
    { type: 'system', subtype: 'compact_boundary', timestamp: '2026-09-28T10:06:00Z' },
    claudeTurn('2026-09-28T10:07:00Z', 1_000, 10_000),
  ]);

  // Act
  const { claude } = sessionHistory({ home, workspace, now: NOW });

  // Assert
  assert.equal(claude.unit, 'tokens');
  assert.equal(claude.current.id, 'new');
  assert.equal(claude.current.turns, 3);
  assert.equal(claude.current.peak, 91_000);
  assert.equal(claude.current.compactions, 1);
  assert.deepEqual(claude.current.samples.map((sample) => [sample.value, sample.compactedBefore]), [
    [21_000, false], [91_000, false], [11_000, true],
  ]);
});

test('Claude: subagent rows are excluded because they run in a separate context', () => {
  // Arrange
  const { home, workspace } = fixture();
  writeLines(path.join(claudeDirectory(home, workspace), 's.jsonl'), [
    claudeTurn('2026-09-28T10:00:00Z', 5_000),
    claudeTurn('2026-09-28T10:01:00Z', 900_000, 0, { isSidechain: true }),
  ]);

  // Act
  const { claude } = sessionHistory({ home, workspace, now: NOW });

  // Assert
  assert.equal(claude.current.peak, 5_000);
  assert.equal(claude.current.turns, 1);
});

test('top sessions are the largest peaks from the last 7 days, without their samples', () => {
  // Arrange
  const { home, workspace } = fixture();
  const directory = claudeDirectory(home, workspace);
  writeLines(path.join(directory, 'small.jsonl'), [claudeTurn('2026-09-27T10:00:00Z', 10_000)]);
  writeLines(path.join(directory, 'big.jsonl'), [claudeTurn('2026-09-26T10:00:00Z', 200_000)]);
  writeLines(path.join(directory, 'ancient.jsonl'), [claudeTurn('2026-09-01T10:00:00Z', 900_000)]);

  // Act
  const { claude } = sessionHistory({ home, workspace, now: NOW });

  // Assert
  assert.deepEqual(claude.top.map((session) => [session.id, session.peak]), [['big', 200_000], ['small', 10_000]]);
  assert.equal(claude.top[0].samples, undefined);
});

test('Codex: only sessions started in this workspace, one sample per request', () => {
  // Arrange
  const { home, workspace } = fixture();
  const day = path.join(home, '.codex', 'sessions', '2026', '09', '28');
  writeLines(path.join(day, 'rollout-mine.jsonl'), [
    { type: 'session_meta', payload: { cwd: workspace } },
    { type: 'turn_context', payload: { model: 'gpt-5.6-sol' } },
    { type: 'token_usage_record', timestamp: '2026-09-28T09:00:00Z', payload: { usage: { input_tokens: 17_000 } } },
    { type: 'compacted', timestamp: '2026-09-28T09:10:00Z' },
    { type: 'token_usage_record', timestamp: '2026-09-28T09:11:00Z', payload: { usage: { input_tokens: 9_000 } } },
  ]);
  writeLines(path.join(day, 'rollout-other.jsonl'), [
    { type: 'session_meta', payload: { cwd: '/elsewhere' } },
    { type: 'token_usage_record', timestamp: '2026-09-28T11:00:00Z', payload: { usage: { input_tokens: 99_000 } } },
  ]);

  // Act
  const { codex } = sessionHistory({ home, workspace, now: NOW });

  // Assert
  assert.equal(codex.unit, 'tokens');
  assert.equal(codex.current.id, 'rollout-mine');
  assert.equal(codex.current.model, 'gpt-5.6-sol');
  assert.deepEqual(codex.current.samples.map((sample) => [sample.value, sample.compactedBefore]), [[17_000, false], [9_000, true]]);
  assert.equal(codex.top.length, 1);
});

test('Kiro: CLI sessions contribute per-turn percentages', () => {
  // Arrange
  const { home, workspace } = fixture();
  fs.mkdirSync(path.join(home, '.kiro', 'sessions', 'cli'), { recursive: true });
  fs.writeFileSync(path.join(home, '.kiro', 'sessions', 'cli', 'k1.json'), JSON.stringify({
    cwd: workspace,
    session_state: { conversation_metadata: { user_turn_metadatas: [
      { context_usage_percentage: 12.5, end_timestamp: '2026-09-28T08:00:00Z', model: 'claude-opus-5' },
      { context_usage_percentage: 30, end_timestamp: '2026-09-28T08:10:00Z', model: 'claude-opus-5' },
    ] } },
  }));

  // Act
  const { kiro } = sessionHistory({ home, workspace, now: NOW });

  // Assert
  assert.equal(kiro.unit, 'percent');
  assert.equal(kiro.current.peak, 30);
  assert.deepEqual(kiro.current.samples.map((sample) => sample.value), [12.5, 30]);
});

test('Kiro: IDE sessions contribute their recorded context percentages', () => {
  // Arrange
  const { home, workspace } = fixture();
  const session = path.join(home, '.kiro', 'sessions', 'bucket', 'sess_1');
  fs.mkdirSync(session, { recursive: true });
  fs.writeFileSync(path.join(session, 'session.json'), JSON.stringify({ workspacePaths: [workspace], modelId: 'claude-opus-5' }));
  writeLines(path.join(session, 'messages.jsonl'), [
    { timestamp: '2026-09-28T07:00:00Z', payload: { type: 'session_metadata', key: 'contextUsage', value: { usagePercentage: 8 } } },
    { timestamp: '2026-09-28T07:05:00Z', payload: { type: 'session_metadata', key: 'contextUsage', value: { usagePercentage: 22 } } },
  ]);

  // Act
  const { kiro } = sessionHistory({ home, workspace, now: NOW });

  // Assert
  assert.equal(kiro.current.id, 'sess_1');
  assert.deepEqual(kiro.current.samples.map((sample) => sample.value), [8, 22]);
});

test('a harness with no sessions reports nothing rather than zeros', () => {
  // Arrange
  const { home, workspace } = fixture();

  // Act
  const history = sessionHistory({ home, workspace, now: NOW });

  // Assert
  assert.deepEqual(history.claude, { unit: 'tokens', current: null, top: [] });
  assert.deepEqual(history.kiro, { unit: 'percent', current: null, top: [] });
});

test('downsampling keeps each bucket peak and any compaction inside it', () => {
  // Arrange
  const samples = Array.from({ length: 300 }, (_, index) => ({ at: `t${index}`, value: index === 150 ? 10_000 : index, compactedBefore: index === 201 }));

  // Act
  const reduced = downsample(samples);

  // Assert
  assert.ok(reduced.length <= MAX_SAMPLES);
  assert.equal(Math.max(...reduced.map((sample) => sample.value)), 10_000);
  assert.equal(reduced.filter((sample) => sample.compactedBefore).length, 1);
  assert.equal(reduced.at(-1).value, 299, 'the latest value is kept');
});
