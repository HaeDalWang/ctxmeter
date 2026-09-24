const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const SHIPPED_DIRECTORIES = ['src', 'public'];

function shippedScripts() {
  return SHIPPED_DIRECTORIES.flatMap((directory) => fs
    .readdirSync(path.join(ROOT, directory))
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(directory, name)));
}

// public/app.js is browser-only, so no unit test imports it and a syntax error
// there ships silently. This parses every file the package publishes.
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

test('the browser bundle is loadable in a DOM-free parse without top-level side effects', () => {
  // Arrange
  const file = path.join(ROOT, 'public', 'app.js');

  // Act
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });

  // Assert
  assert.equal(result.status, 0, result.stderr);
});
