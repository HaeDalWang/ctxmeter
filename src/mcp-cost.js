// Measures what MCP tool schemas cost in context.
//
// This is the only part of the project that executes anything. MCP tool
// definitions exist solely in the live prompt — they are never written to any
// local file — so the only way to size them is to start each server and ask.
// That is why this lives behind its own command and an explicit flag, and why
// remote servers are skipped unless the caller opts into network calls.
//
// Only counts and byte totals are retained. Tool names, descriptions, and
// schemas are measured and discarded, matching the rule that snapshots hold
// metadata rather than content.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { claudeMcpServerStates } = require('./claude-mcp');

const PROTOCOL_VERSION = '2025-06-18';
// A misbehaving server must not be able to exhaust our memory.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const CLIENT_INFO = { name: 'agentlens', version: '0.1.0' };

/// Only the fields a model is actually shown. Servers attach `_meta`,
/// `annotations`, and other bookkeeping that never reaches the prompt.
function toolSchemaBytes(tools) {
  if (!Array.isArray(tools) || !tools.length) return 0;
  const shown = tools.map((tool) => ({
    name: tool?.name,
    description: tool?.description,
    inputSchema: tool?.inputSchema,
  }));
  return Buffer.byteLength(JSON.stringify(shown));
}

/// The one status that means a server answered and its schemas were counted.
/// Shared so audit.js and fix.js cannot drift from what this module emits.
const MEASURED_STATUS = 'measured';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function toEntry(harness, name, value, enabled = true) {
  return {
    harness,
    name,
    enabled,
    transport: value.command ? 'stdio' : 'http',
    command: value.command || null,
    args: Array.isArray(value.args) ? value.args : [],
    envKeys: Object.keys(value.env || {}),
    env: value.env || {},
    url: value.url || null,
  };
}

/// Kiro uses `mcpServers` with a `disabled` flag in one file.
function kiroEntries(home) {
  const config = readJson(path.join(home, '.kiro', 'settings', 'mcp.json'));
  return Object.entries(config?.mcpServers || {})
    .filter(([, value]) => value && typeof value === 'object')
    .map(([name, value]) => toEntry('kiro', name, value, value.disabled !== true));
}

/// Claude spreads servers across scopes; claude-mcp.js decides which load.
function claudeEntries(home, workspace) {
  return claudeMcpServerStates(home, workspace).map((server) => toEntry('claude', server.name, server.config, server.enabled));
}

/// The value part of `key = value`, without quotes or a trailing `# comment`.
/// Without this, `enabled = false # note` reads as on and the server is started.
function tomlScalar(raw) {
  const quoted = raw.match(/^"((?:[^"\\]|\\.)*)"/) || raw.match(/^'([^']*)'/);
  if (quoted) return quoted[1];
  if (raw.startsWith('[')) return raw.slice(0, raw.lastIndexOf(']') + 1);
  return raw.replace(/\s*#.*$/, '');
}

/// Minimal TOML reading for `[mcp_servers.<name>]` blocks. The scanner already
/// takes this approach; a dependency is not worth it for three key shapes.
function codexEntries(home) {
  const file = path.join(home, '.codex', 'config.toml');
  if (!fs.existsSync(file)) return [];
  const entries = new Map();
  let current = null;
  let inEnv = false;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const section = line.match(/^\s*\[([^\]]+)\]/)?.[1];
    if (section) {
      const envMatch = section.match(/^mcp_servers\.(?:"([^"]+)"|([^.]+))\.env$/);
      const serverMatch = section.match(/^mcp_servers\.(?:"([^"]+)"|([^.]+))$/);
      inEnv = Boolean(envMatch);
      const name = (envMatch?.[1] ?? envMatch?.[2]) || (serverMatch?.[1] ?? serverMatch?.[2]);
      current = name || null;
      if (serverMatch && current && !entries.has(current)) {
        entries.set(current, {
          harness: 'codex', name: current, enabled: true, transport: 'stdio',
          command: null, args: [], envKeys: [], env: {}, url: null,
        });
      }
      continue;
    }
    if (!current || !entries.has(current)) continue;
    const entry = entries.get(current);
    const pair = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/);
    if (!pair) continue;
    const value = tomlScalar(pair[2]);
    if (inEnv) {
      entry.envKeys.push(pair[1]);
      entry.env[pair[1]] = value;
      continue;
    }
    if (pair[1] === 'command') entry.command = value;
    if (pair[1] === 'url') {
      entry.url = value;
      entry.transport = 'http';
    }
    if (pair[1] === 'args') {
      entry.args = [...value.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
    }
    // Codex switches a server off in place. Honouring it matters twice over: a
    // disabled server costs nothing, and starting it anyway can launch a GUI app.
    if (pair[1] === 'enabled') entry.enabled = value.trim() !== 'false';
  }
  return [...entries.values()];
}

/// Every configured server, on or off. `fix` needs the off ones to turn them back on.
/// Claude's local and project scopes depend on the workspace; the others do not.
function configuredMcpServers(home, workspace = process.cwd()) {
  return [...claudeEntries(home, workspace), ...codexEntries(home), ...kiroEntries(home)];
}

/// Only the servers that are on. These are what `mcp-scan` may start.
function mcpServerEntries(home, workspace = process.cwd()) {
  return configuredMcpServers(home, workspace).filter((entry) => entry.enabled);
}

/// Shown before anything is executed so the user can inspect and refuse.
function describeDryRun(entries) {
  if (!entries.length) return 'No MCP servers are configured.';
  const lines = ['These commands would be executed:', ''];
  for (const entry of entries) {
    const target = entry.transport === 'stdio'
      ? [entry.command, ...entry.args].join(' ')
      : `HTTP POST ${entry.url}`;
    lines.push(`  ${entry.harness}/${entry.name}`);
    lines.push(`    ${target}`);
    // Names only. The values are credentials.
    if (entry.envKeys.length) lines.push(`    env passed through: ${entry.envKeys.join(', ')}`);
  }
  lines.push('', 'Environment values are never printed or stored.');
  return lines.join('\n');
}

function frames() {
  return [
    JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
    }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  ];
}

function measureStdioServer(entry, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(entry.command, entry.args, {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, ...entry.env },
        // npx and uvx are batch shims on Windows and are not directly executable.
        shell: process.platform === 'win32',
      });
    } catch {
      resolve({ status: 'failed', detail: 'could not spawn' });
      return;
    }

    let settled = false;
    let buffer = '';
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      resolve(value);
    };
    const timer = setTimeout(() => finish({ status: 'timeout', detail: `no tools/list within ${timeoutMs}ms` }), timeoutMs);

    child.on('error', () => finish({ status: 'failed', detail: 'could not spawn' }));
    child.on('exit', () => finish({ status: 'failed', detail: 'exited before answering' }));

    const [initialize, initialized, listTools] = frames();
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > MAX_RESPONSE_BYTES) {
        finish({ status: 'failed', detail: 'server sent too much output before answering' });
        return;
      }
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        if (row.id === 1 && row.result) {
          child.stdin.write(`${initialized}\n${listTools}\n`);
        }
        if (row.id === 2) {
          const tools = row.result?.tools;
          if (!Array.isArray(tools)) {
            finish({ status: 'failed', detail: 'no tools in response' });
            return;
          }
          finish({ status: MEASURED_STATUS, toolCount: tools.length, schemaBytes: toolSchemaBytes(tools) });
          return;
        }
      }
    });

    try {
      child.stdin.write(`${initialize}\n`);
    } catch {
      finish({ status: 'failed', detail: 'could not write to server' });
    }
  });
}

async function measureHttpServer(entry, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  const post = (body) => fetch(entry.url, {
    method: 'POST',
    headers,
    body,
    signal: controller.signal,
  });
  try {
    const [initialize, initialized, listTools] = frames();
    const initializeResponse = await post(initialize);
    // The spec requires both on every request after initialize. A stateful
    // server rejects follow-ups without its session id, so without this every
    // such server reads as "failed".
    const sessionId = initializeResponse.headers.get('mcp-session-id');
    if (sessionId) headers['mcp-session-id'] = sessionId;
    headers['mcp-protocol-version'] = PROTOCOL_VERSION;
    await initializeResponse.body?.cancel();
    await post(initialized);
    const response = await post(listTools);
    const text = await response.text();
    // Streamable HTTP may answer as SSE; take the last JSON payload either way.
    const payload = text.trimEnd().split('\n')
      .map((line) => line.replace(/^data:\s*/, '').trim())
      .filter((line) => line.startsWith('{'))
      .at(-1);
    const tools = payload ? JSON.parse(payload).result?.tools : null;
    if (!Array.isArray(tools)) return { status: 'failed', detail: 'no tools in response' };
    return { status: MEASURED_STATUS, toolCount: tools.length, schemaBytes: toolSchemaBytes(tools) };
  } catch (error) {
    return { status: error.name === 'AbortError' ? 'timeout' : 'failed', detail: error.name };
  } finally {
    clearTimeout(timer);
  }
}

async function measureMcpCost(entries, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const home = options.home || null;
  const allowRemote = options.allowRemote === true;

  const servers = await Promise.all(entries.map(async (entry) => {
    const base = { harness: entry.harness, name: entry.name, transport: entry.transport };
    if (entry.transport !== 'stdio' && !allowRemote) {
      return { ...base, status: 'skipped-remote', toolCount: null, schemaBytes: null, estimatedTokens: null,
        detail: 'remote server; rerun with --allow-remote to measure it' };
    }
    const outcome = entry.transport === 'stdio'
      ? await measureStdioServer(entry, timeoutMs)
      : await measureHttpServer(entry, timeoutMs);
    return {
      ...base,
      status: outcome.status,
      toolCount: outcome.toolCount ?? null,
      schemaBytes: outcome.schemaBytes ?? null,
      estimatedTokens: outcome.schemaBytes === undefined ? null : Math.round(outcome.schemaBytes / 4),
      detail: outcome.detail ?? null,
    };
  }));

  return {
    measuredAt: new Date().toISOString(),
    home,
    protocolVersion: PROTOCOL_VERSION,
    timeoutMs,
    servers,
    totalToolCount: servers.reduce((total, server) => total + (server.toolCount || 0), 0),
    totalEstimatedTokens: servers.reduce((total, server) => total + (server.estimatedTokens || 0), 0),
  };
}

function formatMcpCost(result) {
  if (!result.servers.length) return 'No MCP servers are configured.';
  const integer = (value) => Number(value || 0).toLocaleString('en-US');
  const isDeferred = (server) => server.loading?.mode === 'deferred';
  const known = result.servers.some((server) => server.loading);
  const deferredTotal = result.servers.filter(isDeferred).reduce((total, server) => total + (server.estimatedTokens || 0), 0);
  const headline = known && deferredTotal
    ? `MCP tool schemas: ${integer(result.totalEstimatedTokens - deferredTotal)} tokens load at startup; ${integer(deferredTotal)} more load only when a tool is used.`
    : `MCP tool schemas cost ${integer(result.totalEstimatedTokens)} tokens across ${integer(result.totalToolCount)} tools.`;
  const lines = [headline, ''];
  const ranked = [...result.servers].sort((left, right) => (right.estimatedTokens || 0) - (left.estimatedTokens || 0));
  for (const server of ranked) {
    const value = server.estimatedTokens === null
      ? `${server.status}${server.detail ? ` — ${server.detail}` : ''}`
      : `${integer(server.estimatedTokens)} tokens, ${integer(server.toolCount)} tools${isDeferred(server) ? ' — deferred' : ''}`;
    lines.push(`  ${server.harness}/${server.name}: ${value}`);
  }
  lines.push(
    '',
    'Measured by starting each server and calling tools/list, then discarding the schemas.',
    'Figures are schema bytes divided by four, not a tokenizer count.',
  );
  if (deferredTotal) {
    lines.push('Deferred: the agent keeps these behind a tool search and loads a tool only when the model looks for it.');
  }
  return lines.join('\n');
}

module.exports = { MEASURED_STATUS, configuredMcpServers, describeDryRun, formatMcpCost, mcpServerEntries, measureMcpCost, toolSchemaBytes };
