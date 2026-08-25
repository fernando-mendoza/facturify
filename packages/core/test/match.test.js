import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchClaim } from '../dist/index.js';

const ASSET = 'CCW67TSZ';
const claim = {
  network: 'stellar:pubnet',
  payTo: 'GDNJXCKW',
  asset: ASSET,
  amount: 10000n,
  window: { from: '2026-08-25T00:00:00Z', to: '2026-08-25T23:59:59Z' },
};
const credit = (txHash, ts, amount = 10000n) => ({
  ts, kind: 'credit', amount, asset: ASSET, counterparty: 'GA5WN2JB', txHash,
});

test('GATE: an unreadable rail is `unknown`, never `not-settled`', () => {
  const v = matchClaim(claim, null);
  assert.equal(v.state, 'unknown');
  assert.equal(v.reason, 'rail-unreadable');
});

test('an empty movement list IS `not-settled` — it means we looked', () => {
  assert.equal(matchClaim(claim, []).state, 'not-settled');
});

test('one match settles, unambiguously', () => {
  const v = matchClaim(claim, [credit('abc', '2026-08-25T10:00:00Z')]);
  assert.equal(v.state, 'settled');
  assert.equal(v.ambiguous, false);
  assert.equal(v.candidates, 1);
  assert.equal(v.evidence.txHash, 'abc');
});

test('GATE: two identical payments in the window are declared ambiguous', () => {
  const v = matchClaim(claim, [
    credit('late', '2026-08-25T14:00:00Z'),
    credit('early', '2026-08-25T09:00:00Z'),
  ]);
  assert.equal(v.state, 'settled');
  assert.equal(v.ambiguous, true, 'must not silently pick one');
  assert.equal(v.candidates, 2);
  assert.equal(v.evidence.txHash, 'early', 'reports the earliest, and says it is ambiguous');
});

test('a txHash removes the ambiguity entirely', () => {
  const withHash = { ...claim, txHash: 'late' };
  const v = matchClaim(withHash, [
    credit('late', '2026-08-25T14:00:00Z'),
    credit('early', '2026-08-25T09:00:00Z'),
  ]);
  assert.equal(v.ambiguous, false);
  assert.equal(v.evidence.txHash, 'late');
});

test('a movement outside the window does not count', () => {
  assert.equal(matchClaim(claim, [credit('x', '2026-08-24T10:00:00Z')]).state, 'not-settled');
});

test('a different amount does not count — no tolerance on money', () => {
  assert.equal(matchClaim(claim, [credit('x', '2026-08-25T10:00:00Z', 9999n)]).state, 'not-settled');
});

test('a debit on the collector account is not a payment to it', () => {
  const debit = { ...credit('x', '2026-08-25T10:00:00Z'), kind: 'debit' };
  assert.equal(matchClaim(claim, [debit]).state, 'not-settled');
});
