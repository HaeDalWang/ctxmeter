'use strict';

// File-system helpers shared by the per-agent scanners.

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

/// Kiro stores servers under `mcpServers` with a `disabled` flag. (Claude's
/// scopes are resolved in claude-mcp.js.) A disabled server contributes nothing
/// to the prompt, so counting it would overstate how much is unmeasured.
function enabledMcpServerNames(config) {
  return Object.entries(config?.mcpServers || {})
    .filter(([, value]) => value && value.disabled !== true)
    .map(([name]) => name);
}

// Never holds anything an agent loads, and a checkout's .git can be huge.
const NEVER_WALKED = new Set(['node_modules', '.git']);
// Inside an agent's root these hold logs, caches, and staging checkouts, which
// can be tens of thousands of directories. The excluded-skill count skips them.
const NOT_SKILL_SOURCES = new Set(['.tmp', 'sessions', 'projects', 'cache', 'logs', 'log', 'shell_snapshots', 'file-history', 'todos']);

function walkFiles(directory, predicate, files = [], visited = new Set(), skip = NEVER_WALKED) {
  let stat;
  try { stat = fs.statSync(directory); } catch { return files; }
  if (!stat.isDirectory()) return files;

  // Keyed by inode rather than path, so a symlink to a directory that was already
  // walked by its plain path, or a cycle, is visited once. The stat is the one the
  // existence check needed anyway.
  const key = `${stat.dev}:${stat.ino}`;
  if (visited.has(key)) return files;
  visited.add(key);

  // One unreadable directory must not abort a scan of everything else.
  let entries;
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return files; }

  for (const entry of entries) {
    if (NEVER_WALKED.has(entry.name) || skip.has(entry.name)) continue;
    const item = path.join(directory, entry.name);
    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      let linked;
      try { linked = fs.statSync(item); } catch { continue; }
      isDirectory = linked.isDirectory();
      isFile = linked.isFile();
    }
    if (isDirectory) walkFiles(item, predicate, files, visited, skip);
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

/// The leading `---` block, tolerating a BOM and CRLF line endings. Searching
/// from the opening newline also catches an empty block.
function frontmatterOf(content) {
  const opening = content.match(/^\uFEFF?---\r?\n/);
  if (!opening) return '';
  const end = content.indexOf('\n---', opening[0].length - 1);
  return end === -1 ? '' : content.slice(0, end + 5);
}

function skillFrontmatter(file) {
  if (!fileExists(file)) return 0;
  return frontmatterOf(fs.readFileSync(file, 'utf8'));
}

function declaredSkillName(frontmatter) {
  const match = frontmatter.match(/^name:\s*["']?([^\n"']+)["']?\s*$/m);
  return match ? match[1].trim() : null;
}

function skillAsset(file, groupDirectory) {
  const content = fs.readFileSync(file, 'utf8');
  const frontmatter = frontmatterOf(content);
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
  const isSkill = (candidate) => path.basename(candidate) === 'SKILL.md';
  for (const file of walkFiles(directory, isSkill, [], new Set(), NOT_SKILL_SOURCES)) {
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
  // Claude records which version it actually installed. Directory names are
  // versions or commit hashes, so sorting them only guesses.
  const installs = readJson(path.join(claudeDirectory, 'plugins', 'installed_plugins.json')).plugins?.[pluginId];
  const recorded = (Array.isArray(installs) ? installs : [])
    .map((install) => install?.installPath)
    .find((installPath) => typeof installPath === 'string' && path.dirname(path.resolve(installPath)) === root && exists(installPath));
  if (recorded) return recorded;
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

/// A reader that rescans at most once per `minRefreshMs`.
function createRuntimeReader(scan, options = {}) {
  const home = options.home || os.homedir();
  const workspace = options.workspace || process.cwd();
  const minRefreshMs = options.minRefreshMs ?? 5_000;
  const now = options.now || Date.now;
  let cached = null;
  let lastReadAt = Number.NEGATIVE_INFINITY;
  return () => {
    const currentTime = now();
    if (cached && currentTime - lastReadAt < minRefreshMs) return cached;
    cached = scan(home, workspace);
    lastReadAt = currentTime;
    return cached;
  };
}

module.exports = {
  NEVER_WALKED,
  NOT_SKILL_SOURCES,
  bytesToEstimate,
  classifyAssetPath,
  costItem,
  countExcludedSkills,
  countHooks,
  createRuntimeReader,
  declaredSkillName,
  directoryCostItems,
  enabledMcpServerNames,
  enabledPluginIds,
  exists,
  fileExists,
  fileSummary,
  frontmatterOf,
  pluginCacheDirectory,
  readJson,
  runtimeCostItem,
  skillAsset,
  skillCostItems,
  skillFrontmatter,
  skillGroup,
  skillMetadataBytes,
  walkFiles,
};
