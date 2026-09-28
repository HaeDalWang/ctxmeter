const assert = require('node:assert/strict');
const test = require('node:test');

const { setJsonPluginEnabled, setJsonServerDisabled, setTomlSectionKey } = require('../src/config-edit');

const TOML = [
  '# top of file',
  'model = "gpt-5"',
  '',
  '[plugins."github@openai-curated"]',
  'enabled = true',
  '',
  '[mcp_servers.obsidian]',
  'command = "npx"',
  'enabled = false',
  '',
  '[mcp_servers.obsidian.env]',
  'API_KEY = "secret"',
  '',
  '[mcp_servers.live]',
  'command = "uvx"',
  'args = ["thing", "serve"]',
  '',
  '[projects."/some/path"]',
  'trust_level = "trusted"',
  '',
].join('\n');

test('inserts the key directly after a section header that lacks it', () => {
  // Arrange & Act
  const result = setTomlSectionKey(TOML, 'mcp_servers.live', 'enabled', 'false');

  // Assert
  const lines = result.content.split('\n');
  const header = lines.indexOf('[mcp_servers.live]');
  assert.equal(lines[header + 1], 'enabled = false');
  assert.equal(result.changed, true);
});

test('replaces the key in place when the section already declares it', () => {
  // Arrange & Act
  const result = setTomlSectionKey(TOML, 'plugins."github@openai-curated"', 'enabled', 'false');

  // Assert
  const lines = result.content.split('\n');
  const header = lines.indexOf('[plugins."github@openai-curated"]');
  assert.equal(lines[header + 1], 'enabled = false');
  assert.equal(result.content.split('\n').length, TOML.split('\n').length, 'replacing must not add a line');
});

test('leaves every other byte of the file untouched', () => {
  // Arrange & Act
  const result = setTomlSectionKey(TOML, 'mcp_servers.live', 'enabled', 'false');

  // Assert
  const removed = result.content.split('\n').filter((line) => line !== 'enabled = false');
  const original = TOML.split('\n').filter((line) => line !== 'enabled = false');
  assert.deepEqual(removed, original);
});

test('never reaches into a sub-section when editing its parent', () => {
  // Arrange & Act
  const result = setTomlSectionKey(TOML, 'mcp_servers.obsidian', 'enabled', 'true');

  // Assert
  const lines = result.content.split('\n');
  assert.equal(lines[lines.indexOf('[mcp_servers.obsidian]') + 2], 'enabled = true');
  assert.equal(lines[lines.indexOf('[mcp_servers.obsidian.env]') + 1], 'API_KEY = "secret"');
});

test('reports no change when the key already holds the wanted value', () => {
  // Arrange & Act
  const result = setTomlSectionKey(TOML, 'mcp_servers.obsidian', 'enabled', 'false');

  // Assert
  assert.equal(result.changed, false);
  assert.equal(result.content, TOML);
});

test('refuses a section that does not exist rather than appending one', () => {
  // Arrange & Act & Assert
  assert.throws(
    () => setTomlSectionKey(TOML, 'mcp_servers.absent', 'enabled', 'false'),
    /mcp_servers\.absent/,
  );
});

test('refuses a section that appears more than once', () => {
  // Arrange
  const duplicated = `${TOML}\n[mcp_servers.live]\ncommand = "other"\n`;

  // Act & Assert
  assert.throws(() => setTomlSectionKey(duplicated, 'mcp_servers.live', 'enabled', 'false'), /twice|more than once/i);
});

test('sets the disabled flag on one JSON server without touching its siblings', () => {
  // Arrange
  const content = `${JSON.stringify({
    mcpServers: {
      keep: { command: 'node', args: ['a'] },
      target: { command: 'uvx', env: { KEY: 'value' } },
    },
  }, null, 2)}\n`;

  // Act
  const result = setJsonServerDisabled(content, 'target', true);
  const parsed = JSON.parse(result.content);

  // Assert
  assert.equal(parsed.mcpServers.target.disabled, true);
  assert.deepEqual(parsed.mcpServers.keep, { command: 'node', args: ['a'] });
  assert.equal(parsed.mcpServers.target.env.KEY, 'value', 'credentials in the file must survive untouched');
  assert.equal(result.changed, true);
});

test('keeps server order and the trailing newline', () => {
  // Arrange
  const content = `${JSON.stringify({ mcpServers: { one: {}, two: {}, three: {} } }, null, 2)}\n`;

  // Act
  const result = setJsonServerDisabled(content, 'two', true);

  // Assert
  assert.deepEqual(Object.keys(JSON.parse(result.content).mcpServers), ['one', 'two', 'three']);
  assert.ok(result.content.endsWith('\n'));
});

test('reports no change when the JSON server is already disabled', () => {
  // Arrange
  const content = `${JSON.stringify({ mcpServers: { off: { disabled: true } } }, null, 2)}\n`;

  // Act
  const result = setJsonServerDisabled(content, 'off', true);

  // Assert
  assert.equal(result.changed, false);
  assert.equal(result.content, content);
});

test('refuses a file it cannot parse rather than repairing it', () => {
  // Arrange
  const withComment = '{\n  // a comment makes this JSONC\n  "mcpServers": { "a": {} }\n}\n';

  // Act & Assert
  assert.throws(() => setJsonServerDisabled(withComment, 'a', true), /could not be parsed|not valid JSON/i);
});

test('refuses a server the file does not declare', () => {
  // Arrange
  const content = `${JSON.stringify({ mcpServers: { a: {} } }, null, 2)}\n`;

  // Act & Assert
  assert.throws(() => setJsonServerDisabled(content, 'absent', true), /absent/);
});


test('sets one Claude plugin in enabledPlugins and leaves every other key alone', () => {
  // Arrange
  const content = `${JSON.stringify({ model: 'opus', enabledPlugins: { 'a@m': true, 'b@m': true }, hooks: {} }, null, 2)}\n`;

  // Act
  const result = setJsonPluginEnabled(content, 'a@m', false);

  // Assert
  assert.equal(result.changed, true);
  assert.deepEqual(JSON.parse(result.content), { model: 'opus', enabledPlugins: { 'a@m': false, 'b@m': true }, hooks: {} });
  assert.ok(result.content.endsWith('\n'));
});

test('refuses a plugin that enabledPlugins does not list rather than inventing one', () => {
  // Arrange
  const content = JSON.stringify({ enabledPlugins: { 'a@m': true } });

  // Act + Assert
  assert.throws(() => setJsonPluginEnabled(content, 'ghost@m', false), /not listed/);
});

test('reports no change when the plugin already has the wanted value', () => {
  // Arrange
  const content = JSON.stringify({ enabledPlugins: { 'a@m': false } });

  // Act + Assert
  assert.equal(setJsonPluginEnabled(content, 'a@m', false).changed, false);
});

test('a nested array line inside a value is not mistaken for a section header', () => {
  // Arrange: `["a", "b"],` starts with a bracket but belongs to `args`.
  const content = [
    '[mcp_servers.x]',
    'args = [',
    '  ["a", "b"],',
    ']',
    'enabled = true',
    '',
  ].join('\n');

  // Act
  const result = setTomlSectionKey(content, 'mcp_servers.x', 'enabled', 'false');

  // Assert: the existing key is replaced, not duplicated above it.
  assert.equal(result.action, 'replaced');
  assert.equal(result.content.match(/enabled =/g).length, 1);
});

test('a bracketed line inside a multi-line string is not mistaken for a section header', () => {
  // Arrange
  const content = [
    '[mcp_servers.x]',
    'description = """',
    '[not a section]',
    '"""',
    'enabled = true',
    '',
  ].join('\n');

  // Act
  const result = setTomlSectionKey(content, 'mcp_servers.x', 'enabled', 'false');

  // Assert
  assert.equal(result.action, 'replaced');
  assert.equal(result.content.match(/enabled =/g).length, 1);
});
