#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanEnvironment, scanClaudeRuntime, scanCodexRuntime, scanKiroRuntime } = require('./scanner');
const { auditReport, formatAudit } = require('./audit');
const { describeDryRun, formatMcpCost, mcpServerEntries, measureMcpCost } = require('./mcp-cost');

const PROFILES_FILE = path.join(__dirname, '..', 'config', 'context-profiles.json');
const MCP_CACHE_NAME = 'mcp-cost.json';

function mcpCachePath(workspace) {
  return path.join(workspace, '.ctxmeter', MCP_CACHE_NAME);
}

/// Written by mcp-scan, read by audit. Keeps the expensive path opt-in and rare.
function readMcpCache(workspace) {
  try {
    return JSON.parse(fs.readFileSync(mcpCachePath(workspace), 'utf8'));
  } catch {
    return null;
  }
}

function usage() {
  return [
    'Usage: ctxmeter [audit]    [--home <dir>] [--workspace <dir>]',
    '       ctxmeter scan       [--home <dir>] [--workspace <dir>] [--output <file>]',
    '       ctxmeter telemetry  [--home <dir>] [--workspace <dir>]',
    '       ctxmeter mcp-scan   [--dry-run] [--allow-remote] [--timeout <ms>]',
    '',
    'audit     (default) prints what your agent setup costs before you type anything.',
    'scan      writes a full metadata-only inventory snapshot.',
    'telemetry prints current session usage as JSON without an inventory scan.',
    'mcp-scan  measures MCP tool schema cost. This one starts your servers; see --dry-run.',
    '',
    'No command copies prompt, rule, skill, or secret contents, and nothing leaves this machine.',
  ].join('\n');
}

const VALUE_FLAGS = ['--home', '--workspace', '--output', '--timeout'];
const BOOLEAN_FLAGS = ['--dry-run', '--allow-remote', '--i-understand-this-launches-servers'];

function parseArgs(argv) {
  const [first, ...rest] = argv;
  // Bare `npx ctxmeter` runs the audit, so the front door needs no arguments.
  const hasCommand = first !== undefined && !first.startsWith('--');
  const options = { command: hasCommand ? first : 'audit' };
  const flags = hasCommand ? rest : argv;
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (BOOLEAN_FLAGS.includes(flag)) {
      options[flag.slice(2)] = true;
      continue;
    }
    if (!VALUE_FLAGS.includes(flag)) throw new Error(`Unknown option: ${flag}`);
    const value = flags[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    options[flag.slice(2)] = value;
    index += 1;
  }
  return options;
}

function metadataTokens(groups) {
  return groups.reduce((total, group) => total + group.metadataTokenEstimate, 0);
}

function formatSummary(snapshot, output) {
  const { claude, codex, kiro } = snapshot.harnesses;
  return [
    'ctxmeter scan complete',
    `Claude: ${claude.enabledPlugins.length} enabled plugins, ${claude.hookCount} hooks, ~${metadataTokens(claude.skillGroups)} skill-metadata tokens`,
    `Codex: ${codex.enabledPlugins.length} enabled / ${codex.configuredPluginCount} configured plugins, ${codex.hookCount} hooks, ~${metadataTokens(codex.skillGroups)} skill-metadata tokens`,
    `Kiro: ${kiro.customAgentCount} custom agents, ${kiro.powerCount} powers, ~${metadataTokens(kiro.skillGroups)} skill-metadata tokens`,
    `Snapshot: ${output}`,
    'Note: static assets are estimates; Claude and Codex session totals are observed from local JSONL. Inspect snapshot warnings for attribution limits.',
  ].join('\n');
}

function resolveOutput(workspace, requestedOutput) {
  if (requestedOutput) return path.resolve(requestedOutput);
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  return path.join(workspace, '.ctxmeter', 'snapshots', `scan-${stamp}.json`);
}

function readProfiles() {
  try {
    return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
  } catch {
    return { profiles: [] };
  }
}

function profileWindow(profiles, harnessId, modelId) {
  const match = (profiles.profiles || []).find((profile) => profile.harness === harnessId && profile.id === modelId);
  return Number.isFinite(match?.contextWindowTokens) ? match.contextWindowTokens : null;
}

function catalogWindow(catalog, modelId) {
  const match = (catalog.models || []).find((model) => model.id === modelId);
  return Number.isFinite(match?.contextWindowTokens) ? match.contextWindowTokens : null;
}

function harnessTelemetry(harnessId, runtime = {}, profiles) {
  const catalog = runtime.modelCatalog || {};
  const telemetry = runtime.sessionTelemetry || null;
  const model = telemetry?.currentModel || catalog.selectedModel || null;
  const sessionWindow = Number.isFinite(telemetry?.contextWindowTokens) ? telemetry.contextWindowTokens : null;
  const contextWindowTokens = sessionWindow ?? catalogWindow(catalog, model) ?? profileWindow(profiles, harnessId, model);
  const inputTokens = Number.isFinite(telemetry?.latestUsage?.inputTokens) ? telemetry.latestUsage.inputTokens : null;
  // Kiro records a percentage and no token total; Claude and Codex record the
  // reverse. Percentage is the only unit all three can express.
  const observedPercent = Number.isFinite(telemetry?.latestUsagePercent) ? telemetry.latestUsagePercent : null;
  return {
    model,
    contextWindowTokens,
    inputTokens,
    usagePercent: observedPercent ?? (inputTokens !== null && contextWindowTokens ? inputTokens / contextWindowTokens * 100 : null),
    observedAt: telemetry?.updatedAt || null,
    store: telemetry?.store || null,
    source: telemetry?.source || null,
  };
}

function telemetrySummary(runtimes, profiles = {}) {
  return {
    claude: harnessTelemetry('claude', runtimes.claude, profiles),
    codex: harnessTelemetry('codex', runtimes.codex, profiles),
    kiro: harnessTelemetry('kiro', runtimes.kiro, profiles),
  };
}

function telemetryReport(options, currentDirectory) {
  const home = options.home || os.homedir();
  const workspace = path.resolve(options.workspace || currentDirectory);
  return {
    schemaVersion: '0.1.0',
    generatedAt: new Date().toISOString(),
    target: { home, workspace },
    harnesses: telemetrySummary({
      claude: scanClaudeRuntime(home, workspace),
      codex: scanCodexRuntime(home, workspace),
      kiro: scanKiroRuntime(home, workspace),
    }, readProfiles()),
  };
}

const CONSENT_FLAG = '--i-understand-this-launches-servers';

async function runMcpScan(options) {
  const home = options.home || os.homedir();
  const entries = mcpServerEntries(home);
  if (options['dry-run']) return { summary: describeDryRun(entries) };
  if (!options[CONSENT_FLAG.slice(2)]) {
    throw new Error([
      'mcp-scan starts every configured MCP server to read its tool list.',
      'Tool schemas exist only in the live prompt, so there is no file to read instead.',
      '',
      'Inspect what would run first:',
      '  ctxmeter mcp-scan --dry-run',
      '',
      'Then rerun with:',
      `  ctxmeter mcp-scan ${CONSENT_FLAG}`,
      '',
      'Remote servers are skipped unless you also pass --allow-remote.',
    ].join('\n'));
  }
  const result = await measureMcpCost(entries, {
    home,
    timeoutMs: Number(options.timeout) > 0 ? Number(options.timeout) : 5_000,
    allowRemote: options['allow-remote'] === true,
  });
  const workspace = path.resolve(options.workspace || process.cwd());
  const cacheFile = mcpCachePath(workspace);
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, `${JSON.stringify(result, null, 2)}\n`);
  return { summary: `${formatMcpCost(result)}\n\nCached to ${path.relative(workspace, cacheFile)}; audit will include it.` };
}

async function run(argv = process.argv.slice(2), currentDirectory = process.cwd()) {
  const options = parseArgs(argv);
  if (options.command === 'mcp-scan') return runMcpScan(options);
  if (options.command === 'audit') {
    if (options.output) throw new Error('audit writes to stdout; --output is not supported');
    const workspace = path.resolve(options.workspace || currentDirectory);
    const snapshot = scanEnvironment({ home: options.home, workspace });
    return { summary: formatAudit(auditReport(snapshot, readProfiles(), readMcpCache(workspace))) };
  }
  if (options.command === 'telemetry') {
    if (options.output) throw new Error('telemetry writes to stdout; --output is not supported');
    return { json: telemetryReport(options, currentDirectory) };
  }
  if (options.command !== 'scan') throw new Error(usage());
  const workspace = path.resolve(options.workspace || currentDirectory);
  const output = resolveOutput(workspace, options.output);
  const snapshot = scanEnvironment({ home: options.home, workspace });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`);
  return { output, summary: formatSummary(snapshot, output) };
}

if (require.main === module) {
  Promise.resolve()
    .then(() => run())
    .then((result) => {
      process.stdout.write(result.json ? `${JSON.stringify(result.json, null, 2)}\n` : `${result.summary}\n`);
    })
    .catch((error) => {
      process.stderr.write(`ctxmeter error: ${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = { auditReport, formatAudit, formatSummary, parseArgs, run, telemetrySummary };
