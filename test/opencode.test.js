const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const { parseJsonc, opencodeMcpEntries, scanOpenCode } = require('../src/opencode-scan');

function fixture() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-opencode-')));
  const workspace = path.join(home, 'work', 'repo');
  fs.mkdirSync(workspace, { recursive: true });
  return { home, workspace };
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

/// The two tables ctxmeter reads, with the columns it uses.
function database(home, sessions) {
  const file = path.join(home, '.local', 'share', 'opencode', 'opencode.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('create table session (id text primary key, parent_id text, directory text not null, version text not null, time_created integer not null, time_updated integer not null)');
  db.exec('create table message (id text primary key, session_id text not null, time_created integer not null, data text not null)');
  const addSession = db.prepare('insert into session values (?, ?, ?, ?, ?, ?)');
  const addMessage = db.prepare('insert into message values (?, ?, ?, ?)');
  for (const entry of sessions) {
    addSession.run(entry.id, entry.parent || null, entry.directory, entry.version || '1.14.48', entry.at, entry.at + entry.messages.length);
    entry.messages.forEach((message, index) => addMessage.run(`${entry.id}-${index}`, entry.id, entry.at + index, JSON.stringify(message)));
  }
  db.close();
}

const assistant = (input, read = 0, extra = {}) => ({
  role: 'assistant', modelID: 'claude-opus-5-5', tokens: { input, output: 10, cache: { read, write: 0 } }, time: { created: 1 }, ...extra,
});

test('JSONC with comments, trailing commas, and // inside strings parses', () => {
  const text = '{\n  // comment\n  "url": "https://x.example/mcp", /* block */\n  "list": [1, 2,],\n}\n';
  assert.deepEqual(parseJsonc(text), { url: 'https://x.example/mcp', list: [1, 2] });
});

test('MCP servers come from both config shapes; V2 Code Mode defers, V1 loads upfront', () => {
  const { home, workspace } = fixture();
  write(path.join(home, '.config/opencode/opencode.json'), JSON.stringify({
    mcp: { legacy: { type: 'local', command: ['npx', '-y', 'srv'], environment: { K: 'v' } }, parked: { type: 'local', command: ['x'], enabled: false } },
  }));
  write(path.join(workspace, 'opencode.jsonc'), '{ "mcp": { "servers": { "modern": { "type": "remote", "url": "https://m.example/mcp" }, "direct": { "type": "local", "command": ["y"], "codemode": false }, "off": { "type": "local", "command": ["z"], "disabled": true } } } }');

  const entries = Object.fromEntries(opencodeMcpEntries(home, workspace).map((entry) => [entry.name, entry]));

  assert.deepEqual(Object.keys(entries).sort(), ['direct', 'legacy', 'modern', 'off', 'parked']);
  assert.deepEqual([entries.legacy.command, entries.legacy.args, entries.legacy.envKeys], ['npx', ['-y', 'srv'], ['K']]);
  assert.equal(entries.parked.enabled, false);
  assert.equal(entries.off.enabled, false);
  assert.equal(entries.modern.transport, 'http');
  assert.deepEqual([entries.legacy.codemode, entries.modern.codemode, entries.direct.codemode], [false, true, false]);
});

test('rules: the nearest AGENTS.md wins over CLAUDE.md, the global file falls back to ~/.claude/CLAUDE.md', () => {
  const { home, workspace } = fixture();
  write(path.join(home, '.claude/CLAUDE.md'), 'c'.repeat(400));
  write(path.join(path.dirname(workspace), 'AGENTS.md'), 'a'.repeat(800));
  write(path.join(workspace, 'CLAUDE.md'), 'nearer, but a CLAUDE.md only counts when the same directory has no AGENTS.md');
  write(path.join(workspace, 'opencode.json'), JSON.stringify({ instructions: ['docs/extra.md', 'https://example.com/remote.md'] }));
  write(path.join(workspace, 'docs/extra.md'), 'e'.repeat(400));

  const { instructions } = scanOpenCode(home, workspace);

  assert.deepEqual(instructions.files.map((file) => path.relative(home, file.path)), ['.claude/CLAUDE.md', 'work/repo/CLAUDE.md', 'work/repo/docs/extra.md']);
  assert.equal(instructions.unmeasured, 1, 'a remote instruction is fetched at runtime');
});

test('skills are listed from OpenCode, Claude-compatible, and agent-compatible folders', () => {
  const { home, workspace } = fixture();
  write(path.join(home, '.config/opencode/skills/a/SKILL.md'), '---\nname: a\ndescription: aaaa\n---\nbody');
  write(path.join(home, '.claude/skills/b/SKILL.md'), '---\nname: b\ndescription: bbbb\n---\nbody');
  write(path.join(workspace, '.opencode/skills/c/SKILL.md'), '---\nname: c\ndescription: cccc\n---\nbody');

  const { skillGroups } = scanOpenCode(home, workspace);

  assert.equal(skillGroups.reduce((total, group) => total + group.skillCount, 0), 3);
});

test('sessions for the workspace, newest first, subagents excluded, compaction marked', () => {
  const { sessionHistory, startupBaselines } = require('../src/session-history');
  const { home, workspace } = fixture();
  database(home, [
    { id: 'old', directory: workspace, at: 1_000, messages: [{ role: 'user' }, assistant(9_000, 2_000), assistant(500, 15_000)] },
    { id: 'new', directory: path.join(workspace, 'pkg'), version: '1.15.0', at: 5_000, messages: [assistant(0), assistant(20_000), assistant(100, 1_000, { summary: true }), assistant(4_000)] },
    { id: 'child', parent: 'new', directory: workspace, at: 6_000, messages: [assistant(70_000)] },
    { id: 'elsewhere', directory: path.join(home, 'other'), at: 7_000, messages: [assistant(1)] },
  ]);

  const baseline = startupBaselines({ home, workspace }).opencode;
  const history = sessionHistory({ home, workspace, now: 10_000 }).opencode;

  assert.equal(baseline.sessions, 2);
  assert.deepEqual([baseline.lowest, baseline.latest.id, baseline.latest.version], [11_000, 'new', '1.15.0']);
  assert.equal(history.current.id, 'new');
  // The summary request is the compaction itself, so the next one is flagged.
  assert.deepEqual(history.current.samples.map((sample) => [sample.value, sample.compactedBefore]), [[20_000, false], [4_000, true]]);
});

test('the audit shows OpenCode with its observed session start', () => {
  const { scanEnvironment } = require('../src/scanner');
  const { auditReport, formatAudit } = require('../src/audit');
  const { startupBaselines } = require('../src/session-history');
  const { home, workspace } = fixture();
  write(path.join(home, '.config/opencode/AGENTS.md'), 'g'.repeat(2_000));
  database(home, [{ id: 's', directory: workspace, at: 1, messages: [assistant(12_000)] }]);

  const snapshot = scanEnvironment({ home, workspace });
  const text = formatAudit(auditReport(snapshot, {}, null, startupBaselines({ home, workspace })));

  assert.match(text, /^OpenCode: 500 tokens/m);
  assert.match(text, /OpenCode 12,000 tokens/);
});

test('no OpenCode install means no OpenCode section', () => {
  const { scanEnvironment } = require('../src/scanner');
  const { home, workspace } = fixture();
  assert.equal(scanEnvironment({ home, workspace }).harnesses.opencode, undefined);
});

test('in the home directory, project and global skill folders are the same and count once', () => {
  const { home } = fixture();
  write(path.join(home, '.claude/skills/b/SKILL.md'), '---\nname: b\ndescription: bbbb\n---\n');
  write(path.join(home, '.agents/skills/c/SKILL.md'), '---\nname: c\ndescription: cccc\n---\n');
  const { skillGroups } = scanOpenCode(home, home);
  assert.equal(skillGroups.reduce((total, group) => total + group.skillCount, 0), 2);
});

test('telemetry skips a newest session that never got a response', () => {
  const { scanOpenCodeRuntime } = require('../src/opencode-scan');
  const { home, workspace } = fixture();
  database(home, [
    { id: 'worked', directory: workspace, at: 1_000, messages: [assistant(9_000)] },
    { id: 'aborted', directory: workspace, at: 5_000, messages: [assistant(0)] },
  ]);
  assert.equal(scanOpenCodeRuntime(home, workspace).sessionTelemetry.latestUsage.inputTokens, 9_000);
});
