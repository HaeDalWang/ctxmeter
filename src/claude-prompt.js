'use strict';

// What Claude Code actually sent, not what its config files suggest.
//
// Since 2.1.300 each transcript carries `api-request-shape` rows: the system
// prompt blocks and every tool definition of a request. Only their sizes are
// taken. The same files hold `api-request-blob` rows with message content;
// those lines are filtered out by a substring test and never parsed.

const fs = require('node:fs');
const path = require('node:path');
const { eachJsonLine } = require('./jsonl');
const { claudeProjectDirectory } = require('./scanner');

const SHAPE_MARKER = '"type":"api-request-shape"';
const BYTES_PER_TOKEN = 4;
// Recent sessions only: a shape tells about the current setup, not last month's.
const SESSIONS_TO_SEARCH = 5;

function tokens(bytes) {
  return Math.round(bytes / BYTES_PER_TOKEN);
}

function bytesOf(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null));
}

/// `mcp__<server>__<tool>`; the server part may itself contain underscores.
function mcpServer(name) {
  const match = /^mcp__(.+?)__[^_].*$/.exec(name || '');
  return match ? match[1] : null;
}

function isDeferredPlaceholder(tool) {
  return tool?.defer_loading === true;
}

/// Sizes only. Names of MCP servers are kept because they are config, not content.
function summariseShape(row) {
  const system = Array.isArray(row?.shape?.system) ? row.shape.system : [];
  const tools = Array.isArray(row?.shape?.tools) ? row.shape.tools : [];
  const systemBytes = system.reduce((total, block) => total + Buffer.byteLength(typeof block?.text === 'string' ? block.text : ''), 0);

  const builtin = { tools: 0, bytes: 0 };
  const servers = new Map();
  let deferredPlaceholders = 0;
  let deferredBytes = 0;
  for (const tool of tools) {
    const bytes = bytesOf(tool);
    if (isDeferredPlaceholder(tool)) {
      deferredPlaceholders += 1;
      deferredBytes += bytes;
      continue;
    }
    const server = mcpServer(tool?.name);
    if (!server) {
      builtin.tools += 1;
      builtin.bytes += bytes;
      continue;
    }
    const entry = servers.get(server) || { server, tools: 0, bytes: 0 };
    servers.set(server, { ...entry, tools: entry.tools + 1, bytes: entry.bytes + bytes });
  }

  const mcp = [...servers.values()]
    .map((entry) => ({ server: entry.server, tools: entry.tools, tokens: tokens(entry.bytes) }))
    .sort((left, right) => right.tokens - left.tokens);
  const summary = {
    at: row?.timestamp || null,
    version: row?.version || null,
    system: { blocks: system.length, tokens: tokens(systemBytes) },
    builtin: { tools: builtin.tools, tokens: tokens(builtin.bytes) },
    mcp,
    deferredPlaceholders,
    deferredTokens: tokens(deferredBytes),
  };
  return {
    ...summary,
    totalTokens: summary.system.tokens + summary.builtin.tokens + summary.deferredTokens
      + mcp.reduce((total, entry) => total + entry.tokens, 0),
  };
}

function latestShapeIn(file) {
  let latest = null;
  eachJsonLine(file, (row) => {
    if (row.type === 'api-request-shape') latest = row;
  }, { lineFilter: SHAPE_MARKER });
  return latest;
}

/// The newest request shape in this workspace's recent Claude sessions, or null.
function claudePromptShape(home, workspace) {
  const directory = claudeProjectDirectory(path.join(home, '.claude'), workspace);
  let files;
  try {
    files = fs.readdirSync(directory)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => {
        const file = path.join(directory, name);
        return { file, at: fs.statSync(file).mtimeMs };
      })
      .sort((left, right) => right.at - left.at)
      .slice(0, SESSIONS_TO_SEARCH);
  } catch {
    return null;
  }
  for (const { file } of files) {
    const row = latestShapeIn(file);
    if (row) return summariseShape(row);
  }
  return null;
}

module.exports = { claudePromptShape, mcpServer, summariseShape };
