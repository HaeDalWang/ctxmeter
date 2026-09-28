const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { claudeMcpServers } = require('../src/claude-mcp');

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-claude-mcp-'));
  const workspace = path.join(home, 'project');
  fs.mkdirSync(workspace);
  return { home, workspace };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function names(servers) {
  return servers.map((server) => server.name).sort();
}

test('reads user scope from the top of ~/.claude.json', () => {
  // Arrange
  const { home, workspace } = fixture();
  writeJson(path.join(home, '.claude.json'), { mcpServers: { docs: { command: 'node' } } });

  // Act
  const servers = claudeMcpServers(home, workspace);

  // Assert
  assert.deepEqual(servers, [{ name: 'docs', scope: 'user', config: { command: 'node' } }]);
});

test('reads local scope only for the current workspace', () => {
  // Arrange
  const { home, workspace } = fixture();
  writeJson(path.join(home, '.claude.json'), { projects: {
    [workspace]: { mcpServers: { mine: { command: 'a' } } },
    '/somewhere/else': { mcpServers: { theirs: { command: 'b' } } },
  } });

  // Act + Assert
  assert.deepEqual(claudeMcpServers(home, workspace).map((server) => [server.name, server.scope]), [['mine', 'local']]);
});

test('ignores ~/.claude/mcp.json, which Claude Code does not read', () => {
  // Arrange
  const { home, workspace } = fixture();
  writeJson(path.join(home, '.claude', 'mcp.json'), { mcpServers: { ghost: { command: 'a' } } });

  // Act + Assert
  assert.deepEqual(claudeMcpServers(home, workspace), []);
});

test('a server switched off for this project with /mcp is excluded', () => {
  // Arrange
  const { home, workspace } = fixture();
  writeJson(path.join(home, '.claude.json'), {
    mcpServers: { off: { command: 'a' }, on: { command: 'b' } },
    projects: { [workspace]: { disabledMcpServers: ['off'] } },
  });

  // Act + Assert
  assert.deepEqual(names(claudeMcpServers(home, workspace)), ['on']);
});

test('project .mcp.json servers count only once approved', () => {
  // Arrange
  const { home, workspace } = fixture();
  writeJson(path.join(workspace, '.mcp.json'), { mcpServers: { approved: { command: 'a' }, pending: { command: 'b' }, rejected: { command: 'c' } } });
  writeJson(path.join(home, '.claude.json'), { projects: { [workspace]: {
    enabledMcpjsonServers: ['approved', 'rejected'],
    disabledMcpjsonServers: ['rejected'],
  } } });

  // Act + Assert
  assert.deepEqual(claudeMcpServers(home, workspace).map((server) => [server.name, server.scope]), [['approved', 'project']]);
});

test('enableAllProjectMcpServers approves every project server', () => {
  // Arrange
  const { home, workspace } = fixture();
  writeJson(path.join(workspace, '.mcp.json'), { mcpServers: { a: { command: 'a' }, b: { command: 'b' } } });
  writeJson(path.join(workspace, '.claude', 'settings.local.json'), { enableAllProjectMcpServers: true });

  // Act + Assert
  assert.deepEqual(names(claudeMcpServers(home, workspace)), ['a', 'b']);
});

test('an approval committed to the repo counts only after the workspace is trusted', () => {
  // Arrange
  const { home, workspace } = fixture();
  writeJson(path.join(workspace, '.mcp.json'), { mcpServers: { a: { command: 'a' } } });
  writeJson(path.join(workspace, '.claude', 'settings.json'), { enabledMcpjsonServers: ['a'] });
  const state = path.join(home, '.claude.json');

  // Act
  writeJson(state, { projects: { [workspace]: { hasTrustDialogAccepted: false } } });
  const untrusted = claudeMcpServers(home, workspace);
  writeJson(state, { projects: { [workspace]: { hasTrustDialogAccepted: true } } });
  const trusted = claudeMcpServers(home, workspace);

  // Assert
  assert.deepEqual(names(untrusted), []);
  assert.deepEqual(names(trusted), ['a']);
});

test('the same name in several scopes loads once, from the highest scope', () => {
  // Arrange: precedence is local, then project, then user.
  const { home, workspace } = fixture();
  writeJson(path.join(workspace, '.mcp.json'), { mcpServers: { dup: { command: 'project' } } });
  writeJson(path.join(home, '.claude.json'), {
    mcpServers: { dup: { command: 'user' } },
    projects: { [workspace]: { enabledMcpjsonServers: ['dup'], mcpServers: { dup: { command: 'local' } } } },
  });

  // Act
  const servers = claudeMcpServers(home, workspace);

  // Assert
  assert.deepEqual(servers, [{ name: 'dup', scope: 'local', config: { command: 'local' } }]);
});

test('an unreadable or malformed ~/.claude.json yields no servers rather than throwing', () => {
  // Arrange
  const { home, workspace } = fixture();
  fs.writeFileSync(path.join(home, '.claude.json'), '{ not json');

  // Act + Assert
  assert.deepEqual(claudeMcpServers(home, workspace), []);
});
