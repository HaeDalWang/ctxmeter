const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { parseArgs, run } = require('../src/cli');
const packageManifest = require('../package.json');

const CLI = path.join(__dirname, '..', 'src', 'cli.js');

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

test('parses every documented way of asking for help', () => {
  // Arrange
  const spellings = [['--help'], ['-h'], ['help']];

  // Act
  const parsed = spellings.map((argv) => parseArgs(argv));

  // Assert
  for (const options of parsed) assert.equal(options.command, 'help');
});

test('parses every documented way of asking for the version', () => {
  // Arrange
  const spellings = [['--version'], ['-v'], ['version']];

  // Act
  const parsed = spellings.map((argv) => parseArgs(argv));

  // Assert
  for (const options of parsed) assert.equal(options.command, 'version');
});

test('help wins over a command so a confused user always gets instructions', () => {
  // Arrange & Act
  const options = parseArgs(['mcp-scan', '--help']);

  // Assert
  assert.equal(options.command, 'help');
});

test('prints usage on stdout and exits zero when help is requested', () => {
  // Arrange & Act
  const result = runCli(['--help']);

  // Assert
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Usage: ctxmeter/);
  assert.match(result.stdout, /mcp-scan/);
  assert.match(result.stdout, /Nothing leaves this machine/);
});

test('reports the published version so bug reports can name a build', () => {
  // Arrange & Act
  const result = runCli(['--version']);

  // Assert
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), packageManifest.version);
});

test('an unknown command still fails loudly on stderr', () => {
  // Arrange & Act
  const result = runCli(['nonsense']);

  // Assert
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Unknown command: nonsense/);
  assert.match(result.stderr, /Usage: ctxmeter/);
});

test('an unknown option names the option it rejected', () => {
  // Arrange & Act
  const result = runCli(['audit', '--nope']);

  // Assert
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown option: --nope/);
});

test('fix is a known command and parses its apply target', () => {
  // Arrange & Act
  const dry = parseArgs(['fix']);
  const apply = parseArgs(['fix', '--apply', 'codex/obsidian']);

  // Assert
  assert.equal(dry.command, 'fix');
  assert.equal(dry.apply, undefined);
  assert.equal(apply.apply, 'codex/obsidian');
});

test('fix without --apply changes nothing and says so', () => {
  // Arrange
  const home = path.join(__dirname, 'fixtures-empty-home');

  // Act
  const result = runCli(['fix', '--home', home]);

  // Assert
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Nothing has been changed|Nothing here can be switched off/);
});

test('--apply with no target lists the targets instead of guessing one', () => {
  // Arrange & Act
  const result = runCli(['fix', '--apply']);

  // Assert
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing value for --apply/);
});

test('--apply with an unknown target names what is available', () => {
  // Arrange & Act
  const result = runCli(['fix', '--apply', 'nope/not-a-thing']);

  // Assert
  assert.equal(result.status, 1);
  assert.match(result.stderr, /nope\/not-a-thing/);
});

test('usage documents fix and warns that it writes', () => {
  // Arrange & Act
  const result = runCli(['--help']);

  // Assert
  assert.match(result.stdout, /fix/);
  assert.match(result.stdout, /only command that writes|writes to your config/i);
});


test('history prints per-harness session history as JSON', () => {
  // Arrange
  const home = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'ctx-cli-history-'));

  // Act
  const result = runCli(['history', '--home', home, '--workspace', home]);

  // Assert
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.days, 7);
  assert.deepEqual(Object.keys(report.harnesses).sort(), ['claude', 'codex', 'kiro']);
  assert.equal(report.target.workspace, home);
});


function switchFixture() {
  const fs = require('node:fs');
  const home = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ctx-cli-switch-'));
  fs.mkdirSync(path.join(home, '.codex'));
  const config = path.join(home, '.codex', 'config.toml');
  fs.writeFileSync(config, '[mcp_servers.parked]\ncommand = "b"\nenabled = false\n');
  return { home, config, fs };
}

test('fix --json lists every switch, including ones that are off', () => {
  // Arrange
  const { home } = switchFixture();

  // Act
  const result = runCli(['fix', '--json', '--home', home, '--workspace', home]);

  // Assert
  assert.equal(result.status, 0, result.stderr);
  const [item] = JSON.parse(result.stdout).switches;
  assert.equal(item.target, 'codex/parked');
  assert.equal(item.enabled, false);
});

test('fix --enable turns a switch back on, backs up, and reports the undo as JSON', () => {
  // Arrange
  const { home, config, fs } = switchFixture();

  // Act
  const result = runCli(['fix', '--enable', 'codex/parked', '--json', '--home', home, '--workspace', home]);

  // Assert
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.enabled, true);
  assert.match(fs.readFileSync(config, 'utf8'), /enabled = true/);
  assert.ok(fs.existsSync(report.backup));
  assert.match(report.rollback, /^cp /);
});

test('enabling a switch that is already on is refused', () => {
  // Arrange
  const { home } = switchFixture();
  runCli(['fix', '--enable', 'codex/parked', '--home', home, '--workspace', home]);

  // Act
  const result = runCli(['fix', '--enable', 'codex/parked', '--home', home, '--workspace', home]);

  // Assert
  assert.equal(result.status, 1);
  assert.match(result.stderr, /already switched on/);
});

test('fix refuses --enable and --disable together', () => {
  // Arrange & Act
  const result = runCli(['fix', '--enable', 'a/b', '--disable', 'a/b']);

  // Assert
  assert.equal(result.status, 1);
  assert.match(result.stderr, /one of/);
});

test('details prints composition and switches per harness as JSON', () => {
  // Arrange
  const fs = require('node:fs');
  const home = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ctx-cli-details-'));
  fs.mkdirSync(path.join(home, '.codex'));
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), '[mcp_servers.x]\ncommand = "a"\n');

  // Act
  const result = runCli(['details', '--home', home, '--workspace', home]);

  // Assert
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(report.harnesses).sort(), ['claude', 'codex', 'kiro']);
  assert.equal(report.harnesses.codex.items.find((item) => item.id === 'mcp:x').switch.target, 'codex/x');
});
