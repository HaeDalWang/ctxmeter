const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { eachJsonLine } = require('./jsonl');
const { claudeInstructions, codexInstructions } = require('./instructions');
const { claudeMcpServers } = require('./claude-mcp');
const {
  classifyAssetPath,
  costItem,
  countExcludedSkills,
  countHooks,
  createRuntimeReader,
  directoryCostItems,
  enabledPluginIds,
  exists,
  fileExists,
  fileSummary,
  pluginCacheDirectory,
  readJson,
  runtimeCostItem,
  skillCostItems,
  skillGroup,
  skillMetadataBytes,
  walkFiles,
} = require('./scan-common');
const { createKiroRuntimeReader, kiroCliCandidates, kiroIdeCandidates, scanKiro, scanKiroRuntime } = require('./kiro-scan');

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

/// Claude keeps one directory per workspace, named by its path with every
/// non-alphanumeric character replaced.
function claudeProjectDirectory(root, workspace) {
  return path.join(root, 'projects', path.resolve(workspace).replace(/[^A-Za-z0-9]/g, '-'));
}

function claudeSessionTelemetry(root, workspace) {
  const projectDirectory = claudeProjectDirectory(root, workspace);
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
    eachJsonLine(file, (row) => {
      // A subagent's turns report its own context, not the session's.
      if (row.isSidechain) return;
      const raw = row.type === 'assistant' ? row.message?.usage : null;
      const model = row.message?.model;
      if (!raw || typeof model !== 'string' || model.startsWith('<')) return;
      const number = (value) => Number.isFinite(value) ? value : 0;
      const inputTokens = number(raw.input_tokens) + number(raw.cache_creation_input_tokens) + number(raw.cache_read_input_tokens);
      if (!inputTokens) return;
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
    });
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

const createClaudeRuntimeReader = (options) => createRuntimeReader(scanClaudeRuntime, options);

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

/// Codex sessions for this workspace, newest first. The workspace is recorded in
/// each file's first line, so only that line is read to filter.
function codexWorkspaceSessionFiles(root, workspace) {
  const workspaceRoot = path.resolve(workspace);
  return walkFiles(path.join(root, 'sessions'), (file) => file.endsWith('.jsonl'))
    .filter((file) => {
      const cwd = sessionWorkspace(file);
      return cwd === workspaceRoot || cwd?.startsWith(`${workspaceRoot}${path.sep}`);
    })
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
}

function codexSessionTelemetry(root, workspace) {
  const files = codexWorkspaceSessionFiles(root, workspace);
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

  eachJsonLine(file, (row) => {
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
  });
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

const createCodexRuntimeReader = (options) => createRuntimeReader(scanCodexRuntime, options);

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
  const configuredMcpServerCount = claudeMcpServers(home, workspace).length;
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
    runtimeCostItem('mcp', 'MCP servers', configuredMcpServerCount),
    runtimeCostItem('plugins', 'Enabled plugins', enabledPlugins.length),
  ].filter(Boolean);
  return {
    versionSource: 'local-cli',
    root,
    ...scanClaudeRuntime(home, workspace),
    enabledPlugins,
    hookCount,
    configuredMcpServerCount,
    instructions: claudeInstructions(home, workspace),
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

/// Every `[plugins."<id>"]` block with whether it opts in. Absent means off.
function codexPluginStates(file) {
  if (!fileExists(file)) return [];
  const states = [];
  let current = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const section = line.match(/^\s*\[([^\]]+)\]/)?.[1];
    if (section) {
      const pluginId = section.match(/^plugins\."(.+)"$/)?.[1] || null;
      current = pluginId ? { id: pluginId, enabled: false } : null;
      if (current) states.push(current);
    } else if (current && /^\s*enabled\s*=\s*true(?:\s*(?:#.*)?)?$/.test(line)) {
      current.enabled = true;
    }
  }
  return states;
}

function enabledCodexPluginIds(file) {
  return codexPluginStates(file).filter((state) => state.enabled).map((state) => state.id);
}

/// `[mcp_servers.<name>]` blocks are live unless a block says `enabled = false`.
/// That is the opposite default from `[plugins."..."]`, which must opt in, so the
/// two cannot share one reader.
function enabledCodexMcpServerNames(file) {
  if (!fileExists(file)) return [];
  const names = [];
  let name = null;
  let disabled = false;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const section = line.match(/^\s*\[([^\]]+)\]/)?.[1];
    if (section) {
      if (name && !disabled) names.push(name);
      // A `.env` sub-section clears the name, which is what stops keys inside it
      // from being read as the server's own.
      name = section.match(/^mcp_servers\.(?:"([^"]+)"|([^.]+))$/)?.slice(1).find(Boolean) || null;
      disabled = false;
    } else if (name && /^\s*enabled\s*=\s*false(?:\s*(?:#.*)?)?$/.test(line)) {
      disabled = true;
    }
  }
  if (name && !disabled) names.push(name);
  return names;
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
  const configuredMcpServerCount = enabledCodexMcpServerNames(configFile).length;
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
    instructions: codexInstructions(home, workspace),
    alwaysOn: { agentsMd: fileSummary(agentsFile) },
    skillGroups,
    configurationCosts,
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
  claudeProjectDirectory,
  codexPluginStates,
  codexWorkspaceSessionFiles,
  createClaudeRuntimeReader,
  createCodexRuntimeReader,
  createKiroRuntimeReader,
  kiroCliCandidates,
  kiroIdeCandidates,
  scanEnvironment,
  scanClaudeRuntime,
  scanCodexRuntime,
  scanKiroRuntime,
  skillMetadataBytes,
};
