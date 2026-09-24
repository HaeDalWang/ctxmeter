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
  assert.match(result.stdout, /nothing leaves this machine/);
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

test('usage documents the dashboard so installed users can find it', () => {
  // Arrange & Act
  const result = runCli(['--help']);

  // Assert
  assert.match(result.stdout, /dashboard/);
});

test('dashboard is reachable as a subcommand rather than only an npm script', async () => {
  // Arrange & Act
  const options = parseArgs(['dashboard', '--port', '0']);

  // Assert
  assert.equal(options.command, 'dashboard');
  assert.equal(options.port, '0');
});

test('dashboard starts on an ephemeral port and reports its address', async () => {
  // Arrange & Act
  const result = await run(['dashboard', '--port', '0']);

  // Assert
  try {
    assert.match(result.summary, /http:\/\/127\.0\.0\.1:\d+/);
    assert.ok(result.server, 'dashboard run should hand back the server for shutdown');
  } finally {
    await new Promise((resolve) => result.server.close(resolve));
  }
});
