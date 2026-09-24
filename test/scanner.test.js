const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  classifyAssetPath,
  createClaudeRuntimeReader,
  createCodexRuntimeReader,
  createKiroRuntimeReader,
  scanEnvironment,
  skillMetadataBytes,
} = require('../src/scanner');
const { parseArgs, telemetrySummary, auditReport, formatAudit } = require('../src/cli');
const { createDashboardServer, formatListenError } = require('../src/dashboard-server');
const { buildConfigurationCosts, buildContextBudget, buildContextOverview, mergeCodexRuntime, mergeHarnessRuntime, mergeModelProfiles, selectSnapshotOnRefresh, shouldPollCodexRuntime, shouldPollHarnessRuntime } = require('../public/dashboard-model');
const contextProfiles = require('../config/context-profiles.json');

function fixtureHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentlens-test-'));
}

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function snapshotMatchingClaudeCalibration(calibration) {
  const baseline = calibration.inventoryBaseline;
  return { harnesses: { claude: {
    enabledPlugins: baseline.enabledPlugins,
    hookCount: baseline.hookCount,
    alwaysOn: { claudeMd: { tokenEstimate: baseline.claudeMdTokens }, ruleBytes: baseline.ruleBytes },
    skillGroups: baseline.skillGroups,
  } } };
}

test('classifies active assets separately from cache, backup, and staging', () => {
  assert.equal(classifyAssetPath('/tmp/.claude/skills/tdd/SKILL.md'), 'active-candidate');
  assert.equal(classifyAssetPath('/tmp/.claude/plugins/cache/ecc/ecc/2.2.2/skills/tdd/SKILL.md'), 'plugin-cache');
  assert.equal(classifyAssetPath('/tmp/.claude/skills.bak.20260921/tdd/SKILL.md'), 'backup');
  assert.equal(classifyAssetPath('/tmp/.codex/.tmp/plugins/example/SKILL.md'), 'staging');
  assert.equal(classifyAssetPath('/tmp/.claude/plugins/marketplaces/ecc/skills/tdd/SKILL.md'), 'marketplace-source');
});

test('measures only frontmatter as baseline skill metadata', () => {
  const home = fixtureHome();
  const skill = path.join(home, 'SKILL.md');
  const frontmatter = '---\nname: sample\ndescription: Test sample\n---\n';
  fs.writeFileSync(skill, `${frontmatter}${'body '.repeat(1000)}`);

  assert.equal(skillMetadataBytes(skill), Buffer.byteLength(frontmatter));
});

test('discovers enabled Claude plugins without counting marketplace sources as active skills', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'workspace');
  write(home, '.claude/settings.json', JSON.stringify({
    enabledPlugins: { 'ecc@ecc': true },
    hooks: { Stop: [{}], PostToolUse: [{}, {}] },
  }));
  write(home, '.claude/CLAUDE.md', '# concise instructions\n');
  write(home, '.claude/skills/local/SKILL.md', '---\nname: local\ndescription: local work\n---\nbody\n');
  write(home, '.claude/skills.bak.20260921/old/SKILL.md', '---\nname: old\ndescription: old\n---\nbody\n');
  write(home, '.claude/plugins/cache/ecc/ecc/2.2.2/skills/ecc-skill/SKILL.md', '---\nname: ecc-skill\ndescription: ecc work\n---\nbody\n');
  write(home, '.claude/plugins/marketplaces/ecc/skills/source-only/SKILL.md', '---\nname: source-only\ndescription: source\n---\nbody\n');
  fs.mkdirSync(workspace, { recursive: true });

  const snapshot = scanEnvironment({ home, workspace });
  const claude = snapshot.harnesses.claude;

  assert.deepEqual(claude.enabledPlugins, ['ecc@ecc']);
  assert.equal(claude.hookCount, 3);
  assert.equal(claude.skillGroups.find((group) => group.id === 'user-skills').skillCount, 1);
  assert.equal(claude.skillGroups.find((group) => group.id === 'ecc@ecc').skillCount, 1);
  assert.equal(claude.excluded.backup, 1);
  assert.equal(claude.excluded['marketplace-source'], 1);
  assert.equal(claude.excluded['plugin-cache'], undefined);
  assert.ok(snapshot.warnings.some((warning) => warning.code === 'ESTIMATE_NOT_EXACT'));
});

test('includes an asset-level skill inventory without persisting skill body text', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'workspace');
  write(home, '.claude/skills/local/SKILL.md', '---\nname: local-audit\ndescription: private metadata\n---\nDO NOT STORE THIS BODY\n');
  fs.mkdirSync(workspace, { recursive: true });

  const group = scanEnvironment({ home, workspace }).harnesses.claude.skillGroups
    .find((candidate) => candidate.id === 'user-skills');

  assert.equal(group.assets.length, 1);
  assert.equal(group.assets[0].declaredName, 'local-audit');
  assert.equal(group.assets[0].relativePath, 'local/SKILL.md');
  assert.match(group.assets[0].sha256, /^[a-f0-9]{64}$/);
  assert.ok(group.assets[0].bodyBytes > group.assets[0].metadataBytes);
  assert.equal(JSON.stringify(group.assets).includes('DO NOT STORE THIS BODY'), false);
});

test('keeps Kiro Crew assets separate from ordinary Kiro CLI assets', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'workspace');
  write(home, '.kiro/skills/regular/SKILL.md', '---\nname: regular\ndescription: regular\n---\nbody\n');
  write(home, '.kiro/crew/skills/crew-only/SKILL.md', '---\nname: crew-only\ndescription: crew\n---\nbody\n');
  write(home, '.kiro/agents/reviewer.json', '{"name":"reviewer"}');
  fs.mkdirSync(workspace, { recursive: true });

  const kiro = scanEnvironment({ home, workspace }).harnesses.kiro;

  assert.equal(kiro.skillGroups.find((group) => group.id === 'user-skills').skillCount, 1);
  assert.equal(kiro.crew.skillCount, 1);
  assert.equal(kiro.customAgentCount, 1);
});

test('reports missing plugin caches, Codex configuration, and workspace assets without reading contents', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'workspace');
  write(home, '.claude/settings.json', JSON.stringify({ enabledPlugins: { 'missing@marketplace': true } }));
  write(home, '.codex/config.toml', '[plugins."browser@market"]\n[mcp_servers.docs]\n');
  write(home, '.codex/hooks.json', '{ invalid json');
  write(home, '.codex/AGENTS.md', 'Keep this concise.\n');
  write(home, '.kiro/steering/testing.md', 'Run tests.\n');
  write(home, 'workspace/AGENTS.md', 'Repository rules.\n');
  write(home, 'workspace/.claude/settings.local.json', '{"skillOverrides":{}}');

  const snapshot = scanEnvironment({ home, workspace });
  const missingPlugin = snapshot.harnesses.claude.skillGroups.find((group) => group.id === 'missing@marketplace');

  assert.equal(missingPlugin.status, 'enabled-plugin-cache-missing');
  assert.equal(snapshot.harnesses.codex.configuredPluginCount, 1);
  assert.equal(snapshot.harnesses.codex.configuredMcpServerCount, 1);
  assert.equal(snapshot.harnesses.codex.hookCount, 0);
  assert.equal(snapshot.harnesses.kiro.steering.fileCount, 1);
  assert.deepEqual(snapshot.workspace.assets.map((asset) => asset.path), ['AGENTS.md', '.claude/settings.local.json']);
});

test('configuration costs distinguish file estimates from runtime costs and honor Codex override', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'workspace');
  write(home, '.claude/CLAUDE.md', 'CLAUDE PRIVATE BODY');
  write(home, '.claude/rules/common/testing.md', 'RULE PRIVATE BODY');
  write(home, '.claude/agents/reviewer.md', 'AGENT PRIVATE BODY');
  write(home, '.claude/settings.json', JSON.stringify({ hooks: { Stop: [{}] } }));
  write(home, '.claude/mcp.json', JSON.stringify({ mcpServers: { docs: { command: 'SECRET COMMAND' } } }));
  write(home, '.codex/AGENTS.md', 'OLD GLOBAL INSTRUCTION');
  write(home, '.codex/AGENTS.override.md', 'OVERRIDE PRIVATE BODY');
  write(home, '.codex/agents/reviewer.toml', 'description = "PRIVATE AGENT"');
  write(home, '.codex/rules/default.rules', 'private command policy');
  write(home, '.codex/config.toml', '[mcp_servers.docs]\n[mcp_servers.docs.env]\n[plugins."sample@market"]\nenabled = true\n[plugins."disabled@market"]\nenabled = false\n');
  write(home, '.codex/plugins/cache/market/sample/1.0.0/skills/plugin-skill/SKILL.md', '---\nname: plugin-skill\n---\nBODY SECRET');
  write(home, 'workspace/AGENTS.md', 'OLD WORKSPACE INSTRUCTION');
  write(home, 'workspace/AGENTS.override.md', 'WORKSPACE OVERRIDE PRIVATE');

  const snapshot = scanEnvironment({ home, workspace });
  const codex = snapshot.harnesses.codex;
  const claudeCosts = buildConfigurationCosts(snapshot, 'claude');
  const codexCosts = buildConfigurationCosts(snapshot, 'codex');

  assert.equal(codex.alwaysOn.agentsMd.path, path.join(home, '.codex/AGENTS.override.md'));
  assert.equal(codex.configuredMcpServerCount, 1);
  assert.equal(claudeCosts.find((item) => item.kind === 'rules').load, 'conditional');
  assert.equal(claudeCosts.find((item) => item.kind === 'agents').estimatedTokens, Math.round(Buffer.byteLength('AGENT PRIVATE BODY') / 4));
  assert.equal(claudeCosts.find((item) => item.kind === 'hooks').estimatedTokens, null);
  assert.equal(claudeCosts.find((item) => item.kind === 'mcp').count, 1);
  assert.equal(codexCosts.find((item) => item.label === 'Workspace instructions').path, 'AGENTS.override.md');
  assert.equal(codexCosts.find((item) => item.kind === 'plugins').count, 1);
  assert.equal(codex.enabledPlugins.length, 1);
  assert.equal(codex.configuredPluginCount, 2);
  assert.equal(codex.skillGroups.find((group) => group.id === 'sample@market').skillCount, 1);
  assert.equal(codexCosts.find((item) => item.kind === 'rules').estimatedTokens, null);
  assert.equal(JSON.stringify(snapshot).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(snapshot).includes('SECRET COMMAND'), false);
});

test('CLI writes a metadata-only JSON snapshot and prints a concise summary', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'workspace');
  const output = path.join(home, 'snapshots', 'scan.json');
  write(home, '.claude/settings.json', JSON.stringify({ enabledPlugins: {} }));
  fs.mkdirSync(workspace, { recursive: true });

  const result = spawnSync(process.execPath, [
    'src/cli.js', 'scan', '--home', home, '--workspace', workspace, '--output', output,
  ], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /AgentLens scan complete/);
  assert.ok(fs.existsSync(output));
  const snapshot = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(snapshot.schemaVersion, '0.1.0');
  assert.equal(snapshot.harnesses.claude.enabledPlugins.length, 0);
  assert.equal(JSON.stringify(snapshot).includes('Keep this concise'), false);
});

test('CLI argument parsing accepts scan options and rejects malformed input', () => {
  assert.deepEqual(parseArgs(['scan', '--home', '/tmp/home']), { command: 'scan', home: '/tmp/home' });
  assert.throws(() => parseArgs(['scan', '--unknown', 'value']), /Unknown option/);
  assert.throws(() => parseArgs(['scan', '--output']), /Missing value/);
});

test('Claude runtime reads only numeric usage from the latest workspace session', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'workspace_under_score');
  const project = `.claude/projects/${workspace.replace(/[^A-Za-z0-9]/g, '-')}`;
  write(home, `${project}/session.jsonl`, [
    { type: 'user', message: { content: 'PRIVATE USER PROMPT' } },
    { type: 'assistant', timestamp: 'first', message: { model: 'claude-opus-5', content: 'PRIVATE ANSWER', usage: { input_tokens: 2, cache_creation_input_tokens: 70, cache_read_input_tokens: 20, output_tokens: 4 } } },
    { type: 'assistant', timestamp: 'latest', message: { model: 'claude-sonnet-5', usage: { input_tokens: 3, cache_creation_input_tokens: 5, cache_read_input_tokens: 190, output_tokens: 8 } } },
    { type: 'assistant', timestamp: 'synthetic', message: { model: '<synthetic>', usage: { input_tokens: 999 } } },
  ].map((row) => JSON.stringify(row)).join('\n'));
  const snapshot = scanEnvironment({ home, workspace });
  const telemetry = snapshot.harnesses.claude.sessionTelemetry;

  assert.equal(telemetry.firstUsage.inputTokens, 92);
  assert.equal(telemetry.latestUsage.inputTokens, 198);
  assert.equal(telemetry.latestUsage.cachedInputTokens, 190);
  assert.equal(telemetry.startModel, 'claude-opus-5');
  assert.equal(telemetry.currentModel, 'claude-sonnet-5');
  assert.equal(telemetry.updatedAt, 'latest');
  assert.equal(JSON.stringify(snapshot).includes('PRIVATE'), false);

  let now = 0;
  const read = createClaudeRuntimeReader({ home, workspace, minRefreshMs: 1_000, now: () => now });
  assert.equal(read().sessionTelemetry.latestUsage.inputTokens, 198);
  fs.appendFileSync(path.join(home, `${project}/session.jsonl`), `\n${JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5', usage: { input_tokens: 210 } } })}`);
  now = 500;
  assert.equal(read().sessionTelemetry.latestUsage.inputTokens, 198);
  now = 1_001;
  assert.equal(read().sessionTelemetry.latestUsage.inputTokens, 210);
});

test('Claude context uses JSONL total with file estimates inside a measured remainder', () => {
  const snapshot = { harnesses: { claude: {
    alwaysOn: { claudeMd: { tokenEstimate: 10 }, ruleBytes: 40 },
    skillGroups: [{ skillCount: 2, metadataTokenEstimate: 20 }],
    sessionTelemetry: {
      startModel: 'opus', currentModel: 'sonnet', firstObservedAt: 'first', updatedAt: 'latest',
      firstUsage: { inputTokens: 100, cachedInputTokens: 70, outputTokens: 5 },
      latestUsage: { inputTokens: 200, cachedInputTokens: 150, outputTokens: 8 },
    },
  } } };
  const profile = { id: 'sonnet', name: 'Sonnet', harness: 'claude', contextWindowTokens: 1000, autocompactBufferTokens: 100 };
  const first = buildContextBudget(snapshot, profile, null, 'first-session');
  const current = buildContextBudget(snapshot, profile, null, 'observed-session');

  assert.equal(first.usedTokens, 100);
  assert.equal(first.confidence, 'cross-model-proxy');
  assert.equal(current.usedTokens, 200);
  assert.equal(current.confidence, 'observed-claude');
  assert.equal(current.categories.reduce((sum, row) => sum + row.tokens, 0), 200);
  assert.equal(current.categories.find((row) => row.id === 'unattributed').tokens, 160);
  assert.equal(current.freeTokens, 700);
  assert.equal(current.supplemental.cachedInputTokens, 150);
});

test('dashboard lists snapshots, serves assets, and rejects traversal paths', async () => {
  const home = fixtureHome();
  const snapshots = path.join(home, 'snapshots');
  const profiles = path.join(home, 'context-profiles.json');
  fs.mkdirSync(snapshots, { recursive: true });
  fs.writeFileSync(path.join(snapshots, 'example.json'), JSON.stringify({ schemaVersion: '0.1.0', harnesses: {} }));
  fs.writeFileSync(profiles, JSON.stringify({ profiles: [{ id: 'test-model' }] }));
  const server = createDashboardServer({
    snapshotDirectory: snapshots,
    publicDirectory: path.join(__dirname, '..', 'public'),
    contextProfilesFile: profiles,
    claudeRuntimeReader: () => ({ sessionTelemetry: { latestUsage: { inputTokens: 654 } }, modelCatalog: { models: [] } }),
    codexRuntimeReader: () => ({ sessionTelemetry: { latestUsage: { inputTokens: 321 } }, modelCatalog: { models: [] } }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const request = (pathname) => new Promise((resolve, reject) => {
    require('node:http').get({ hostname: '127.0.0.1', port, path: pathname }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    }).on('error', reject);
  });

  try {
    assert.deepEqual(JSON.parse((await request('/api/snapshots')).body).snapshots, ['example.json']);
    assert.equal(JSON.parse((await request('/api/context-profiles')).body).profiles[0].id, 'test-model');
    assert.equal(JSON.parse((await request('/api/runtime/codex')).body).sessionTelemetry.latestUsage.inputTokens, 321);
    assert.equal(JSON.parse((await request('/api/runtime/claude')).body).sessionTelemetry.latestUsage.inputTokens, 654);
    assert.equal((await request('/api/snapshots/example.json')).status, 200);
    assert.equal((await request('/api/snapshots/%2e%2e%2fsecret.json')).status, 400);
    assert.match((await request('/')).body, /AgentLens/);
    assert.equal((await request('/api/snapshots/missing.json')).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('dashboard reports a helpful message when its local port is occupied', () => {
  assert.match(formatListenError({ code: 'EADDRINUSE' }, 4318), /already running.*4318/i);
  assert.match(formatListenError({ code: 'EADDRINUSE' }, 4318), /AGENTLENS_PORT=4319/);
  assert.match(formatListenError({ code: 'EACCES', message: 'denied' }, 4318), /denied/);
});

test('context overview separates known baseline from unknown runtime usage', () => {
  const overview = buildContextOverview({
    harnesses: {
      claude: {
        alwaysOn: { claudeMd: { tokenEstimate: 250 }, ruleBytes: 4000 },
        skillGroups: [{ id: 'ecc@ecc', skillCount: 292, metadataTokenEstimate: 27000 }],
        hookCount: 15,
      },
      codex: { alwaysOn: { agentsMd: { tokenEstimate: 100 } }, skillGroups: [{ id: 'skills', skillCount: 10, metadataTokenEstimate: 5000 }], hookCount: 2 },
    },
  });

  assert.equal(overview.claude.knownBaselineTokens, 28250);
  assert.equal(overview.claude.skillMetadataTokens, 27000);
  assert.equal(overview.claude.risk, 'high');
  assert.equal(overview.claude.runtimeStatus, 'awaiting-telemetry');
  assert.equal(overview.codex.knownBaselineTokens, 5100);
});

test('context overview handles Kiro steering, medium risk, and empty snapshots', () => {
  const overview = buildContextOverview({
    harnesses: {
      kiro: { steering: { tokenEstimate: 500 }, skillGroups: [{ skillCount: 12, metadataTokenEstimate: 8000 }] },
      custom: {},
    },
  });

  assert.equal(overview.kiro.knownBaselineTokens, 8500);
  assert.equal(overview.kiro.risk, 'medium');
  assert.equal(overview.custom.knownBaselineTokens, 0);
  assert.deepEqual(buildContextOverview({}), {});
  const sparse = buildContextOverview({ harnesses: {
    claude: { alwaysOn: {}, skillGroups: [{}] },
    codex: { alwaysOn: {}, skillGroups: [] },
    kiro: { steering: {}, skillGroups: [] },
  } });
  assert.equal(sparse.claude.knownBaselineTokens, 0);
});

test('Claude scan discovers model choices without copying catalog descriptions', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'workspace');
  write(home, '.claude/cache/model-catalog/catalog.json', JSON.stringify({
    fetchedAt: 123,
    catalog: {
      config: { models: [
        { id: 'claude-opus-5', name: 'Opus 5', short_name: 'Opus', description: 'DO NOT COPY' },
        { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', short_name: 'Haiku' },
      ] },
      state: { model: 'claude-opus-5' },
    },
  }));
  fs.mkdirSync(workspace, { recursive: true });

  const catalog = scanEnvironment({ home, workspace }).harnesses.claude.modelCatalog;

  assert.equal(catalog.selectedModel, 'claude-opus-5');
  assert.equal(catalog.models.length, 2);
  assert.deepEqual(catalog.models[0], { id: 'claude-opus-5', name: 'Opus 5', shortName: 'Opus' });
  assert.equal(JSON.stringify(catalog).includes('DO NOT COPY'), false);
});

test('context budget predicts first-session cost and preserves current observation', () => {
  const opus = contextProfiles.profiles.find((profile) => profile.id === 'claude-opus-5');
  const calibration = contextProfiles.calibrations[0];
  const snapshot = snapshotMatchingClaudeCalibration(calibration);

  const firstSession = buildContextBudget(snapshot, opus, calibration, 'first-session');
  const observedSession = buildContextBudget(snapshot, opus, calibration, 'observed-session');

  assert.equal(firstSession.contextWindowTokens, 1_000_000);
  assert.equal(firstSession.usedTokens, 71_273);
  assert.equal(firstSession.categories.find((category) => category.id === 'messages').tokens, 0);
  assert.equal(firstSession.freeTokens, 895_727);
  assert.equal(firstSession.confidence, 'observed-baseline');
  assert.equal(observedSession.usedTokens, 111_000);
  assert.equal(observedSession.breakdownTokens, 112_073);
  assert.equal(observedSession.categories.find((category) => category.id === 'skills').count, 534);
});

test('model profile merge keeps local choices and marks cross-model calibration as a proxy', () => {
  const calibratedClaude = snapshotMatchingClaudeCalibration(contextProfiles.calibrations[0]).harnesses.claude;
  const snapshot = { harnesses: { claude: {
    ...calibratedClaude,
    modelCatalog: {
      selectedModel: 'claude-sonnet-5',
      models: [
        { id: 'claude-sonnet-5', name: 'Sonnet 5', shortName: 'Sonnet' },
        { id: 'local-unknown', name: 'Local Unknown', shortName: 'Unknown' },
      ],
    },
  } } };
  const models = mergeModelProfiles(snapshot, contextProfiles);
  const sonnet = models.find((model) => model.id === 'claude-sonnet-5');
  const unknown = models.find((model) => model.id === 'local-unknown');
  const budget = buildContextBudget(snapshot, sonnet, contextProfiles.calibrations[0], 'first-session');

  assert.equal(sonnet.selected, true);
  assert.equal(sonnet.contextWindowTokens, 1_000_000);
  assert.equal(unknown.contextWindowTokens, null);
  assert.equal(budget.usedTokens, 71_273);
  assert.equal(budget.confidence, 'cross-model-proxy');
});

test('context budget falls back to static snapshot estimates when no calibration exists', () => {
  const budget = buildContextBudget({ harnesses: { claude: {
    alwaysOn: { claudeMd: { tokenEstimate: 100 }, ruleBytes: 400 },
    skillGroups: [{ skillCount: 2, metadataTokenEstimate: 300 }],
  } } }, { id: 'unobserved', name: 'Unobserved', harness: 'claude', contextWindowTokens: 10_000 }, null);

  assert.equal(budget.usedTokens, 500);
  assert.equal(budget.confidence, 'static-estimate');
  assert.equal(budget.categories.find((category) => category.id === 'systemTools').confidence, 'unknown');
  assert.equal(budget.categories.find((category) => category.id === 'messages').confidence, 'session-dependent');
});

test('Codex scan extracts numeric session telemetry and model limits without message content', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'workspace');
  write(home, '.codex/models_cache.json', JSON.stringify({
    fetched_at: '2026-09-21T00:00:00Z',
    client_version: '0.155.1',
    models: [
      { slug: 'gpt-test', display_name: 'GPT Test', visibility: 'list', context_window: 100_000, max_context_window: 400_000, effective_context_window_percent: 90, default_reasoning_level: 'medium', description: 'PRIVATE MODEL DESCRIPTION' },
      { slug: 'hidden', display_name: 'Hidden', visibility: 'hide', context_window: 50_000 },
    ],
  }));
  const rows = [
    { type: 'session_meta', timestamp: '2026-09-21T00:00:00Z', payload: { originator: 'codex-tui', cwd: workspace, metadata: 'x'.repeat(20_000) } },
    { type: 'turn_context', timestamp: '2026-09-21T00:00:01Z', payload: { model: 'gpt-test', effort: 'medium', user_prompt: 'DO NOT PERSIST THIS PROMPT' } },
    { type: 'event_msg', timestamp: '2026-09-21T00:00:02Z', payload: { type: 'task_started', model_context_window: 90_000 } },
    { type: 'token_usage_record', timestamp: '2026-09-21T00:00:03Z', payload: { usage: { input_tokens: 10_000, cached_input_tokens: 8_000, output_tokens: 100, reasoning_output_tokens: 20, total_tokens: 10_100 }, thread_token_usage: { total_tokens: 10_100 } } },
    { type: 'compacted', timestamp: '2026-09-21T00:00:04Z', payload: { message: 'PRIVATE COMPACTION' } },
    { type: 'token_usage_record', timestamp: '2026-09-21T00:00:05Z', payload: { usage: { input_tokens: 40_000, cached_input_tokens: 32_000, output_tokens: 200, reasoning_output_tokens: 50, total_tokens: 40_200 }, thread_token_usage: { total_tokens: 90_000 } } },
  ];
  write(home, '.codex/sessions/2026/09/21/rollout.jsonl', rows.map((row) => JSON.stringify(row)).join('\n'));
  write(home, '.codex/sessions/2026/09/22/other-workspace.jsonl', [
    { type: 'session_meta', payload: { cwd: path.join(home, 'other-workspace') } },
    { type: 'turn_context', payload: { model: 'other-model' } },
    { type: 'token_usage_record', payload: { usage: { input_tokens: 999_999 } } },
  ].map((row) => JSON.stringify(row)).join('\n'));
  fs.mkdirSync(workspace, { recursive: true });

  const codex = scanEnvironment({ home, workspace }).harnesses.codex;

  assert.deepEqual(codex.modelCatalog.models[0], {
    id: 'gpt-test', name: 'GPT Test', contextWindowTokens: 90_000, rawContextWindowTokens: 100_000,
    maxContextWindowTokens: 400_000, effectiveContextWindowPercent: 90, defaultReasoningLevel: 'medium',
  });
  assert.equal(codex.modelCatalog.models.length, 1);
  assert.equal(codex.modelCatalog.selectedModel, 'gpt-test');
  assert.equal(codex.sessionTelemetry.firstUsage.inputTokens, 10_000);
  assert.equal(codex.sessionTelemetry.latestUsage.inputTokens, 40_000);
  assert.equal(codex.sessionTelemetry.latestUsage.cachedInputTokens, 32_000);
  assert.equal(codex.sessionTelemetry.threadUsage.totalTokens, 90_000);
  assert.equal(codex.sessionTelemetry.compactionCount, 1);
  assert.equal(codex.sessionTelemetry.contextWindowTokens, 90_000);
  assert.equal(JSON.stringify(codex).includes('PRIVATE'), false);
});

test('Codex context budget uses observed first and latest input context without double counting inventory', () => {
  const snapshot = { harnesses: { codex: {
    alwaysOn: { agentsMd: { tokenEstimate: 1_000 } },
    skillGroups: [{ skillCount: 20, metadataTokenEstimate: 4_000 }],
    sessionTelemetry: {
      startModel: 'gpt-test', currentModel: 'gpt-test', contextWindowTokens: 90_000, compactionCount: 1,
      firstUsage: { inputTokens: 10_000, cachedInputTokens: 8_000, outputTokens: 100, reasoningOutputTokens: 20, totalTokens: 10_100 },
      latestUsage: { inputTokens: 40_000, cachedInputTokens: 32_000, outputTokens: 200, reasoningOutputTokens: 50, totalTokens: 40_200 },
      threadUsage: { totalTokens: 90_000 },
    },
  } } };
  const profile = { id: 'gpt-test', name: 'GPT Test', harness: 'codex', contextWindowTokens: 90_000 };

  const first = buildContextBudget(snapshot, profile, null, 'first-session');
  const current = buildContextBudget(snapshot, profile, null, 'observed-session');

  assert.equal(first.usedTokens, 10_000);
  assert.equal(first.categories.reduce((sum, category) => sum + category.tokens, 0), 10_000);
  assert.equal(first.categories.find((category) => category.id === 'unattributed').tokens, 5_000);
  assert.equal(first.confidence, 'observed-codex');
  assert.equal(current.usedTokens, 40_000);
  assert.equal(current.freeTokens, 50_000);
  assert.equal(current.supplemental.cachedInputTokens, 32_000);
  assert.equal(current.supplemental.threadTotalTokens, 90_000);
  assert.equal(current.supplemental.compactionCount, 1);
});

test('Codex telemetry tolerates malformed lines and sparse model metadata', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'workspace');
  write(home, '.codex/models_cache.json', JSON.stringify({ models: [
    null,
    { description: 'missing slug' },
    { slug: 'sparse-model' },
  ] }));
  write(home, '.codex/sessions/2026/09/21/sparse.jsonl', [
    JSON.stringify({ type: 'session_meta', payload: { cwd: workspace } }),
    'not json',
    JSON.stringify({ type: 'turn_context', timestamp: 'one', payload: { model: 'sparse-model', model_reasoning_effort: 'low' } }),
    JSON.stringify({ type: 'event_msg', timestamp: 'two', payload: { type: 'token_count', info: { model_context_window: 12_345 } } }),
    JSON.stringify({ type: 'token_usage_record', timestamp: 'three', payload: { usage: { input_tokens: 123 } } }),
  ].join('\n'));
  fs.mkdirSync(workspace, { recursive: true });

  const codex = scanEnvironment({ home, workspace }).harnesses.codex;

  assert.equal(codex.sessionTelemetry.currentModel, 'sparse-model');
  assert.equal(codex.sessionTelemetry.reasoningEffort, 'low');
  assert.equal(codex.sessionTelemetry.contextWindowTokens, 12_345);
  assert.deepEqual(codex.sessionTelemetry.latestUsage, {
    inputTokens: 123, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0,
  });
  assert.equal(codex.sessionTelemetry.threadUsage, null);
  assert.deepEqual(codex.modelCatalog.models[0], {
    id: 'sparse-model', name: 'sparse-model', contextWindowTokens: null, rawContextWindowTokens: null,
    maxContextWindowTokens: null, effectiveContextWindowPercent: 100, defaultReasoningLevel: null,
  });
});

test('Codex context budget exposes safe zero-state and cross-model proxy behavior', () => {
  const empty = buildContextBudget({ harnesses: { codex: { alwaysOn: {}, skillGroups: [] } } }, {
    id: 'unseen', name: 'Unseen', harness: 'codex', contextWindowTokens: null,
  }, null, 'observed-session');
  assert.equal(empty.usedTokens, 0);
  assert.equal(empty.freeTokens, null);
  assert.equal(empty.usagePercent, null);
  assert.equal(empty.confidence, 'cross-model-proxy');
  assert.equal(empty.supplemental.cachedInputTokens, 0);

  const proxied = buildContextBudget({ harnesses: { codex: {
    alwaysOn: {}, skillGroups: [],
    sessionTelemetry: { startModel: 'original', firstUsage: { inputTokens: 500 } },
  } } }, { id: 'other', name: 'Other', harness: 'codex', contextWindowTokens: 1_000 }, null, 'first-session');
  assert.equal(proxied.usedTokens, 500);
  assert.equal(proxied.freeTokens, 500);
  assert.equal(proxied.confidence, 'cross-model-proxy');
  assert.equal(proxied.categories[0].confidence, 'proxy');
});

test('Codex runtime reader throttles reparsing and refreshes after its cache interval', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'workspace');
  let now = 0;
  write(home, '.codex/models_cache.json', JSON.stringify({ models: [{ slug: 'gpt-live', display_name: 'GPT Live', visibility: 'list', context_window: 1_000 }] }));
  const session = '.codex/sessions/2026/09/21/live.jsonl';
  const turn = { type: 'turn_context', payload: { model: 'gpt-live' } };
  const usage = (inputTokens) => ({ type: 'token_usage_record', timestamp: `time-${inputTokens}`, payload: { usage: { input_tokens: inputTokens } } });
  write(home, session, `${JSON.stringify({ type: 'session_meta', payload: { cwd: workspace } })}\n${JSON.stringify(turn)}\n${JSON.stringify(usage(100))}\n`);
  const read = createCodexRuntimeReader({ home, workspace, minRefreshMs: 1_000, now: () => now });

  const first = read();
  fs.appendFileSync(path.join(home, session), `${JSON.stringify(usage(200))}\n`);
  now = 500;
  const cached = read();
  now = 1_001;
  const refreshed = read();

  assert.equal(first.sessionTelemetry.latestUsage.inputTokens, 100);
  assert.equal(cached.sessionTelemetry.latestUsage.inputTokens, 100);
  assert.equal(refreshed.sessionTelemetry.latestUsage.inputTokens, 200);
  assert.equal(refreshed.modelCatalog.selectedModel, 'gpt-live');
});

test('live Codex runtime merges immutably into a loaded snapshot', () => {
  const snapshot = { harnesses: { claude: { marker: 'keep' }, codex: { hookCount: 3, sessionTelemetry: { updatedAt: 'old' } } } };
  const runtime = { sessionTelemetry: { updatedAt: 'new' }, modelCatalog: { selectedModel: 'gpt-live', models: [] } };

  const merged = mergeCodexRuntime(snapshot, runtime);

  assert.notEqual(merged, snapshot);
  assert.notEqual(merged.harnesses.codex, snapshot.harnesses.codex);
  assert.equal(merged.harnesses.claude, snapshot.harnesses.claude);
  assert.equal(merged.harnesses.codex.hookCount, 3);
  assert.equal(merged.harnesses.codex.sessionTelemetry.updatedAt, 'new');
});

test('live Claude runtime merges into its own harness and polls only while visible', () => {
  const snapshot = { harnesses: { claude: { hookCount: 3 }, codex: { marker: 'keep' } } };
  const merged = mergeHarnessRuntime(snapshot, 'claude', { sessionTelemetry: { updatedAt: 'new' } });
  assert.equal(merged.harnesses.claude.hookCount, 3);
  assert.equal(merged.harnesses.claude.sessionTelemetry.updatedAt, 'new');
  assert.equal(merged.harnesses.codex, snapshot.harnesses.codex);
  assert.equal(shouldPollHarnessRuntime('claude', 'visible'), true);
  assert.equal(shouldPollHarnessRuntime('claude', 'hidden'), false);
  assert.equal(shouldPollHarnessRuntime('codex', 'visible'), true);
});

test('Codex live polling runs only on the visible Codex dashboard', () => {
  assert.equal(shouldPollCodexRuntime('codex', 'visible'), true);
  assert.equal(shouldPollCodexRuntime('claude', 'visible'), false);
  assert.equal(shouldPollCodexRuntime('codex', 'hidden'), false);
});

test('changed Claude inventory invalidates old context calibration instead of reporting stale usage as current', () => {
  const baseline = {
    enabledPlugins: ['ecc@ecc'], hookCount: 2, claudeMdTokens: 100, ruleBytes: 400,
    skillGroups: [{ id: 'ecc@ecc', skillCount: 300, metadataTokenEstimate: 12_000 }],
  };
  const calibration = {
    modelId: 'claude-opus-5', contextWindowTokens: 1_000_000, autocompactBufferTokens: 33_000,
    inventoryBaseline: baseline,
    categories: [
      { id: 'systemPrompt', label: 'System prompt', tokens: 4_000 },
      { id: 'skills', label: 'Skills', tokens: 8_000, count: 500 },
      { id: 'messages', label: 'Messages', tokens: 10_000 },
    ],
  };
  const profile = { id: 'claude-opus-5', name: 'Opus 5', harness: 'claude', contextWindowTokens: 1_000_000 };
  const old = { harnesses: { claude: {
    enabledPlugins: ['ecc@ecc'], hookCount: 2, alwaysOn: { claudeMd: { tokenEstimate: 100 }, ruleBytes: 400 },
    skillGroups: [{ id: 'ecc@ecc', skillCount: 300, metadataTokenEstimate: 12_000 }],
  } } };
  const changed = { harnesses: { claude: {
    ...old.harnesses.claude,
    enabledPlugins: [],
    skillGroups: [{ id: 'user-skills', skillCount: 73, metadataTokenEstimate: 8_481 }],
  } } };

  const matched = buildContextBudget(old, profile, calibration, 'first-session');
  const current = buildContextBudget(changed, profile, calibration, 'first-session');
  const historical = buildContextBudget(changed, profile, calibration, 'observed-session');

  assert.equal(matched.confidence, 'observed-baseline');
  assert.equal(current.confidence, 'stale-calibration');
  assert.equal(current.usedTokens, 8_681);
  assert.equal(current.freeTokens, null);
  assert.equal(current.categories.find((category) => category.id === 'skills').count, 73);
  assert.equal(current.categories.find((category) => category.id === 'skills').tokens, 8_481);
  assert.equal(current.categories.find((category) => category.id === 'systemPrompt').confidence, 'unknown');
  assert.equal(historical.confidence, 'historical-observation');
  assert.equal(historical.categories.find((category) => category.id === 'skills').count, 500);
});

test('missing inventory provenance cannot certify a Claude calibration as current', () => {
  const budget = buildContextBudget({ harnesses: { claude: { alwaysOn: {}, skillGroups: [] } } },
    { id: 'claude-opus-5', harness: 'claude', contextWindowTokens: 1_000_000 },
    { modelId: 'claude-opus-5', categories: [{ id: 'skills', tokens: 9_800, count: 534 }] });

  assert.equal(budget.confidence, 'stale-calibration');
  assert.equal(budget.usedTokens, 0);
  assert.equal(budget.freeTokens, null);
});

test('new snapshots auto-select only when the viewer was already on the newest snapshot', () => {
  const previous = ['scan-2.json', 'scan-1.json'];
  const updated = ['scan-3.json', ...previous];
  assert.equal(selectSnapshotOnRefresh(previous, 'scan-2.json', updated), 'scan-3.json');
  assert.equal(selectSnapshotOnRefresh(previous, 'scan-1.json', updated), 'scan-1.json');
  assert.equal(selectSnapshotOnRefresh(previous, 'missing.json', updated), 'scan-3.json');
  assert.equal(selectSnapshotOnRefresh([], null, updated), 'scan-3.json');
});

test('model profile merge preserves context capacity discovered from the Codex cache', () => {
  const snapshot = { harnesses: { codex: { modelCatalog: {
    selectedModel: 'gpt-local',
    models: [{ id: 'gpt-local', name: 'GPT Local', contextWindowTokens: 258_400, maxContextWindowTokens: 872_000 }],
  } } } };

  const [profile] = mergeModelProfiles(snapshot, { profiles: [] }, 'codex');

  assert.equal(profile.contextWindowTokens, 258_400);
  assert.equal(profile.maxContextWindowTokens, 872_000);
  assert.equal(profile.selected, true);
});

test('Codex model profile keeps local session and published API capacities separate', () => {
  const snapshot = { harnesses: { codex: {
    modelCatalog: { selectedModel: 'gpt-5.6-sol', models: [{
      id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', contextWindowTokens: 258_400,
      rawContextWindowTokens: 272_000, maxContextWindowTokens: 872_000, effectiveContextWindowPercent: 95,
    }] },
    sessionTelemetry: { currentModel: 'gpt-5.6-sol', contextWindowTokens: 300_000 },
  } } };
  const [profile] = mergeModelProfiles(snapshot, contextProfiles, 'codex');

  assert.equal(profile.contextWindowTokens, 300_000);
  assert.equal(profile.contextWindowSource, 'session');
  assert.equal(profile.rawContextWindowTokens, 272_000);
  assert.equal(profile.maxContextWindowTokens, 872_000);
  assert.equal(profile.apiContextWindowTokens, 1_050_000);
  assert.equal(buildContextBudget(snapshot, profile, null, 'observed-session').contextWindowTokens, 300_000);
});

test('Codex model tabs do not advertise API profiles absent from the local catalog', () => {
  const snapshot = { harnesses: { codex: {
    modelCatalog: { selectedModel: 'gpt-5.6-sol', models: [{ id: 'gpt-5.6-sol', contextWindowTokens: 258_400 }] },
  } } };
  const profiles = mergeModelProfiles(snapshot, contextProfiles, 'codex');

  assert.deepEqual(profiles.map((profile) => profile.id), ['gpt-5.6-sol']);
  assert.equal(profiles[0].apiContextWindowTokens, 1_050_000);
});

test('Kiro IDE session telemetry records observed context percentage without prompt text', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'workspace');
  write(home, '.kiro/sessions/bucket1/sess_a/session.json', JSON.stringify({
    id: 'sess_a', title: 'PRIVATE SESSION TITLE', agentMode: 'vibe',
    workspacePaths: [workspace], modelId: 'claude-opus-5',
  }));
  write(home, '.kiro/sessions/bucket1/sess_a/messages.jsonl', [
    { id: 'm1', timestamp: '2026-09-24T09:10:00.000Z', payload: { type: 'user', content: 'PRIVATE PROMPT' } },
    { id: 'm2', timestamp: '2026-09-24T09:10:49.787Z', payload: { type: 'session_metadata', key: 'contextUsage', value: { usagePercentage: 4.5 } } },
    { id: 'm3', timestamp: '2026-09-24T09:11:00.000Z', payload: { type: 'session_metadata', key: 'otherKey', value: { usagePercentage: 99 } } },
    { id: 'm4', timestamp: '2026-09-24T09:12:00.000Z', payload: { type: 'session_metadata', key: 'contextUsage', value: { usagePercentage: 11.6 } } },
    { id: 'm5', timestamp: '2026-09-24T09:12:01.000Z', payload: { type: 'usage_summary', status: 'success', promptTurnSummaries: [{ unit: 'credit', usage: 5.25, usedTools: ['read_file'] }] } },
  ].map((row) => JSON.stringify(row)).concat('not json').join('\n'));
  write(home, '.kiro/sessions/bucket2/sess_b/session.json', JSON.stringify({ workspacePaths: [path.join(home, 'elsewhere')], modelId: 'claude-sonnet-5' }));
  write(home, '.kiro/sessions/bucket2/sess_b/messages.jsonl', JSON.stringify({ timestamp: 'other', payload: { type: 'session_metadata', key: 'contextUsage', value: { usagePercentage: 77.7 } } }));
  fs.mkdirSync(workspace, { recursive: true });

  const snapshot = scanEnvironment({ home, workspace });
  const telemetry = snapshot.harnesses.kiro.sessionTelemetry;

  assert.equal(telemetry.store, 'ide');
  assert.equal(telemetry.sourcePath.includes('sess_a'), true);
  assert.equal(telemetry.firstUsagePercent, 4.5);
  assert.equal(telemetry.latestUsagePercent, 11.6);
  assert.equal(telemetry.sampleCount, 2);
  assert.equal(telemetry.currentModel, 'claude-opus-5');
  assert.equal(telemetry.contextWindowTokens, null);
  assert.equal(telemetry.creditsUsed, 5.25);
  assert.equal(telemetry.updatedAt, '2026-09-24T09:12:00.000Z');
  assert.equal(snapshot.harnesses.kiro.modelCatalog.selectedModel, 'claude-opus-5');
  assert.equal(JSON.stringify(snapshot).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(snapshot).includes('77.7'), false);
});

test('Kiro prefers the newest session store and never reads prompt history files', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'workspace');
  write(home, '.kiro/sessions/bucket1/sess_a/session.json', JSON.stringify({ workspacePaths: [workspace], modelId: 'claude-sonnet-5' }));
  write(home, '.kiro/sessions/bucket1/sess_a/messages.jsonl', JSON.stringify({ timestamp: 'older', payload: { type: 'session_metadata', key: 'contextUsage', value: { usagePercentage: 3.3 } } }));
  write(home, '.kiro/sessions/cli/s1.history', 'PRIVATE HISTORY PROMPT');
  write(home, '.kiro/sessions/cli/s1.json', JSON.stringify({
    session_id: 's1', cwd: path.join(workspace, 'nested'), created_at: 'created', updated_at: 'updated',
    session_state: {
      conversation_metadata: {
        user_turn_metadatas: [
          { input_token_count: 0, output_token_count: 0, cache_read_input_token_count: 0, context_usage_percentage: 2.1, model: 'claude-opus-5', end_timestamp: 'turn-one', metering_usage: [{ value: 0.5, unit: 'credit' }], user_prompt_length: 7 },
          { input_token_count: 0, context_usage_percentage: 7.3, model: 'claude-opus-5', end_timestamp: 'turn-two', metering_usage: [{ value: 1.75, unit: 'credit' }] },
        ],
      },
      rts_model_state: { context_usage_percentage: 7.3, model_info: { model_id: 'claude-opus-5', context_window_tokens: 1_000_000 } },
    },
  }));
  write(home, '.kiro/sessions/cli/other.json', JSON.stringify({ cwd: path.join(home, 'elsewhere'), session_state: { rts_model_state: { context_usage_percentage: 55.5 } } }));
  fs.mkdirSync(workspace, { recursive: true });
  const older = new Date('2026-09-20T00:00:00Z');
  fs.utimesSync(path.join(home, '.kiro/sessions/bucket1/sess_a/messages.jsonl'), older, older);

  const snapshot = scanEnvironment({ home, workspace });
  const telemetry = snapshot.harnesses.kiro.sessionTelemetry;

  assert.equal(telemetry.store, 'cli');
  assert.equal(telemetry.firstUsagePercent, 2.1);
  assert.equal(telemetry.latestUsagePercent, 7.3);
  assert.equal(telemetry.sampleCount, 2);
  assert.equal(telemetry.contextWindowTokens, 1_000_000);
  assert.equal(telemetry.creditsUsed, 2.25);
  assert.equal(telemetry.startModel, 'claude-opus-5');
  assert.equal(telemetry.firstObservedAt, 'turn-one');
  assert.equal(telemetry.updatedAt, 'turn-two');
  assert.equal(JSON.stringify(snapshot).includes('PRIVATE HISTORY'), false);
  assert.equal(JSON.stringify(snapshot).includes('55.5'), false);
});

test('Kiro session telemetry falls back to session-level percentage and stays null without sessions', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'workspace');
  write(home, '.kiro/sessions/cli/sparse.json', JSON.stringify({
    cwd: workspace, updated_at: 'sparse-updated',
    session_state: { conversation_metadata: { user_turn_metadatas: [] }, rts_model_state: { context_usage_percentage: 1.8615, model_info: { model_id: 'claude-opus-5', context_window_tokens: 1_000_000 } } },
  }));
  write(home, '.kiro/sessions/cli/empty.json', JSON.stringify({ cwd: workspace, session_state: {} }));
  fs.mkdirSync(workspace, { recursive: true });

  const telemetry = scanEnvironment({ home, workspace }).harnesses.kiro.sessionTelemetry;

  assert.equal(telemetry.firstUsagePercent, 1.8615);
  assert.equal(telemetry.latestUsagePercent, 1.8615);
  assert.equal(telemetry.sampleCount, 1);
  assert.equal(telemetry.updatedAt, 'sparse-updated');

  const bare = scanEnvironment({ home: fixtureHome(), workspace });
  assert.equal(bare.harnesses.kiro.sessionTelemetry, null);
  assert.equal(bare.harnesses.kiro.crewUsage, null);
});

test('Kiro Crew usage is reported separately because it cannot be attributed to a workspace', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'workspace');
  write(home, '.kiro/crew/usage/tokens/2026-09-20.jsonl', [
    JSON.stringify({ _type: 'tokens', ts: '2026-09-20T10:00:00+09:00', surface: 'dashboard', model: 'claude-opus-5', input: 0, output: 0, credits: 1.5, context_window: 1_000_000 }),
    'broken line',
    JSON.stringify({ _type: 'other', credits: 900 }),
    JSON.stringify({ _type: 'tokens', ts: '2026-09-20T11:00:00+09:00', surface: 'cron', model: 'auto', input: 0, credits: 0.25 }),
  ].join('\n'));
  write(home, '.kiro/crew/usage/tokens/2026-09-21.jsonl', JSON.stringify({ _type: 'tokens', ts: '2026-09-21T09:00:00+09:00', surface: 'bg:tips', credits: 0.5 }));
  fs.mkdirSync(workspace, { recursive: true });

  const crewUsage = scanEnvironment({ home, workspace }).harnesses.kiro.crewUsage;

  assert.equal(crewUsage.recordCount, 3);
  assert.equal(crewUsage.creditsTotal, 2.25);
  assert.equal(crewUsage.firstDate, '2026-09-20');
  assert.equal(crewUsage.lastDate, '2026-09-21');
  assert.equal(crewUsage.workspaceAttributable, false);
});

test('Kiro context budget reports observed percentage and leaves absolute tokens unmeasured', () => {
  const snapshot = { harnesses: { kiro: {
    steering: { tokenEstimate: 300 },
    skillGroups: [{ skillCount: 4, metadataTokenEstimate: 200 }],
    sessionTelemetry: {
      store: 'cli', startModel: 'claude-opus-5', currentModel: 'claude-opus-5', contextWindowTokens: 1_000_000,
      contextWindowSource: 'session',
      firstUsagePercent: 2.1, latestUsagePercent: 7.3, sampleCount: 2, creditsUsed: 2.25,
      firstObservedAt: 'turn-one', updatedAt: 'turn-two',
    },
    crewUsage: { recordCount: 3, creditsTotal: 4.5, firstDate: '2026-09-20', lastDate: '2026-09-21', workspaceAttributable: false },
  } } };
  const profile = { id: 'claude-opus-5', name: 'Opus 5', harness: 'kiro', contextWindowTokens: 1_000_000 };

  const first = buildContextBudget(snapshot, profile, null, 'first-session');
  const latest = buildContextBudget(snapshot, profile, null, 'observed-session');

  assert.equal(first.usagePercent, 2.1);
  assert.equal(first.observedAt, 'turn-one');
  assert.equal(latest.usagePercent, 7.3);
  assert.equal(latest.usedTokens, null);
  assert.equal(latest.freeTokens, null);
  assert.equal(latest.bufferTokens, 0);
  assert.equal(latest.confidence, 'observed-kiro-percent');
  assert.equal(latest.categories.find((category) => category.id === 'skills').tokens, 200);
  assert.equal(latest.categories.find((category) => category.id === 'memoryFiles').tokens, 300);
  assert.equal(latest.breakdownTokens, 500);
  assert.equal(latest.supplemental.creditsUsed, 2.25);
  assert.equal(latest.supplemental.sampleCount, 2);
  assert.equal(latest.supplemental.crewCreditsTotal, 4.5);
  assert.equal(latest.supplemental.contextWindowSource, 'session');
  assert.equal(latest.observedAt, 'turn-two');

  const proxied = buildContextBudget(snapshot, { id: 'claude-sonnet-5', harness: 'kiro', contextWindowTokens: 1_000_000 }, null, 'observed-session');
  assert.equal(proxied.confidence, 'cross-model-proxy');
  assert.equal(proxied.categories[0].confidence, 'proxy');
});

test('Kiro model tabs come from session telemetry and keep the session context window', () => {
  const snapshot = { harnesses: { kiro: {
    modelCatalog: { selectedModel: 'claude-opus-5', models: [] },
    sessionTelemetry: { startModel: 'claude-sonnet-5', currentModel: 'claude-opus-5', contextWindowTokens: 1_000_000 },
  } } };

  const profiles = mergeModelProfiles(snapshot, { profiles: [] }, 'kiro');
  const opus = profiles.find((profile) => profile.id === 'claude-opus-5');

  assert.deepEqual(profiles.map((profile) => profile.id).sort(), ['claude-opus-5', 'claude-sonnet-5']);
  assert.equal(opus.selected, true);
  assert.equal(opus.harness, 'kiro');
  assert.equal(opus.contextWindowTokens, 1_000_000);
  assert.equal(opus.contextWindowSource, 'session');
  assert.equal(profiles.find((profile) => profile.id === 'claude-sonnet-5').contextWindowTokens, null);
});

test('Kiro falls back to static file estimates when no session telemetry exists', () => {
  const budget = buildContextBudget({ harnesses: { kiro: {
    steering: { tokenEstimate: 120 }, skillGroups: [{ skillCount: 3, metadataTokenEstimate: 80 }], sessionTelemetry: null,
  } } }, { id: 'claude-opus-5', harness: 'kiro', contextWindowTokens: 1_000_000 }, null, 'observed-session');

  assert.equal(budget.confidence, 'static-estimate');
  assert.equal(budget.usedTokens, 200);
  assert.equal(budget.usagePercent, 0.02);
});


test('discovers symlinked assets while surviving broken links and directory cycles', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'workspace');
  write(home, 'shared/rules/coding-style.md', 'SHARED RULE BODY');
  write(home, 'shared/skills/eli5/SKILL.md', '---\nname: eli5\ndescription: shared skill\n---\nbody\n');
  fs.mkdirSync(path.join(home, '.kiro/steering'), { recursive: true });
  fs.mkdirSync(path.join(home, '.kiro/skills'), { recursive: true });
  fs.symlinkSync(path.join(home, 'shared/rules/coding-style.md'), path.join(home, '.kiro/steering/coding-style.md'));
  fs.symlinkSync(path.join(home, 'shared/skills/eli5'), path.join(home, '.kiro/skills/eli5'));
  fs.symlinkSync(path.join(home, 'missing/target'), path.join(home, '.kiro/skills/broken'));
  fs.symlinkSync(path.join(home, '.kiro/skills'), path.join(home, 'shared/skills/eli5/loop'));
  fs.mkdirSync(workspace, { recursive: true });

  const kiro = scanEnvironment({ home, workspace }).harnesses.kiro;

  assert.equal(kiro.steering.fileCount, 1);
  assert.equal(kiro.steering.bytes, Buffer.byteLength('SHARED RULE BODY'));
  assert.equal(kiro.skillGroups.find((group) => group.id === 'user-skills').skillCount, 1);
});

test('counts a symlinked skill once per harness group instead of following duplicate links', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'workspace');
  write(home, 'shared/skills/eli5/SKILL.md', '---\nname: eli5\ndescription: shared\n---\nbody\n');
  fs.mkdirSync(path.join(home, '.kiro/skills'), { recursive: true });
  fs.symlinkSync(path.join(home, 'shared/skills'), path.join(home, '.kiro/skills/first'));
  fs.symlinkSync(path.join(home, 'shared/skills'), path.join(home, '.kiro/skills/second'));
  fs.mkdirSync(workspace, { recursive: true });

  const group = scanEnvironment({ home, workspace }).harnesses.kiro.skillGroups
    .find((candidate) => candidate.id === 'user-skills');

  assert.equal(group.skillCount, 1);
});

test('symlinked Claude rules and agent definitions reach the configuration cost list', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'workspace');
  write(home, 'shared/testing.md', 'SHARED TESTING RULE');
  fs.mkdirSync(path.join(home, '.claude/rules'), { recursive: true });
  fs.symlinkSync(path.join(home, 'shared/testing.md'), path.join(home, '.claude/rules/testing.md'));
  fs.mkdirSync(workspace, { recursive: true });

  const claude = scanEnvironment({ home, workspace }).harnesses.claude;

  assert.equal(claude.alwaysOn.ruleFiles, 1);
  assert.equal(claude.alwaysOn.ruleBytes, Buffer.byteLength('SHARED TESTING RULE'));
  assert.equal(claude.configurationCosts.filter((item) => item.kind === 'rules').length, 1);
});


test('Kiro hook count sums v2 hook definitions from home and workspace without copying commands', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'workspace');
  write(home, '.kiro/hooks/global.json', JSON.stringify({ version: 'v1', hooks: [
    { name: 'format', trigger: 'PostFileSave', action: { type: 'command', command: 'SECRET COMMAND' } },
    { name: 'greet', trigger: 'SessionStart', action: { type: 'agent', prompt: 'PRIVATE PROMPT' } },
  ] }));
  write(home, 'workspace/.kiro/hooks/local.json', JSON.stringify({ version: 'v1', hooks: [{ name: 'stop', trigger: 'Stop', action: { type: 'command', command: 'echo' } }] }));
  write(home, 'workspace/.kiro/hooks/broken.json', '{ not json');

  const snapshot = scanEnvironment({ home, workspace });

  assert.equal(snapshot.harnesses.kiro.hookCount, 3);
  assert.equal(JSON.stringify(snapshot).includes('SECRET COMMAND'), false);
  assert.equal(JSON.stringify(snapshot).includes('PRIVATE PROMPT'), false);
});

test('Kiro reuses a locally observed context window when the winning session store lacks one', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'workspace');
  write(home, '.kiro/sessions/bucket1/sess_a/session.json', JSON.stringify({ workspacePaths: [workspace], modelId: 'claude-opus-5' }));
  write(home, '.kiro/sessions/bucket1/sess_a/messages.jsonl', JSON.stringify({ timestamp: 'now', payload: { type: 'session_metadata', key: 'contextUsage', value: { usagePercentage: 18.4 } } }));
  write(home, '.kiro/sessions/cli/older.json', JSON.stringify({
    cwd: workspace,
    session_state: { rts_model_state: { context_usage_percentage: 1.86, model_info: { model_id: 'claude-opus-5', context_window_tokens: 1_000_000 } } },
  }));
  write(home, '.kiro/sessions/cli/other-model.json', JSON.stringify({
    cwd: workspace,
    session_state: { rts_model_state: { context_usage_percentage: 4, model_info: { model_id: 'claude-sonnet-5', context_window_tokens: 200_000 } } },
  }));
  fs.mkdirSync(workspace, { recursive: true });
  const older = new Date('2026-09-20T00:00:00Z');
  fs.utimesSync(path.join(home, '.kiro/sessions/cli/older.json'), older, older);
  fs.utimesSync(path.join(home, '.kiro/sessions/cli/other-model.json'), older, older);

  const telemetry = scanEnvironment({ home, workspace }).harnesses.kiro.sessionTelemetry;

  assert.equal(telemetry.store, 'ide');
  assert.equal(telemetry.latestUsagePercent, 18.4);
  assert.equal(telemetry.contextWindowTokens, 1_000_000);
  assert.equal(telemetry.contextWindowSource, 'peer-session');
});


test('Kiro runtime reader throttles reparsing and refreshes after its cache interval', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'workspace');
  let now = 0;
  const session = '.kiro/sessions/bucket1/sess_live/messages.jsonl';
  write(home, '.kiro/sessions/bucket1/sess_live/session.json', JSON.stringify({ workspacePaths: [workspace], modelId: 'claude-opus-5' }));
  const sample = (percent) => JSON.stringify({ timestamp: `time-${percent}`, payload: { type: 'session_metadata', key: 'contextUsage', value: { usagePercentage: percent } } });
  write(home, session, `${sample(4.5)}\n`);
  fs.mkdirSync(workspace, { recursive: true });
  const read = createKiroRuntimeReader({ home, workspace, minRefreshMs: 1_000, now: () => now });

  const first = read();
  fs.appendFileSync(path.join(home, session), `${sample(18.4)}\n`);
  now = 500;
  const cached = read();
  now = 1_001;
  const refreshed = read();

  assert.equal(first.sessionTelemetry.latestUsagePercent, 4.5);
  assert.equal(cached.sessionTelemetry.latestUsagePercent, 4.5);
  assert.equal(refreshed.sessionTelemetry.latestUsagePercent, 18.4);
  assert.equal(refreshed.sessionTelemetry.firstUsagePercent, 4.5);
  assert.equal(refreshed.modelCatalog.selectedModel, 'claude-opus-5');
});

test('dashboard serves the Kiro runtime endpoint and polls it while visible', async () => {
  const server = createDashboardServer({
    snapshotDirectory: fixtureHome(),
    publicDirectory: path.join(__dirname, '..', 'public'),
    kiroRuntimeReader: () => ({ sessionTelemetry: { latestUsagePercent: 24.9 }, modelCatalog: { selectedModel: 'claude-opus-5', models: [] } }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const body = await new Promise((resolve, reject) => {
    require('node:http').get({ hostname: '127.0.0.1', port, path: '/api/runtime/kiro' }, (response) => {
      let text = '';
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve(text));
    }).on('error', reject);
  });

  try {
    assert.equal(JSON.parse(body).sessionTelemetry.latestUsagePercent, 24.9);
    assert.equal(shouldPollHarnessRuntime('kiro', 'visible'), true);
    assert.equal(shouldPollHarnessRuntime('kiro', 'hidden'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('telemetry summary unifies three harnesses on percentage', () => {
  const summary = telemetrySummary({
    claude: { modelCatalog: { selectedModel: 'claude-opus-5' }, sessionTelemetry: { currentModel: 'claude-opus-5', latestUsage: { inputTokens: 250_000 }, updatedAt: 'c-time' } },
    codex: { modelCatalog: { models: [{ id: 'gpt-sol', contextWindowTokens: 200_000 }] }, sessionTelemetry: { currentModel: 'gpt-sol', contextWindowTokens: 100_000, latestUsage: { inputTokens: 25_000 }, updatedAt: 'x-time' } },
    kiro: { modelCatalog: { selectedModel: 'claude-opus-5' }, sessionTelemetry: { currentModel: 'claude-opus-5', contextWindowTokens: 1_000_000, latestUsagePercent: 24.9, store: 'ide', updatedAt: 'k-time' } },
  }, { profiles: [{ id: 'claude-opus-5', harness: 'claude', contextWindowTokens: 1_000_000 }] });

  assert.deepEqual(Object.keys(summary).sort(), ['claude', 'codex', 'kiro']);
  assert.equal(summary.claude.usagePercent, 25);
  assert.equal(summary.claude.inputTokens, 250_000);
  assert.equal(summary.claude.contextWindowTokens, 1_000_000);
  assert.equal(summary.claude.observedAt, 'c-time');
  assert.equal(summary.codex.usagePercent, 25);
  assert.equal(summary.codex.contextWindowTokens, 100_000);
  assert.equal(summary.kiro.usagePercent, 24.9);
  assert.equal(summary.kiro.inputTokens, null);
  assert.equal(summary.kiro.contextWindowTokens, 1_000_000);
  assert.equal(summary.kiro.store, 'ide');
});

test('telemetry summary reports unknown capacity and missing sessions as null', () => {
  const summary = telemetrySummary({
    claude: { modelCatalog: {}, sessionTelemetry: null },
    codex: { modelCatalog: { models: [] }, sessionTelemetry: { currentModel: 'unlisted', latestUsage: { inputTokens: 10 } } },
    kiro: { modelCatalog: {}, sessionTelemetry: null },
  }, { profiles: [] });

  assert.equal(summary.claude.model, null);
  assert.equal(summary.claude.inputTokens, null);
  assert.equal(summary.claude.usagePercent, null);
  assert.equal(summary.codex.inputTokens, 10);
  assert.equal(summary.codex.contextWindowTokens, null);
  assert.equal(summary.codex.usagePercent, null);
  assert.equal(summary.kiro.usagePercent, null);
});

test('CLI telemetry command prints session usage only, without an inventory scan', () => {
  const home = fixtureHome();
  const workspace = path.join(home, 'workspace');
  const project = `.claude/projects/${workspace.replace(/[^A-Za-z0-9]/g, '-')}`;
  write(home, `${project}/session.jsonl`, JSON.stringify({
    type: 'assistant', timestamp: 'c-time', message: { model: 'claude-opus-5', usage: { input_tokens: 500, cache_read_input_tokens: 0, output_tokens: 3 } },
  }));
  write(home, '.kiro/sessions/bucket1/sess_a/session.json', JSON.stringify({ workspacePaths: [workspace], modelId: 'claude-opus-5' }));
  write(home, '.kiro/sessions/bucket1/sess_a/messages.jsonl', JSON.stringify({ timestamp: 'k-time', payload: { type: 'session_metadata', key: 'contextUsage', value: { usagePercentage: 24.9 } } }));
  write(home, '.claude/skills/noise/SKILL.md', '---\nname: noise\n---\nINVENTORY BODY\n');
  fs.mkdirSync(workspace, { recursive: true });

  const result = spawnSync(process.execPath, [
    'src/cli.js', 'telemetry', '--home', home, '--workspace', workspace,
  ], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.harnesses.claude.inputTokens, 500);
  assert.equal(output.harnesses.kiro.usagePercent, 24.9);
  assert.equal(output.target.workspace, workspace);
  assert.equal(JSON.stringify(output).includes('skillGroups'), false);
  assert.equal(JSON.stringify(output).includes('INVENTORY BODY'), false);
});

test('CLI argument parsing accepts the telemetry command and rejects unknown commands', () => {
  assert.deepEqual(parseArgs(['telemetry', '--workspace', '/tmp/ws']), { command: 'telemetry', workspace: '/tmp/ws' });
  assert.throws(() => parseArgs(['telemetry', '--nope', 'x']), /Unknown option/);
});


test('context profiles cover the locally selected Claude model so its percentage resolves', () => {
  const profile = contextProfiles.profiles.find((candidate) => candidate.harness === 'claude' && candidate.id === 'claude-opus-5-5');

  assert.equal(profile.contextWindowTokens, 1_000_000);
  assert.ok(profile.capacitySource);

  const summary = telemetrySummary({
    claude: { modelCatalog: { selectedModel: 'claude-opus-5-5' }, sessionTelemetry: { currentModel: 'claude-opus-5-5', latestUsage: { inputTokens: 250_000 }, updatedAt: 'c-time' } },
  }, contextProfiles);

  assert.equal(summary.claude.contextWindowTokens, 1_000_000);
  assert.equal(summary.claude.usagePercent, 25);
});


test('audit ranks removable startup cost and never invents a number it cannot measure', () => {
  const snapshot = {
    generatedAt: '2026-09-24T10:00:00.000Z',
    target: { home: '/h', workspace: '/w' },
    harnesses: {
      claude: {
        alwaysOn: { claudeMd: { tokenEstimate: 254 }, ruleFiles: 6, ruleBytes: 10_790 },
        skillGroups: [
          { id: 'user-skills', skillCount: 18, metadataTokenEstimate: 3_000 },
          { id: 'ecc@ecc', skillCount: 292, metadataTokenEstimate: 27_000 },
        ],
        hookCount: 16,
        configuredMcpServerCount: 2,
        enabledPlugins: ['a', 'b'],
        sessionTelemetry: { currentModel: 'claude-opus-5-5', latestUsage: { inputTokens: 188_381 } },
      },
      codex: { alwaysOn: { agentsMd: { tokenEstimate: 586 } }, skillGroups: [], hookCount: 0, configuredMcpServerCount: 5, enabledPlugins: [] },
      kiro: { steering: { tokenEstimate: 2_275 }, skillGroups: [{ skillCount: 13, metadataTokenEstimate: 1_795 }], hookCount: 0 },
    },
  };

  const report = auditReport(snapshot, { profiles: [{ id: 'claude-opus-5-5', harness: 'claude', contextWindowTokens: 1_000_000 }] });
  const claude = report.harnesses.find((entry) => entry.id === 'claude');

  // Ranked largest first so the biggest win is the first thing read.
  assert.deepEqual(claude.findings.map((finding) => finding.id), ['skills', 'instructions']);
  assert.equal(claude.findings[0].tokens, 30_000);
  assert.equal(claude.findings[0].detail.includes('ecc@ecc'), true);
  assert.equal(claude.measuredStartupTokens, 30_254 + Math.round(10_790 / 4));

  // MCP is the loudest real cost and we cannot measure it, so it is declared, not guessed.
  assert.equal(claude.unmeasured.find((item) => item.id === 'mcp').count, 2);
  assert.equal(claude.unmeasured.find((item) => item.id === 'mcp').tokens, null);
  assert.equal(claude.unmeasured.find((item) => item.id === 'hooks').count, 16);

  // Kiro has steering but no token total from the session, so no percentage is fabricated.
  const kiro = report.harnesses.find((entry) => entry.id === 'kiro');
  assert.equal(kiro.measuredStartupTokens, 4_070);
  assert.equal(kiro.observedInputTokens, null);

  assert.equal(claude.observedInputTokens, 188_381);
  assert.equal(report.totalMeasuredStartupTokens, claude.measuredStartupTokens + 586 + 4_070);
});

test('audit text output leads with the number and states what is unmeasured', () => {
  const snapshot = {
    generatedAt: '2026-09-24T10:00:00.000Z',
    target: { home: '/h', workspace: '/w' },
    harnesses: {
      claude: {
        alwaysOn: { claudeMd: { tokenEstimate: 100 }, ruleFiles: 2, ruleBytes: 400 },
        skillGroups: [{ id: 'big@plugin', skillCount: 292, metadataTokenEstimate: 27_000 }],
        hookCount: 3, configuredMcpServerCount: 4, enabledPlugins: [],
      },
    },
  };

  const text = formatAudit(auditReport(snapshot, { profiles: [] }));

  assert.match(text, /27,200 tokens/);
  assert.match(text, /big@plugin/);
  assert.match(text, /4 MCP server/);
  assert.match(text, /not measured/i);
  assert.equal(text.includes('undefined'), false);
  assert.equal(text.includes('NaN'), false);
});

test('audit stays safe on an empty environment', () => {
  const report = auditReport({ harnesses: {} }, {});

  assert.deepEqual(report.harnesses, []);
  assert.equal(report.totalMeasuredStartupTokens, 0);
  assert.match(formatAudit(report), /No local agent configuration found/);
});
