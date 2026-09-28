'use strict';

// Which MCP servers Claude Code will actually load for one workspace.
//
// Locations and rules follow https://code.claude.com/docs/en/mcp:
//   user scope     ~/.claude.json  mcpServers
//   local scope    ~/.claude.json  projects[<workspace>].mcpServers
//   project scope  <workspace>/.mcp.json, loaded only once approved
// A per-project /mcp toggle writes projects[<workspace>].disabledMcpServers.
// When a name appears in several scopes, local wins over project over user.
//
// ~/.claude/mcp.json is deliberately not read: Claude Code does not load it, and
// counting it reported servers that never reach the prompt.

const fs = require('node:fs');
const path = require('node:path');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function list(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function serverMap(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/// Approval of project servers can come from ~/.claude.json or from settings.
/// An approval committed to the repo's .claude/settings.json only counts once the
/// workspace is trusted, so a cloned repository cannot approve its own servers.
function projectApproval(home, workspace, project) {
  const settings = [
    path.join(home, '.claude', 'settings.json'),
    path.join(workspace, '.claude', 'settings.local.json'),
    ...(project.hasTrustDialogAccepted === true ? [path.join(workspace, '.claude', 'settings.json')] : []),
  ].map(readJson).filter(Boolean);
  const approveAll = settings.some((entry) => entry.enableAllProjectMcpServers === true);
  const approved = new Set([...list(project.enabledMcpjsonServers), ...settings.flatMap((entry) => list(entry.enabledMcpjsonServers))]);
  const rejected = new Set([...list(project.disabledMcpjsonServers), ...settings.flatMap((entry) => list(entry.disabledMcpjsonServers))]);
  return (name) => !rejected.has(name) && (approveAll || approved.has(name));
}

function claudeMcpServers(home, workspace) {
  const root = path.resolve(workspace);
  const state = readJson(path.join(home, '.claude.json')) || {};
  const project = serverMap(serverMap(state.projects)[root]);
  const isApproved = projectApproval(home, root, project);
  const switchedOff = new Set(list(project.disabledMcpServers));

  // Lowest precedence first, so a higher scope replaces the entry.
  const scopes = [
    ['user', Object.entries(serverMap(state.mcpServers))],
    ['project', Object.entries(serverMap(readJson(path.join(root, '.mcp.json'))?.mcpServers)).filter(([name]) => isApproved(name))],
    ['local', Object.entries(serverMap(project.mcpServers))],
  ];
  const byName = new Map();
  for (const [scope, entries] of scopes) {
    for (const [name, config] of entries) {
      if (config && typeof config === 'object') byName.set(name, { name, scope, config });
    }
  }
  return [...byName.values()].filter((server) => !switchedOff.has(server.name));
}

module.exports = { claudeMcpServers };
