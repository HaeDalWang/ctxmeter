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

const PROTOCOL_VERSION = '2025-06-18';
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

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function claudeEntries(home) {
  const config = readJson(path.join(home, '.claude', 'mcp.json'));
  return Object.entries(config?.mcpServers || {})
    .filter(([, value]) => value && value.disabled !== true)
    .map(([name, value]) => ({
      harness: 'claude',
      name,
      transport: value.command ? 'stdio' : 'http',
      command: value.command || null,
      args: Array.isArray(value.args) ? value.args : [],
      envKeys: Object.keys(value.env || {}),
      env: value.env || {},
      url: value.url || null,
    }));
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
          harness: 'codex', name: current, transport: 'stdio',
          command: null, args: [], envKeys: [], env: {}, url: null,
        });
      }
      continue;
    }
    if (!current || !entries.has(current)) continue;
    const entry = entries.get(current);
    const pair = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/);
    if (!pair) continue;
    if (inEnv) {
      entry.envKeys.push(pair[1]);
      entry.env[pair[1]] = pair[2].replace(/^"|"$/g, '');
      continue;
    }
    if (pair[1] === 'command') entry.command = pair[2].replace(/^"|"$/g, '');
    if (pair[1] === 'url') {
      entry.url = pair[2].replace(/^"|"$/g, '');
      entry.transport = 'http';
    }
    if (pair[1] === 'args') {
      entry.args = [...pair[2].matchAll(/"([^"]*)"/g)].map((match) => match[1]);
    }
  }
  return [...entries.values()];
}

function mcpServerEntries(home) {
  return [...claudeEntries(home), ...codexEntries(home)];
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
          finish({ status: 'measured', toolCount: tools.length, schemaBytes: toolSchemaBytes(tools) });
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
  const post = (body) => fetch(entry.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body,
    signal: controller.signal,
  });
  try {
    const [initialize, initialized, listTools] = frames();
    await post(initialize);
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
    return { status: 'measured', toolCount: tools.length, schemaBytes: toolSchemaBytes(tools) };
  } catch (error) {
    return { status: error.name === 'AbortError' ? 'timeout' : 'failed', detail: error.name };
  } finally {
    clearTimeout(timer);
  }
}

async function measureMcpCost(entries, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5_000;
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
  const lines = [
    `MCP tool schemas cost ${integer(result.totalEstimatedTokens)} tokens across ${integer(result.totalToolCount)} tools.`,
    '',
  ];
  const ranked = [...result.servers].sort((left, right) => (right.estimatedTokens || 0) - (left.estimatedTokens || 0));
  for (const server of ranked) {
    const value = server.estimatedTokens === null
      ? `${server.status}${server.detail ? ` — ${server.detail}` : ''}`
      : `${integer(server.estimatedTokens)} tokens, ${integer(server.toolCount)} tools`;
    lines.push(`  ${server.harness}/${server.name}: ${value}`);
  }
  lines.push(
    '',
    'Measured by starting each server and calling tools/list, then discarding the schemas.',
    'Figures are schema bytes divided by four, not a tokenizer count.',
  );
  return lines.join('\n');
}

module.exports = { describeDryRun, formatMcpCost, mcpServerEntries, measureMcpCost, toolSchemaBytes };
