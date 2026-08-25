import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile } from '../dist/index.js';

const mv = (kind, amount, txHash, ts = '2026-08-25T10:00:00Z') => ({
  ts, kind, amount, asset: 'CCW67TSZ', counterparty: 'GDNJXCKW', txHash,
});
const base = { balanceExpected: 1000n, movements: null, explained: [], pending: [], isFirstRun: false };

test('GATE: an unreadable balance is `unreadable`, not `ok`', () => {
  const r = reconcile({ ...base, balanceObserved: null });
  assert.equal(r.outcome, 'unreadable');
  assert.equal(r.alert, true);
});

test('first run anchors a baseline without asserting anything', () => {
  const r = reconcile({ ...base, balanceObserved: 1000n, isFirstRun: true });
  assert.equal(r.outcome, 'baseline');
  assert.equal(r.alert, false);
});

test('balance matching with every debit explained is ok', () => {
  const r = reconcile({
    ...base, balanceObserved: 1000n,
    movements: [mv('debit', 50n, '0xaaa')], explained: [{ amount: 50n }],
  });
  assert.equal(r.outcome, 'ok');
  assert.deepEqual(r.unloggedDebits, []);
});

test('GATE: the netting case — balance adds up and it alerts anyway', () => {
  // 50 leaves with no ledger entry, 50 arrives as a swap. Delta is zero.
  const r = reconcile({
    ...base,
    balanceObserved: 1000n,
    movements: [mv('debit', 50n, '0xghost'), mv('credit', 50n, '0xswap')],
    explained: [],
  });
  assert.equal(r.delta, 0n, 'the balance really does add up');
  assert.equal(r.outcome, 'unlogged-debit', 'a balance-only check would have signed this off');
  assert.equal(r.alert, true);
  assert.equal(r.unloggedDebits[0].txHash, '0xghost');
});

test('missing funds nothing explains is a mismatch', () => {
  const r = reconcile({ ...base, balanceObserved: 900n });
  assert.equal(r.outcome, 'mismatch');
  assert.equal(r.alert, true);
});

test('missing funds matching a pending settlement is a late settlement, with its real txHash', () => {
  const r = reconcile({
    ...base, balanceObserved: 900n,
    movements: [mv('debit', 100n, '0xlate')],
    explained: [{ amount: 100n }],
    pending: [{ amount: 100n, ref: 'seq-42' }],
  });
  assert.equal(r.outcome, 'late-settlement');
  assert.deepEqual(r.resolved, { ref: 'seq-42', txHash: '0xlate' });
  assert.equal(r.alert, false);
});

test('a late settlement without per-operation reading is attributed by amount, and says so', () => {
  const r = reconcile({
    ...base, balanceObserved: 900n, pending: [{ amount: 100n, ref: 'seq-42' }],
  });
  assert.equal(r.outcome, 'late-settlement');
  assert.deepEqual(r.resolved, { ref: 'seq-42' });
  assert.match(r.reason, /no txHash/);
});

test('extra funds are reported as credit, not as an error', () => {
  const r = reconcile({ ...base, balanceObserved: 1100n });
  assert.equal(r.outcome, 'credit');
  assert.equal(r.alert, false);
});

test('precedence: a mismatch outranks an unlogged debit', () => {
  const r = reconcile({
    ...base, balanceObserved: 900n,
    movements: [mv('debit', 77n, '0xghost')], explained: [],
  });
  assert.equal(r.outcome, 'mismatch');
});

test('a rail without movements() degrades to balance-only and declares it', () => {
  const r = reconcile({ ...base, balanceObserved: 1000n, movements: null });
  assert.equal(r.outcome, 'ok');
  assert.equal(r.unloggedDebits, null, 'null is not an empty list');
  assert.match(r.reason, /balance-only/);
});
