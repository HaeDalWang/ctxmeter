(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ctxmeterModel = api;
}(typeof globalThis === 'object' ? globalThis : this, function createModel() {
  function instructionTokens(id, harness) {
    if (id === 'claude') return (harness.alwaysOn?.claudeMd?.tokenEstimate || 0) + Math.round((harness.alwaysOn?.ruleBytes || 0) / 4);
    if (id === 'codex') return harness.alwaysOn?.agentsMd?.tokenEstimate || 0;
    if (id === 'kiro') return harness.steering?.tokenEstimate || 0;
    return 0;
  }

  function buildContextOverview(snapshot) {
    const overview = {};
    for (const [id, harness] of Object.entries(snapshot.harnesses || {})) {
      const skillMetadataTokens = (harness.skillGroups || []).reduce((total, group) => total + (group.metadataTokenEstimate || 0), 0);
      const alwaysOnInstructionTokens = instructionTokens(id, harness);
      const knownBaselineTokens = skillMetadataTokens + alwaysOnInstructionTokens;
      overview[id] = {
        skillMetadataTokens,
        alwaysOnInstructionTokens,
        knownBaselineTokens,
        skillCount: (harness.skillGroups || []).reduce((total, group) => total + (group.skillCount || 0), 0),
        hookCount: harness.hookCount || 0,
        risk: knownBaselineTokens >= 25000 ? 'high' : knownBaselineTokens >= 8000 ? 'medium' : 'low',
        runtimeStatus: 'awaiting-telemetry',
      };
    }
    return overview;
  }

  function buildConfigurationCosts(snapshot, harnessId) {
    const items = [...(snapshot.harnesses?.[harnessId]?.configurationCosts || [])];
    const filenames = harnessId === 'codex' ? ['AGENTS.override.md', 'AGENTS.md']
      : harnessId === 'claude' ? ['CLAUDE.md'] : [];
    const workspaceFile = filenames.map((name) => (snapshot.workspace?.assets || []).find((asset) => asset.path === name && asset.bytes > 0)).find(Boolean);
    if (workspaceFile) items.push({
      kind: 'instructions', label: 'Workspace instructions', path: workspaceFile.path,
      count: 1, estimatedTokens: workspaceFile.tokenEstimate, load: 'conditional',
    });
    return items;
  }

  function mergeModelProfiles(snapshot, contextProfiles = {}, harnessId = 'claude') {
    const configured = new Map((contextProfiles.profiles || []).filter((profile) => profile.harness === harnessId).map((profile) => [profile.id, profile]));
    const catalog = snapshot.harnesses?.[harnessId]?.modelCatalog || {};
    const telemetry = snapshot.harnesses?.[harnessId]?.sessionTelemetry;
    const local = catalog.models || [];
    const telemetryDriven = harnessId === 'codex' || harnessId === 'kiro';
    const telemetryModelIds = harnessId === 'kiro'
      ? [telemetry?.startModel, telemetry?.currentModel].filter(Boolean)
      : telemetry?.currentModel ? [telemetry.currentModel] : [];
    const ids = telemetryDriven
      ? new Set([...local.map((model) => model.id), ...telemetryModelIds])
      : new Set([...local.map((model) => model.id), ...configured.keys()]);
    return [...ids].map((id) => {
      const discovered = local.find((model) => model.id === id) || {};
      const profile = configured.get(id) || {};
      const sessionWindowTokens = telemetryDriven && telemetry?.currentModel === id && Number.isFinite(telemetry.contextWindowTokens)
        ? telemetry.contextWindowTokens : null;
      return {
        ...profile,
        ...discovered,
        id,
        harness: profile.harness || harnessId,
        name: discovered.name || profile.name || id,
        contextWindowTokens: sessionWindowTokens || profile.contextWindowTokens || discovered.contextWindowTokens || null,
        contextWindowSource: sessionWindowTokens ? 'session' : discovered.contextWindowTokens ? 'catalog' : 'profile',
        autocompactBufferTokens: profile.autocompactBufferTokens || null,
        selected: id === catalog.selectedModel,
        discovered: local.some((model) => model.id === id),
      };
    });
  }

  function mergeHarnessRuntime(snapshot, harnessId, runtime = {}) {
    return {
      ...snapshot,
      harnesses: {
        ...(snapshot.harnesses || {}),
        [harnessId]: {
          ...(snapshot.harnesses?.[harnessId] || {}),
          ...(runtime.modelCatalog ? { modelCatalog: runtime.modelCatalog } : {}),
          ...(Object.prototype.hasOwnProperty.call(runtime, 'sessionTelemetry') ? { sessionTelemetry: runtime.sessionTelemetry } : {}),
        },
      },
    };
  }

  function mergeCodexRuntime(snapshot, runtime = {}) {
    return mergeHarnessRuntime(snapshot, 'codex', runtime);
  }

  function shouldPollCodexRuntime(harnessId, visibilityState) {
    return harnessId === 'codex' && visibilityState === 'visible';
  }

  function shouldPollHarnessRuntime(harnessId, visibilityState) {
    return (harnessId === 'claude' || harnessId === 'codex' || harnessId === 'kiro') && visibilityState === 'visible';
  }

  function selectSnapshotOnRefresh(previousNames, selectedName, nextNames) {
    if (!nextNames.length) return null;
    if (!selectedName || selectedName === previousNames[0] || !nextNames.includes(selectedName)) return nextNames[0];
    return selectedName;
  }

  function claudeInventory(snapshot) {
    const harness = snapshot.harnesses?.claude || {};
    return {
      enabledPlugins: [...(harness.enabledPlugins || [])].sort(),
      hookCount: harness.hookCount || 0,
      claudeMdTokens: harness.alwaysOn?.claudeMd?.tokenEstimate || 0,
      ruleBytes: harness.alwaysOn?.ruleBytes || 0,
      skillGroups: (harness.skillGroups || []).map((group) => ({
        id: group.id,
        skillCount: group.skillCount || 0,
        metadataTokenEstimate: group.metadataTokenEstimate || 0,
      })).sort((left, right) => left.id.localeCompare(right.id)),
    };
  }

  function calibrationMatchesSnapshot(snapshot, calibration) {
    if (!calibration?.inventoryBaseline) return false;
    const baseline = calibration.inventoryBaseline;
    const sortedBaseline = {
      ...baseline,
      enabledPlugins: [...(baseline.enabledPlugins || [])].sort(),
      skillGroups: [...(baseline.skillGroups || [])].sort((left, right) => left.id.localeCompare(right.id)),
    };
    return JSON.stringify(claudeInventory(snapshot)) === JSON.stringify(sortedBaseline);
  }

  function buildCodexContextBudget(snapshot, profile, mode) {
    const harness = snapshot.harnesses?.codex || {};
    const telemetry = harness.sessionTelemetry || {};
    const usage = mode === 'first-session' ? telemetry.firstUsage : telemetry.latestUsage;
    const observedInputTokens = usage?.inputTokens || 0;
    const overview = buildContextOverview(snapshot).codex || {};
    const instructionTokens = Math.min(overview.alwaysOnInstructionTokens || 0, observedInputTokens);
    const skillTokens = Math.min(overview.skillMetadataTokens || 0, Math.max(observedInputTokens - instructionTokens, 0));
    const unattributedTokens = Math.max(observedInputTokens - instructionTokens - skillTokens, 0);
    const matchingModel = profile.id === (mode === 'first-session' ? telemetry.startModel : telemetry.currentModel);
    const contextWindowTokens = profile.contextWindowTokens || telemetry.contextWindowTokens || null;
    const categories = [
      { id: 'unattributed', label: mode === 'first-session' ? 'System, tools + first prompt' : 'Messages, tools + unclassified', tokens: unattributedTokens, confidence: matchingModel ? 'derived' : 'proxy' },
      { id: 'memoryFiles', label: 'AGENTS instructions', tokens: instructionTokens, confidence: 'byte-estimate' },
      { id: 'skills', label: 'Skill metadata', tokens: skillTokens, count: overview.skillCount || 0, unit: 'skills', confidence: 'byte-estimate' },
      { id: 'mcpTools', label: 'MCP tools', tokens: 0, confidence: 'unknown' },
      { id: 'customAgents', label: 'Custom agents', tokens: 0, confidence: 'unknown' },
    ];
    return {
      mode,
      modelId: profile.id,
      modelName: profile.name || profile.id,
      contextWindowTokens,
      bufferTokens: 0,
      usedTokens: observedInputTokens,
      breakdownTokens: observedInputTokens,
      freeTokens: contextWindowTokens === null ? null : Math.max(contextWindowTokens - observedInputTokens, 0),
      usagePercent: contextWindowTokens ? observedInputTokens / contextWindowTokens * 100 : null,
      categories,
      confidence: matchingModel ? 'observed-codex' : 'cross-model-proxy',
      calibrationModelId: mode === 'first-session' ? telemetry.startModel : telemetry.currentModel,
      observedAt: telemetry.updatedAt || null,
      supplemental: {
        cachedInputTokens: usage?.cachedInputTokens || 0,
        outputTokens: usage?.outputTokens || 0,
        reasoningOutputTokens: usage?.reasoningOutputTokens || 0,
        threadTotalTokens: telemetry.threadUsage?.totalTokens || 0,
        compactionCount: telemetry.compactionCount || 0,
        reasoningEffort: telemetry.reasoningEffort || null,
        maxContextWindowTokens: profile.maxContextWindowTokens || null,
      },
    };
  }

  function buildClaudeContextBudget(snapshot, profile, mode) {
    const telemetry = snapshot.harnesses?.claude?.sessionTelemetry || {};
    const usage = mode === 'first-session' ? telemetry.firstUsage : telemetry.latestUsage;
    const observedInputTokens = usage?.inputTokens || 0;
    const overview = buildContextOverview(snapshot).claude || {};
    const instructionTokens = Math.min(overview.alwaysOnInstructionTokens || 0, observedInputTokens);
    const skillTokens = Math.min(overview.skillMetadataTokens || 0, Math.max(observedInputTokens - instructionTokens, 0));
    const unattributedTokens = Math.max(observedInputTokens - instructionTokens - skillTokens, 0);
    const sourceModel = mode === 'first-session' ? telemetry.startModel : telemetry.currentModel;
    const matchingModel = profile.id === sourceModel;
    const contextWindowTokens = profile.contextWindowTokens || null;
    const bufferTokens = profile.autocompactBufferTokens || 0;
    return {
      mode,
      modelId: profile.id,
      modelName: profile.name || profile.id,
      contextWindowTokens,
      bufferTokens,
      usedTokens: observedInputTokens,
      breakdownTokens: observedInputTokens,
      freeTokens: contextWindowTokens === null ? null : Math.max(contextWindowTokens - observedInputTokens - bufferTokens, 0),
      usagePercent: contextWindowTokens ? observedInputTokens / contextWindowTokens * 100 : null,
      categories: [
        { id: 'unattributed', label: mode === 'first-session' ? 'System, tools + first prompt' : 'Messages, system + tools', tokens: unattributedTokens, confidence: matchingModel ? 'derived' : 'proxy' },
        { id: 'memoryFiles', label: 'Instructions + rules', tokens: instructionTokens, confidence: 'byte-estimate' },
        { id: 'skills', label: 'Skill metadata', tokens: skillTokens, count: overview.skillCount || 0, unit: 'skills', confidence: 'byte-estimate' },
      ],
      confidence: matchingModel ? 'observed-claude' : 'cross-model-proxy',
      calibrationModelId: sourceModel,
      observedAt: mode === 'first-session' ? telemetry.firstObservedAt : telemetry.updatedAt,
      supplemental: {
        cachedInputTokens: usage?.cachedInputTokens || 0,
        outputTokens: usage?.outputTokens || 0,
      },
    };
  }

  function snapshotFallbackCategories(snapshot, harnessId) {
    const overview = buildContextOverview(snapshot)[harnessId] || {};
    return [
      { id: 'systemPrompt', label: 'System prompt', tokens: 0, confidence: 'unknown' },
      { id: 'systemTools', label: 'System tools', tokens: 0, confidence: 'unknown' },
      { id: 'mcpTools', label: 'MCP tools', tokens: 0, confidence: 'unknown' },
      { id: 'customAgents', label: 'Custom agents', tokens: 0, confidence: 'unknown' },
      { id: 'memoryFiles', label: 'Memory / instructions', tokens: overview.alwaysOnInstructionTokens || 0, confidence: 'byte-estimate' },
      { id: 'skills', label: 'Skill metadata', tokens: overview.skillMetadataTokens || 0, count: overview.skillCount || 0, unit: 'skills', confidence: 'byte-estimate' },
      { id: 'messages', label: 'Messages', tokens: 0, confidence: 'session-dependent' },
    ];
  }

  function buildKiroContextBudget(snapshot, profile, mode) {
    const harness = snapshot.harnesses?.kiro || {};
    const telemetry = harness.sessionTelemetry || {};
    const percent = mode === 'first-session' ? telemetry.firstUsagePercent : telemetry.latestUsagePercent;
    const overview = buildContextOverview(snapshot).kiro || {};
    const matchingModel = profile.id === (mode === 'first-session' ? telemetry.startModel : telemetry.currentModel);
    const categories = [
      { id: 'memoryFiles', label: 'Steering', tokens: overview.alwaysOnInstructionTokens || 0, confidence: matchingModel ? 'byte-estimate' : 'proxy' },
      { id: 'skills', label: 'Skill metadata', tokens: overview.skillMetadataTokens || 0, count: overview.skillCount || 0, unit: 'skills', confidence: matchingModel ? 'byte-estimate' : 'proxy' },
      { id: 'messages', label: 'Messages, system + tools', tokens: 0, confidence: 'unknown' },
    ];
    return {
      mode,
      modelId: profile.id,
      modelName: profile.name || profile.id,
      contextWindowTokens: profile.contextWindowTokens || telemetry.contextWindowTokens || null,
      bufferTokens: 0,
      usedTokens: null,
      breakdownTokens: categories.reduce((total, category) => total + category.tokens, 0),
      freeTokens: null,
      usagePercent: Number.isFinite(percent) ? percent : null,
      categories,
      confidence: matchingModel ? 'observed-kiro-percent' : 'cross-model-proxy',
      calibrationModelId: mode === 'first-session' ? telemetry.startModel : telemetry.currentModel,
      observedAt: mode === 'first-session' ? telemetry.firstObservedAt : telemetry.updatedAt,
      supplemental: {
        creditsUsed: telemetry.creditsUsed || 0,
        sampleCount: telemetry.sampleCount || 0,
        store: telemetry.store || null,
        contextWindowSource: telemetry.contextWindowSource || null,
        crewCreditsTotal: harness.crewUsage?.creditsTotal || 0,
      },
    };
  }

  function buildContextBudget(snapshot, profile = {}, calibration, mode = 'first-session') {
    if (profile.harness === 'codex') return buildCodexContextBudget(snapshot, profile, mode);
    if (profile.harness === 'kiro' && snapshot.harnesses?.kiro?.sessionTelemetry) {
      return buildKiroContextBudget(snapshot, profile, mode);
    }
    if (profile.harness === 'claude' && snapshot.harnesses?.claude?.sessionTelemetry?.firstUsage) {
      return buildClaudeContextBudget(snapshot, profile, mode);
    }
    const sameModel = calibration?.modelId === profile.id;
    const hasCalibration = Array.isArray(calibration?.categories);
    const calibrationCurrent = hasCalibration && calibrationMatchesSnapshot(snapshot, calibration);
    const staleCalibration = hasCalibration && !calibrationCurrent;
    const useHistorical = staleCalibration && mode === 'observed-session';
    const useCalibration = calibrationCurrent || useHistorical;
    const confidence = useHistorical ? 'historical-observation'
      : staleCalibration ? 'stale-calibration'
        : hasCalibration ? (sameModel ? 'observed-baseline' : 'cross-model-proxy') : 'static-estimate';
    const categoryConfidence = sameModel ? 'observed' : 'proxy';
    const sourceCategories = useCalibration
      ? calibration.categories.map((category) => ({ ...category, confidence: categoryConfidence }))
      : snapshotFallbackCategories(snapshot, profile.harness || 'claude');
    const categories = sourceCategories.map((category) => ({
      ...category,
      tokens: mode === 'first-session' && category.id === 'messages' ? 0 : category.tokens,
      confidence: mode === 'first-session' && category.id === 'messages' ? 'session-dependent' : category.confidence,
    }));
    const breakdownTokens = categories.reduce((total, category) => total + (category.tokens || 0), 0);
    const contextWindowTokens = profile.contextWindowTokens || calibration?.contextWindowTokens || null;
    const bufferTokens = staleCalibration && !useHistorical ? 0 : (profile.autocompactBufferTokens || calibration?.autocompactBufferTokens || 0);
    const usedTokens = mode === 'observed-session' && useCalibration && sameModel && calibration?.observedUsedTokens
      ? calibration.observedUsedTokens
      : breakdownTokens;
    const freeTokens = contextWindowTokens === null || (staleCalibration && !useHistorical)
      ? null
      : (mode === 'observed-session' && useCalibration && sameModel && calibration?.observedFreeTokens !== undefined
        ? calibration.observedFreeTokens
        : Math.max(contextWindowTokens - usedTokens - bufferTokens, 0));
    return {
      mode,
      modelId: profile.id || calibration?.modelId || 'unknown',
      modelName: profile.name || calibration?.modelName || profile.id || 'Unknown model',
      contextWindowTokens,
      bufferTokens,
      usedTokens,
      breakdownTokens,
      freeTokens,
      usagePercent: contextWindowTokens ? usedTokens / contextWindowTokens * 100 : null,
      categories,
      confidence,
      calibrationModelId: calibration?.modelId || null,
      observedAt: calibration?.observedAt || null,
      calibrationCurrent,
    };
  }

  return { buildConfigurationCosts, buildContextBudget, buildContextOverview, mergeCodexRuntime, mergeHarnessRuntime, mergeModelProfiles, selectSnapshotOnRefresh, shouldPollCodexRuntime, shouldPollHarnessRuntime };
}));
