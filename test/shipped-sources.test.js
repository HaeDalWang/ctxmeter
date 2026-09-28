const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const SHIPPED_DIRECTORIES = ['src'];

function shippedScripts() {
  return SHIPPED_DIRECTORIES.flatMap((directory) => fs
    .readdirSync(path.join(ROOT, directory))
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(directory, name)));
}

// A file no test imports can ship with a syntax error unnoticed, which is how the
// old browser dashboard broke. This parses every file the package publishes.
test('every shipped script parses', () => {
  // Arrange
  const scripts = shippedScripts();
  assert.ok(scripts.length >= 5, `expected to find shipped scripts, found ${scripts.length}`);

  // Act
  const broken = scripts
    .map((relative) => ({ relative, result: spawnSync(process.execPath, ['--check', path.join(ROOT, relative)], { encoding: 'utf8' }) }))
    .filter(({ result }) => result.status !== 0);

  // Assert
  assert.deepEqual(broken.map(({ relative, result }) => `${relative}: ${result.stderr.match(/^\w*Error.*$/m)?.[0] || 'failed'}`), []);
});
