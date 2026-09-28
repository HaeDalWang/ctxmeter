'use strict';

// Content transforms for the two config formats ctxmeter is allowed to change.
// Both are pure string -> string so the caller can show a diff before writing.
//
// The design rule is in develop/decisions/05-fix-mutation-model.md: every harness
// has a native disable flag, so a change is always one key. Nothing here removes a
// section, reorders a file, or rewrites a value it was not asked about.

const SECTION_PATTERN = /^\s*\[([^\]]+)\]/;

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/// Indices of lines that really are table headers. A line that starts with `[`
/// inside a multi-line array (`  ["a", "b"],`) or a multi-line string is part of
/// a value, and treating it as a header would end the section early and lead to
/// a duplicate key being inserted.
function headerIndices(lines) {
  const headers = [];
  let depth = 0;
  let openString = null;
  lines.forEach((line, index) => {
    if (openString) {
      if (line.includes(openString)) openString = null;
      return;
    }
    if (depth === 0 && SECTION_PATTERN.test(line)) {
      headers.push(index);
      return;
    }
    const triples = line.match(/"""|'''/g) || [];
    if (triples.length % 2 === 1) {
      openString = triples.at(-1);
      return;
    }
    const code = line.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '').replace(/#.*$/, '');
    depth = Math.max(0, depth + (code.match(/\[/g) || []).length - (code.match(/\]/g) || []).length);
  });
  return headers;
}

/// Sets `key = value` inside `[section]` of a TOML document.
///
/// TOML is edited line by line and never reserialized: these files carry comments
/// and dozens of unrelated sections, and there is no TOML writer here. The section
/// must already exist — appending one would be inventing configuration.
function setTomlSectionKey(content, section, key, value) {
  const lines = content.split('\n');
  const headers = headerIndices(lines);
  const matching = headers.filter((index) => SECTION_PATTERN.exec(lines[index])?.[1] === section);

  if (matching.length === 0) throw new Error(`[${section}] is not in this file, so there is nothing to change`);
  if (matching.length > 1) throw new Error(`[${section}] appears more than once; refusing to guess which one to change`);

  const start = matching[0];
  // The section ends at the next header of any kind, which is also what keeps a
  // `.env` sub-section's keys out of reach.
  const end = headers.find((index) => index > start) ?? lines.length;

  const keyPattern = new RegExp(`^\\s*${escapeForRegExp(key)}\\s*=`);
  const existing = lines.slice(start + 1, end).findIndex((line) => keyPattern.test(line));
  const replacement = `${key} = ${value}`;

  if (existing === -1) {
    const next = [...lines.slice(0, start + 1), replacement, ...lines.slice(start + 1)];
    return { content: next.join('\n'), changed: true, line: start + 2, action: 'inserted' };
  }

  const target = start + 1 + existing;
  if (lines[target].trim() === replacement) return { content, changed: false, line: target + 1, action: 'unchanged' };
  const next = [...lines];
  next[target] = replacement;
  return { content: next.join('\n'), changed: true, line: target + 1, action: 'replaced' };
}

/// Sets `disabled` on one entry of an `mcpServers` object.
///
/// JSON has no comments to preserve, so this parses and reserializes. It refuses a
/// file it cannot parse rather than attempting a textual patch: a half-understood
/// edit to someone's MCP config is worse than no edit. Key order survives because
/// the object is mutated in place, and the trailing newline is carried over.
function setJsonServerDisabled(content, name, disabled) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`this file is not valid JSON, so it will not be edited: ${error.message}`);
  }

  const servers = parsed?.mcpServers;
  if (!servers || typeof servers !== 'object') throw new Error('this file has no mcpServers object');
  if (!Object.prototype.hasOwnProperty.call(servers, name)) throw new Error(`${name} is not declared in this file`);

  if (Boolean(servers[name]?.disabled) === disabled) return { content, changed: false, action: 'unchanged' };

  const next = { ...parsed, mcpServers: { ...servers, [name]: { ...servers[name], disabled } } };
  const serialized = JSON.stringify(next, null, 2);
  const rebuilt = content.endsWith('\n') ? `${serialized}\n` : serialized;

  // Guard against a serializer surprise before the caller is allowed to write.
  const reparsed = JSON.parse(rebuilt);
  if (reparsed.mcpServers[name].disabled !== disabled) throw new Error('the edit did not survive a round trip; refusing to write');
  if (Object.keys(reparsed.mcpServers).join('\u0000') !== Object.keys(servers).join('\u0000')) {
    throw new Error('server order changed during the edit; refusing to write');
  }

  return { content: rebuilt, changed: true, action: disabled ? 'disabled' : 'enabled' };
}

/// Sets one entry of `enabledPlugins` in Claude's settings.json. Only a plugin the
/// file already lists can be changed; adding one would be installing it.
function setJsonPluginEnabled(content, id, enabled) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`this file is not valid JSON, so it will not be edited: ${error.message}`);
  }

  const plugins = parsed?.enabledPlugins;
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) throw new Error('this file has no enabledPlugins object');
  if (!Object.prototype.hasOwnProperty.call(plugins, id)) throw new Error(`${id} is not listed in enabledPlugins`);
  if ((plugins[id] === true) === enabled) return { content, changed: false, action: 'unchanged' };

  const next = { ...parsed, enabledPlugins: { ...plugins, [id]: enabled } };
  const serialized = JSON.stringify(next, null, 2);
  const rebuilt = content.endsWith('\n') ? `${serialized}\n` : serialized;

  const reparsed = JSON.parse(rebuilt);
  if (reparsed.enabledPlugins[id] !== enabled) throw new Error('the edit did not survive a round trip; refusing to write');
  if (Object.keys(reparsed).join('\u0000') !== Object.keys(parsed).join('\u0000')) {
    throw new Error('key order changed during the edit; refusing to write');
  }

  return { content: rebuilt, changed: true, action: enabled ? 'enabled' : 'disabled' };
}

module.exports = { setJsonPluginEnabled, setJsonServerDisabled, setTomlSectionKey };
