import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyChain } from '@facturify/core';
import { memoryStore } from '@facturify/store';
import { facturify } from '../dist/index.js';

const NET = 'stellar:pubnet';
const COLLECTOR = 'GDNJXCKW';
const ASSET = 'USDC:GA5ZSEJY';
const claim = (over = {}) => ({
  network: NET, payTo: COLLECTOR, asset: ASSET, amount: 10000n,
  window: { from: '2026-08-25T00:00:00Z', to: '2026-08-25T23:59:59Z' }, ...over,
});
const credit = (txHash, ts = '2026-08-25T14:05:29Z') => ({
  ts, kind: 'credit', amount: 10000n, asset: ASSET, counterparty: 'GA5WN2JB', txHash,
});

/** Records which account was asked for. */
const fakeRail = (script) => {
  const asked = [];
  let call = 0;
  return {
    asked,
    rail: {
      network: NET,
      async movements(account) {
        asked.push(account);
        const step = script[Math.min(call++, script.length - 1)];
        return step;
      },
      async balance() { return 0n; },
    },
  };
};

// A clock that only moves when the code sleeps: no wall-clock flakiness.
const fakeClock = () => {
  let t = Date.parse('2026-08-25T15:00:00Z');
  return { now: () => new Date(t), sleep: async (ms) => { t += ms; } };
};

test('verify reads the COLLECTOR account, not the payer', async () => {
  const { rail, asked } = fakeRail([[credit('abc')]]);
  await facturify({ rails: [rail] }).verify(claim());
  assert.deepEqual(asked, [COLLECTOR], 'a payment to someone lands on their account');
});

test('verify returns settled and records it in the audit trail', async () => {
  const { rail } = fakeRail([[credit('abc')]]);
  const f = facturify({ rails: [rail] });
  const verdict = await f.verify(claim());
  assert.equal(verdict.state, 'settled');
  assert.equal(verdict.evidence.txHash, 'abc');
  const entries = await f.export();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'verdict');
});

test('GATE: an unreadable rail yields unknown, and the trail says so', async () => {
  const { rail } = fakeRail([null]);
  const f = facturify({ rails: [rail] });
  const verdict = await f.verify(claim());
  assert.equal(verdict.state, 'unknown');
  assert.equal(verdict.reason, 'rail-unreadable');
});

test('a claim on a network we have no rail for is unknown, never not-settled', async () => {
  const { rail } = fakeRail([[]]);
  const f = facturify({ rails: [rail] });
  const verdict = await f.verify(claim({ network: 'eip155:8453' }));
  assert.deepEqual(verdict, { state: 'unknown', reason: 'network-unsupported' });
});

test('GATE: the audit trail verifies after a mixed sequence of operations', async () => {
  const { rail } = fakeRail([[credit('a')], null, [credit('b')]]);
  const f = facturify({ rails: [rail], store: memoryStore() });
  await f.record(claim());
  await f.verify(claim());
  await f.verify(claim());
  await f.reconcile({
    balanceObserved: 100n, balanceExpected: 100n, movements: null,
    explained: [], pending: [], isFirstRun: false,
  });
  const entries = await f.export();
  assert.equal(entries.length, 4);
  assert.deepEqual(await verifyChain(entries), { valid: true, entries: 4 });
  assert.deepEqual(await f.verifyOwnChain(), { valid: true, entries: 4 });
});

test('a tampered export is caught by verifyChain', async () => {
  const { rail } = fakeRail([[credit('a')]]);
  const f = facturify({ rails: [rail] });
  await f.verify(claim());
  const entries = await f.export();
  entries[0].payload = { tampered: true };
  assert.equal((await verifyChain(entries)).valid, false);
});

test('awaitSettlement resolves as soon as the payment lands', async () => {
  const { rail } = fakeRail([[credit('abc')]]);
  const f = facturify({ rails: [rail], ...fakeClock() });
  const r = await f.record(claim());
  const outcome = await r.awaitSettlement({ deadlineMs: 60_000, intervalMs: 2_000 });
  assert.equal(outcome.state, 'settled');
});

test('GATE: a late settlement is caught on a later poll, not missed', async () => {
  // Three empty checks, then the money lands — the real x402 timing.
  const { rail } = fakeRail([[], [], [], [credit('late')]]);
  const f = facturify({ rails: [rail], ...fakeClock() });
  const r = await f.record(claim());
  const outcome = await r.awaitSettlement({ deadlineMs: 60_000, intervalMs: 2_000 });
  assert.equal(outcome.state, 'settled');
  assert.equal(outcome.evidence.txHash, 'late');
});

test('GATE: the deadline returns `pending`, never `not-settled`', async () => {
  const { rail } = fakeRail([[]]);
  const f = facturify({ rails: [rail], ...fakeClock() });
  const r = await f.record(claim());
  const outcome = await r.awaitSettlement({ deadlineMs: 10_000, intervalMs: 2_000 });
  assert.equal(outcome.state, 'pending', 'not settled YET is not not-settled');
  assert.ok(outcome.checks >= 4);
});

test('awaitSettlement does not loop forever on a broken rail', async () => {
  const { rail } = fakeRail([null]);
  const f = facturify({ rails: [rail], ...fakeClock() });
  const r = await f.record(claim());
  const outcome = await r.awaitSettlement({ deadlineMs: 6_000, intervalMs: 2_000 });
  assert.equal(outcome.state, 'unknown');
});

test('the claim is recorded before any settlement exists', async () => {
  const { rail } = fakeRail([[]]);
  const f = facturify({ rails: [rail], ...fakeClock() });
  const r = await f.record(claim());
  assert.equal(r.entry.kind, 'claim');
  assert.equal(r.entry.seq, 0);
  assert.equal(r.entry.payload.amount, 10000n);
});

test('ambiguity survives all the way to the caller', async () => {
  const { rail } = fakeRail([[credit('one', '2026-08-25T10:00:00Z'), credit('two', '2026-08-25T11:00:00Z')]]);
  const verdict = await facturify({ rails: [rail] }).verify(claim());
  assert.equal(verdict.ambiguous, true);
  assert.equal(verdict.candidates, 2);
});
