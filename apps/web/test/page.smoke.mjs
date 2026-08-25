import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import assert from 'node:assert/strict';

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.map': 'application/json' };
const server = createServer(async (req, res) => {
  const path = join('dist', req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'text/plain' });
    res.end(body);
  } catch { res.writeHead(404).end('nope'); }
});
await new Promise((r) => server.listen(4321, r));

const browser = await chromium.launch({ channel: 'chrome' });
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(['✔', name]); }
  catch (e) { results.push(['✖', `${name} — ${e.message.split('\n')[0]}`]); }
};

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:4321/', { waitUntil: 'networkidle' });

await check('page loads with no console or page errors', () => assert.deepEqual(errors, []));
await check('title names the product question', async () =>
  assert.match(await page.title(), /did this agent payment actually settle/i));
await check('fonts loaded (Space Grotesk display)', async () =>
  assert.match(await page.$eval('h1', (el) => getComputedStyle(el).fontFamily), /Space Grotesk/));

// THE REAL TEST: hit mainnet from the browser.
await check('GATE: the live verifier returns settled against mainnet', async () => {
  await page.click('#run');
  await page.waitForFunction(() => document.getElementById('chip').textContent !== 'reading', null, { timeout: 30000 });
  const state = await page.$eval('#chip', (el) => el.textContent);
  assert.equal(state, 'settled', `chip said "${state}"`);
  const body = await page.$eval('#out', (el) => el.textContent);
  assert.match(body, /"txHash": "[0-9a-f]{64}"/, 'must show a real citable hash');
});

await check('GATE: a decimal amount is refused before touching the network', async () => {
  await page.fill('#in-amount', '0.001');
  await page.click('#run');
  await page.waitForTimeout(300);
  assert.match(await page.$eval('#out', (el) => el.textContent), /atomic integer/);
  await page.fill('#in-amount', '10000');
});

await check('the palette traps focus in its input when opened', async () => {
  await page.keyboard.press('Control+k');
  await page.waitForFunction(() => document.getElementById('pal').hasAttribute('open'), null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'pal-input');
  await page.keyboard.press('Escape');
});

await check('GATE: an unreadable account yields unknown, not not-settled', async () => {
  await page.fill('#in-payto', 'GBOGUSACCOUNTTHATDOESNOTEXIST00000000000000000000000000');
  await page.click('#run');
  await page.waitForFunction(() => !['reading'].includes(document.getElementById('chip').textContent), null, { timeout: 30000 });
  const state = await page.$eval('#chip', (el) => el.textContent);
  assert.equal(state, 'unknown', `chip said "${state}"`);
});

await check('the command palette opens on Ctrl+K and filters', async () => {
  await page.keyboard.press('Control+k');
  await page.waitForFunction(() => document.getElementById('pal').hasAttribute('open'), null, { timeout: 5000 });
  await page.fill('#pal-input', 'install');
  const rows = await page.$$eval('.pal__row', (r) => r.length);
  assert.equal(rows, 1);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('pal').hasAttribute('open'), null, { timeout: 5000 });
});

await check('copy button gives silent success feedback', async () => {
  await page.context().grantPermissions(['clipboard-write', 'clipboard-read']);
  await page.click('.copy[data-copy="cli"]');
  await page.waitForTimeout(200);
  assert.equal(await page.$eval('.copy[data-copy="cli"]', (b) => b.textContent), 'copied');
});

// Mobile: the hard floor.
for (const width of [320, 375, 414, 768]) {
  const m = await browser.newPage({ viewport: { width, height: 800 } });
  await m.goto('http://localhost:4321/', { waitUntil: 'load' });
  await m.evaluate(() => document.fonts.ready);
  await check(`no horizontal scroll at ${width}px`, async () => {
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `overflows by ${overflow}px`);
  });
  await check(`hit targets >= 44px at ${width}px`, async () => {
    const small = await m.$$eval('.btn, .kbd-trigger, .copy', (els) =>
      els.filter((e) => e.getBoundingClientRect().height < 44)
         .map((e) => `${e.className}@${e.getBoundingClientRect().height.toFixed(1)}px`));
    if (width <= 640) assert.equal(small.join(' | '), '', `undersized: ${small.join(' | ')}`);
  });
  await m.close();
}

await browser.close();
server.close();

for (const [mark, name] of results) console.log(`${mark} ${name}`);
const failed = results.filter(([m]) => m === '✖').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
