const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const packageManifest = require('../package.json');

const INFO_PLIST = path.join(__dirname, '..', 'menubar', 'Info.plist');

function plistString(xml, key) {
  const match = xml.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
  return match ? match[1] : null;
}

// The menu bar app compares its own CFBundleShortVersionString with the latest
// release tag, so the two manifests must agree or it would announce the wrong thing.
test('the menu bar app and the CLI carry the same version', () => {
  const xml = fs.readFileSync(INFO_PLIST, 'utf8');
  assert.equal(plistString(xml, 'CFBundleShortVersionString'), packageManifest.version);
});

test('a release tag matches the version it ships', { skip: !process.env.RELEASE_TAG }, () => {
  assert.equal(process.env.RELEASE_TAG, `v${packageManifest.version}`);
});
