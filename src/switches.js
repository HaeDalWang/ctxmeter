'use strict';

// Every on/off switch ctxmeter knows about, in both states, and the edit that
// flips one. `fix` offers the subset worth turning off; the menu bar shows all.
//
// Rules from develop/decisions/05 and 06: a switch is always one native flag, an
// unmeasured cost is `null` rather than a guess, and Claude MCP servers are
// switched in Claude itself because ~/.claude.json is rewritten while Claude runs.

const fs = require('node:fs');
const path = require('node:path');
const { setJsonPluginEnabled, setJsonServerDisabled, setTomlSectionKey } = require('./config-edit');
const { MEASURED_STATUS, configuredMcpServers } = require('./mcp-cost');
const { codexPluginStates } = require('./scanner');

const CLAUDE_INSTRUCTION = 'switch it in Claude Code: run /mcp and toggle it (applies to this project)';
const TOML_BARE_KEY = /^[A-Za-z0-9_-]+$/;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/// The same guard the audit uses: a cache from another home describes another
/// machine's servers.
function measuredCosts(mcpCost, home) {
  const trusted = mcpCost && mcpCost.home && mcpCost.home === home ? mcpCost : null;
  return new Map((trusted?.servers || [])
    .filter((server) => server.status === MEASURED_STATUS && Number.isFinite(server.estimatedTokens))
    .map((server) => [`${server.harness}/${server.name}`, server]));
}

function mcpSwitch(home, server, measured) {
  const target = `${server.harness}/${server.name}`;
  const cost = measured.get(target);
  const base = {
    target,
    harness: server.harness,
    kind: 'mcp-server',
    name: server.name,
    enabled: server.enabled,
    tokens: cost ? cost.estimatedTokens : null,
    detail: Number.isFinite(cost?.toolCount) ? plural(cost.toolCount, 'tool') : null,
  };
  if (server.harness === 'claude') return { ...base, format: 'manual', file: null, instruction: CLAUDE_INSTRUCTION };
  if (server.harness === 'codex') {
    // TOML only allows [A-Za-z0-9_-] in a bare key; anything else is quoted.
    const key = TOML_BARE_KEY.test(server.name) ? server.name : `"${server.name}"`;
    return { ...base, format: 'toml', file: path.join(home, '.codex', 'config.toml'), section: `mcp_servers.${key}` };
  }
  return { ...base, format: 'json', file: path.join(home, '.kiro', 'settings', 'mcp.json') };
}

function groupCost(snapshot, harness, id) {
  const group = (snapshot?.harnesses?.[harness]?.skillGroups || []).find((entry) => entry.id === id);
  return {
    tokens: Number.isFinite(group?.metadataTokenEstimate) && group.metadataTokenEstimate > 0 ? group.metadataTokenEstimate : null,
    detail: Number.isFinite(group?.skillCount) ? plural(group.skillCount, 'skill') : null,
  };
}

/// Codex plugin groups opt in with `enabled = true`; absent means off.
function codexPluginSwitches(home, snapshot) {
  const file = path.join(home, '.codex', 'config.toml');
  return codexPluginStates(file).map((state) => ({
    target: `codex/plugin:${state.id}`,
    harness: 'codex',
    kind: 'plugin-group',
    name: state.id,
    enabled: state.enabled,
    ...(state.enabled ? groupCost(snapshot, 'codex', state.id) : { tokens: null, detail: null }),
    format: 'toml',
    file,
    section: `plugins."${state.id}"`,
  }));
}

/// Claude plugins are `enabledPlugins: { "<name>@<marketplace>": bool }` in settings.json.
function claudePluginSwitches(home, snapshot) {
  const file = path.join(home, '.claude', 'settings.json');
  const plugins = readJson(file)?.enabledPlugins;
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) return [];
  return Object.entries(plugins).map(([id, value]) => ({
    target: `claude/plugin:${id}`,
    harness: 'claude',
    kind: 'plugin-group',
    name: id,
    enabled: value === true,
    ...(value === true ? groupCost(snapshot, 'claude', id) : { tokens: null, detail: null }),
    format: 'json-plugin',
    file,
  }));
}

function listSwitches({ home, snapshot, mcpCost }) {
  const workspace = snapshot?.target?.workspace || home;
  const measured = measuredCosts(mcpCost, snapshot?.target?.home);
  const servers = configuredMcpServers(home, workspace).map((server) => mcpSwitch(home, server, measured));
  return [...servers, ...codexPluginSwitches(home, snapshot), ...claudePluginSwitches(home, snapshot)]
    .filter((item) => item.format === 'manual' || fs.existsSync(item.file));
}

/// Computes the edit without touching the file, so the caller can show it first.
function planSwitch(item, enabled) {
  if (item.format === 'manual') throw new Error(`ctxmeter does not edit this one; ${item.instruction}.`);
  const before = fs.readFileSync(item.file, 'utf8');
  let result;
  if (item.format === 'toml') result = setTomlSectionKey(before, item.section, 'enabled', String(enabled));
  else if (item.format === 'json-plugin') result = setJsonPluginEnabled(before, item.name, enabled);
  else result = setJsonServerDisabled(before, item.name, !enabled);

  const change = item.format === 'toml'
    ? `enabled = ${enabled} under [${item.section}]`
    : item.format === 'json-plugin'
      ? `"${item.name}": ${enabled} in enabledPlugins`
      : `"disabled": ${!enabled} on "${item.name}"`;
  return { proposal: item, enabled, file: item.file, before, after: result.content, changed: result.changed, line: result.line ?? null, change };
}

module.exports = { CLAUDE_INSTRUCTION, listSwitches, planSwitch };
