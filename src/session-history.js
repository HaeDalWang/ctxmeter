'use strict';

// Context over time, from the session logs each harness already keeps.
//
// `telemetry` reports one number per harness and runs every 30 seconds. This
// reads every recent session for the workspace, so it is a separate command the
// menu bar refreshes less often. Values stay in the unit each harness records:
// Claude and Codex log token counts, Kiro logs only a percentage.

const fs = require('node:fs');
const path = require('node:path');
const {
  claudeProjectDirectory, codexWorkspaceSessionFiles, kiroCliCandidates, kiroIdeCandidates,
} = require('./scanner');

const HISTORY_DAYS = 7;
const TOP_SESSIONS = 5;
const MAX_SAMPLES = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

function lines(file) {
  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a torn last line is normal while a session is live */ }
  }
  return rows;
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
    peak: Math.max(...samples.map((sample) => sample.value)),
    compactions: samples.filter((sample) => sample.compactedBefore).length,
    samples,
  };
}

function collect(rows, read) {
  const samples = [];
  let pendingCompaction = false;
  let model = null;
  for (const row of rows) {
    const step = read(row);
    if (!step) continue;
    if (step.model) model = step.model;
    if (step.compaction) pendingCompaction = true;
    if (Number.isFinite(step.value) && step.value > 0) {
      samples.push({ at: step.at || null, value: step.value, compactedBefore: pendingCompaction });
      pendingCompaction = false;
    }
  }
  return { samples, model };
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
    value: number(usage.input_tokens) + number(usage.cache_creation_input_tokens) + number(usage.cache_read_input_tokens),
  };
}

function codexRow(row) {
  if (row.type === 'compacted') return { compaction: true };
  if (row.type === 'turn_context' && typeof row.payload?.model === 'string') return { model: row.payload.model };
  if (row.type !== 'token_usage_record') return null;
  return { at: row.timestamp, value: row.payload?.usage?.input_tokens };
}

function kiroIdeRow(row) {
  const payload = row.payload;
  if (payload?.type !== 'session_metadata' || payload.key !== 'contextUsage') return null;
  return { at: row.timestamp, value: payload.value?.usagePercentage };
}

function fromFile(file, read) {
  const { samples, model } = collect(lines(file), read);
  return session(path.basename(file, '.jsonl'), model, samples);
}

function claudeSessions(home, workspace) {
  const directory = claudeProjectDirectory(path.join(home, '.claude'), workspace);
  let names;
  try { names = fs.readdirSync(directory).filter((name) => name.endsWith('.jsonl')); } catch { return []; }
  return names.map((name) => fromFile(path.join(directory, name), claudeRow));
}

function codexSessions(home, workspace) {
  return codexWorkspaceSessionFiles(path.join(home, '.codex'), workspace).map((file) => fromFile(file, codexRow));
}

function kiroSessions(home, workspace) {
  const root = path.join(home, '.kiro');
  const workspaceRoot = path.resolve(workspace);
  const ide = kiroIdeCandidates(root, workspaceRoot).map((candidate) => {
    const { samples } = collect(lines(candidate.file), kiroIdeRow);
    return session(path.basename(path.dirname(candidate.file)), candidate.modelId, samples);
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
  return {
    claude: summarise('tokens', claudeSessions(home, workspace), now, days),
    codex: summarise('tokens', codexSessions(home, workspace), now, days),
    kiro: summarise('percent', kiroSessions(home, workspace), now, days),
  };
}

module.exports = { HISTORY_DAYS, MAX_SAMPLES, downsample, sessionHistory };
