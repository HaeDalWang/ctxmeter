const state = { snapshot: null, snapshotNames: [], assets: [], contextProfiles: {}, models: [], harnessId: 'claude', modelId: null, mode: 'observed-session', pollTimer: null, refreshing: false, refreshingSnapshots: false };
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const integer = (number) => Number(number || 0).toLocaleString();
const compact = (number) => {
  const value = Number(number || 0);
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  return integer(value);
};
const capacity = (number) => {
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}m`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return integer(number);
};
const estimate = (number) => `~${integer(number)} tokens`;
const plural = (count, noun) => `${integer(count)} ${noun}${count === 1 ? '' : 's'}`;
const confidenceLabel = { observed: 'observed', derived: 'observed minus file estimate', proxy: 'model proxy', 'byte-estimate': 'file estimate', unknown: 'not measured', 'session-dependent': 'session-dependent' };
const categoryClass = { systemPrompt: 'system-prompt', systemTools: 'system-tools', unattributed: 'system-tools', mcpTools: 'mcp-tools', customAgents: 'custom-agents', memoryFiles: 'memory-files', skills: 'skills', messages: 'messages' };
const harnessLabel = { claude: 'Claude', codex: 'Codex', kiro: 'Kiro' };
const loadLabel = { startup: 'session start', discovery: 'listing metadata', conditional: 'conditional / on demand', runtime: 'runtime, not measured' };

async function load() {
  const [list, profiles] = await Promise.all([
    fetch('/api/snapshots').then((response) => response.json()),
    fetch('/api/context-profiles').then((response) => response.json()),
  ]);
  state.contextProfiles = profiles;
  state.snapshotNames = list.snapshots;
  $('snapshots').innerHTML = list.snapshots.map((name) => `<option>${esc(name)}</option>`).join('');
  $('snapshots').onchange = renderSnapshot;
  document.querySelectorAll('#mode-switch button').forEach((button) => {
    button.onclick = () => {
      state.mode = button.dataset.mode;
      document.querySelectorAll('#mode-switch button').forEach((candidate) => candidate.classList.toggle('active', candidate === button));
      renderContextBudget();
    };
  });
  await renderSnapshot();
  setInterval(refreshSnapshotList, 10_000);
}

async function refreshSnapshotList() {
  if (document.visibilityState !== 'visible' || state.refreshingSnapshots) return;
  state.refreshingSnapshots = true;
  try {
    const response = await fetch('/api/snapshots');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { snapshots } = await response.json();
    if (JSON.stringify(snapshots) === JSON.stringify(state.snapshotNames)) return;
    const previousSelection = $('snapshots').value;
    const nextSelection = ctxmeterModel.selectSnapshotOnRefresh(state.snapshotNames, previousSelection, snapshots);
    state.snapshotNames = snapshots;
    $('snapshots').innerHTML = snapshots.map((name) => `<option>${esc(name)}</option>`).join('');
    if (nextSelection) $('snapshots').value = nextSelection;
    if (nextSelection !== previousSelection) await renderSnapshot();
  } catch (error) {
    $('snapshots').title = `Snapshot list refresh failed: ${error.message}`;
  } finally {
    state.refreshingSnapshots = false;
  }
}

async function renderSnapshot() {
  const name = $('snapshots').value;
  if (!name) return;
  state.snapshot = await fetch(`/api/snapshots/${encodeURIComponent(name)}`).then((response) => response.json());
  renderAgentTabs();
  selectHarness(state.harnessId);
  renderHarnessCards();
  state.assets = Object.entries(state.snapshot.harnesses || {}).flatMap(([harness, value]) => (value.skillGroups || []).flatMap((group) => (group.assets || []).map((asset) => ({ ...asset, harness, group: group.id }))));
  renderAssets();
}

function renderAgentTabs() {
  const agents = [
    { id: 'claude', label: 'Claude Code', ready: true, observed: 'observed from JSONL' },
    { id: 'codex', label: 'Codex', ready: Boolean(state.snapshot.harnesses?.codex?.sessionTelemetry), observed: 'observed from JSONL' },
    { id: 'kiro', label: 'Kiro', ready: Boolean(state.snapshot.harnesses?.kiro?.sessionTelemetry), observed: 'observed percentage' },
  ];
  $('agent-tabs').innerHTML = agents.map((agent) => `<button data-harness="${agent.id}" class="agent-tab ${agent.id === state.harnessId ? 'active' : ''}" ${agent.ready ? '' : 'disabled'}><span>${agent.label}</span><small>${agent.ready ? (state.snapshot.harnesses?.[agent.id]?.sessionTelemetry ? agent.observed : 'file estimate') : 'telemetry pending'}</small></button>`).join('');
  document.querySelectorAll('.agent-tab:not(:disabled)').forEach((button) => { button.onclick = () => selectHarness(button.dataset.harness); });
}

function selectHarness(harnessId) {
  state.harnessId = harnessId;
  state.models = ctxmeterModel.mergeModelProfiles(state.snapshot, state.contextProfiles, harnessId);
  state.modelId = state.models.find((model) => model.selected)?.id || state.models[0]?.id || null;
  renderAgentTabs();
  renderModelTabs();
  renderContextBudget();
  configureLivePolling();
}

function setLiveStatus(message, active = false) {
  $('live-status').textContent = message;
  $('live-status').classList.toggle('active', active);
}

function configureLivePolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
  if (!ctxmeterModel.shouldPollHarnessRuntime(state.harnessId, document.visibilityState)) {
    setLiveStatus(document.visibilityState === 'hidden' ? 'background · paused' : 'Snapshot mode');
    return;
  }
  refreshHarnessRuntime();
  state.pollTimer = setInterval(refreshHarnessRuntime, 10_000);
}

async function refreshHarnessRuntime() {
  if (state.refreshing || !ctxmeterModel.shouldPollHarnessRuntime(state.harnessId, document.visibilityState)) return;
  const harnessId = state.harnessId;
  state.refreshing = true;
  setLiveStatus(`${harnessLabel[harnessId] || harnessId} refreshing…`, true);
  try {
    const response = await fetch(`/api/runtime/${harnessId}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const runtime = await response.json();
    if (state.harnessId !== harnessId || document.visibilityState !== 'visible') return;
    const previousModelId = state.modelId;
    const previousSelectedModel = state.snapshot.harnesses?.[harnessId]?.modelCatalog?.selectedModel;
    state.snapshot = ctxmeterModel.mergeHarnessRuntime(state.snapshot, harnessId, runtime);
    state.models = ctxmeterModel.mergeModelProfiles(state.snapshot, state.contextProfiles, harnessId);
    state.modelId = previousModelId === previousSelectedModel
      ? state.models.find((model) => model.selected)?.id || previousModelId
      : state.models.some((model) => model.id === previousModelId) ? previousModelId : state.models[0]?.id || null;
    renderAgentTabs();
    renderModelTabs();
    renderContextBudget();
    const observedAt = runtime.sessionTelemetry?.updatedAt;
    const time = observedAt ? new Date(observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'no session';
    const recent = observedAt && Date.now() - Date.parse(observedAt) < 60_000;
    setLiveStatus(observedAt ? `${recent ? 'LIVE' : 'last record'} · ${time}` : 'no session data', Boolean(recent));
  } catch (error) {
    setLiveStatus(`refresh failed · ${error.message}`);
  } finally {
    state.refreshing = false;
  }
}

function renderModelTabs() {
  $('model-tabs').innerHTML = state.models.map((model) => {
    const window = model.contextWindowTokens ? `${capacity(model.contextWindowTokens)} ${model.harness === 'codex' ? 'local window' : 'context'}` : 'capacity unknown';
    const api = model.apiContextWindowTokens ? ` · API ${capacity(model.apiContextWindowTokens)}` : '';
    return `<button class="model-tab ${model.id === state.modelId ? 'active' : ''}" data-model="${esc(model.id)}"><span>${esc(model.name)}</span><small>${window}${api}${model.selected ? ' · selected' : ''}</small></button>`;
  }).join('');
  const selected = state.models.find((model) => model.id === state.modelId);
  $('model-context-note').innerHTML = selected?.harness === 'codex' ? [
    `${selected.contextWindowSource === 'session' ? 'active session window' : 'local catalog window'} ${selected.contextWindowTokens ? integer(selected.contextWindowTokens) : 'unknown'}`,
    selected.rawContextWindowTokens ? `catalog base window ${integer(selected.rawContextWindowTokens)} (${selected.effectiveContextWindowPercent}% effective)` : null,
    selected.maxContextWindowTokens ? `catalog ceiling ${integer(selected.maxContextWindowTokens)} (not applied to the active window)` : null,
    selected.apiContextWindowTokens ? `published API spec ${integer(selected.apiContextWindowTokens)} <a href="${esc(selected.capacitySource)}" target="_blank" rel="noopener noreferrer">source</a>` : null,
  ].filter(Boolean).join(' · ') : '';
  document.querySelectorAll('.model-tab').forEach((button) => {
    button.onclick = () => { state.modelId = button.dataset.model; renderModelTabs(); renderContextBudget(); };
  });
}

function contextCells(budget) {
  if (budget.usedTokens === null) {
    const observed = Math.round(budget.usagePercent || 0);
    const percentCells = Array.from({ length: 100 }, (_, index) => (index < observed
      ? '<i class="system-tools" title="Observed usage (percentage only)"></i>'
      : '<i class="free" title="Free space"></i>'));
    return `<div class="context-map" aria-label="Context allocation map">${percentCells.join('')}</div>`;
  }
  if (!budget.contextWindowTokens) return '<div class="context-map unavailable">No context capacity profile yet.</div>';
  const positive = budget.categories.filter((category) => category.tokens > 0);
  const segments = [];
  let cumulative = 0;
  positive.forEach((category) => { cumulative += category.tokens; segments.push({ end: cumulative, className: categoryClass[category.id] || 'other', label: category.label }); });
  segments.push({ end: Math.max(cumulative, budget.usedTokens), className: 'other', label: 'Other observed usage' });
  segments.push({ end: Math.max(cumulative, budget.usedTokens) + budget.bufferTokens, className: 'buffer', label: 'Autocompact buffer' });
  const cells = Array.from({ length: 100 }, (_, index) => {
    const point = (index + 0.5) / 100 * budget.contextWindowTokens;
    const segment = segments.find((candidate) => point <= candidate.end);
    const unknownRemainder = budget.confidence === 'stale-calibration' || budget.confidence === 'static-estimate';
    return `<i class="${segment?.className || (unknownRemainder ? 'unmeasured' : 'free')}" title="${esc(segment?.label || (unknownRemainder ? 'Unmeasured' : 'Free space'))}"></i>`;
  });
  return `<div class="context-map" aria-label="Context allocation map">${cells.join('')}</div>`;
}

function renderContextBudget() {
  const profile = state.models.find((model) => model.id === state.modelId);
  if (!profile) { $('context-budget').innerHTML = '<p class="muted">No model profile found.</p>'; return; }
  const calibration = (state.contextProfiles.calibrations || []).find((item) => item.harness === profile.harness);
  const budget = ctxmeterModel.buildContextBudget(state.snapshot, profile, calibration, state.mode);
  const hasSessionTelemetry = Boolean(state.snapshot.harnesses?.[profile.harness]?.sessionTelemetry);
  const confidence = budget.confidence === 'stale-calibration' ? 'inventory changed · current minimum'
    : budget.confidence === 'historical-observation' ? 'past /context · not current'
      : budget.confidence === 'observed-baseline' ? 'Opus /context baseline'
        : budget.confidence === 'observed-codex' ? 'Codex JSONL observed'
          : budget.confidence === 'observed-claude' ? 'Claude JSONL observed'
          : budget.confidence === 'observed-kiro-percent' ? 'Kiro session percentage observed'
          : budget.confidence === 'cross-model-proxy' ? `${budget.calibrationModelId || 'another model'} observation projected onto ${profile.name}` : 'file-based estimate';
  const title = budget.confidence === 'observed-kiro-percent' ? (state.mode === 'first-session' ? 'First turn, observed share' : 'Latest observed share')
    : budget.confidence === 'stale-calibration' ? 'Minimum confirmed from current files'
    : budget.confidence === 'historical-observation' ? 'Observation from before the inventory changed'
      : state.mode === 'first-session'
    ? (hasSessionTelemetry ? 'First response input context' : 'Projected share before the first message')
    : (hasSessionTelemetry ? 'Latest input context' : 'Saved /context observation');
  const categories = budget.categories.map((category) => {
    const unknown = category.confidence === 'unknown';
    const contextPercent = budget.contextWindowTokens && !unknown ? category.tokens / budget.contextWindowTokens * 100 : null;
    const compositionPercent = budget.breakdownTokens ? category.tokens / budget.breakdownTokens * 100 : 0;
    const count = category.count === undefined ? '' : `<span>${integer(category.count)} ${esc(category.unit || '')}</span>`;
    return `<div class="category-row"><i class="category-dot ${categoryClass[category.id] || 'other'}"></i><div class="category-name"><b>${esc(category.label)}</b><small>${count}<em>${esc(confidenceLabel[category.confidence] || category.confidence)}</em></small></div><div class="category-bar"><span class="${categoryClass[category.id] || 'other'}" style="width:${compositionPercent}%"></span></div><b>${unknown ? '—' : compact(category.tokens)}</b><small>${contextPercent === null ? '—' : `${contextPercent.toFixed(1)}%`}</small></div>`;
  }).join('');
  const usage = budget.usagePercent === null ? '—' : `${budget.confidence === 'stale-calibration' ? '≥' : ''}${budget.usagePercent.toFixed(1)}%`;
  const denominator = budget.contextWindowTokens ? capacity(budget.contextWindowTokens) : 'capacity unknown';
  const free = budget.freeTokens === null ? 'not measured' : compact(budget.freeTokens);
  const supplemental = profile.harness === 'kiro' && budget.supplemental
    ? `<span><b>${budget.supplemental.creditsUsed.toFixed(2)}</b> credits</span><span><b>${integer(budget.supplemental.sampleCount)}</b> samples</span><span><b>${esc(budget.supplemental.store || '—')}</b> session store</span>`
    : budget.supplemental ? `<span><b>${compact(budget.supplemental.cachedInputTokens)}</b> cached input</span><span><b>${compact(budget.supplemental.outputTokens)}</b> latest output</span>${profile.harness === 'codex' ? `<span><b>${compact(budget.supplemental.reasoningOutputTokens)}</b> reasoning</span><span><b>${compact(budget.supplemental.threadTotalTokens)}</b> thread total</span><span><b>${integer(budget.supplemental.compactionCount)}</b> compactions</span>` : `<span><b>${compact(budget.bufferTokens)}</b> autocompact buffer est.</span>`}` : budget.confidence === 'stale-calibration' ? '<span><b>not measured</b> system, tools, autocompact buffer</span>' : `<span><b>${compact(budget.bufferTokens)}</b> autocompact buffer</span>`;
  const reserve = budget.bufferTokens ? `<div class="category-row reserve"><i class="category-dot buffer"></i><div class="category-name"><b>Autocompact buffer</b><small><em>reserved</em></small></div><div class="category-bar"><span class="buffer" style="width:${budget.contextWindowTokens ? budget.bufferTokens / budget.contextWindowTokens * 100 : 0}%"></span></div><b>${compact(budget.bufferTokens)}</b><small>${budget.contextWindowTokens ? `${(budget.bufferTokens / budget.contextWindowTokens * 100).toFixed(1)}%` : '—'}</small></div>` : '';
  const note = profile.harness === 'kiro' ? `Kiro records no absolute token count locally. Only the percentage is observed and no token figure is derived from it. Categories are file estimates, not a breakdown of that percentage. Store: ${budget.supplemental?.store === 'cli' ? 'sessions/cli' : 'sessions/<workspace>/messages.jsonl'}${budget.supplemental?.contextWindowSource === 'peer-session' ? ' · the denominator was observed in another local session using the same model' : ''}.${budget.confidence === 'cross-model-proxy' ? ` observed model: ${budget.calibrationModelId || 'unknown'}.` : ''}`
    : profile.harness === 'codex' ? 'Input totals are observed from the JSONL for this workspace. AGENTS and skills are file estimates; the remainder is unclassified. Cached input is included in the total, and the thread total is not current window usage.' : hasSessionTelemetry ? `Claude input context was read from the local JSONL for this workspace. Instructions and skills are file estimates; the remainder is unclassified.${state.mode === 'first-session' ? ' The first user message is included.' : ''}${budget.confidence === 'cross-model-proxy' ? ` observed model: ${budget.calibrationModelId}.` : ''}` : budget.confidence === 'stale-calibration' ? 'The installed configuration changed since the last /context measurement. Only current file estimates are shown; real first-session usage and free space need remeasuring.' : budget.confidence === 'historical-observation' ? 'This is a /context observation recorded under a previous configuration. It is not current usage.' : `Category total ${compact(budget.breakdownTokens)} tokens · badges distinguish observed, proxy, and file estimates.`;
  const minimum = budget.confidence === 'stale-calibration' ? '≥' : '';
  const freeLabel = profile.harness === 'kiro' ? 'free' : budget.confidence === 'historical-observation' ? 'free then' : budget.supplemental ? 'estimated free' : 'workable';
  const configurationCosts = ctxmeterModel.buildConfigurationCosts(state.snapshot, profile.harness);
  const home = state.snapshot.target?.home || '';
  const costRows = configurationCosts.map((item) => {
    const shownPath = home && item.path?.startsWith(`${home}/`) ? `~/${item.path.slice(home.length + 1)}` : item.path || '';
    return `<div class="cost-row"><span class="cost-kind">${esc(item.kind)}</span><div><b>${esc(item.label)}</b><small title="${esc(item.path || '')}">${esc(shownPath)}</small></div><span>${integer(item.count || 0)}</span><span>${esc(loadLabel[item.load] || item.load)}</span><strong>${item.estimatedTokens === null ? 'not measured' : estimate(item.estimatedTokens)}</strong></div>`;
  }).join('');
  const costDetails = configurationCosts.length ? `<details class="configuration-costs" open><summary>Estimated tokens per configuration item <small>${plural(configurationCosts.length, 'item')}</small></summary><p>File estimates are size ÷ 4. A conditional item is not necessarily always loaded. This list is a separate breakdown from the observed total above and must not be summed with it.</p><div class="cost-list"><div class="cost-row cost-head"><span>Kind</span><span>Item / path</span><span>Count</span><span>Loaded</span><span>Est. tokens</span></div>${costRows}</div></details>` : '';
  const crew = state.snapshot.harnesses?.kiro?.crewUsage;
  const crewBlock = profile.harness === 'kiro' && crew ? `<details class="configuration-costs"><summary>Crew cumulative usage <small>not attributable to a workspace</small></summary><p>Crew usage is aggregated per day and surface, so it cannot be attributed to this workspace. Crew records no token count either, so only credits are shown. It must not be added to the share above.</p><div class="budget-stats"><span><b>${crew.creditsTotal.toFixed(2)}</b> credits total</span><span><b>${integer(crew.recordCount)}</b> records</span><span><b>${esc(crew.firstDate)} ~ ${esc(crew.lastDate)}</b></span></div></details>` : '';
  const used = budget.usedTokens === null ? 'not measured' : `${minimum}${compact(budget.usedTokens)}`;
  $('context-budget').innerHTML = `<div class="budget-summary"><div><span class="status-pill ${budget.confidence}">${esc(confidence)}</span><p>${esc(title)}</p><strong>${used} <small>/ ${denominator} tokens</small></strong><div class="budget-stats"><span><b>${usage}</b> used</span><span><b>${free}</b> ${freeLabel}</span>${supplemental}</div></div>${contextCells(budget)}</div><div class="category-list">${categories}${reserve}</div><p class="budget-note ${budget.confidence === 'stale-calibration' || budget.confidence === 'historical-observation' ? 'warning' : ''}">${esc(note)} · observed ${esc(budget.observedAt || 'none')} · config scan ${esc(state.snapshot.generatedAt || 'none')}</p>${costDetails}${crewBlock}`;
}

function renderHarnessCards() {
  const overview = ctxmeterModel.buildContextOverview(state.snapshot);
  const maximum = Math.max(...Object.values(overview).map((item) => item.knownBaselineTokens), 1);
  $('cards').innerHTML = Object.entries(overview).map(([id, item]) => `<article class="card ${item.risk}"><div class="card-title"><strong>${id.toUpperCase()}</strong><span class="badge">${item.risk}</span></div><b>${estimate(item.knownBaselineTokens)}</b><p>${plural(item.skillCount, 'skill')} · ${plural(item.hookCount, 'hook')}</p><div class="meter"><span style="width:${Math.round(item.knownBaselineTokens / maximum * 100)}%"></span></div></article>`).join('');
}

function renderAssets() {
  const query = $('query').value.toLowerCase();
  const harness = $('harness').value;
  const rows = state.assets.filter((asset) => (!harness || asset.harness === harness) && `${asset.declaredName || ''} ${asset.relativePath}`.toLowerCase().includes(query));
  $('count').textContent = plural(rows.length, 'asset');
  const groups = Object.groupBy(rows, (asset) => `${asset.harness} · ${asset.group}`);
  $('groups').innerHTML = Object.entries(groups).map(([name, items]) => `<details class="group" ${query ? 'open' : ''}><summary><span>${esc(name)}</span><span>${plural(items.length, 'asset')} · ${estimate(items.reduce((sum, item) => sum + item.metadataTokenEstimate, 0))}</span></summary><div class="asset-list">${items.slice(0, 80).map((asset) => `<button class="asset" data-index="${state.assets.indexOf(asset)}"><span>${esc(asset.declaredName || asset.relativePath)}</span><small>${estimate(asset.metadataTokenEstimate)}</small></button>`).join('')}${items.length > 80 ? '<p class="muted">Narrow the search to see the remaining items.</p>' : ''}</div></details>`).join('');
  document.querySelectorAll('.asset').forEach((button) => { button.onclick = () => showDetail(state.assets[button.dataset.index]); });
}

function showDetail(asset) {
  $('detail').innerHTML = `<p class="eyebrow">${esc(asset.harness)} · ${esc(asset.group)}</p><h2>${esc(asset.declaredName || 'Unnamed skill')}</h2><p>${esc(asset.relativePath)}</p><div class="detail-grid"><span>Metadata</span><b>${estimate(asset.metadataTokenEstimate)}</b><span>Body</span><b>${integer(asset.bodyBytes)} bytes</b><span>Status</span><b>${esc(asset.status)}</b></div>`;
}

$('query').oninput = renderAssets;
$('harness').onchange = renderAssets;
document.addEventListener('visibilitychange', () => {
  configureLivePolling();
  if (document.visibilityState === 'visible') refreshSnapshotList();
});
load().catch((error) => { $('context-budget').innerHTML = `<p class="error">Dashboard load failed: ${esc(error.message)}</p>`; });
