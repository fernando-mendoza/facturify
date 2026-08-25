import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseArgs, buildClaim, main } from '../dist/cli.js';

const run = promisify(execFile);
const BIN = new URL('../dist/cli.js', import.meta.url).pathname;

test('parseArgs handles values, flags and adjacent flags', () => {
  assert.deepEqual(parseArgs(['--a', '1', '--flag', '--b', '2']), { a: '1', flag: true, b: '2' });
});

test('buildClaim demands every field that money depends on', () => {
  assert.equal(buildClaim({}), 'missing --network');
  assert.equal(buildClaim({ network: 'stellar:pubnet' }), 'missing --pay-to');
  assert.equal(buildClaim({ network: 'x', 'pay-to': 'G' }), 'missing --amount');
  assert.equal(buildClaim({ network: 'x', 'pay-to': 'G', amount: '1' }), 'missing --asset');
});

test('GATE: a decimal amount is refused — atomic integers only', () => {
  const r = buildClaim({ network: 'stellar:pubnet', 'pay-to': 'G', amount: '0.001', asset: 'USDC' });
  assert.match(r, /atomic integer/);
});

test('buildClaim parses an atomic amount as a bigint', () => {
  const c = buildClaim({ network: 'stellar:pubnet', 'pay-to': 'G', amount: '10000', asset: 'USDC' });
  assert.equal(c.amount, 10000n);
  assert.equal(typeof c.amount, 'bigint');
});

test('the default window is the last 24 hours, closed at now', () => {
  const c = buildClaim({ network: 'stellar:pubnet', 'pay-to': 'G', amount: '1', asset: 'U' });
  assert.equal(Date.parse(c.window.to) - Date.parse(c.window.from), 24 * 3600 * 1000);
});

test('an explicit txHash reaches the claim', () => {
  const c = buildClaim({ network: 'stellar:pubnet', 'pay-to': 'G', amount: '1', asset: 'U', tx: 'abc' });
  assert.equal(c.txHash, 'abc');
});

test('GATE: exit codes distinguish the three verdicts from a usage error', async () => {
  assert.equal(await main(['verify']), 3, 'usage error');
  assert.equal(await main(['export']), 3, 'missing --file');
  assert.equal(await main([]), 0, 'no command prints usage');
  assert.equal(await main(['bogus']), 3);
});

test('the binary runs and documents the exit codes', async () => {
  const { stdout } = await run(process.execPath, [BIN, '--help']);
  assert.match(stdout, /0 settled/);
  assert.match(stdout, /1 not settled/);
  assert.match(stdout, /2 unknown/);
  assert.match(stdout, /ATOMIC/);
});

test('export --verify on an empty ledger is valid and exits 0', async () => {
  assert.equal(await main(['export', '--file', '/nonexistent/x.jsonl', '--verify']), 0);
});
