'use strict';

// Whether an MCP server's tool schemas are in the prompt at session start, or
// held back until the model searches for them.
//
// Claude Code and Codex both defer MCP tool definitions behind a tool search by
// default, so counting every schema as startup cost overstates it. Sources,
// checked 2026-09-28 (develop/research/04-market-2026-09-28.md):
//   Claude  https://code.claude.com/docs/en/agent-sdk/tool-search
//           ENABLE_TOOL_SEARCH unset|true|false|auto|auto:N; off for a
//           third-party ANTHROPIC_BASE_URL; CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
//           keeps it off; a server's `alwaysLoad: true` loads it up front.
//   Codex   codex-rs/features/src/lib.rs: tool_search is always enabled and MCP
//           tools are always deferred when tool_search is available.
//   Kiro    https://kiro.dev/docs/mcp/tool-search/ (2026-10-13): IDE 1.3+ and
//           CLI V3 sessions (2.31+) defer by default; CLI V2 only with
//           toolSearch.enabled, past 5% of the window or 50,000 tokens.

const fs = require('node:fs');
const path = require('node:path');
const { claudeMcpServerStates } = require('./claude-mcp');

const DEFAULT_AUTO_PERCENT = 10;
const KIRO_V2_MIN_PCT = 5;
const KIRO_V2_MIN_TOKENS = 50_000;
const KIRO_LEGACY_ENGINES = new Set(['v1', 'v2']);
const FIRST_PARTY_HOSTS = new Set(['api.anthropic.com']);

const upfront = (reason) => ({ mode: 'upfront', reason });
const deferred = (reason) => ({ mode: 'deferred', reason });

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function isThirdPartyBaseUrl(value) {
  if (!value) return false;
  try {
    return !FIRST_PARTY_HOSTS.has(new URL(value).hostname);
  } catch {
    return true;
  }
}

function autoPercent(value) {
  const match = /^auto(?::(\d+(?:\.\d+)?))?$/.exec(value);
  if (!match) return null;
  return match[1] === undefined ? DEFAULT_AUTO_PERCENT : Number(match[1]);
}

function claudeLoading({ env = {}, alwaysLoad = false, totalTokens = null, contextWindowTokens = null }) {
  if (alwaysLoad === true) return upfront('alwaysLoad is set on this server');
  if (env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS) return upfront('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS keeps tool search off');
  const setting = typeof env.ENABLE_TOOL_SEARCH === 'string' ? env.ENABLE_TOOL_SEARCH.trim().toLowerCase() : '';
  if (setting === 'false') return upfront('ENABLE_TOOL_SEARCH=false');
  if (setting === 'true') return deferred('ENABLE_TOOL_SEARCH=true');
  const percent = autoPercent(setting);
  if (percent !== null) {
    if (!Number.isFinite(totalTokens) || !Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0) {
      return upfront(`ENABLE_TOOL_SEARCH=${setting}, but the context window is unknown; counted as loaded`);
    }
    return totalTokens / contextWindowTokens * 100 > percent
      ? deferred(`ENABLE_TOOL_SEARCH=${setting}: MCP schemas exceed ${percent}% of the window`)
      : upfront(`ENABLE_TOOL_SEARCH=${setting}: MCP schemas are under ${percent}% of the window`);
  }
  if (isThirdPartyBaseUrl(env.ANTHROPIC_BASE_URL)) return upfront('a third-party ANTHROPIC_BASE_URL turns tool search off');
  return deferred('Claude Code defers MCP tools behind tool search by default');
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/// Kiro settings are flat dotted keys in cli.json. The engine decides the
/// default: V3 (and the IDE) defer, V2 needs toolSearch.enabled and a threshold.
function kiroLoading({ settings = {}, totalTokens = null, contextWindowTokens = null }) {
  const engine = String(settings['chat.agentEngine'] || '').toLowerCase();
  if (!KIRO_LEGACY_ENGINES.has(engine)) return deferred('Kiro IDE and CLI V3 sessions load MCP tools on demand');
  if (settings['toolSearch.enabled'] !== true) return upfront(`Kiro CLI ${engine} preloads MCP tools unless toolSearch.enabled is set`);
  const minPct = finiteOr(settings['toolSearch.minPct'], KIRO_V2_MIN_PCT);
  const minTokens = finiteOr(settings['toolSearch.minTokens'], KIRO_V2_MIN_TOKENS);
  if (minPct === 0 && minTokens === 0) return deferred('Kiro toolSearch thresholds are 0, so it is always on');
  const total = finiteOr(totalTokens, 0);
  const overTokens = total > minTokens;
  const overPct = Number.isFinite(contextWindowTokens) && contextWindowTokens > 0 && total / contextWindowTokens * 100 > minPct;
  return overTokens || overPct
    ? deferred(`Kiro toolSearch: MCP schemas exceed ${minPct}% of the window or ${minTokens} tokens`)
    : upfront(`Kiro toolSearch: MCP schemas are under ${minPct}% of the window and ${minTokens} tokens`);
}

function mcpLoading(harness, options = {}) {
  if (harness === 'claude') return claudeLoading(options);
  if (harness === 'codex') return deferred('Codex defers MCP tools behind tool search');
  if (harness === 'kiro') return kiroLoading(options);
  return upfront('deferred loading is not documented for this agent; counted as loaded');
}

/// Tokens a server adds at session start: nothing while deferred, all of it
/// otherwise. A server with no `loading` (an older caller) counts in full.
function startupTokens(server) {
  const tokens = Number.isFinite(server?.estimatedTokens) ? server.estimatedTokens : 0;
  return server?.loading?.mode === 'deferred' ? 0 : tokens;
}

/// Claude reads its env from settings.json on top of the shell it started in.
function claudeEnv(home, workspace, env) {
  const layers = [
    path.join(home, '.claude', 'settings.json'),
    path.join(workspace, '.claude', 'settings.json'),
    path.join(workspace, '.claude', 'settings.local.json'),
  ].map((file) => readJson(file)?.env).filter((value) => value && typeof value === 'object');
  return Object.assign({}, env, ...layers);
}

/// Kiro reads ~/.kiro/settings/cli.json, overridden per workspace.
function kiroSettings(home, workspace) {
  return Object.assign({},
    readJson(path.join(home, '.kiro', 'settings', 'cli.json')),
    readJson(path.join(workspace, '.kiro', 'settings', 'cli.json')));
}

function harnessTotal(servers, harness) {
  return servers
    .filter((server) => server.harness === harness)
    .reduce((total, server) => total + (Number.isFinite(server.estimatedTokens) ? server.estimatedTokens : 0), 0);
}

/// A new cache with `loading` on every server. Decided at read time, not stored,
/// because the settings that decide it can change after mcp-scan ran.
function annotateLoading(mcpCost, { home, workspace, env = process.env, contextWindows = {} }) {
  if (!mcpCost || !Array.isArray(mcpCost.servers)) return mcpCost;
  const effectiveClaudeEnv = claudeEnv(home, workspace, env);
  const claudeConfigs = new Map(claudeMcpServerStates(home, workspace).map((server) => [server.name, server.config]));
  const settings = kiroSettings(home, workspace);
  const servers = mcpCost.servers.map((server) => ({
    ...server,
    loading: mcpLoading(server.harness, {
      env: effectiveClaudeEnv,
      settings,
      alwaysLoad: claudeConfigs.get(server.name)?.alwaysLoad === true,
      totalTokens: harnessTotal(mcpCost.servers, server.harness),
      contextWindowTokens: contextWindows[server.harness] ?? null,
    }),
  }));
  return { ...mcpCost, servers };
}

module.exports = { annotateLoading, claudeLoading, kiroLoading, mcpLoading, startupTokens };
