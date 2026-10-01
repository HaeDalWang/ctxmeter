'use strict';

// What the context is made of, per harness, for the menu bar Details window.
// Replaces the web dashboard's breakdown (develop/decisions/06).
//
// Two views of the same data:
//   segments  the observed input split into file estimates and the remainder,
//             clamped so the estimates never add up to more than was observed
//   items     one row per instruction set, skill group, and MCP server, with the
//             switch that turns it off or on where one exists

const { instructionFinding, unmeasuredItems } = require('./audit');

const SEGMENT_LABELS = {
  instructions: 'Instructions and rules',
  skills: 'Skill metadata',
  mcp: 'MCP tool schemas',
  other: 'Messages, system prompt, and tools',
};

function switchRef(item) {
  if (!item) return null;
  return { target: item.target, enabled: item.enabled, format: item.format, instruction: item.instruction || null };
}

/// A plugin with no skills can still ship MCP servers, hooks, or agents, none of
/// which this measures, so "0 skills" alone would read as "costs nothing".
function groupDetail(group) {
  if (!Number.isFinite(group.skillCount)) return null;
  if (group.skillCount === 0) return 'no skills; any other plugin content is not measured';
  return `${group.skillCount} skill${group.skillCount === 1 ? '' : 's'}`;
}

function skillItems(harnessId, harness, switches) {
  const plugins = new Map(switches
    .filter((item) => item.harness === harnessId && item.kind === 'plugin-group')
    .map((item) => [item.name, item]));
  const fromGroups = (harness.skillGroups || []).map((group) => {
    const plugin = plugins.get(group.id);
    plugins.delete(group.id);
    const tokens = group.metadataTokenEstimate > 0 ? group.metadataTokenEstimate : null;
    if (tokens === null && !plugin) return null;
    return {
      id: `skills:${group.id}`,
      category: 'skills',
      label: group.id,
      tokens,
      detail: groupDetail(group),
      switch: switchRef(plugin),
    };
  });
  // Plugins that are off have no scanned group, but they still need a row so
  // they can be switched back on.
  const withoutGroup = [...plugins.values()].map((plugin) => ({
    id: `skills:${plugin.name}`,
    category: 'skills',
    label: plugin.name,
    tokens: plugin.tokens,
    detail: plugin.detail || null,
    switch: switchRef(plugin),
  }));
  return [...fromGroups.filter(Boolean), ...withoutGroup];
}

function mcpItems(harnessId, switches) {
  return switches
    .filter((item) => item.harness === harnessId && item.kind === 'mcp-server')
    .map((item) => ({
      id: `mcp:${item.name}`,
      category: 'mcp',
      label: item.name,
      tokens: item.tokens,
      detail: item.detail || null,
      switch: switchRef(item),
      deferredTokens: item.deferredTokens ?? null,
    }));
}

function onTokens(items, category) {
  return items
    .filter((item) => item.category === category && (item.switch?.enabled ?? true))
    .reduce((total, item) => total + (item.tokens || 0), 0);
}

function segments(items, observed) {
  const estimates = ['instructions', 'skills', 'mcp'].map((id) => ({ id, label: SEGMENT_LABELS[id], tokens: onTokens(items, id) }));
  if (!Number.isFinite(observed)) return estimates;
  let remaining = observed;
  const clamped = estimates.map((segment) => {
    const tokens = Math.min(segment.tokens, remaining);
    remaining -= tokens;
    return { ...segment, tokens };
  });
  return [...clamped, { id: 'other', label: SEGMENT_LABELS.other, tokens: remaining }];
}

function byCost(left, right) {
  if (left.tokens === null && right.tokens === null) return 0;
  if (left.tokens === null) return 1;
  if (right.tokens === null) return -1;
  return right.tokens - left.tokens;
}

function harnessDetails(harnessId, harness, switches, telemetry, profiles, mcpCost, observedStart = null) {
  const instruction = instructionFinding(harnessId, harness);
  const items = [
    ...(instruction ? [{ id: 'instructions', category: 'instructions', label: instruction.label, tokens: instruction.tokens, detail: instruction.detail, switch: null }] : []),
    ...skillItems(harnessId, harness, switches),
    ...mcpItems(harnessId, switches),
  ].sort(byCost);
  const observed = Number.isFinite(telemetry?.inputTokens) ? telemetry.inputTokens : null;
  const profile = (profiles.profiles || []).find((entry) => entry.harness === harnessId && entry.id === telemetry?.model);
  return {
    model: telemetry?.model || null,
    contextWindowTokens: telemetry?.contextWindowTokens ?? null,
    observedInputTokens: observed,
    usagePercent: telemetry?.usagePercent ?? null,
    autocompactBufferTokens: Number.isFinite(profile?.autocompactBufferTokens) ? profile.autocompactBufferTokens : null,
    observedStart,
    segments: segments(items, observed),
    items,
    unmeasured: unmeasuredItems(harnessId, harness, mcpCost),
  };
}

function buildDetails({ snapshot, switches, telemetry = {}, profiles = {}, mcpCost = null, baselines = {} }) {
  return Object.fromEntries(Object.entries(snapshot.harnesses || {})
    .map(([harnessId, harness]) => [harnessId, harnessDetails(harnessId, harness, switches, telemetry[harnessId], profiles, mcpCost, baselines?.[harnessId] || null)]));
}

module.exports = { buildDetails };
