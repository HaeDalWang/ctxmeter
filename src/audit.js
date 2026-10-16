// Turns an inventory snapshot into a ranked, actionable verdict.
//
// The scanner answers "what exists". This answers "what is it costing you at
// session start, and what could you remove". Anything that cannot be measured
// from local files is declared as unmeasured rather than estimated; MCP tool
// schemas, for one, are not readable from disk at all.

const { MEASURED_STATUS } = require('./mcp-cost');
const { startupTokens } = require('./tool-loading');

const HARNESS_LABELS = { claude: 'Claude Code', codex: 'Codex', kiro: 'Kiro' };

function bytesToTokens(bytes) {
  return Math.round((bytes || 0) / 4);
}

const SCOPE_LABELS = {
  global: 'global', project: 'project', ancestor: 'parent directories', local: 'local',
  import: 'imports', rule: 'rules', steering: 'workspace steering',
};
const INSTRUCTION_LABELS = { claude: 'Instructions and rules', codex: 'AGENTS.md instructions', kiro: 'Steering documents' };

function describeInstructionFiles(instructions, harnessId) {
  const counts = new Map();
  for (const file of instructions.files) counts.set(file.scope, (counts.get(file.scope) || 0) + 1);
  const single = { user: 'user CLAUDE.md', ...(harnessId === 'codex' ? { global: 'global AGENTS.md' } : {}) };
  const labels = { ...SCOPE_LABELS, ...(harnessId === 'kiro' ? { global: 'global steering' } : {}) };
  const parts = [...counts].map(([scope, count]) => single[scope] || `${labels[scope] || scope} ${count}`);
  const notes = [];
  if (instructions.onDemand) notes.push(`${instructions.onDemand} more load on demand`);
  if (instructions.truncated && harnessId === 'codex') notes.push('cut at project_doc_max_bytes');
  const count = instructions.files.length;
  return `${count} file${count === 1 ? '' : 's'}: ${parts.join(', ')}${notes.length ? `; ${notes.join('; ')}` : ''}`;
}

/// Files each agent loads at launch (src/instructions.js). Older snapshots
/// without that field fall back to the global files they recorded.
function instructionFinding(harnessId, harness) {
  if (harness.instructions) {
    const { tokens } = harness.instructions;
    return tokens
      ? { id: 'instructions', label: INSTRUCTION_LABELS[harnessId] || 'Instructions', tokens, detail: describeInstructionFiles(harness.instructions, harnessId) }
      : null;
  }
  if (harnessId === 'claude') {
    const tokens = (harness.alwaysOn?.claudeMd?.tokenEstimate || 0) + bytesToTokens(harness.alwaysOn?.ruleBytes);
    const ruleFiles = harness.alwaysOn?.ruleFiles || 0;
    return tokens
      ? { id: 'instructions', label: 'Global instructions and rules', tokens, detail: `CLAUDE.md + ${ruleFiles} rule file${ruleFiles === 1 ? '' : 's'}` }
      : null;
  }
  if (harnessId === 'codex') {
    const tokens = harness.alwaysOn?.agentsMd?.tokenEstimate || 0;
    return tokens ? { id: 'instructions', label: 'Global instructions', tokens, detail: 'AGENTS.md' } : null;
  }
  const tokens = harness.steering?.tokenEstimate || 0;
  const fileCount = harness.steering?.fileCount || 0;
  return tokens
    ? { id: 'instructions', label: 'Steering documents', tokens, detail: `${fileCount} steering file${fileCount === 1 ? '' : 's'}` }
    : null;
}

function skillFinding(harness) {
  const groups = (harness.skillGroups || []).filter((group) => group.metadataTokenEstimate);
  if (!groups.length) return null;
  const tokens = groups.reduce((total, group) => total + group.metadataTokenEstimate, 0);
  const skillCount = groups.reduce((total, group) => total + (group.skillCount || 0), 0);
  const largest = groups.reduce((worst, group) => (group.metadataTokenEstimate > worst.metadataTokenEstimate ? group : worst));
  return {
    id: 'skills',
    label: 'Skill metadata listed at startup',
    tokens,
    detail: `${skillCount} skills; largest group ${largest.id} at ${largest.metadataTokenEstimate.toLocaleString()} tokens`,
  };
}

/// A cached `mcp-scan` turns an unmeasured cost into a real number.
/// Only schemas in the prompt at startup count; deferred ones are reported apart.
function mcpFinding(harnessId, mcpCost) {
  const measured = (mcpCost?.servers || [])
    .filter((server) => server.harness === harnessId && server.status === MEASURED_STATUS && startupTokens(server) > 0);
  if (!measured.length) return null;
  const tokens = measured.reduce((total, server) => total + startupTokens(server), 0);
  const toolCount = measured.reduce((total, server) => total + (server.toolCount || 0), 0);
  const largest = measured.reduce((worst, server) => (server.estimatedTokens > worst.estimatedTokens ? server : worst));
  return {
    id: 'mcp',
    label: 'MCP tool schemas',
    tokens,
    detail: `${toolCount} tools across ${measured.length} server${measured.length === 1 ? '' : 's'}; largest ${largest.name} at ${largest.estimatedTokens.toLocaleString('en-US')} tokens`,
  };
}

/// Measured schemas the agent holds back until the model searches for a tool.
function deferredMcp(harnessId, mcpCost) {
  const servers = (mcpCost?.servers || []).filter((server) => server.harness === harnessId
    && server.status === MEASURED_STATUS && server.loading?.mode === 'deferred' && Number.isFinite(server.estimatedTokens));
  if (!servers.length) return null;
  return {
    tokens: servers.reduce((total, server) => total + server.estimatedTokens, 0),
    servers: servers.length,
    tools: servers.reduce((total, server) => total + (server.toolCount || 0), 0),
  };
}

/// Hook output exists only in the live prompt. MCP servers are unmeasured only
/// until `mcp-scan` runs; servers it could not reach stay unmeasured.
function unmeasuredItems(harnessId, harness, mcpCost) {
  const items = [];
  const measuredNames = new Set((mcpCost?.servers || [])
    .filter((server) => server.harness === harnessId && server.status === MEASURED_STATUS)
    .map((server) => server.name));
  const mcpCount = Math.max((harness.configuredMcpServerCount || 0) - measuredNames.size, 0);
  if (mcpCount) {
    items.push({
      id: 'mcp',
      label: `${mcpCount} MCP server${mcpCount === 1 ? '' : 's'}`,
      count: mcpCount,
      tokens: null,
      reason: measuredNames.size
        ? 'not reachable during the last mcp-scan'
        : 'tool schemas are injected at runtime; run mcp-scan to measure them',
    });
  }
  const hookCount = harness.hookCount || 0;
  if (hookCount) {
    items.push({
      id: 'hooks',
      label: `${hookCount} hook${hookCount === 1 ? '' : 's'}`,
      count: hookCount,
      tokens: null,
      reason: 'hook output size depends on what they emit at runtime',
    });
  }
  return items;
}

function auditHarness(harnessId, harness, profiles, mcpCost, observedStart = null, sentPrompt = null) {
  const findings = [instructionFinding(harnessId, harness), skillFinding(harness), mcpFinding(harnessId, mcpCost)]
    .filter(Boolean)
    .sort((left, right) => right.tokens - left.tokens);
  const measuredStartupTokens = findings.reduce((total, finding) => total + finding.tokens, 0);
  const telemetry = harness.sessionTelemetry;
  const observedInputTokens = Number.isFinite(telemetry?.latestUsage?.inputTokens)
    ? telemetry.latestUsage.inputTokens
    : null;
  const model = telemetry?.currentModel || harness.modelCatalog?.selectedModel || null;
  const profile = (profiles.profiles || []).find((entry) => entry.harness === harnessId && entry.id === model);
  const contextWindowTokens = Number.isFinite(telemetry?.contextWindowTokens)
    ? telemetry.contextWindowTokens
    : Number.isFinite(profile?.contextWindowTokens) ? profile.contextWindowTokens : null;

  return {
    id: harnessId,
    label: HARNESS_LABELS[harnessId] || harnessId,
    model,
    contextWindowTokens,
    measuredStartupTokens,
    observedInputTokens,
    startupSharePercent: contextWindowTokens ? measuredStartupTokens / contextWindowTokens * 100 : null,
    findings,
    observedStart,
    sentPrompt,
    deferredMcp: deferredMcp(harnessId, mcpCost),
    unmeasured: unmeasuredItems(harnessId, harness, mcpCost),
  };
}

/// `prompts` holds what an agent logged it sent (Claude's api-request-shape).
function auditReport(snapshot, profiles = {}, rawMcpCost = null, baselines = {}, prompts = {}) {
  // A cache records the home it measured. Using one from a different home would
  // report another machine's servers as this one's cost.
  const mcpCost = rawMcpCost && rawMcpCost.home && rawMcpCost.home === snapshot.target?.home
    ? rawMcpCost
    : null;
  const harnesses = Object.entries(snapshot.harnesses || {})
    .map(([harnessId, harness]) => auditHarness(harnessId, harness, profiles, mcpCost, baselines?.[harnessId] || null, prompts?.[harnessId] || null))
    .filter((entry) => entry.measuredStartupTokens || entry.unmeasured.length || entry.observedInputTokens !== null || entry.deferredMcp || entry.observedStart)
    .sort((left, right) => right.measuredStartupTokens - left.measuredStartupTokens);

  return {
    generatedAt: snapshot.generatedAt || null,
    workspace: snapshot.target?.workspace || null,
    mcpMeasuredAt: mcpCost?.measuredAt || null,
    harnesses,
    totalMeasuredStartupTokens: harnesses.reduce((total, entry) => total + entry.measuredStartupTokens, 0),
  };
}

function integer(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function observedValue(start, short = false) {
  if (start.unit === 'percent') return `${start.lowest.toFixed(1)}% of ${short ? 'its' : 'the'} window`;
  return `${integer(start.lowest)} tokens`;
}

/// Sizes from the agent's own log of its last request; no text is read.
function sentPromptLine(sent) {
  const parts = [
    `system ${integer(sent.system.tokens)}`,
    `${sent.builtin.tools} built-in tools ${integer(sent.builtin.tokens)}`,
  ];
  const mcp = sent.mcp.reduce((total, entry) => total + entry.tokens, 0);
  if (mcp) parts.push(`MCP ${integer(mcp)}`);
  if (sent.deferredTokens) parts.push(`deferred list ${integer(sent.deferredTokens)}`);
  return `agent's own prompt: ${integer(sent.totalTokens)} tokens (${parts.join(' · ')}), from the last request`;
}

/// The observed start leads when session logs exist: it is what the agent
/// actually sent, not an estimate. The estimate then says how much is yours.
function headline(report) {
  const observed = report.harnesses.filter((harness) => harness.observedStart)
    // Token counts first, largest first; a percentage cannot be ranked against them.
    .sort((left, right) => (left.observedStart.unit === 'tokens' ? 0 : 1) - (right.observedStart.unit === 'tokens' ? 0 : 1)
      || right.observedStart.lowest - left.observedStart.lowest);
  if (!observed.length) return [`Your agent setup costs ${integer(report.totalMeasuredStartupTokens)} tokens before you type anything.`];
  const lines = [
    'Measured in your session logs, a new session starts at:',
    `  ${observed.map((harness) => `${harness.label} ${observedValue(harness.observedStart, true)}`).join(' · ')}`,
  ];
  const inTokens = observed.filter((harness) => harness.observedStart.unit === 'tokens');
  if (inTokens.length) {
    const yours = inTokens.reduce((total, harness) => total + harness.measuredStartupTokens, 0);
    const sent = inTokens.filter((harness) => harness.sentPrompt);
    if (!sent.length) {
      lines.push(`Your setup is ${integer(yours)} of those tokens; the rest is each agent's built-in prompt and tools.`);
      return lines;
    }
    const own = sent.map((harness) => `${harness.label}'s own prompt and tools measure ${integer(harness.sentPrompt.totalTokens)}`).join('; ');
    const unmeasuredAgents = inTokens.length > sent.length ? ', other agents\' built-in prompts,' : '';
    lines.push(`Your setup is ${integer(yours)} of those tokens; ${own}. The rest is your first message${unmeasuredAgents} and anything not measured.`);
  }
  return lines;
}

function formatAudit(report) {
  if (!report.harnesses.length) {
    return [
      'No local agent configuration found.',
      '',
      'Looked for Claude Code, Codex, and Kiro settings in your home directory.',
      'If you use one of those, run it once so it writes its configuration, then try again.',
    ].join('\n');
  }

  const lines = [...headline(report), ''];

  for (const harness of report.harnesses) {
    const share = harness.startupSharePercent === null
      ? ''
      : ` — ${harness.startupSharePercent.toFixed(1)}% of ${integer(harness.contextWindowTokens)}`;
    lines.push(`${harness.label}: ${integer(harness.measuredStartupTokens)} tokens${share}`);
    for (const finding of harness.findings) {
      lines.push(`  ${integer(finding.tokens).padStart(9)}  ${finding.label}`);
      lines.push(`             ${finding.detail}`);
    }
    if (harness.deferredMcp) {
      const { tokens, servers, tools } = harness.deferredMcp;
      lines.push(`  ${integer(tokens)} tokens of MCP schemas (${servers} server${servers === 1 ? '' : 's'}, ${tools} tools) load only on use`);
    }
    if (harness.sentPrompt) lines.push(`  ${sentPromptLine(harness.sentPrompt)}`);
    if (harness.observedStart) {
      const { sessions } = harness.observedStart;
      lines.push(`  session start: ${observedValue(harness.observedStart)} observed (lowest of ${sessions} session${sessions === 1 ? '' : 's'}, incl. first message)`);
    }
    if (harness.unmeasured.length) {
      const names = harness.unmeasured.map((item) => item.label).join(', ');
      lines.push(`  not measured: ${names}`);
    }
    lines.push('');
  }

  lines.push('Static figures are file bytes divided by four, not a tokenizer count.');
  if (report.mcpMeasuredAt) {
    lines.push(`MCP schemas measured ${report.mcpMeasuredAt} by starting each server; rerun mcp-scan to refresh.`);
  } else if (report.harnesses.some((harness) => harness.unmeasured.some((item) => item.id === 'mcp'))) {
    lines.push(
      'MCP tool schemas are not included above: they exist only in the live prompt.',
      'Most agents now load them on use; to measure what yours load:',
      '  ctxmeter mcp-scan --dry-run      # see what would be started',
      '  ctxmeter mcp-scan --i-understand-this-launches-servers',
    );
  }
  return lines.join('\n');
}

module.exports = { auditReport, formatAudit, instructionFinding, unmeasuredItems };
