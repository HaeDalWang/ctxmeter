'use strict';

const ERASE_LINE = '\r\u001b[K';

/// A single rewritable stderr line. The audit spends a few seconds walking
/// thousands of files, and a silent terminal reads as a hung process. Writing to
/// stderr keeps stdout pipeable, and the TTY check keeps pipes and CI silent.
function createStatusLine(stream = process.stderr) {
  const isInteractive = Boolean(stream && stream.isTTY);
  let isShowing = false;
  return {
    show(message) {
      if (!isInteractive) return;
      stream.write(`${ERASE_LINE}${message}`);
      isShowing = true;
    },
    clear() {
      if (!isInteractive || !isShowing) return;
      stream.write(ERASE_LINE);
      isShowing = false;
    },
  };
}

module.exports = { createStatusLine };
