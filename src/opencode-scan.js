'use strict';

// OpenCode: config (JSON or JSONC), rules, skills, MCP servers, and sessions
// from its SQLite store. Docs checked 2026-10-16:
//   config   https://opencode.ai/docs/config/
//   rules    https://opencode.ai/docs/rules/
//   skills   https://opencode.ai/docs/skills/
//   MCP      https://opencode.ai/docs/mcp-servers/ (V1 `mcp.<name>`, `enabled`)
//            https://opencode.ai/v2/docs/mcp-servers/ (V2 `mcp.servers.<name>`,
//            `disabled`, `codemode` default true: tools go through Code Mode
//            rather than the native tool list)
// Sessions live in ~/.local/share/opencode/opencode.db (`session`, `message`);
// verified against a local 1.14 install. Only token counts are read.

const fs = require('node:fs');
const path = require('node:path');
const { exists, fileExists, skillGroup } = require('./scan-common');

const BYTES_PER_TOKEN = 4;

function configDirectory(home) {
  return path.join(home, '.config', 'opencode');
}

function databaseFile(home) {
  return path.join(home, '.local', 'share', 'opencode', 'opencode.db');
}

function isInstalled(home) {
  return exists(configDirectory(home)) || fileExists(databaseFile(home));
}

/// JSON with // and /* */ comments and trailing commas, which OpenCode accepts.
/// Strings are copied verbatim so a URL's `//` survives.
function parseJsonc(text) {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      let end = index + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      out += text.slice(index, end + 1);
      index = end;
    } else if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
      out += '\n';
    } else if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end === -1 ? text.length : end + 1;
    } else {
      out += char;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function readConfig(directory) {
  for (const name of ['opencode.jsonc', 'opencode.json']) {
    const file = path.join(directory, name);
    if (!fileExists(file)) continue;
    try { return parseJsonc(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  }
  return {};
}

/// Global then project; a later definition of the same server wins.
function configs(home, workspace) {
  return [readConfig(configDirectory(home)), readConfig(workspace)];
}

function toEntry(name, value, modern) {
  const command = Array.isArray(value.command) ? value.command : [];
  const env = value.environment && typeof value.environment === 'object' ? value.environment : {};
  return {
    harness: 'opencode',
    name,
    enabled: modern ? value.disabled !== true : value.enabled !== false,
    transport: value.type === 'remote' ? 'http' : 'stdio',
    command: command[0] || null,
    args: command.slice(1),
    envKeys: Object.keys(env),
    env,
    url: value.url || null,
    // V1 has no Code Mode; V2 defaults it on.
    codemode: modern ? value.codemode !== false : false,
  };
}

function opencodeMcpEntries(home, workspace) {
  const byName = new Map();
  for (const config of configs(home, workspace)) {
    const mcp = config?.mcp;
    if (!mcp || typeof mcp !== 'object') continue;
    const modern = mcp.servers && typeof mcp.servers === 'object';
    for (const [name, value] of Object.entries(modern ? mcp.servers : mcp)) {
      if (value && typeof value === 'object') byName.set(name, toEntry(name, value, modern));
    }
  }
  return [...byName.values()];
}

function fileRecord(file, scope) {
  try {
    const real = fs.realpathSync(file);
    const bytes = fs.statSync(real).size;
    return bytes ? { path: real, scope, bytes } : null;
  } catch {
    return null;
  }
}

/// Nearest directory with AGENTS.md (else CLAUDE.md) wins; then the global
/// AGENTS.md, else ~/.claude/CLAUDE.md; then `instructions` entries.
function opencodeInstructions(home, workspace, env = process.env) {
  const claudeOff = Boolean(env.OPENCODE_DISABLE_CLAUDE_CODE);
  const files = [];
  const globalFile = fileRecord(path.join(configDirectory(home), 'AGENTS.md'), 'global')
    || (claudeOff || env.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT ? null : fileRecord(path.join(home, '.claude', 'CLAUDE.md'), 'global'));
  if (globalFile) files.push(globalFile);

  let directory = path.resolve(workspace);
  for (;;) {
    const found = fileRecord(path.join(directory, 'AGENTS.md'), 'project')
      || (claudeOff ? null : fileRecord(path.join(directory, 'CLAUDE.md'), 'project'));
    if (found) {
      files.push(found);
      break;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  let unmeasured = 0;
  for (const config of configs(home, workspace)) {
    for (const entry of Array.isArray(config?.instructions) ? config.instructions : []) {
      // ponytail: URLs and globs are not resolved; count them as unmeasured. Add glob matching if users rely on it.
      if (typeof entry !== 'string' || /^https?:\/\//.test(entry) || /[*?[{]/.test(entry)) {
        unmeasured += 1;
        continue;
      }
      const record = fileRecord(path.resolve(workspace, entry), 'config');
      if (record && !files.some((file) => file.path === record.path)) files.push(record);
    }
  }
  const bytes = files.reduce((total, file) => total + file.bytes, 0);
  return { files, bytes, tokens: Math.round(bytes / BYTES_PER_TOKEN), onDemand: 0, truncated: false, unmeasured };
}

function opencodeSkillGroups(home, workspace, env = process.env) {
  const claudeOff = env.OPENCODE_DISABLE_CLAUDE_CODE || env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS;
  return [
    ['opencode-skills', path.join(configDirectory(home), 'skills')],
    ['agent-skills', path.join(home, '.agents', 'skills')],
    ...(claudeOff ? [] : [['claude-skills', path.join(home, '.claude', 'skills')]]),
    ['project-skills', path.join(workspace, '.opencode', 'skills')],
    ['project-agent-skills', path.join(workspace, '.agents', 'skills')],
    ...(claudeOff ? [] : [['project-claude-skills', path.join(workspace, '.claude', 'skills')]]),
  ]
    // Run from the home directory, a project folder is the global one.
    .filter(([, directory], index, all) => all.findIndex(([, other]) => path.resolve(other) === path.resolve(directory)) === index)
    .map(([id, directory]) => skillGroup(id, directory, { allowedStatuses: new Set(['active-candidate']) }))
    .filter((group) => group.skillCount);
}

/// node:sqlite (Node 22.13+) still prints an ExperimentalWarning on some
/// versions; the CLI's output is meant to be read, so that one is dropped.
function openDatabase(file) {
  if (!fileExists(file)) return null;
  const emitWarning = process.emitWarning;
  process.emitWarning = (warning, ...rest) => (String(warning).includes('SQLite') ? undefined : emitWarning.call(process, warning, ...rest));
  try {
    const { DatabaseSync } = require('node:sqlite');
    return new DatabaseSync(file, { readOnly: true });
  } catch {
    return null;
  } finally {
    process.emitWarning = emitWarning;
  }
}

/// Top-level sessions for the workspace, newest first, each with its assistant
/// messages in order. A subagent session (`parent_id`) has its own context.
function opencodeSessionRows(home, workspace, { limit = 50 } = {}) {
  const db = openDatabase(databaseFile(home));
  if (!db) return [];
  try {
    const root = path.resolve(workspace);
    const sessions = db.prepare(`select id, version, directory from session where parent_id is null
      and (directory = ? or substr(directory, 1, ?) = ?) order by time_updated desc limit ?`)
      .all(root, root.length + 1, `${root}${path.sep}`, limit);
    const messages = db.prepare(`select time_created, data from message where session_id = ?
      and json_extract(data, '$.role') = 'assistant' order by time_created, id`);
    return sessions.map((session) => ({
      id: session.id,
      version: session.version || null,
      messages: messages.all(session.id).map((row) => {
        let data = {};
        try { data = JSON.parse(row.data); } catch { /* skip a malformed row */ }
        return { at: new Date(Number(row.time_created)).toISOString(), data };
      }),
    }));
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/// One message's context: everything sent, cached or not.
function messageContext(data) {
  const tokens = data?.tokens || {};
  const number = (value) => (Number.isFinite(value) ? value : 0);
  return number(tokens.input) + number(tokens.cache?.read) + number(tokens.cache?.write);
}

const RUNTIME_SESSIONS = 5;

/// The newest session that got a response; an aborted one reports zero tokens.
function scanOpenCodeRuntime(home, workspace) {
  const last = opencodeSessionRows(home, workspace, { limit: RUNTIME_SESSIONS })
    .map((session) => session.messages.filter((message) => messageContext(message.data) > 0).at(-1))
    .find(Boolean);
  if (!last) return { modelCatalog: { selectedModel: null, models: [] }, sessionTelemetry: null };
  return {
    modelCatalog: { selectedModel: last.data.modelID || null, models: [] },
    sessionTelemetry: {
      source: 'local-sqlite',
      currentModel: last.data.modelID || null,
      latestUsage: { inputTokens: messageContext(last.data) },
      updatedAt: last.at,
    },
  };
}

function scanOpenCode(home, workspace) {
  return {
    root: configDirectory(home),
    ...scanOpenCodeRuntime(home, workspace),
    instructions: opencodeInstructions(home, workspace),
    skillGroups: opencodeSkillGroups(home, workspace),
    hookCount: 0,
    configuredMcpServerCount: opencodeMcpEntries(home, workspace).filter((entry) => entry.enabled).length,
  };
}

module.exports = {
  isInstalled, messageContext, opencodeMcpEntries, opencodeSessionRows, parseJsonc, scanOpenCode, scanOpenCodeRuntime,
};
