'use strict';

// Line-by-line JSONL reading. Session logs run to hundreds of megabytes; reading
// one whole into a string costs memory, and past ~512 MB V8 refuses outright.

const fs = require('node:fs');

const CHUNK_BYTES = 1024 * 1024;
const NEWLINE = 0x0a;

function parse(buffer, filter) {
  // Matched on bytes, so a skipped line is never decoded or parsed.
  if (filter && buffer.indexOf(filter) === -1) return undefined;
  const text = buffer.toString('utf8').trim();
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

/// Calls `visit(row)` for each parseable line. A torn last line, normal while a
/// session is live, is skipped. Returning `false` from `visit` stops reading.
/// Lines are split on raw bytes, so multi-byte characters never straddle a cut.
/// `lineFilter` is a substring a line must contain to be parsed at all.
function eachJsonLine(file, visit, { chunkBytes = CHUNK_BYTES, lineFilter = null } = {}) {
  const filter = lineFilter ? Buffer.from(lineFilter) : null;
  let handle;
  try { handle = fs.openSync(file, 'r'); } catch { return; }
  const buffer = Buffer.alloc(chunkBytes);
  let pending = [];
  try {
    for (;;) {
      const bytes = fs.readSync(handle, buffer, 0, chunkBytes, null);
      if (!bytes) break;
      let start = 0;
      let index;
      while ((index = buffer.indexOf(NEWLINE, start)) !== -1 && index < bytes) {
        pending.push(buffer.subarray(start, index));
        const row = parse(Buffer.concat(pending), filter);
        pending = [];
        start = index + 1;
        if (row !== undefined && visit(row) === false) return;
      }
      // Copy: the buffer is reused by the next read.
      if (start < bytes) pending.push(Buffer.from(buffer.subarray(start, bytes)));
    }
    const row = pending.length ? parse(Buffer.concat(pending), filter) : undefined;
    if (row !== undefined) visit(row);
  } finally {
    fs.closeSync(handle);
  }
}

module.exports = { eachJsonLine };
