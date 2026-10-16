const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { eachJsonLine } = require('../src/jsonl');

function file(content) {
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-jsonl-')), 'log.jsonl');
  fs.writeFileSync(target, content);
  return target;
}

test('reads every row, skipping blank and torn lines', () => {
  // Arrange
  const target = file('{"a":1}\n\n{"a":2}\r\n{"a":\n{"a":3}');

  // Act
  const rows = [];
  eachJsonLine(target, (row) => { rows.push(row.a); });

  // Assert
  assert.deepEqual(rows, [1, 2, 3]);
});

test('a row longer than the read buffer is reassembled', () => {
  // Arrange
  const long = 'x'.repeat(300_000);
  const target = file(`${JSON.stringify({ long })}\n${JSON.stringify({ a: 2 })}\n`);

  // Act
  const rows = [];
  eachJsonLine(target, (row) => { rows.push(row); }, { chunkBytes: 64 * 1024 });

  // Assert
  assert.equal(rows[0].long.length, 300_000);
  assert.equal(rows[1].a, 2);
});

test('multi-byte characters split across reads survive', () => {
  // Arrange
  const text = '한국어'.repeat(10_000);
  const target = file(`${JSON.stringify({ text })}\n`);

  // Act
  const rows = [];
  eachJsonLine(target, (row) => { rows.push(row); }, { chunkBytes: 1_001 });

  // Assert
  assert.equal(rows[0].text, text);
});

test('returning false stops reading', () => {
  // Arrange
  const target = file('{"a":1}\n{"a":2}\n{"a":3}\n');

  // Act
  const rows = [];
  eachJsonLine(target, (row) => { rows.push(row.a); return row.a < 2; });

  // Assert
  assert.deepEqual(rows, [1, 2]);
});

test('a missing file reads as empty', () => {
  assert.doesNotThrow(() => eachJsonLine('/no/such/file.jsonl', () => assert.fail('no rows')));
});

test('a line filter skips non-matching lines without parsing them', () => {
  // Arrange: the second line is valid JSON, so only the filter can keep it out.
  const target = file('{"type":"keep","a":1}\n{"type":"skip","a":99}\n{"type":"keep","a":2}\n');

  // Act
  const rows = [];
  eachJsonLine(target, (row) => { rows.push(row.a); }, { lineFilter: '"type":"keep"' });

  // Assert
  assert.deepEqual(rows, [1, 2]);
});
