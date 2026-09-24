const assert = require('node:assert/strict');
const test = require('node:test');

const { createStatusLine } = require('../src/status-line');

function fakeStream(isTTY) {
  const writes = [];
  return { isTTY, write: (chunk) => writes.push(chunk), writes };
}

test('announces progress on an interactive terminal', () => {
  // Arrange
  const stream = fakeStream(true);
  const status = createStatusLine(stream);

  // Act
  status.show('Reading Claude Code');

  // Assert
  assert.equal(stream.writes.length, 1);
  assert.match(stream.writes[0], /Reading Claude Code/);
});

test('stays silent when output is piped so machine consumers see clean streams', () => {
  // Arrange
  const stream = fakeStream(false);
  const status = createStatusLine(stream);

  // Act
  status.show('Reading Claude Code');
  status.clear();

  // Assert
  assert.deepEqual(stream.writes, []);
});

test('erases the line so the status never mixes into the report', () => {
  // Arrange
  const stream = fakeStream(true);
  const status = createStatusLine(stream);

  // Act
  status.show('Reading Codex');
  status.clear();

  // Assert
  const erase = stream.writes.at(-1);
  assert.match(erase, /\r/, 'clear should return the cursor to column zero');
  assert.match(erase, /\u001b\[K/, 'clear should erase to end of line');
});

test('replaces the previous status instead of stacking lines', () => {
  // Arrange
  const stream = fakeStream(true);
  const status = createStatusLine(stream);

  // Act
  status.show('Reading Claude Code');
  status.show('Reading Codex');

  // Assert
  for (const chunk of stream.writes) assert.ok(!chunk.includes('\n'), 'status writes must not emit newlines');
});

test('clear is safe before anything was shown', () => {
  // Arrange
  const stream = fakeStream(true);
  const status = createStatusLine(stream);

  // Act
  status.clear();

  // Assert
  assert.deepEqual(stream.writes, []);
});
