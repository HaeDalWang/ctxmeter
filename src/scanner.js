const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function exists(directory) {
  try {
    return fs.statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function readJson(file, fallback = {}) {
  if (!fileExists(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function walkFiles(directory, predicate, files = [], visited = new Set(), tracking = false) {
  if (!exists(directory)) return files;

  // Cycle and duplicate tracking costs a realpath per directory, so it starts
  // only once a symlink has been followed. Neither can occur without one.
  if (tracking) {
    let realDirectory;
    try { realDirectory = fs.realpathSync(directory); } catch { return files; }
    if (visited.has(realDirectory)) return files;
    visited.add(realDirectory);
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const item = path.join(directory, entry.name);
    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      let stat;
      try { stat = fs.statSync(item); } catch { continue; }
      isDirectory = stat.isDirectory();
      isFile = stat.isFile();
      if (isDirectory) {
        walkFiles(item, predicate, files, visited, true);
        continue;
      }
    }
    if (isDirectory) walkFiles(item, predicate, files, visited, tracking);
    if (isFile && predicate(item)) files.push(item);
  }
  return files;
}

function classifyAssetPath(assetPath) {
  const normalized = assetPath.replaceAll('\\', '/');
  if (/\/(?:skills|agents|rules)\.bak\.[^/]+\//.test(normalized) || normalized.includes('/.backup/') || normalized.includes('/backups/')) {
    return 'backup';
  }
  if (normalized.includes('/plugins/marketplaces/')) return 'marketplace-source';
  if (normalized.includes('/.tmp/')) return 'staging';
  if (normalized.includes('/plugins/cache/')) return 'plugin-cache';
  if (normalized.includes('/plugins/synced/')) return 'synced-plugin';
  return 'active-candidate';
}

function skillMetadataBytes(file) {
  const frontmatter = skillFrontmatter(file);
  return frontmatter ? Buffer.byteLength(frontmatter) : 0;
}

function skillFrontmatter(file) {
  if (!fileExists(file)) return 0;
  const content = fs.readFileSync(file, 'utf8');
  if (!content.startsWith('---\n')) return '';
  const end = content.indexOf('\n---', 4);
  return end === -1 ? '' : content.slice(0, end + 5);
}

function declaredSkillName(frontmatter) {
  const match = frontmatter.match(/^name:\s*["']?([^\n"']+)["']?\s*$/m);
  return match ? match[1].trim() : null;
}

function skillAsset(file, groupDirectory) {
  const content = fs.readFileSync(file, 'utf8');
  const end = content.startsWith('---\n') ? content.indexOf('\n---', 4) : -1;
  const frontmatter = end === -1 ? '' : content.slice(0, end + 5);
  const metadataBytes = frontmatter ? Buffer.byteLength(frontmatter) : 0;
  const stat = fs.statSync(file);
  return {
    relativePath: path.relative(groupDirectory, file).replaceAll(path.sep, '/'),
    declaredName: declaredSkillName(frontmatter),
    status: classifyAssetPath(file),
    bodyBytes: stat.size,
    metadataBytes,
    metadataTokenEstimate: bytesToEstimate(metadataBytes),
    modifiedAt: stat.mtime.toISOString(),
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  };
}

function bytesToEstimate(bytes) {
  return Math.round(bytes / 4);
}

function skillGroup(id, directory, options = {}) {
  const allowedStatuses = options.allowedStatuses || new Set(['active-candidate', 'plugin-cache', 'synced-plugin']);
  const files = walkFiles(directory, (file) => path.basename(file) === 'SKILL.md')
    .filter((file) => allowedStatuses.has(classifyAssetPath(file)));
  const assets = files.map((file) => skillAsset(file, directory));
  const metadataBytes = assets.reduce((sum, asset) => sum + asset.metadataBytes, 0);

  return {
    id,
    path: directory,
    status: options.status || 'active-candidate',
    skillCount: files.length,
    metadataBytes,
    metadataTokenEstimate: bytesToEstimate(metadataBytes),
    assets,
  };
}

function countExcludedSkills(directory) {
  const excluded = {};
  const nonLoadableStatuses = new Set(['backup', 'marketplace-source', 'staging']);
  for (const file of walkFiles(directory, (candidate) => path.basename(candidate) === 'SKILL.md')) {
    const status = classifyAssetPath(file);
    if (nonLoadableStatuses.has(status)) excluded[status] = (excluded[status] || 0) + 1;
  }
  return excluded;
}

function countHooks(hooks) {
  if (!hooks || typeof hooks !== 'object') return 0;
  return Object.values(hooks).reduce((total, handlers) => total + (Array.isArray(handlers) ? handlers.length : 0), 0);
}

function enabledPluginIds(settings) {
  if (!settings || typeof settings.enabledPlugins !== 'object' || settings.enabledPlugins === null) return [];
  return Object.entries(settings.enabledPlugins)
    .filter(([, enabled]) => enabled === true)
    .map(([id]) => id)
    .sort();
}

function pluginCacheDirectory(claudeDirectory, pluginId) {
  const separator = pluginId.lastIndexOf('@');
  if (separator < 1) return null;
  const name = pluginId.slice(0, separator);
  const marketplace = pluginId.slice(separator + 1);
  const root = path.join(claudeDirectory, 'plugins', 'cache', marketplace, name);
  if (!exists(root)) return null;
  const versions = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
  return versions.length ? path.join(root, versions.at(-1)) : null;
}

function fileSummary(file) {
  if (!fileExists(file)) return null;
  const bytes = fs.statSync(file).size;
  return { path: file, bytes, tokenEstimate: bytesToEstimate(bytes) };
}

function costItem(kind, label, file, load) {
  const summary = fileSummary(file);
  return summary && { kind, label, path: file, count: 1, estimatedTokens: summary.tokenEstimate, load };
}

function directoryCostItems(kind, label, directory, suffix, load) {
  return walkFiles(directory, (file) => file.endsWith(suffix))
    .map((file) => costItem(kind, label, file, load));
}

function skillCostItems(groups) {
  return groups.filter((group) => group.skillCount).map((group) => ({
    kind: 'skills', label: group.id, path: group.path, count: group.skillCount,
    estimatedTokens: group.metadataTokenEstimate, load: 'discovery',
  }));
}

function runtimeCostItem(kind, label, count) {
  return { kind, label, count, estimatedTokens: null, load: 'runtime' };
}

function claudeModelCatalog(root) {
  const files = walkFiles(path.join(root, 'cache', 'model-catalog'), (file) => file.endsWith('.json'))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  for (const file of files) {
    const value = readJson(file, null);
    const models = value?.catalog?.config?.models;
    if (!Array.isArray(models)) continue;
    return {
      fetchedAt: value.fetchedAt || null,
      selectedModel: value.catalog?.state?.model || null,
      models: models
        .filter((model) => model && typeof model.id === 'string')
        .map((model) => ({ id: model.id, name: model.name || model.id, shortName: model.short_name || model.name || model.id })),
    };
  }
  return { fetchedAt: null, selectedModel: null, models: [] };
}

function claudeSessionTelemetry(root, workspace) {
  const projectDirectory = path.join(root, 'projects', path.resolve(workspace).replace(/[^A-Za-z0-9]/g, '-'));
  if (!exists(projectDirectory)) return null;
  const files = fs.readdirSync(projectDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => path.join(projectDirectory, entry.name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  for (const file of files) {
    let firstUsage = null;
    let latestUsage = null;
    let startModel = null;
    let currentModel = null;
    let firstObservedAt = null;
    let updatedAt = null;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      const raw = row.type === 'assistant' ? row.message?.usage : null;
      const model = row.message?.model;
      if (!raw || typeof model !== 'string' || model.startsWith('<')) continue;
      const number = (value) => Number.isFinite(value) ? value : 0;
      const inputTokens = number(raw.input_tokens) + number(raw.cache_creation_input_tokens) + number(raw.cache_read_input_tokens);
      if (!inputTokens) continue;
      const usage = {
        inputTokens,
        cachedInputTokens: number(raw.cache_read_input_tokens),
        outputTokens: number(raw.output_tokens),
      };
      if (!firstUsage) {
        firstUsage = usage;
        startModel = model;
        firstObservedAt = row.timestamp || null;
      }
      latestUsage = usage;
      currentModel = model;
      updatedAt = row.timestamp || updatedAt;
    }
    if (latestUsage) return { source: 'local-jsonl', sourcePath: file, startModel, currentModel, firstUsage, latestUsage, firstObservedAt, updatedAt };
  }
  return null;
}

function scanClaudeRuntime(home = os.homedir(), workspace = process.cwd()) {
  const root = path.join(home, '.claude');
  const modelCatalog = claudeModelCatalog(root);
  const sessionTelemetry = claudeSessionTelemetry(root, workspace);
  return {
    modelCatalog: { ...modelCatalog, selectedModel: sessionTelemetry?.currentModel || modelCatalog.selectedModel },
    sessionTelemetry,
  };
}

function createClaudeRuntimeReader(options = {}) {
  const home = options.home || os.homedir();
  const workspace = options.workspace || process.cwd();
  const minRefreshMs = options.minRefreshMs ?? 5_000;
  const now = options.now || Date.now;
  let cached = null;
  let lastReadAt = Number.NEGATIVE_INFINITY;
  return () => {
    const currentTime = now();
    if (cached && currentTime - lastReadAt < minRefreshMs) return cached;
    cached = scanClaudeRuntime(home, workspace);
    lastReadAt = currentTime;
    return cached;
  };
}

function tokenUsage(value) {
  if (!value || typeof value !== 'object') return null;
  const number = (key) => Number.isFinite(value[key]) ? value[key] : 0;
  return {
    inputTokens: number('input_tokens'),
    cachedInputTokens: number('cached_input_tokens'),
    outputTokens: number('output_tokens'),
    reasoningOutputTokens: number('reasoning_output_tokens'),
    totalTokens: number('total_tokens'),
  };
}

function sessionWorkspace(file) {
  const handle = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(8192);
  const chunks = [];
  let position = 0;
  try {
    while (position < 1_048_576) {
      const bytes = fs.readSync(handle, buffer, 0, buffer.length, position);
      if (!bytes) break;
      const newline = buffer.subarray(0, bytes).indexOf(10);
      chunks.push(Buffer.from(buffer.subarray(0, newline === -1 ? bytes : newline)));
      if (newline !== -1) break;
      position += bytes;
    }
  }
  finally { fs.closeSync(handle); }
  try {
    const row = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return row.type === 'session_meta' ? row.payload?.cwd || null : null;
  } catch { return null; }
}

function codexSessionTelemetry(root, workspace) {
  const workspaceRoot = path.resolve(workspace);
  const files = walkFiles(path.join(root, 'sessions'), (file) => file.endsWith('.jsonl'))
    .filter((file) => {
      const cwd = sessionWorkspace(file);
      return cwd === workspaceRoot || cwd?.startsWith(`${workspaceRoot}${path.sep}`);
    })
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  if (!files.length) return null;
  const file = files[0];
  let startModel = null;
  let currentModel = null;
  let reasoningEffort = null;
  let contextWindowTokens = null;
  let firstUsage = null;
  let latestUsage = null;
  let threadUsage = null;
  let compactionCount = 0;
  let updatedAt = null;

  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row.type === 'turn_context' && typeof row.payload?.model === 'string') {
      startModel ||= row.payload.model;
      currentModel = row.payload.model;
      reasoningEffort = row.payload.effort || row.payload.model_reasoning_effort || reasoningEffort;
    }
    if (row.type === 'event_msg') {
      const candidate = row.payload?.model_context_window || row.payload?.info?.model_context_window;
      if (Number.isFinite(candidate)) contextWindowTokens = candidate;
    }
    if (row.type === 'token_usage_record') {
      const usage = tokenUsage(row.payload?.usage);
      if (usage) {
        firstUsage ||= usage;
        latestUsage = usage;
        threadUsage = tokenUsage(row.payload?.thread_token_usage) || threadUsage;
        updatedAt = row.timestamp || updatedAt;
      }
    }
    if (row.type === 'compacted') compactionCount += 1;
  }
  if (!firstUsage && !currentModel) return null;
  return {
    source: 'local-jsonl',
    sourcePath: file,
    startModel,
    currentModel,
    reasoningEffort,
    contextWindowTokens,
    firstUsage,
    latestUsage,
    threadUsage,
    compactionCount,
    updatedAt,
  };
}

function codexModelCatalog(root, selectedModel) {
  const cache = readJson(path.join(root, 'models_cache.json'));
  const models = Array.isArray(cache.models) ? cache.models : [];
  return {
    fetchedAt: cache.fetched_at || null,
    clientVersion: cache.client_version || null,
    selectedModel: selectedModel || null,
    models: models
      .filter((model) => model && typeof model.slug === 'string' && model.visibility !== 'hide')
      .map((model) => {
        const rawContextWindowTokens = Number.isFinite(model.context_window) ? model.context_window : null;
        const effectiveContextWindowPercent = Number.isFinite(model.effective_context_window_percent) ? model.effective_context_window_percent : 100;
        return {
          id: model.slug,
          name: model.display_name || model.slug,
          contextWindowTokens: rawContextWindowTokens === null ? null : Math.round(rawContextWindowTokens * effectiveContextWindowPercent / 100),
          rawContextWindowTokens,
          maxContextWindowTokens: Number.isFinite(model.max_context_window) ? model.max_context_window : null,
          effectiveContextWindowPercent,
          defaultReasoningLevel: model.default_reasoning_level || null,
        };
      }),
  };
}

function scanCodexRuntime(home = os.homedir(), workspace = process.cwd()) {
  const root = path.join(home, '.codex');
  const sessionTelemetry = codexSessionTelemetry(root, workspace);
  return {
    modelCatalog: codexModelCatalog(root, sessionTelemetry?.currentModel),
    sessionTelemetry,
  };
}

function createCodexRuntimeReader(options = {}) {
  const home = options.home || os.homedir();
  const workspace = options.workspace || process.cwd();
  const minRefreshMs = options.minRefreshMs ?? 5_000;
  const now = options.now || Date.now;
  let cached = null;
  let lastReadAt = Number.NEGATIVE_INFINITY;
  return () => {
    const currentTime = now();
    if (cached && currentTime - lastReadAt < minRefreshMs) return cached;
    cached = scanCodexRuntime(home, workspace);
    lastReadAt = currentTime;
    return cached;
  };
}

function scanClaude(home, workspace) {
  const root = path.join(home, '.claude');
  const settings = readJson(path.join(root, 'settings.json'));
  const enabledPlugins = enabledPluginIds(settings);
  const skillGroups = [
    skillGroup('user-skills', path.join(root, 'skills'), { allowedStatuses: new Set(['active-candidate']) }),
    skillGroup('agent-skills', path.join(root, '.agents', 'skills'), { allowedStatuses: new Set(['active-candidate']) }),
  ];

  for (const pluginId of enabledPlugins) {
    const pluginDirectory = pluginCacheDirectory(root, pluginId);
    if (pluginDirectory) {
      skillGroups.push(skillGroup(pluginId, path.join(pluginDirectory, 'skills'), {
        allowedStatuses: new Set(['plugin-cache']),
        status: 'enabled-plugin-candidate',
      }));
    } else {
      skillGroups.push({ id: pluginId, path: null, status: 'enabled-plugin-cache-missing', skillCount: 0, metadataBytes: 0, metadataTokenEstimate: 0, assets: [] });
    }
  }

  const claudeMd = fileSummary(path.join(root, 'CLAUDE.md'));
  const ruleFiles = walkFiles(path.join(root, 'rules'), (file) => file.endsWith('.md'));
  const hookCount = countHooks(settings.hooks);
  const configuredMcpServerCount = Object.keys(readJson(path.join(root, 'mcp.json')).mcpServers || {}).length;
  const configurationCosts = [
    costItem('instructions', 'Global CLAUDE.md', path.join(root, 'CLAUDE.md'), 'startup'),
    ...directoryCostItems('rules', 'Rule file', path.join(root, 'rules'), '.md', 'conditional'),
    ...directoryCostItems('agents', 'Agent definition', path.join(root, 'agents'), '.md', 'conditional'),
    ...enabledPlugins.flatMap((pluginId) => {
      const directory = pluginCacheDirectory(root, pluginId);
      return directory ? directoryCostItems('agents', 'Plugin agent', path.join(directory, 'agents'), '.md', 'conditional') : [];
    }),
    ...skillCostItems(skillGroups),
    runtimeCostItem('hooks', 'Configured hooks', hookCount),
    runtimeCostItem('mcp', 'User MCP servers', configuredMcpServerCount),
    runtimeCostItem('plugins', 'Enabled plugins', enabledPlugins.length),
  ].filter(Boolean);
  return {
    versionSource: 'local-cli',
    root,
    ...scanClaudeRuntime(home, workspace),
    enabledPlugins,
    hookCount,
    configuredMcpServerCount,
    alwaysOn: {
      claudeMd,
      ruleFiles: ruleFiles.length,
      ruleBytes: ruleFiles.reduce((total, file) => total + fs.statSync(file).size, 0),
    },
    skillGroups,
    configurationCosts,
    excluded: countExcludedSkills(root),
  };
}

function tomlSectionNames(file) {
  if (!fileExists(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.match(/^\s*\[([^\]]+)\]/)?.[1])
    .filter(Boolean);
}

function enabledCodexPluginIds(file) {
  if (!fileExists(file)) return [];
  const enabled = [];
  let pluginId = null;
  let active = false;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const section = line.match(/^\s*\[([^\]]+)\]/)?.[1];
    if (section) {
      if (pluginId && active) enabled.push(pluginId);
      pluginId = section.match(/^plugins\."(.+)"$/)?.[1] || null;
      active = false;
    } else if (pluginId && /^\s*enabled\s*=\s*true(?:\s*(?:#.*)?)?$/.test(line)) {
      active = true;
    }
  }
  if (pluginId && active) enabled.push(pluginId);
  return enabled;
}

function scanCodex(home, workspace) {
  const root = path.join(home, '.codex');
  const configFile = path.join(root, 'config.toml');
  const sections = tomlSectionNames(configFile);
  const hooks = readJson(path.join(root, 'hooks.json'));
  const runtime = scanCodexRuntime(home, workspace);
  const agentsFile = fileExists(path.join(root, 'AGENTS.override.md')) && fs.statSync(path.join(root, 'AGENTS.override.md')).size > 0
    ? path.join(root, 'AGENTS.override.md') : path.join(root, 'AGENTS.md');
  const skillGroups = [
    skillGroup('user-and-system-skills', path.join(root, 'skills'), { allowedStatuses: new Set(['active-candidate']) }),
    skillGroup('agent-skills', path.join(root, '.agents', 'skills'), { allowedStatuses: new Set(['active-candidate']) }),
  ];
  const enabledPlugins = enabledCodexPluginIds(configFile);
  for (const pluginId of enabledPlugins) {
    const pluginDirectory = pluginCacheDirectory(root, pluginId);
    if (pluginDirectory) skillGroups.push(skillGroup(pluginId, path.join(pluginDirectory, 'skills'), {
      allowedStatuses: new Set(['plugin-cache']), status: 'enabled-plugin-candidate',
    }));
  }
  const hookCount = countHooks(hooks.hooks);
  const configuredPluginCount = sections.filter((section) => /^plugins\.(?:"[^"]+"|[^.]+)$/.test(section)).length;
  const configuredMcpServerCount = sections.filter((section) => /^mcp_servers\.(?:"[^"]+"|[^.]+)$/.test(section)).length;
  const configurationCosts = [
    costItem('instructions', 'Global AGENTS instructions', agentsFile, 'startup'),
    ...walkFiles(path.join(root, 'rules'), (file) => file.endsWith('.rules'))
      .map((file) => ({ kind: 'rules', label: 'Command rule', path: file, count: 1, estimatedTokens: null, load: 'runtime' })),
    ...directoryCostItems('agents', 'Agent definition', path.join(root, 'agents'), '.toml', 'conditional'),
    ...skillCostItems(skillGroups),
    runtimeCostItem('hooks', 'Configured hooks', hookCount),
    runtimeCostItem('mcp', 'Configured MCP servers', configuredMcpServerCount),
    runtimeCostItem('plugins', 'Enabled plugins', enabledPlugins.length),
  ].filter(Boolean);
  return {
    versionSource: 'local-cli',
    root,
    ...runtime,
    hookCount,
    configuredPluginCount,
    enabledPlugins,
    configuredMcpServerCount,
    alwaysOn: { agentsMd: fileSummary(agentsFile) },
    skillGroups,
    configurationCosts,
    excluded: countExcludedSkills(root),
  };
}

function withinWorkspace(candidate, workspaceRoot) {
  if (typeof candidate !== 'string' || !candidate) return false;
  const resolved = path.resolve(candidate);
  return resolved === workspaceRoot || resolved.startsWith(`${workspaceRoot}${path.sep}`);
}

function kiroIdeCandidates(root, workspaceRoot) {
  const sessionsRoot = path.join(root, 'sessions');
  if (!exists(sessionsRoot)) return [];
  const candidates = [];
  for (const bucket of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
    if (!bucket.isDirectory() || bucket.isSymbolicLink() || bucket.name === 'cli') continue;
    const bucketDirectory = path.join(sessionsRoot, bucket.name);
    for (const entry of fs.readdirSync(bucketDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('sess_')) continue;
      const directory = path.join(bucketDirectory, entry.name);
      const messages = path.join(directory, 'messages.jsonl');
      const meta = readJson(path.join(directory, 'session.json'), null);
      if (!fileExists(messages) || !meta) continue;
      if (!(meta.workspacePaths || []).some((candidate) => withinWorkspace(candidate, workspaceRoot))) continue;
      candidates.push({ store: 'ide', file: messages, modelId: meta.modelId || null, mtimeMs: fs.statSync(messages).mtimeMs });
    }
  }
  return candidates;
}

function kiroIdeTelemetry(candidate) {
  let firstUsagePercent = null;
  let latestUsagePercent = null;
  let firstObservedAt = null;
  let updatedAt = null;
  let sampleCount = 0;
  let creditsUsed = 0;
  for (const line of fs.readFileSync(candidate.file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const payload = row.payload;
    if (payload?.type === 'usage_summary') {
      for (const summary of payload.promptTurnSummaries || []) {
        if (Number.isFinite(summary?.usage)) creditsUsed += summary.usage;
      }
      continue;
    }
    if (payload?.type !== 'session_metadata' || payload.key !== 'contextUsage') continue;
    const percent = payload.value?.usagePercentage;
    if (!Number.isFinite(percent)) continue;
    sampleCount += 1;
    if (firstUsagePercent === null) {
      firstUsagePercent = percent;
      firstObservedAt = row.timestamp || null;
    }
    latestUsagePercent = percent;
    updatedAt = row.timestamp || updatedAt;
  }
  if (firstUsagePercent === null) return null;
  return {
    source: 'local-session',
    store: 'ide',
    sourcePath: candidate.file,
    startModel: candidate.modelId,
    currentModel: candidate.modelId,
    contextWindowTokens: null,
    firstUsagePercent,
    latestUsagePercent,
    sampleCount,
    creditsUsed,
    firstObservedAt,
    updatedAt,
  };
}

function kiroCliCandidates(root, workspaceRoot) {
  const directory = path.join(root, 'sessions', 'cli');
  if (!exists(directory)) return [];
  const candidates = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = path.join(directory, entry.name);
    const meta = readJson(file, null);
    if (!meta || !withinWorkspace(meta.cwd, workspaceRoot)) continue;
    candidates.push({ store: 'cli', file, meta, mtimeMs: fs.statSync(file).mtimeMs });
  }
  return candidates;
}

function meteringCredits(turn) {
  return (turn.metering_usage || []).reduce((total, entry) => total + (Number.isFinite(entry?.value) ? entry.value : 0), 0);
}

function kiroCliTelemetry(candidate) {
  const state = candidate.meta.session_state || {};
  const modelInfo = state.rts_model_state?.model_info || {};
  const turns = (state.conversation_metadata?.user_turn_metadatas || [])
    .filter((turn) => Number.isFinite(turn?.context_usage_percentage));
  const sessionPercent = state.rts_model_state?.context_usage_percentage;
  const fallbackPercent = Number.isFinite(sessionPercent) ? sessionPercent : null;
  const firstUsagePercent = turns.length ? turns[0].context_usage_percentage : fallbackPercent;
  if (firstUsagePercent === null) return null;
  return {
    source: 'local-session',
    store: 'cli',
    sourcePath: candidate.file,
    startModel: turns[0]?.model || modelInfo.model_id || null,
    currentModel: turns.at(-1)?.model || modelInfo.model_id || null,
    contextWindowTokens: Number.isFinite(modelInfo.context_window_tokens) ? modelInfo.context_window_tokens : null,
    firstUsagePercent,
    latestUsagePercent: turns.length ? turns.at(-1).context_usage_percentage : fallbackPercent,
    sampleCount: turns.length || 1,
    creditsUsed: turns.reduce((total, turn) => total + meteringCredits(turn), 0),
    firstObservedAt: turns[0]?.end_timestamp || candidate.meta.created_at || null,
    updatedAt: turns.at(-1)?.end_timestamp || candidate.meta.updated_at || null,
  };
}

function kiroObservedWindows(cliCandidates) {
  const windows = new Map();
  for (const candidate of cliCandidates) {
    const info = candidate.meta.session_state?.rts_model_state?.model_info || {};
    if (typeof info.model_id === 'string' && Number.isFinite(info.context_window_tokens)) {
      windows.set(info.model_id, info.context_window_tokens);
    }
  }
  return windows;
}

function kiroSessionTelemetry(root, workspace) {
  const workspaceRoot = path.resolve(workspace);
  const cliCandidates = kiroCliCandidates(root, workspaceRoot);
  const candidates = [...kiroIdeCandidates(root, workspaceRoot), ...cliCandidates]
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const candidate of candidates) {
    const telemetry = candidate.store === 'ide' ? kiroIdeTelemetry(candidate) : kiroCliTelemetry(candidate);
    if (!telemetry) continue;
    if (telemetry.contextWindowTokens !== null) return { ...telemetry, contextWindowSource: 'session' };
    // A store without a window is still comparable: Kiro's own CLI sessions
    // record the window per model, so reuse an observation for the same model.
    const peerWindow = kiroObservedWindows(cliCandidates).get(telemetry.currentModel);
    return peerWindow === undefined
      ? { ...telemetry, contextWindowSource: null }
      : { ...telemetry, contextWindowTokens: peerWindow, contextWindowSource: 'peer-session' };
  }
  return null;
}

function kiroHookCount(root, workspace) {
  const directories = [path.join(root, 'hooks'), path.join(workspace, '.kiro', 'hooks')];
  return directories.reduce((total, directory) => total + walkFiles(directory, (file) => file.endsWith('.json'))
    .reduce((sum, file) => {
      const hooks = readJson(file, {}).hooks;
      return sum + (Array.isArray(hooks) ? hooks.length : 0);
    }, 0), 0);
}

function kiroCrewUsage(crewRoot) {
  const directory = path.join(crewRoot, 'usage', 'tokens');
  if (!exists(directory)) return null;
  const files = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => entry.name)
    .sort();
  let recordCount = 0;
  let creditsTotal = 0;
  for (const name of files) {
    for (const line of fs.readFileSync(path.join(directory, name), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (row._type !== 'tokens') continue;
      recordCount += 1;
      if (Number.isFinite(row.credits)) creditsTotal += row.credits;
    }
  }
  if (!recordCount) return null;
  return {
    recordCount,
    creditsTotal,
    firstDate: path.basename(files[0], '.jsonl'),
    lastDate: path.basename(files.at(-1), '.jsonl'),
    workspaceAttributable: false,
  };
}

function scanKiroRuntime(home = os.homedir(), workspace = process.cwd()) {
  const root = path.join(home, '.kiro');
  const sessionTelemetry = kiroSessionTelemetry(root, workspace);
  return {
    modelCatalog: { selectedModel: sessionTelemetry?.currentModel || null, models: [] },
    sessionTelemetry,
  };
}

function createKiroRuntimeReader(options = {}) {
  const home = options.home || os.homedir();
  const workspace = options.workspace || process.cwd();
  const minRefreshMs = options.minRefreshMs ?? 5_000;
  const now = options.now || Date.now;
  let cached = null;
  let lastReadAt = Number.NEGATIVE_INFINITY;
  return () => {
    const currentTime = now();
    if (cached && currentTime - lastReadAt < minRefreshMs) return cached;
    cached = scanKiroRuntime(home, workspace);
    lastReadAt = currentTime;
    return cached;
  };
}

function scanKiro(home, workspace) {
  const root = path.join(home, '.kiro');
  const crewRoot = path.join(root, 'crew');
  return {
    versionSource: 'local-cli',
    root,
    ...scanKiroRuntime(home, workspace),
    crewUsage: kiroCrewUsage(crewRoot),
    hookCount: kiroHookCount(root, workspace),
    customAgentCount: walkFiles(path.join(root, 'agents'), (file) => file.endsWith('.json')).length,
    powerCount: walkFiles(path.join(root, 'powers'), (file) => path.basename(file) === 'plugin.json').length,
    steering: (() => {
      const files = walkFiles(path.join(root, 'steering'), (file) => file.endsWith('.md'));
      const bytes = files.reduce((total, file) => total + fs.statSync(file).size, 0);
      return { fileCount: files.length, bytes, tokenEstimate: bytesToEstimate(bytes) };
    })(),
    skillGroups: [
      skillGroup('user-skills', path.join(root, 'skills'), { allowedStatuses: new Set(['active-candidate']) }),
    ],
    crew: skillGroup('crew-skills', path.join(crewRoot, 'skills'), { allowedStatuses: new Set(['active-candidate']) }),
    excluded: countExcludedSkills(root),
  };
}

function scanWorkspace(workspace) {
  const tracked = ['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md', '.claude/settings.json', '.claude/settings.local.json'];
  return tracked
    .map((relativePath) => fileSummary(path.join(workspace, relativePath)))
    .filter(Boolean)
    .map((summary) => ({ ...summary, path: path.relative(workspace, summary.path) || '.' }));
}

function scanEnvironment(options = {}) {
  const home = options.home || os.homedir();
  const workspace = options.workspace || process.cwd();
  return {
    schemaVersion: '0.1.0',
    generatedAt: new Date().toISOString(),
    target: { home, workspace },
    harnesses: {
      claude: scanClaude(home, workspace),
      codex: scanCodex(home, workspace),
      kiro: scanKiro(home, workspace),
    },
    workspace: { assets: scanWorkspace(workspace) },
    warnings: [
      {
        code: 'ESTIMATE_NOT_EXACT',
        message: 'Static asset token values are byte-based estimates. Claude and Codex session totals are observed from local JSONL, while category attribution and vendor-managed prompts remain estimates.',
      },
      {
        code: 'READ_ONLY_DISCOVERY',
        message: 'This snapshot stores metadata only and does not copy prompt, rule, skill, or secret contents.',
      },
    ],
  };
}

module.exports = {
  classifyAssetPath,
  createClaudeRuntimeReader,
  createCodexRuntimeReader,
  createKiroRuntimeReader,
  scanEnvironment,
  scanClaudeRuntime,
  scanCodexRuntime,
  scanKiroRuntime,
  skillMetadataBytes,
};
