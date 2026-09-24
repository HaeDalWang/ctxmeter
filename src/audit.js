// Turns an inventory snapshot into a ranked, actionable verdict.
//
// The scanner answers "what exists". This answers "what is it costing you at
// session start, and what could you remove". Anything that cannot be measured
// from local files is declared as unmeasured rather than estimated, because the
// loudest real cost — MCP tool schemas — is not readable from disk at all.

const HARNESS_LABELS = { claude: 'Claude Code', codex: 'Codex', kiro: 'Kiro' };

function bytesToTokens(bytes) {
  return Math.round((bytes || 0) / 4);
}

function instructionFinding(harnessId, harness) {
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

/// MCP schemas and hook output exist only in the live prompt, never on disk.
function unmeasuredItems(harness) {
  const items = [];
  const mcpCount = harness.configuredMcpServerCount || 0;
  if (mcpCount) {
    items.push({
      id: 'mcp',
      label: `${mcpCount} MCP server${mcpCount === 1 ? '' : 's'}`,
      count: mcpCount,
      tokens: null,
      reason: 'tool schemas are injected at runtime and are not written to any local file',
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

function auditHarness(harnessId, harness, profiles) {
  const findings = [instructionFinding(harnessId, harness), skillFinding(harness)]
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
    unmeasured: unmeasuredItems(harness),
  };
}

function auditReport(snapshot, profiles = {}) {
  const harnesses = Object.entries(snapshot.harnesses || {})
    .map(([harnessId, harness]) => auditHarness(harnessId, harness, profiles))
    .filter((entry) => entry.measuredStartupTokens || entry.unmeasured.length || entry.observedInputTokens !== null)
    .sort((left, right) => right.measuredStartupTokens - left.measuredStartupTokens);

  return {
    generatedAt: snapshot.generatedAt || null,
    workspace: snapshot.target?.workspace || null,
    harnesses,
    totalMeasuredStartupTokens: harnesses.reduce((total, entry) => total + entry.measuredStartupTokens, 0),
  };
}

function integer(value) {
  return Number(value || 0).toLocaleString('en-US');
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

  const lines = [
    `Your agent setup costs ${integer(report.totalMeasuredStartupTokens)} tokens before you type anything.`,
    '',
  ];

  for (const harness of report.harnesses) {
    const share = harness.startupSharePercent === null
      ? ''
      : ` — ${harness.startupSharePercent.toFixed(1)}% of ${integer(harness.contextWindowTokens)}`;
    lines.push(`${harness.label}: ${integer(harness.measuredStartupTokens)} tokens${share}`);
    for (const finding of harness.findings) {
      lines.push(`  ${integer(finding.tokens).padStart(9)}  ${finding.label}`);
      lines.push(`             ${finding.detail}`);
    }
    if (harness.observedInputTokens !== null) {
      lines.push(`  observed latest input: ${integer(harness.observedInputTokens)} tokens`);
    }
    if (harness.unmeasured.length) {
      const names = harness.unmeasured.map((item) => item.label).join(', ');
      lines.push(`  not measured: ${names}`);
    }
    lines.push('');
  }

  lines.push(
    'Static figures are file bytes divided by four, not a tokenizer count.',
    'MCP tool schemas are the largest reported cost in the wild and are deliberately',
    'not estimated here: they are injected at runtime and never written to disk.',
  );
  return lines.join('\n');
}

module.exports = { auditReport, formatAudit };
