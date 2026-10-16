'use strict';

// Context over time, from the session logs each harness already keeps.
//
// `telemetry` reports one number per harness and runs every 30 seconds. This
// reads every recent session for the workspace, so it is a separate command the
// menu bar refreshes less often. Values stay in the unit each harness records:
// Claude and Codex log token counts, Kiro logs only a percentage.

const fs = require('node:fs');
const path = require('node:path');
const { eachJsonLine } = require('./jsonl');
const {
  claudeProjectDirectory, codexWorkspaceSessionFiles, kiroCliCandidates, kiroIdeCandidates,
} = require('./scanner');

const HISTORY_DAYS = 7;
const TOP_SESSIONS = 5;
const MAX_SAMPLES = 60;
const BASELINE_SESSIONS = 10;
// A start this much above the earlier median is reported as drift.
const DRIFT_RATIO = 1.15;
const DRIFT_MIN = { tokens: 2_000, percent: 1 };
const DAY_MS = 24 * 60 * 60 * 1000;

function mtime(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

function number(value) {
  return Number.isFinite(value) ? value : 0;
}

/// Samples are `{ at, value, compactedBefore }`; a compaction flags the next one.
function session(id, model, samples) {
  if (!samples.length) return null;
  return {
    id,
    model,
    startedAt: samples[0].at,
    updatedAt: samples.at(-1).at,
    turns: samples.length,
    // reduce, not Math.max(...): spreading a very long session overflows the stack.
    peak: samples.reduce((best, sample) => Math.max(best, sample.value), 0),
    compactions: samples.filter((sample) => sample.compactedBefore).length,
    samples,
  };
}

/// Folds rows into samples. With `firstOnly`, stops at the first sample, which
/// is all a startup baseline needs from a file that may be hundreds of MB.
function collector(read, { firstOnly = false } = {}) {
  const samples = [];
  let pendingCompaction = false;
  let model = null;
  let version = null;
  const visit = (row) => {
    const step = read(row);
    if (!step) return true;
    if (step.model) model = step.model;
    if (step.version && !version) version = step.version;
    if (step.compaction) pendingCompaction = true;
    if (Number.isFinite(step.value) && step.value > 0) {
      samples.push({ at: step.at || null, value: step.value, compactedBefore: pendingCompaction });
      pendingCompaction = false;
      if (firstOnly) return false;
    }
    return true;
  };
  return { visit, result: () => ({ samples, model, version }) };
}

function collect(rows, read) {
  const { visit, result } = collector(read);
  for (const row of rows) visit(row);
  return result();
}

function collectFile(file, read, options) {
  const { visit, result } = collector(read, options);
  eachJsonLine(file, visit);
  return result();
}

function claudeRow(row) {
  if (row.isSidechain) return null;
  if (row.type === 'system' && row.subtype === 'compact_boundary') return { compaction: true };
  const usage = row.type === 'assistant' ? row.message?.usage : null;
  const model = row.message?.model;
  if (!usage || typeof model !== 'string' || model.startsWith('<')) return null;
  return {
    at: row.timestamp,
    model,
    version: typeof row.version === 'string' ? row.version : null,
    value: number(usage.input_tokens) + number(usage.cache_creation_input_tokens) + number(usage.cache_read_input_tokens),
  };
}

function codexRow(row) {
  if (row.type === 'compacted') return { compaction: true };
  if (row.type === 'session_meta') return { version: row.payload?.cli_version || null };
  if (row.type === 'turn_context' && typeof row.payload?.model === 'string') return { model: row.payload.model };
  if (row.type !== 'token_usage_record') return null;
  return { at: row.timestamp, value: row.payload?.usage?.input_tokens };
}

function kiroIdeRow(row) {
  const payload = row.payload;
  if (payload?.type !== 'session_metadata' || payload.key !== 'contextUsage') return null;
  return { at: row.timestamp, value: payload.value?.usagePercentage };
}

/// A session from its log. `firstOnly` reads up to the first sample; the
/// session's `updatedAt` then falls back to the file's mtime so ordering holds.
function fromFile(file, read, id, model, options = {}) {
  const collected = collectFile(file, read, options);
  const entry = session(id, model || collected.model, collected.samples);
  if (entry) entry.version = collected.version;
  if (entry && options.firstOnly) entry.updatedAt = new Date(mtime(file)).toISOString();
  return entry;
}

/// Which files to read. Newest first, so `limit` keeps the most recent; `since`
/// drops files untouched since then, except the newest, which is the current one.
function selectFiles(files, { since = null, limit = Infinity } = {}) {
  const ordered = files.map((file) => ({ file, at: mtime(file) })).sort((left, right) => right.at - left.at);
  return ordered
    .filter((entry, index) => index === 0 || since === null || entry.at >= since)
    .slice(0, limit)
    .map((entry) => entry.file);
}

function claudeSessions(home, workspace, options = {}) {
  const directory = claudeProjectDirectory(path.join(home, '.claude'), workspace);
  let names;
  try { names = fs.readdirSync(directory).filter((name) => name.endsWith('.jsonl')); } catch { return []; }
  return selectFiles(names.map((name) => path.join(directory, name)), options)
    .map((file) => fromFile(file, claudeRow, path.basename(file, '.jsonl'), null, options));
}

function codexSessions(home, workspace, options = {}) {
  return selectFiles(codexWorkspaceSessionFiles(path.join(home, '.codex'), workspace), options)
    .map((file) => fromFile(file, codexRow, path.basename(file, '.jsonl'), null, options));
}

function kiroSessions(home, workspace, options = {}) {
  const root = path.join(home, '.kiro');
  const workspaceRoot = path.resolve(workspace);
  const candidates = kiroIdeCandidates(root, workspaceRoot);
  const byFile = new Map(candidates.map((candidate) => [candidate.file, candidate]));
  const ide = selectFiles(candidates.map((candidate) => candidate.file), options).map((file) => {
    const candidate = byFile.get(file);
    return fromFile(file, kiroIdeRow, path.basename(path.dirname(file)), candidate.modelId, options);
  });
  const cli = kiroCliCandidates(root, workspaceRoot).map((candidate) => {
    const turns = candidate.meta.session_state?.conversation_metadata?.user_turn_metadatas || [];
    const { samples, model } = collect(turns, (turn) => ({ at: turn?.end_timestamp, model: turn?.model, value: turn?.context_usage_percentage }));
    return session(path.basename(candidate.file, '.json'), model, samples);
  });
  return [...ide, ...cli];
}

/// Keeps the peak of each bucket, so a spike never disappears from the chart,
/// and always ends on the latest sample, so the chart ends where the session is.
function downsample(samples, limit = MAX_SAMPLES) {
  if (samples.length <= limit) return samples;
  const head = samples.slice(0, -1);
  const size = Math.ceil(head.length / (limit - 1));
  const buckets = [];
  for (let start = 0; start < head.length; start += size) {
    const bucket = head.slice(start, start + size);
    const peak = bucket.reduce((best, sample) => (sample.value > best.value ? sample : best));
    buckets.push({ ...peak, compactedBefore: bucket.some((sample) => sample.compactedBefore) });
  }
  return [...buckets, samples.at(-1)];
}

function time(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarise(unit, sessions, now, days) {
  const known = sessions.filter(Boolean).sort((left, right) => time(right.updatedAt) - time(left.updatedAt));
  if (!known.length) return { unit, current: null, top: [] };
  const since = now - days * DAY_MS;
  const top = known
    .filter((entry) => time(entry.updatedAt) >= since)
    .sort((left, right) => right.peak - left.peak)
    .slice(0, TOP_SESSIONS)
    .map(({ samples, ...rest }) => rest);
  return { unit, current: { ...known[0], samples: downsample(known[0].samples) }, top };
}

function sessionHistory({ home, workspace, now = Date.now(), days = HISTORY_DAYS }) {
  // A file untouched since the window opened cannot hold a session inside it.
  const options = { since: now - days * DAY_MS };
  return {
    claude: summarise('tokens', claudeSessions(home, workspace, options), now, days),
    codex: summarise('tokens', codexSessions(home, workspace, options), now, days),
    kiro: summarise('percent', kiroSessions(home, workspace, options), now, days),
  };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/// What a new session actually carries before any work: the first request of
/// each recent session, as the agent logged it. It includes the user's first
/// message (never read, only counted by the agent), which is why `lowest` is
/// the closer figure for pure overhead. A session that opens on a compaction
/// summary is a continuation, not a start.
function baselineFrom(unit, sessions, limit = BASELINE_SESSIONS) {
  const starts = sessions
    .filter((entry) => entry?.samples?.length && !entry.samples[0].compactedBefore)
    .sort((left, right) => time(right.updatedAt) - time(left.updatedAt))
    .slice(0, limit)
    .map((entry) => ({ id: entry.id, at: entry.samples[0].at, value: entry.samples[0].value, version: entry.version || null }));
  if (!starts.length) return null;
  const values = starts.map((start) => start.value);
  return { unit, sessions: starts.length, lowest: Math.min(...values), median: median(values), latest: starts[0], drift: drift(unit, starts) };
}

/// The newest start against the median of the earlier ones. Needs two earlier
/// starts so one odd session cannot set the reference. The version pair is kept
/// only when it changed, since that is the likeliest cause of a jump.
function drift(unit, starts) {
  const [latest, ...earlier] = starts;
  if (earlier.length < 2) return null;
  const from = median(earlier.map((start) => start.value));
  if (latest.value - from < DRIFT_MIN[unit] || latest.value < from * DRIFT_RATIO) return null;
  const versionFrom = earlier[0].version;
  const changed = versionFrom && latest.version && versionFrom !== latest.version;
  return { from, to: latest.value, versionFrom: changed ? versionFrom : null, versionTo: changed ? latest.version : null };
}

/// Only the first sample of each file is read, and only the newest few files:
/// some are skipped as compaction continuations, so it reads twice the limit.
function startupBaselines({ home, workspace, limit = BASELINE_SESSIONS }) {
  const options = { firstOnly: true, limit: limit * 2 };
  return {
    claude: baselineFrom('tokens', claudeSessions(home, workspace, options), limit),
    codex: baselineFrom('tokens', codexSessions(home, workspace, options), limit),
    kiro: baselineFrom('percent', kiroSessions(home, workspace, options), limit),
  };
}

module.exports = { BASELINE_SESSIONS, HISTORY_DAYS, MAX_SAMPLES, baselineFrom, downsample, sessionHistory, startupBaselines };
