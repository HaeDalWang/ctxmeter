const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createClaudeRuntimeReader, createCodexRuntimeReader, createKiroRuntimeReader } = require('./scanner');

const MIME = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function send(response, status, body, type = 'text/plain; charset=utf-8') {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(body);
}

function listSnapshots(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name).sort().reverse();
}

function safeSnapshotName(value) {
  return value && !value.includes('/') && !value.includes('\\') && value.endsWith('.json') ? value : null;
}

function formatListenError(error, port) {
  if (error.code === 'EADDRINUSE') {
    return `ctxmeter dashboard is already running on http://127.0.0.1:${port}. Stop that process or run CTXMETER_PORT=${port + 1} npm run dashboard.`;
  }
  return `ctxmeter dashboard could not start: ${error.message || error.code}`;
}

function createDashboardServer({ snapshotDirectory, publicDirectory, contextProfilesFile, claudeRuntimeReader, codexRuntimeReader, kiroRuntimeReader }) {
  const runtimeReaders = { claude: claudeRuntimeReader, codex: codexRuntimeReader, kiro: kiroRuntimeReader };
  return http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/api/snapshots') return send(response, 200, JSON.stringify({ snapshots: listSnapshots(snapshotDirectory) }), MIME['.json']);
    if (pathname === '/api/context-profiles') {
      return contextProfilesFile && fs.existsSync(contextProfilesFile)
        ? send(response, 200, fs.readFileSync(contextProfilesFile), MIME['.json'])
        : send(response, 200, JSON.stringify({ profiles: [], calibrations: [] }), MIME['.json']);
    }
    if (pathname.startsWith('/api/runtime/')) {
      const harnessId = pathname.slice('/api/runtime/'.length);
      if (!Object.prototype.hasOwnProperty.call(runtimeReaders, harnessId)) return send(response, 404, 'Unknown harness');
      const reader = runtimeReaders[harnessId];
      try {
        return send(response, 200, JSON.stringify(reader ? reader() : { modelCatalog: { models: [] }, sessionTelemetry: null }), MIME['.json']);
      } catch (error) {
        return send(response, 500, JSON.stringify({ error: `${harnessId} runtime refresh failed`, detail: error.message }), MIME['.json']);
      }
    }
    if (pathname.startsWith('/api/snapshots/')) {
      const name = safeSnapshotName(decodeURIComponent(pathname.slice('/api/snapshots/'.length)));
      if (!name) return send(response, 400, 'Invalid snapshot name');
      const file = path.join(snapshotDirectory, name);
      return fs.existsSync(file) ? send(response, 200, fs.readFileSync(file), MIME['.json']) : send(response, 404, 'Snapshot not found');
    }
    const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (requested.includes('..')) return send(response, 400, 'Invalid asset path');
    const file = path.join(publicDirectory, requested);
    return fs.existsSync(file) ? send(response, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream') : send(response, 404, 'Not found');
  });
}

const DEFAULT_PORT = 4318;
const REFRESH_INTERVAL_MS = 5_000;

/// Assembles the server from a workspace root. Shared by the CLI `dashboard`
/// command and by running this file directly, so both bind the same readers.
function startDashboard({ root = process.cwd(), home = os.homedir(), port = DEFAULT_PORT } = {}) {
  const server = createDashboardServer({
    snapshotDirectory: path.join(root, '.ctxmeter', 'snapshots'),
    publicDirectory: path.join(__dirname, '..', 'public'),
    contextProfilesFile: path.join(__dirname, '..', 'config', 'context-profiles.json'),
    claudeRuntimeReader: createClaudeRuntimeReader({ home, workspace: root, minRefreshMs: REFRESH_INTERVAL_MS }),
    codexRuntimeReader: createCodexRuntimeReader({ home, workspace: root, minRefreshMs: REFRESH_INTERVAL_MS }),
    kiroRuntimeReader: createKiroRuntimeReader({ home, workspace: root, minRefreshMs: REFRESH_INTERVAL_MS }),
  });
  return new Promise((resolve, reject) => {
    server.once('error', (error) => reject(new Error(formatListenError(error, port))));
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.CTXMETER_PORT || DEFAULT_PORT);
  startDashboard({ port })
    .then(({ url }) => process.stdout.write(`ctxmeter dashboard: ${url}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = { DEFAULT_PORT, createDashboardServer, formatListenError, listSnapshots, startDashboard };
