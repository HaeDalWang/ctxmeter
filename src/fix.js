'use strict';

// Turns audit findings into config edits the user can accept one at a time.
//
// Scope and safety rules live in develop/decisions/05-fix-mutation-model.md. The
// short version: only items that are currently on and carry a measured token count
// are offered, every change is one key, a backup goes next to the original, and the
// rollback is printed rather than stored.

const fs = require('node:fs');
const path = require('node:path');
const { setJsonServerDisabled, setTomlSectionKey } = require('./config-edit');
const { MEASURED_STATUS } = require('./mcp-cost');

const JSON_LOCATIONS = {
  claude: ['.claude', 'mcp.json'],
  kiro: ['.kiro', 'settings', 'mcp.json'],
};

function integer(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function mcpProposal(home, server) {
  // An unmeasured server has no saving to promise, so it is not offered.
  if (server.status !== MEASURED_STATUS || !Number.isFinite(server.estimatedTokens)) return null;
  const detail = Number.isFinite(server.toolCount) ? `${server.toolCount} tool${server.toolCount === 1 ? '' : 's'}` : null;
  const base = {
    target: `${server.harness}/${server.name}`,
    harness: server.harness,
    kind: 'mcp-server',
    name: server.name,
    tokens: server.estimatedTokens,
    detail,
  };

  if (server.harness === 'codex') {
    return { ...base, file: path.join(home, '.codex', 'config.toml'), format: 'toml', section: `mcp_servers.${server.name}` };
  }
  const location = JSON_LOCATIONS[server.harness];
  if (!location) return null;
  return { ...base, file: path.join(home, ...location), format: 'json' };
}

/// Codex plugin groups are the only skill groups with a vendor-supported off
/// switch. A group the user assembled themselves is content, not configuration.
function pluginProposals(home, codex) {
  const enabled = new Set(codex?.enabledPlugins || []);
  return (codex?.skillGroups || [])
    .filter((group) => enabled.has(group.id) && Number.isFinite(group.metadataTokenEstimate) && group.metadataTokenEstimate > 0)
    .map((group) => ({
      target: `codex/plugin:${group.id}`,
      harness: 'codex',
      kind: 'plugin-group',
      name: group.id,
      tokens: group.metadataTokenEstimate,
      detail: Number.isFinite(group.skillCount) ? `${group.skillCount} skill${group.skillCount === 1 ? '' : 's'}` : null,
      file: path.join(home, '.codex', 'config.toml'),
      format: 'toml',
      section: `plugins."${group.id}"`,
    }));
}

function fixProposals({ home, snapshot, mcpCost }) {
  // The same guard the audit uses: a cache from another home describes another
  // machine's servers.
  const trusted = mcpCost && mcpCost.home && mcpCost.home === snapshot?.target?.home ? mcpCost : null;
  const servers = (trusted?.servers || [])
    .map((server) => mcpProposal(home, server))
    .filter(Boolean);

  return [...servers, ...pluginProposals(home, snapshot?.harnesses?.codex)]
    .filter((proposal) => fs.existsSync(proposal.file))
    .sort((left, right) => right.tokens - left.tokens);
}

/// Computes the edit without touching the file, so the caller can show it first.
function planProposal(proposal) {
  const before = fs.readFileSync(proposal.file, 'utf8');
  const result = proposal.format === 'toml'
    ? setTomlSectionKey(before, proposal.section, 'enabled', 'false')
    : setJsonServerDisabled(before, proposal.name, true);

  return {
    proposal,
    file: proposal.file,
    before,
    after: result.content,
    changed: result.changed,
    line: result.line ?? null,
    change: proposal.format === 'toml' ? `enabled = false under [${proposal.section}]` : `"disabled": true on "${proposal.name}"`,
  };
}

function backupPath(file, now) {
  const stamp = now.toISOString().replaceAll(':', '-').replaceAll('.', '-');
  return path.join(path.dirname(file), `${path.basename(file)}.ctxmeter-${stamp}.bak`);
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function applyPlan(plan, now = new Date()) {
  if (!plan.changed) throw new Error(`${plan.proposal.target} is already switched off; nothing to do`);
  const backup = backupPath(plan.file, now);
  fs.copyFileSync(plan.file, backup);
  fs.writeFileSync(plan.file, plan.after);
  return {
    target: plan.proposal.target,
    file: plan.file,
    backup,
    tokens: plan.proposal.tokens,
    rollback: `cp ${shellQuote(backup)} ${shellQuote(plan.file)}`,
  };
}

function formatProposals(proposals) {
  if (!proposals.length) {
    return [
      'Nothing here can be switched off from a config file.',
      '',
      'MCP servers are usually the largest removable cost, and measuring them needs:',
      '  ctxmeter mcp-scan --i-understand-this-launches-servers',
      '',
      'Instructions, rules, and steering documents are your own writing, so ctxmeter',
      'reports their cost but will not touch them.',
    ].join('\n');
  }

  const total = proposals.reduce((sum, proposal) => sum + proposal.tokens, 0);
  const lines = [
    `${integer(total)} tokens sit behind ${proposals.length} switch${proposals.length === 1 ? '' : 'es'} you can flip.`,
    '',
  ];

  for (const proposal of proposals) {
    const detail = proposal.detail ? `, ${proposal.detail}` : '';
    lines.push(`  ${integer(proposal.tokens).padStart(8)}  ${proposal.target}${detail}`);
    lines.push(`            ${proposal.format === 'toml' ? `[${proposal.section}]` : `"${proposal.name}"`} in ${proposal.file}`);
  }

  lines.push('');
  lines.push('Nothing has been changed. To switch one off:');
  lines.push(`  ctxmeter fix --apply ${proposals[0].target}`);
  lines.push('');
  lines.push('A backup is written next to the file and the undo command is printed.');
  return lines.join('\n');
}

module.exports = { applyPlan, fixProposals, formatProposals, planProposal };
