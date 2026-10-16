'use strict';

// Turns audit findings into config edits the user can accept one at a time.
//
// Scope and safety rules live in develop/decisions/05-fix-mutation-model.md. The
// short version: only items that are currently on and carry a measured token count
// are offered, every change is one key, a backup goes next to the original, and the
// rollback is printed rather than stored.

const path = require('node:path');
const fs = require('node:fs');
const { listSwitches, planSwitch } = require('./switches');

function integer(value) {
  return Number(value || 0).toLocaleString('en-US');
}

/// Switches worth turning off: currently on, with a measured cost. An unmeasured
/// item has no saving to promise, so it is not offered here (the menu bar still
/// lists it).
function fixProposals({ home, snapshot, mcpCost }) {
  return listSwitches({ home, snapshot, mcpCost })
    .filter((item) => item.enabled && Number.isFinite(item.tokens) && item.tokens > 0)
    .sort((left, right) => right.tokens - left.tokens);
}

/// Computes the edit without touching the file, so the caller can show it first.
function planProposal(proposal, enabled = false) {
  return planSwitch(proposal, enabled);
}

function backupPath(file, now) {
  const stamp = now.toISOString().replaceAll(':', '-').replaceAll('.', '-');
  return path.join(path.dirname(file), `${path.basename(file)}.ctxmeter-${stamp}.bak`);
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/// Writes beside the target and renames over it, so a reader never sees half a
/// file. Keeps the original's mode: configs holding tokens are often 0600.
function replaceFile(file, content) {
  // Rename would replace a symlink with a plain file; write where it points.
  const target = fs.realpathSync(file);
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.ctxmeter-${process.pid}.tmp`);
  try {
    fs.writeFileSync(temp, content, { mode: fs.statSync(target).mode & 0o777 });
    fs.renameSync(temp, target);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

function applyPlan(plan, now = new Date()) {
  if (!plan.changed) throw new Error(`${plan.proposal.target} is already switched ${plan.enabled ? 'on' : 'off'}; nothing to do`);
  // The agent may rewrite its config while running. Writing a plan made from an
  // older read would silently drop that change, so refuse instead.
  const current = fs.readFileSync(plan.file, 'utf8');
  if (typeof plan.before === 'string' && current !== plan.before) {
    throw new Error(`${plan.file} changed since it was read; nothing was written. Run the command again.`);
  }
  const backup = backupPath(plan.file, now);
  fs.copyFileSync(plan.file, backup);
  replaceFile(plan.file, plan.after);
  return {
    target: plan.proposal.target,
    file: plan.file,
    backup,
    tokens: plan.proposal.tokens,
    enabled: plan.enabled,
    rollback: `cp ${shellQuote(backup)} ${shellQuote(plan.file)}`,
  };
}

function formatProposals(proposals) {
  if (!proposals.length) {
    return [
      'Nothing here can be switched off from a config file.',
      '',
      'MCP servers that load at startup can be offered once they are measured:',
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
    if (proposal.format === 'manual') {
      lines.push(`            ${proposal.instruction}`);
      continue;
    }
    lines.push(`            ${proposal.format === 'toml' ? `[${proposal.section}]` : `"${proposal.name}"`} in ${proposal.file}`);
  }

  const applicable = proposals.find((proposal) => proposal.format !== 'manual');
  lines.push('');
  if (!applicable) {
    lines.push('Nothing has been changed. These are switched off inside the agent itself.');
    return lines.join('\n');
  }
  lines.push('Nothing has been changed. To switch one off:');
  lines.push(`  ctxmeter fix --disable ${applicable.target}`);
  lines.push('');
  lines.push('A backup is written next to the file and the undo command is printed.');
  return lines.join('\n');
}

module.exports = { applyPlan, fixProposals, formatProposals, planProposal };
