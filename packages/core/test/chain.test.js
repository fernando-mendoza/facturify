import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendEntry, verifyChain, canonical, GENESIS_PREV } from '../dist/index.js';

const TS = '2026-08-25T12:00:00Z';

async function buildChain() {
  const a = await appendEntry(null, 'genesis', { note: 'start' }, TS);
  const b = await appendEntry(a, 'claim', { amount: 10000n, payTo: 'GA5W' }, TS);
  const c = await appendEntry(b, 'verdict', { state: 'settled' }, TS);
  return [a, b, c];
}

test('genesis anchors to the zero hash and seq starts at 0', async () => {
  const [a] = await buildChain();
  assert.equal(a.prevHash, GENESIS_PREV);
  assert.equal(a.seq, 0);
  assert.equal(a.hash.length, 64);
});

test('an intact chain verifies', async () => {
  const chain = await buildChain();
  assert.deepEqual(await verifyChain(chain), { valid: true, entries: 3 });
});

test('GATE: a tampered export fails verifyChain', async () => {
  const chain = await buildChain();
  // Someone edits the amount in an exported receipt and keeps the hash.
  chain[1] = { ...chain[1], payload: { amount: 1n, payTo: 'GA5W' } };
  const result = await verifyChain(chain);
  assert.equal(result.valid, false);
  assert.equal(result.brokenAt, 1);
  assert.equal(result.reason, 'bad-hash');
});

test('re-hashing the tampered entry still fails: the link is broken downstream', async () => {
  const chain = await buildChain();
  const forged = await appendEntry(chain[0], 'claim', { amount: 1n }, TS);
  chain[1] = forged; // hash is now self-consistent...
  const result = await verifyChain(chain);
  // ...but entry 2 still points at the original hash.
  assert.equal(result.valid, false);
  assert.equal(result.brokenAt, 2);
  assert.equal(result.reason, 'broken-link');
});

test('dropping an entry is detected', async () => {
  const chain = await buildChain();
  const result = await verifyChain([chain[0], chain[2]]);
  assert.equal(result.valid, false);
});

test('canonical form is key-order independent', () => {
  assert.equal(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }));
});

test('canonical form never confuses a bigint with its string', () => {
  assert.notEqual(canonical({ amount: 100n }), canonical({ amount: '100' }));
});
