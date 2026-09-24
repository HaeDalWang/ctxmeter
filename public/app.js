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
const confidenceLabel = { observed: '관측값', derived: '관측값 - 파일 추정', proxy: '모델 프록시', 'byte-estimate': '파일 추정', unknown: '미측정', 'session-dependent': '세션 변수' };
const categoryClass = { systemPrompt: 'system-prompt', systemTools: 'system-tools', unattributed: 'system-tools', mcpTools: 'mcp-tools', customAgents: 'custom-agents', memoryFiles: 'memory-files', skills: 'skills', messages: 'messages' };
const harnessLabel = { claude: 'Claude', codex: 'Codex', kiro: 'Kiro' };
const loadLabel = { startup: '세션 시작', discovery: '목록 메타데이터', conditional: '조건부 / 호출 시', runtime: '실행 시 미측정' };

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
    $('snapshots').title = `Snapshot 목록 갱신 실패: ${error.message}`;
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
    { id: 'claude', label: 'Claude Code', ready: true, observed: 'JSONL 자동 관측' },
    { id: 'codex', label: 'Codex', ready: Boolean(state.snapshot.harnesses?.codex?.sessionTelemetry), observed: 'JSONL 자동 관측' },
    { id: 'kiro', label: 'Kiro', ready: Boolean(state.snapshot.harnesses?.kiro?.sessionTelemetry), observed: '세션 백분율 관측' },
  ];
  $('agent-tabs').innerHTML = agents.map((agent) => `<button data-harness="${agent.id}" class="agent-tab ${agent.id === state.harnessId ? 'active' : ''}" ${agent.ready ? '' : 'disabled'}><span>${agent.label}</span><small>${agent.ready ? (state.snapshot.harnesses?.[agent.id]?.sessionTelemetry ? agent.observed : '파일 기반 추정') : 'Telemetry 준비 중'}</small></button>`).join('');
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
    setLiveStatus(document.visibilityState === 'hidden' ? '백그라운드 · 일시정지' : 'Snapshot mode');
    return;
  }
  refreshHarnessRuntime();
  state.pollTimer = setInterval(refreshHarnessRuntime, 10_000);
}

async function refreshHarnessRuntime() {
  if (state.refreshing || !ctxmeterModel.shouldPollHarnessRuntime(state.harnessId, document.visibilityState)) return;
  const harnessId = state.harnessId;
  state.refreshing = true;
  setLiveStatus(`${harnessLabel[harnessId] || harnessId} 갱신 중…`, true);
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
    const time = observedAt ? new Date(observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '세션 없음';
    const recent = observedAt && Date.now() - Date.parse(observedAt) < 60_000;
    setLiveStatus(observedAt ? `${recent ? 'LIVE' : '최근 기록'} · ${time}` : '세션 데이터 없음', Boolean(recent));
  } catch (error) {
    setLiveStatus(`갱신 실패 · ${error.message}`);
  } finally {
    state.refreshing = false;
  }
}

function renderModelTabs() {
  $('model-tabs').innerHTML = state.models.map((model) => {
    const window = model.contextWindowTokens ? `${capacity(model.contextWindowTokens)} ${model.harness === 'codex' ? '로컬 창' : '컨텍스트'}` : '용량 미확인';
    const api = model.apiContextWindowTokens ? ` · API ${capacity(model.apiContextWindowTokens)}` : '';
    return `<button class="model-tab ${model.id === state.modelId ? 'active' : ''}" data-model="${esc(model.id)}"><span>${esc(model.name)}</span><small>${window}${api}${model.selected ? ' · 현재 선택' : ''}</small></button>`;
  }).join('');
  const selected = state.models.find((model) => model.id === state.modelId);
  $('model-context-note').innerHTML = selected?.harness === 'codex' ? [
    `${selected.contextWindowSource === 'session' ? '현재 세션 유효 창' : '로컬 카탈로그 유효 창'} ${selected.contextWindowTokens ? integer(selected.contextWindowTokens) : '미확인'}`,
    selected.rawContextWindowTokens ? `카탈로그 기본 창 ${integer(selected.rawContextWindowTokens)} (${selected.effectiveContextWindowPercent}% 유효)` : null,
    selected.maxContextWindowTokens ? `카탈로그 확장 상한 ${integer(selected.maxContextWindowTokens)} (현재 창에 미적용)` : null,
    selected.apiContextWindowTokens ? `공식 API 모델 사양 ${integer(selected.apiContextWindowTokens)} <a href="${esc(selected.capacitySource)}" target="_blank" rel="noopener noreferrer">출처</a>` : null,
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
  if (!budget.contextWindowTokens) return '<div class="context-map unavailable">최대 컨텍스트 프로필이 아직 없습니다.</div>';
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
  if (!profile) { $('context-budget').innerHTML = '<p class="muted">모델 프로필을 찾지 못했습니다.</p>'; return; }
  const calibration = (state.contextProfiles.calibrations || []).find((item) => item.harness === profile.harness);
  const budget = ctxmeterModel.buildContextBudget(state.snapshot, profile, calibration, state.mode);
  const hasSessionTelemetry = Boolean(state.snapshot.harnesses?.[profile.harness]?.sessionTelemetry);
  const confidence = budget.confidence === 'stale-calibration' ? '설치 변경 · 현재 확인량'
    : budget.confidence === 'historical-observation' ? '과거 /context · 현재 아님'
      : budget.confidence === 'observed-baseline' ? 'Opus /context 관측 기준'
        : budget.confidence === 'observed-codex' ? 'Codex JSONL 자동 관측'
          : budget.confidence === 'observed-claude' ? 'Claude JSONL 자동 관측'
          : budget.confidence === 'observed-kiro-percent' ? 'Kiro 세션 점유율 관측'
          : budget.confidence === 'cross-model-proxy' ? `${budget.calibrationModelId || '다른 모델'} 관측값을 ${profile.name}에 대입한 예상` : '파일 기반 예상';
  const title = budget.confidence === 'observed-kiro-percent' ? (state.mode === 'first-session' ? '첫 턴 관측 점유율' : '최신 관측 점유율')
    : budget.confidence === 'stale-calibration' ? '현재 파일에서 확인된 최소 사용량'
    : budget.confidence === 'historical-observation' ? '설치 변경 전 과거 관측'
      : state.mode === 'first-session'
    ? (hasSessionTelemetry ? '첫 응답 입력 컨텍스트' : '첫 메시지 전 예상 점유')
    : (hasSessionTelemetry ? '최신 입력 컨텍스트' : '저장된 /context 관측 세션');
  const categories = budget.categories.map((category) => {
    const unknown = category.confidence === 'unknown';
    const contextPercent = budget.contextWindowTokens && !unknown ? category.tokens / budget.contextWindowTokens * 100 : null;
    const compositionPercent = budget.breakdownTokens ? category.tokens / budget.breakdownTokens * 100 : 0;
    const count = category.count === undefined ? '' : `<span>${integer(category.count)} ${esc(category.unit || '')}</span>`;
    return `<div class="category-row"><i class="category-dot ${categoryClass[category.id] || 'other'}"></i><div class="category-name"><b>${esc(category.label)}</b><small>${count}<em>${esc(confidenceLabel[category.confidence] || category.confidence)}</em></small></div><div class="category-bar"><span class="${categoryClass[category.id] || 'other'}" style="width:${compositionPercent}%"></span></div><b>${unknown ? '—' : compact(category.tokens)}</b><small>${contextPercent === null ? '—' : `${contextPercent.toFixed(1)}%`}</small></div>`;
  }).join('');
  const usage = budget.usagePercent === null ? '—' : `${budget.confidence === 'stale-calibration' ? '≥' : ''}${budget.usagePercent.toFixed(1)}%`;
  const denominator = budget.contextWindowTokens ? capacity(budget.contextWindowTokens) : '용량 미확인';
  const free = budget.freeTokens === null ? '미측정' : compact(budget.freeTokens);
  const supplemental = profile.harness === 'kiro' && budget.supplemental
    ? `<span><b>${budget.supplemental.creditsUsed.toFixed(2)}</b> credits</span><span><b>${integer(budget.supplemental.sampleCount)}</b> 관측 샘플</span><span><b>${esc(budget.supplemental.store || '—')}</b> 세션 저장소</span>`
    : budget.supplemental ? `<span><b>${compact(budget.supplemental.cachedInputTokens)}</b> cached input</span><span><b>${compact(budget.supplemental.outputTokens)}</b> latest output</span>${profile.harness === 'codex' ? `<span><b>${compact(budget.supplemental.reasoningOutputTokens)}</b> reasoning</span><span><b>${compact(budget.supplemental.threadTotalTokens)}</b> thread 누적</span><span><b>${integer(budget.supplemental.compactionCount)}</b> compactions</span>` : `<span><b>${compact(budget.bufferTokens)}</b> 압축 버퍼 추정</span>`}` : budget.confidence === 'stale-calibration' ? '<span><b>미측정</b> 시스템·도구·압축 버퍼</span>' : `<span><b>${compact(budget.bufferTokens)}</b> 압축 버퍼</span>`;
  const reserve = budget.bufferTokens ? `<div class="category-row reserve"><i class="category-dot buffer"></i><div class="category-name"><b>Autocompact buffer</b><small><em>예약 영역</em></small></div><div class="category-bar"><span class="buffer" style="width:${budget.contextWindowTokens ? budget.bufferTokens / budget.contextWindowTokens * 100 : 0}%"></span></div><b>${compact(budget.bufferTokens)}</b><small>${budget.contextWindowTokens ? `${(budget.bufferTokens / budget.contextWindowTokens * 100).toFixed(1)}%` : '—'}</small></div>` : '';
  const note = profile.harness === 'kiro' ? `Kiro는 로컬에 절대 토큰 수를 남기지 않습니다. 점유율만 관측값이고 토큰 환산은 하지 않았습니다. 카테고리는 파일 추정치이며 관측 점유율의 내역이 아닙니다. 저장소: ${budget.supplemental?.store === 'cli' ? 'sessions/cli' : 'sessions/<workspace>/messages.jsonl'}${budget.supplemental?.contextWindowSource === 'peer-session' ? ' · 분모는 같은 모델을 쓴 다른 로컬 세션에서 관측한 값입니다' : ''}.${budget.confidence === 'cross-model-proxy' ? ` 관측 모델: ${budget.calibrationModelId || '미확인'}.` : ''}`
    : profile.harness === 'codex' ? '입력 총량은 이 작업공간의 JSONL 관측값입니다. AGENTS·Skills는 파일 추정, 나머지는 미분류입니다. cached input은 입력 총량에 포함되며 thread 누적은 현재 창 사용량이 아닙니다.' : hasSessionTelemetry ? `Claude input context는 이 작업공간의 로컬 JSONL에서 읽었습니다. 지침·Skills는 파일 추정, 나머지는 미분류입니다.${state.mode === 'first-session' ? ' 첫 사용자 메시지도 포함됩니다.' : ''}${budget.confidence === 'cross-model-proxy' ? ` 관측 모델: ${budget.calibrationModelId}.` : ''}` : budget.confidence === 'stale-calibration' ? '설치 구성이 이전 /context 측정 때와 달라졌습니다. 현재 파일 추정량만 표시하며 실제 첫 세션 사용량과 남은 공간은 다시 측정해야 합니다.' : budget.confidence === 'historical-observation' ? '이 값은 이전 설치 구성에서 기록된 /context 관측치입니다. 현재 사용량이 아닙니다.' : `카테고리 합계 ${compact(budget.breakdownTokens)} tokens · 숫자 배지를 통해 관측/프록시/파일 추정을 구분합니다.`;
  const minimum = budget.confidence === 'stale-calibration' ? '≥' : '';
  const freeLabel = profile.harness === 'kiro' ? '잔여' : budget.confidence === 'historical-observation' ? '그때 잔여' : budget.supplemental ? '기준 잔여 추정' : '작업 가능';
  const configurationCosts = ctxmeterModel.buildConfigurationCosts(state.snapshot, profile.harness);
  const home = state.snapshot.target?.home || '';
  const costRows = configurationCosts.map((item) => {
    const shownPath = home && item.path?.startsWith(`${home}/`) ? `~/${item.path.slice(home.length + 1)}` : item.path || '';
    return `<div class="cost-row"><span class="cost-kind">${esc(item.kind)}</span><div><b>${esc(item.label)}</b><small title="${esc(item.path || '')}">${esc(shownPath)}</small></div><span>${integer(item.count || 0)}개</span><span>${esc(loadLabel[item.load] || item.load)}</span><strong>${item.estimatedTokens === null ? '미측정' : estimate(item.estimatedTokens)}</strong></div>`;
  }).join('');
  const costDetails = configurationCosts.length ? `<details class="configuration-costs" open><summary>설정 항목별 예상 토큰 <small>${configurationCosts.length}개 항목</small></summary><p>파일 추정치는 크기 ÷ 4입니다. 조건부 항목은 항상 로드된다는 뜻이 아닙니다. 이 목록은 위 관측 합계의 별도 분석이므로 더해서 합계를 만들 수 없습니다.</p><div class="cost-list"><div class="cost-row cost-head"><span>종류</span><span>항목 / 경로</span><span>개수</span><span>로딩 시점</span><span>예상 토큰</span></div>${costRows}</div></details>` : '';
  const crew = state.snapshot.harnesses?.kiro?.crewUsage;
  const crewBlock = profile.harness === 'kiro' && crew ? `<details class="configuration-costs"><summary>Crew 누적 사용량 <small>워크스페이스 귀속 불가</small></summary><p>Crew 사용량은 일자·surface별 집계라 이 작업공간에 귀속시킬 수 없습니다. Crew도 토큰 수를 남기지 않아 credits만 표시합니다. 위 점유율과 더할 수 없습니다.</p><div class="budget-stats"><span><b>${crew.creditsTotal.toFixed(2)}</b> credits 누적</span><span><b>${integer(crew.recordCount)}</b> 레코드</span><span><b>${esc(crew.firstDate)} ~ ${esc(crew.lastDate)}</b></span></div></details>` : '';
  const used = budget.usedTokens === null ? '미측정' : `${minimum}${compact(budget.usedTokens)}`;
  $('context-budget').innerHTML = `<div class="budget-summary"><div><span class="status-pill ${budget.confidence}">${esc(confidence)}</span><p>${esc(title)}</p><strong>${used} <small>/ ${denominator} tokens</small></strong><div class="budget-stats"><span><b>${usage}</b> 점유</span><span><b>${free}</b> ${freeLabel}</span>${supplemental}</div></div>${contextCells(budget)}</div><div class="category-list">${categories}${reserve}</div><p class="budget-note ${budget.confidence === 'stale-calibration' || budget.confidence === 'historical-observation' ? 'warning' : ''}">${esc(note)} · 관측일 ${esc(budget.observedAt || '없음')} · 설정 스캔 ${esc(state.snapshot.generatedAt || '없음')}</p>${costDetails}${crewBlock}`;
}

function renderHarnessCards() {
  const overview = ctxmeterModel.buildContextOverview(state.snapshot);
  const maximum = Math.max(...Object.values(overview).map((item) => item.knownBaselineTokens), 1);
  $('cards').innerHTML = Object.entries(overview).map(([id, item]) => `<article class="card ${item.risk}"><div class="card-title"><strong>${id.toUpperCase()}</strong><span class="badge">${item.risk}</span></div><b>${estimate(item.knownBaselineTokens)}</b><p>${item.skillCount} skills · ${item.hookCount} hooks</p><div class="meter"><span style="width:${Math.round(item.knownBaselineTokens / maximum * 100)}%"></span></div></article>`).join('');
}

function renderAssets() {
  const query = $('query').value.toLowerCase();
  const harness = $('harness').value;
  const rows = state.assets.filter((asset) => (!harness || asset.harness === harness) && `${asset.declaredName || ''} ${asset.relativePath}`.toLowerCase().includes(query));
  $('count').textContent = `${rows.length} assets`;
  const groups = Object.groupBy(rows, (asset) => `${asset.harness} · ${asset.group}`);
  $('groups').innerHTML = Object.entries(groups).map(([name, items]) => `<details class="group" ${query ? 'open' : ''}><summary><span>${esc(name)}</span><span>${items.length} assets · ${estimate(items.reduce((sum, item) => sum + item.metadataTokenEstimate, 0))}</span></summary><div class="asset-list">${items.slice(0, 80).map((asset) => `<button class="asset" data-index="${state.assets.indexOf(asset)}"><span>${esc(asset.declaredName || asset.relativePath)}</span><small>${estimate(asset.metadataTokenEstimate)}</small></button>`).join('')}${items.length > 80 ? '<p class="muted">검색으로 범위를 좁히면 나머지 항목도 확인할 수 있습니다.</p>' : ''}</div></details>`).join('');
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
