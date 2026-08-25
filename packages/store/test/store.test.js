import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendEntry, verifyChain } from '@facturify/core';
import { memoryStore, jsonlStore, AppendOnlyViolation } from '../dist/index.js';

const TS = '2026-08-25T12:00:00Z';
const chain = async (n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(await appendEntry(out[i - 1] ?? null, i === 0 ? 'genesis' : 'claim', { i, amount: BigInt(i) }, TS));
  }
  return out;
};

test('the port has no update and no delete — append-only is structural', async () => {
  const s = memoryStore();
  assert.deepEqual(Object.keys(s).sort(), ['all', 'append', 'last']);
});

test('entries append and read back in order', async () => {
  const s = memoryStore();
  for (const e of await chain(3)) await s.append(e);
  assert.equal((await s.all()).length, 3);
  assert.equal((await s.last()).seq, 2);
});

test('GATE: an out-of-order append is refused', async () => {
  const s = memoryStore();
  const [a, , c] = await chain(3);
  await s.append(a);
  await assert.rejects(() => s.append(c), AppendOnlyViolation);
});

test('GATE: an append that does not link to the previous hash is refused', async () => {
  const s = memoryStore();
  const [a] = await chain(3);
  await s.append(a);
  const forged = { ...(await chain(2))[1], prevHash: '0'.repeat(64) };
  await assert.rejects(() => s.append(forged), AppendOnlyViolation);
});

test('all() returns a copy: a caller cannot mutate the store through it', async () => {
  const s = memoryStore();
  for (const e of await chain(2)) await s.append(e);
  (await s.all()).pop();
  assert.equal((await s.all()).length, 2);
});

test('jsonl survives a round-trip with bigints intact and still verifies', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'facturify-')), 'ledger.jsonl');
  const s = await jsonlStore(file);
  for (const e of await chain(4)) await s.append(e);

  const reopened = await jsonlStore(file);
  const entries = await reopened.all();
  assert.equal(entries.length, 4);
  assert.equal(entries[2].payload.amount, 2n, 'a bigint must not come back as a string');
  assert.deepEqual(await verifyChain(entries), { valid: true, entries: 4 });
});

test('jsonl enforces the same append-only guard across process boundaries', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'facturify-')), 'ledger.jsonl');
  const s = await jsonlStore(file);
  const [a, , c] = await chain(3);
  await s.append(a);
  await assert.rejects(async () => (await jsonlStore(file)).append(c), AppendOnlyViolation);
});

test('a missing file reads as empty, not as an error', async () => {
  const s = await jsonlStore('/nonexistent/path/ledger.jsonl');
  assert.deepEqual(await s.all(), []);
  assert.equal(await s.last(), null);
});
