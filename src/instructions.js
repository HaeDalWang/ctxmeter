'use strict';

// Which instruction files each agent loads at launch, following each vendor's
// documented discovery. Sizes only; contents are read to find imports and
// front matter, and never stored.
//
//   Claude  https://code.claude.com/docs/en/memory (checked 2026-10-16)
//           ~/.claude/CLAUDE.md, CLAUDE.md / .claude/CLAUDE.md / CLAUDE.local.md
//           in the workspace and every directory above it, @imports up to four
//           hops, rules without `paths`. AGENTS.md only when no CLAUDE.md is in
//           the workspace or above it. Subdirectory files load on demand.
//   Codex   https://learn.chatgpt.com/docs/agent-configuration/agents-md
//           ~/.codex AGENTS.override.md or AGENTS.md, then one file per
//           directory from the git root down to the workspace, capped at
//           project_doc_max_bytes (32 KiB).
//   Kiro    https://kiro.dev/docs/steering/ — steering without `inclusion`, or
//           `inclusion: always`, global and workspace; AGENTS.md always.

const fs = require('node:fs');
const path = require('node:path');

const MAX_IMPORT_HOPS = 4;
const CODEX_DEFAULT_MAX_BYTES = 32 * 1024;
const BYTES_PER_TOKEN = 4;

function realFile(file) {
  try {
    const real = fs.realpathSync(file);
    return fs.statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

function frontMatter(text) {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  return match ? { body: match[1], length: Buffer.byteLength(match[0]) } : null;
}

function frontMatterKey(text, key) {
  const block = frontMatter(text)?.body || '';
  const match = new RegExp(`^${key}:\\s*(.*?)\\s*$`, 'm').exec(block);
  return match ? match[1].replace(/^["']|["']$/g, '').trim() || null : null;
}

/// `@path` references outside code spans and fences. `\ ` escapes a space; a
/// trailing sentence mark is not part of the path; an e-mail is not an import.
function importsOf(text) {
  const found = [];
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const outsideSpans = line.replace(/`[^`]*`/g, ' ');
    for (const match of outsideSpans.matchAll(/(?:^|\s)@((?:\\ |[^\s"'])+)/g)) {
      const reference = match[1].replace(/\\ /g, ' ').replace(/[.,;:!?)]+$/, '');
      if (reference) found.push(reference);
    }
  }
  return found;
}

function resolveImport(reference, from, home) {
  if (reference.startsWith('~/')) return path.join(home, reference.slice(2));
  return path.isAbsolute(reference) ? reference : path.resolve(path.dirname(from), reference);
}

function walkMarkdown(directory) {
  const files = [];
  let entries;
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return files; }
  for (const entry of entries) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkMarkdown(item));
    else if (entry.name.endsWith('.md')) files.push(item);
  }
  return files.sort();
}

/// Directories from the filesystem root down to `workspace`.
function lineage(workspace) {
  const chain = [];
  let current = path.resolve(workspace);
  for (;;) {
    chain.unshift(current);
    const parent = path.dirname(current);
    if (parent === current) return chain;
    current = parent;
  }
}

function collector() {
  const seen = new Set();
  const files = [];
  return {
    files,
    add(file, scope, bytes = null) {
      const real = realFile(file);
      if (!real || seen.has(real)) return null;
      seen.add(real);
      const size = bytes ?? fs.statSync(real).size;
      if (!size) return null;
      files.push({ path: real, scope, bytes: size });
      return real;
    },
  };
}

function summary(files, extra = {}) {
  const bytes = files.reduce((total, file) => total + file.bytes, 0);
  return { files, bytes, tokens: Math.round(bytes / BYTES_PER_TOKEN), onDemand: 0, truncated: false, ...extra };
}

function claudeInstructions(home, workspace) {
  const found = collector();
  const addWithImports = (file, scope, hops = 0) => {
    const real = found.add(file, scope);
    if (!real || hops >= MAX_IMPORT_HOPS) return;
    for (const reference of importsOf(readText(real))) {
      addWithImports(resolveImport(reference, real, home), 'import', hops + 1);
    }
  };
  // Imports of an already-loaded file still need walking from where they are.
  const visit = (file, scope) => {
    if (!realFile(file)) return;
    addWithImports(file, scope);
  };

  visit(path.join(home, '.claude', 'CLAUDE.md'), 'user');
  const directories = lineage(workspace);
  const projectNames = ['CLAUDE.md', path.join('.claude', 'CLAUDE.md'), 'CLAUDE.local.md'];
  const hasClaudeMd = directories.some((directory) => projectNames.some((name) => realFile(path.join(directory, name))
    && path.join(directory, name) !== path.join(home, '.claude', 'CLAUDE.md')));
  for (const directory of directories) {
    const scope = directory === path.resolve(workspace) ? 'project' : 'ancestor';
    if (hasClaudeMd) {
      for (const name of projectNames) visit(path.join(directory, name), name === 'CLAUDE.local.md' ? 'local' : scope);
    } else {
      for (const name of ['AGENTS.md', path.join('.claude', 'AGENTS.md')]) visit(path.join(directory, name), scope);
    }
  }

  let onDemand = 0;
  for (const [directory, scope] of [[path.join(home, '.claude', 'rules'), 'rule'], [path.join(workspace, '.claude', 'rules'), 'rule']]) {
    for (const file of walkMarkdown(directory)) {
      const text = readText(file);
      if (frontMatterKey(text, 'paths')) {
        onDemand += 1;
        continue;
      }
      // Claude strips the front matter before loading a rule.
      found.add(file, scope, Buffer.byteLength(text) - (frontMatter(text)?.length || 0));
    }
  }
  return summary(found.files, { onDemand });
}

/// Top-level keys only; these two appear before any [section].
function codexDocSettings(home) {
  const settings = { maxBytes: CODEX_DEFAULT_MAX_BYTES, fallbacks: [] };
  for (const line of readText(path.join(home, '.codex', 'config.toml')).split('\n')) {
    if (/^\s*\[/.test(line)) break;
    const max = /^\s*project_doc_max_bytes\s*=\s*(\d+)/.exec(line);
    if (max) settings.maxBytes = Number(max[1]);
    const fallbacks = /^\s*project_doc_fallback_filenames\s*=\s*\[(.*)\]/.exec(line);
    if (fallbacks) settings.fallbacks = [...fallbacks[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  }
  return settings;
}

function gitRoot(workspace) {
  const chain = lineage(workspace).reverse();
  return chain.find((directory) => fs.existsSync(path.join(directory, '.git'))) || null;
}

function firstNonEmpty(directory, names) {
  for (const name of names) {
    const real = realFile(path.join(directory, name));
    if (real && fs.statSync(real).size > 0) return real;
  }
  return null;
}

function codexInstructions(home, workspace) {
  const found = collector();
  const global = firstNonEmpty(path.join(home, '.codex'), ['AGENTS.override.md', 'AGENTS.md']);
  if (global) found.add(global, 'global');

  const { maxBytes, fallbacks } = codexDocSettings(home);
  const names = ['AGENTS.override.md', 'AGENTS.md', ...fallbacks];
  const root = gitRoot(workspace);
  const resolved = path.resolve(workspace);
  const directories = root ? lineage(resolved).filter((directory) => directory === root || directory.startsWith(`${root}${path.sep}`)) : [resolved];
  let remaining = maxBytes;
  let truncated = false;
  for (const directory of directories) {
    const file = firstNonEmpty(directory, names);
    if (!file) continue;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const size = fs.statSync(file).size;
    const taken = Math.min(size, remaining);
    if (taken < size) truncated = true;
    found.add(file, directory === resolved ? 'project' : 'ancestor', taken);
    remaining -= taken;
  }
  return summary(found.files, { truncated });
}

function kiroInstructions(home, workspace) {
  const found = collector();
  let onDemand = 0;
  for (const directory of [path.join(home, '.kiro', 'steering'), path.join(workspace, '.kiro', 'steering')]) {
    for (const file of walkMarkdown(directory)) {
      const text = readText(file);
      const inclusion = (frontMatterKey(text, 'inclusion') || 'always').toLowerCase();
      // AGENTS.md has no inclusion modes: always included wherever it sits.
      if (path.basename(file) !== 'AGENTS.md' && inclusion !== 'always') {
        onDemand += 1;
        continue;
      }
      found.add(file, directory.startsWith(home) && !directory.startsWith(path.resolve(workspace)) ? 'global' : 'steering');
    }
  }
  found.add(path.join(workspace, 'AGENTS.md'), 'project');
  return summary(found.files, { onDemand });
}

module.exports = { claudeInstructions, codexInstructions, importsOf, kiroInstructions };
