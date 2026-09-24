#!/usr/bin/env node
//
// Screenshots the dashboard and asserts it rendered real data.
//
// Playwright is deliberately NOT a dependency of this package — ctxmeter ships
// zero dependencies and this is a maintainer-only tool. Install it anywhere that
// Node can resolve and point NODE_PATH at it if needed:
//
//   npm install playwright@1.63.0
//   node scripts/capture-dashboard.js
//
// Exits non-zero if the page shows no harness numbers, so this doubles as a
// smoke test for the dashboard's wiring.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { run } = require('../src/cli');

const OUTPUT_DIRECTORY = path.join(__dirname, '..', 'docs', 'img');
const VIEWPORT = { width: 1440, height: 900 };

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    throw new Error('playwright is not installed. Run `npm install playwright@1.63.0` somewhere Node can resolve it.');
  }
}

async function capture() {
  const { chromium } = loadPlaywright();
  const dashboard = await run(['dashboard', '--port', '0']);
  const url = dashboard.summary.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  const browser = await chromium.launch();
  const failures = [];
  try {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await page.goto(url, { waitUntil: 'networkidle' });
    // The harness panels render from an async fetch, so wait for content rather
    // than a fixed delay.
    await page.waitForFunction(() => /\d/.test(document.body.innerText), null, { timeout: 20_000 });
    await page.waitForTimeout(1_200);

    const text = await page.innerText('body');
    for (const expected of ['Claude', 'Codex', 'Kiro']) {
      if (!text.includes(expected)) failures.push(`page never mentioned ${expected}`);
    }
    if (!/[\d,]{3,}/.test(text)) failures.push('page rendered no multi-digit numbers');
    if (/\b1 (assets|items|skills|hooks)\b/.test(text)) failures.push('found a singular count with a plural noun');
    if (consoleErrors.length > 0) failures.push(`console errors: ${consoleErrors.join(' | ')}`);

    // Two images: a viewport hero small enough for the README, and a full-page
    // capture for the reference docs.
    const hero = path.join(OUTPUT_DIRECTORY, 'dashboard.png');
    const full = path.join(OUTPUT_DIRECTORY, 'dashboard-full.png');
    await page.screenshot({ path: hero });
    await page.screenshot({ path: full, fullPage: true });
    for (const file of [hero, full]) {
      console.log(`${path.relative(path.join(__dirname, '..'), file)}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
    }
    console.log(`captured from ${url}; page text ${text.length} chars`);
  } finally {
    await browser.close();
    await new Promise((resolve) => dashboard.server.close(resolve));
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
}

capture().catch((error) => {
  process.stderr.write(`capture-dashboard: ${error.message}\n`);
  process.exitCode = 1;
});
