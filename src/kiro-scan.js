'use strict';

// Kiro: IDE and CLI session stores, settings, steering, skills, Crew usage.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { eachJsonLine } = require('./jsonl');
const { kiroInstructions } = require('./instructions');
const {
  bytesToEstimate,
  countExcludedSkills,
  createRuntimeReader,
  enabledMcpServerNames,
  exists,
  fileExists,
  readJson,
  skillGroup,
  walkFiles,
} = require('./scan-common');

function withinWorkspace(candidate, workspaceRoot) {
  if (typeof candidate !== 'string' || !candidate) return false;
  const resolved = path.resolve(candidate);
  return resolved === workspaceRoot || resolved.startsWith(`${workspaceRoot}${path.sep}`);
}

function kiroIdeCandidates(root, workspaceRoot) {
  const sessionsRoot = path.join(root, 'sessions');
  if (!exists(sessionsRoot)) return [];
  const candidates = [];
  for (const bucket of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
    if (!bucket.isDirectory() || bucket.isSymbolicLink() || bucket.name === 'cli') continue;
    const bucketDirectory = path.join(sessionsRoot, bucket.name);
    for (const entry of fs.readdirSync(bucketDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('sess_')) continue;
      const directory = path.join(bucketDirectory, entry.name);
      const messages = path.join(directory, 'messages.jsonl');
      const meta = readJson(path.join(directory, 'session.json'), null);
      if (!fileExists(messages) || !meta) continue;
      if (!(meta.workspacePaths || []).some((candidate) => withinWorkspace(candidate, workspaceRoot))) continue;
      candidates.push({ store: 'ide', file: messages, modelId: meta.modelId || null, mtimeMs: fs.statSync(messages).mtimeMs });
    }
  }
  return candidates;
}

function kiroIdeTelemetry(candidate) {
  let firstUsagePercent = null;
  let latestUsagePercent = null;
  let firstObservedAt = null;
  let updatedAt = null;
  let sampleCount = 0;
  let creditsUsed = 0;
  eachJsonLine(candidate.file, (row) => {
    const payload = row.payload;
    if (payload?.type === 'usage_summary') {
      for (const summary of payload.promptTurnSummaries || []) {
        if (Number.isFinite(summary?.usage)) creditsUsed += summary.usage;
      }
      return;
    }
    if (payload?.type !== 'session_metadata' || payload.key !== 'contextUsage') return;
    const percent = payload.value?.usagePercentage;
    if (!Number.isFinite(percent)) return;
    sampleCount += 1;
    if (firstUsagePercent === null) {
      firstUsagePercent = percent;
      firstObservedAt = row.timestamp || null;
    }
    latestUsagePercent = percent;
    updatedAt = row.timestamp || updatedAt;
  });
  if (firstUsagePercent === null) return null;
  return {
    source: 'local-session',
    store: 'ide',
    sourcePath: candidate.file,
    startModel: candidate.modelId,
    currentModel: candidate.modelId,
    contextWindowTokens: null,
    firstUsagePercent,
    latestUsagePercent,
    sampleCount,
    creditsUsed,
    firstObservedAt,
    updatedAt,
  };
}

function kiroCliCandidates(root, workspaceRoot) {
  const directory = path.join(root, 'sessions', 'cli');
  if (!exists(directory)) return [];
  const candidates = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = path.join(directory, entry.name);
    const meta = readJson(file, null);
    if (!meta || !withinWorkspace(meta.cwd, workspaceRoot)) continue;
    candidates.push({ store: 'cli', file, meta, mtimeMs: fs.statSync(file).mtimeMs });
  }
  return candidates;
}

function meteringCredits(turn) {
  return (turn.metering_usage || []).reduce((total, entry) => total + (Number.isFinite(entry?.value) ? entry.value : 0), 0);
}

function kiroCliTelemetry(candidate) {
  const state = candidate.meta.session_state || {};
  const modelInfo = state.rts_model_state?.model_info || {};
  const turns = (state.conversation_metadata?.user_turn_metadatas || [])
    .filter((turn) => Number.isFinite(turn?.context_usage_percentage));
  const sessionPercent = state.rts_model_state?.context_usage_percentage;
  const fallbackPercent = Number.isFinite(sessionPercent) ? sessionPercent : null;
  const firstUsagePercent = turns.length ? turns[0].context_usage_percentage : fallbackPercent;
  if (firstUsagePercent === null) return null;
  return {
    source: 'local-session',
    store: 'cli',
    sourcePath: candidate.file,
    startModel: turns[0]?.model || modelInfo.model_id || null,
    currentModel: turns.at(-1)?.model || modelInfo.model_id || null,
    contextWindowTokens: Number.isFinite(modelInfo.context_window_tokens) ? modelInfo.context_window_tokens : null,
    firstUsagePercent,
    latestUsagePercent: turns.length ? turns.at(-1).context_usage_percentage : fallbackPercent,
    sampleCount: turns.length || 1,
    creditsUsed: turns.reduce((total, turn) => total + meteringCredits(turn), 0),
    firstObservedAt: turns[0]?.end_timestamp || candidate.meta.created_at || null,
    updatedAt: turns.at(-1)?.end_timestamp || candidate.meta.updated_at || null,
  };
}

function kiroObservedWindows(cliCandidates) {
  const windows = new Map();
  for (const candidate of cliCandidates) {
    const info = candidate.meta.session_state?.rts_model_state?.model_info || {};
    if (typeof info.model_id === 'string' && Number.isFinite(info.context_window_tokens)) {
      windows.set(info.model_id, info.context_window_tokens);
    }
  }
  return windows;
}

function kiroSessionTelemetry(root, workspace) {
  const workspaceRoot = path.resolve(workspace);
  const cliCandidates = kiroCliCandidates(root, workspaceRoot);
  const candidates = [...kiroIdeCandidates(root, workspaceRoot), ...cliCandidates]
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const candidate of candidates) {
    const telemetry = candidate.store === 'ide' ? kiroIdeTelemetry(candidate) : kiroCliTelemetry(candidate);
    if (!telemetry) continue;
    if (telemetry.contextWindowTokens !== null) return { ...telemetry, contextWindowSource: 'session' };
    // A store without a window is still comparable: Kiro's own CLI sessions
    // record the window per model, so reuse an observation for the same model.
    const peerWindow = kiroObservedWindows(cliCandidates).get(telemetry.currentModel);
    return peerWindow === undefined
      ? { ...telemetry, contextWindowSource: null }
      : { ...telemetry, contextWindowTokens: peerWindow, contextWindowSource: 'peer-session' };
  }
  return null;
}

function kiroHookCount(root, workspace) {
  // When the workspace is the home directory both paths are the same folder.
  const directories = [...new Set([path.join(root, 'hooks'), path.join(workspace, '.kiro', 'hooks')].map((directory) => path.resolve(directory)))];
  return directories.reduce((total, directory) => total + walkFiles(directory, (file) => file.endsWith('.json'))
    .reduce((sum, file) => {
      const hooks = readJson(file, {}).hooks;
      return sum + (Array.isArray(hooks) ? hooks.length : 0);
    }, 0), 0);
}

function kiroCrewUsage(crewRoot) {
  const directory = path.join(crewRoot, 'usage', 'tokens');
  if (!exists(directory)) return null;
  const files = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => entry.name)
    .sort();
  let recordCount = 0;
  let creditsTotal = 0;
  for (const name of files) {
    eachJsonLine(path.join(directory, name), (row) => {
      if (row._type !== 'tokens') return;
      recordCount += 1;
      if (Number.isFinite(row.credits)) creditsTotal += row.credits;
    });
  }
  if (!recordCount) return null;
  return {
    recordCount,
    creditsTotal,
    firstDate: path.basename(files[0], '.jsonl'),
    lastDate: path.basename(files.at(-1), '.jsonl'),
    workspaceAttributable: false,
  };
}

function scanKiroRuntime(home = os.homedir(), workspace = process.cwd()) {
  const root = path.join(home, '.kiro');
  const sessionTelemetry = kiroSessionTelemetry(root, workspace);
  return {
    modelCatalog: { selectedModel: sessionTelemetry?.currentModel || null, models: [] },
    sessionTelemetry,
  };
}

const createKiroRuntimeReader = (options) => createRuntimeReader(scanKiroRuntime, options);

function scanKiro(home, workspace) {
  const root = path.join(home, '.kiro');
  const crewRoot = path.join(root, 'crew');
  return {
    versionSource: 'local-cli',
    root,
    ...scanKiroRuntime(home, workspace),
    crewUsage: kiroCrewUsage(crewRoot),
    hookCount: kiroHookCount(root, workspace),
    configuredMcpServerCount: enabledMcpServerNames(readJson(path.join(root, 'settings', 'mcp.json'))).length,
    customAgentCount: walkFiles(path.join(root, 'agents'), (file) => file.endsWith('.json')).length,
    powerCount: walkFiles(path.join(root, 'powers'), (file) => path.basename(file) === 'plugin.json').length,
    instructions: kiroInstructions(home, workspace),
    steering: (() => {
      const files = walkFiles(path.join(root, 'steering'), (file) => file.endsWith('.md'));
      const bytes = files.reduce((total, file) => total + fs.statSync(file).size, 0);
      return { fileCount: files.length, bytes, tokenEstimate: bytesToEstimate(bytes) };
    })(),
    skillGroups: [
      skillGroup('user-skills', path.join(root, 'skills'), { allowedStatuses: new Set(['active-candidate']) }),
    ],
    crew: skillGroup('crew-skills', path.join(crewRoot, 'skills'), { allowedStatuses: new Set(['active-candidate']) }),
    excluded: countExcludedSkills(root),
  };
}

module.exports = { createKiroRuntimeReader, kiroCliCandidates, kiroIdeCandidates, scanKiro, scanKiroRuntime };
