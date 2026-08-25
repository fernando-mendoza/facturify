import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stellar, toAtomic } from '../dist/index.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));

const PAYER = 'GA5WN2JBYTPARINB7YCAVGBHPV65475GY37DN7VDKU2VXYSY6MQAIUA3';
const COLLECTOR = 'GCLBBPON256CV7ATEHM5B54BOKNC7GX53MBINJ42MHVXGDMMZ3ZWKBHP';
const PHANTOM_TX = 'f03a5d5b1da5c888b7d42936052241f75af8a217a55900136e8d4b4597ca4e99';
const USDC = 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

// Serves the real chain data recorded from Horizon on 2026-08-25.
const recorded = (missing = []) => async (url) => {
  const u = String(url);
  if (missing.some((m) => u.includes(m))) return { ok: false, json: async () => ({}) };
  const body = u.includes('/effects') && u.includes('/operations/')
    ? fx('operation-effects.json')
    : u.includes('/effects')
      ? fx('account-effects-phantom.json')
      : u.includes('/operations/')
        ? fx('operation-274050365530976257.json')
        : null;
  if (body === null) return { ok: false, json: async () => ({}) };
  return { ok: true, json: async () => body };
};

test('GATE: finds the phantom payment debit with its real txHash', async () => {
  const rail = stellar({ fetchImpl: recorded() });
  const moves = await rail.movements(PAYER, '2026-08-01T00:00:00Z');
  const debit = moves.find((m) => m.kind === 'debit');

  assert.equal(debit.txHash, PHANTOM_TX, 'must cite the real hash, not "check the explorer"');
  assert.equal(debit.amount, 200000n, '0.0200000 USDC in atomic units');
  assert.equal(debit.asset, USDC);
  assert.equal(debit.counterparty, COLLECTOR, 'resolved from the other side of the operation');
  assert.equal(debit.ts, '2026-08-05T07:29:36Z');
});

test('the settlement is visible as a credit on the collector account', async () => {
  const rail = stellar({ fetchImpl: recorded() });
  const moves = await rail.movements(COLLECTOR, '2026-08-01T00:00:00Z');
  const credit = moves.find((m) => m.kind === 'credit' && m.counterparty === PAYER);
  assert.equal(credit.txHash, PHANTOM_TX);
  assert.equal(credit.amount, 200000n);
});

test('WHY /effects: the operation itself carries no money at all', () => {
  const op = fx('operation-274050365530976257.json');
  assert.equal(op.type, 'invoke_host_function', 'a SAC transfer is a contract call');
  for (const field of ['amount', 'asset_code', 'from', 'to']) {
    assert.equal(op[field], undefined, `/payments would report no ${field}`);
  }
});

test('an unreadable Horizon is null, never an empty list', async () => {
  const rail = stellar({ fetchImpl: async () => { throw new Error('network down'); } });
  assert.equal(await rail.movements(PAYER, '2026-08-01T00:00:00Z'), null);
});

test('an operation we cannot resolve aborts: a movement without a citable hash is not evidence', async () => {
  const rail = stellar({ fetchImpl: recorded(['/operations/274050365530976257?', '274050365530976257']) });
  assert.equal(await rail.movements(PAYER, '2026-08-01T00:00:00Z'), null);
});

test('movements before the window are excluded', async () => {
  const rail = stellar({ fetchImpl: recorded() });
  assert.deepEqual(await rail.movements(PAYER, '2026-09-01T00:00:00Z'), []);
});

test('decimal to atomic is exact — no float ever touches money', () => {
  assert.equal(toAtomic('0.0200000'), 200000n);
  assert.equal(toAtomic('2.9317268'), 29317268n);
  assert.equal(toAtomic('0.0000001'), 1n);
  assert.equal(toAtomic('1000'), 10000000000n);
});
