import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evm, TRANSFER_TOPIC, CHUNK } from '../dist/index.js';

const receipt = JSON.parse(
  readFileSync(new URL('./fixtures/receipt-e2e.json', import.meta.url), 'utf8'),
).result;

const E2E_TX = '0xa4a42890124b512efd604c5a340652a904dcc713786f10cd1bbf97ed7c9a5143';
const MULTICALL3 = '0xca11bde05977b3631167028862be2a173976ca11';
const USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e';
const PAYER = '0x6e598b1de6e924b57972f015cc8a87d809227aa3';
const COLLECTOR = '0xdf98b94653fc914124a5d1b7fa1435a40c656123';

const BLOCK = parseInt(receipt.blockNumber, 16);
const HEAD = BLOCK + 30;
const BASE_TS = 1_760_000_000;
const tsOf = (n) => BASE_TS + n * 2;

const transferLogs = receipt.logs
  .filter((l) => l.topics[0] === TRANSFER_TOPIC)
  .map((l) => ({ ...l, transactionHash: E2E_TX, blockNumber: receipt.blockNumber }));

/** A fake node that replays the recorded receipt. Deterministic and offline. */
const node = (opts = {}) => async (_url, init) => {
  const { method, params } = JSON.parse(init.body);
  const reply = (result) => ({ ok: true, json: async () => ({ jsonrpc: '2.0', result }) });

  if (method === 'eth_blockNumber') return reply(`0x${HEAD.toString(16)}`);
  if (method === 'eth_getBlockByNumber') {
    const n = parseInt(params[0], 16);
    return reply({ timestamp: `0x${tsOf(n).toString(16)}` });
  }
  if (method === 'eth_getLogs') {
    if (opts.logsFail) return { ok: false, json: async () => ({}) };
    const { fromBlock, toBlock, topics } = params[0];
    const lo = parseInt(fromBlock, 16);
    const hi = parseInt(toBlock, 16);
    if (BLOCK < lo || BLOCK > hi) return reply([]);
    const wantFrom = topics[1];
    const wantTo = topics[2];
    return reply(
      transferLogs.filter(
        (l) =>
          (wantFrom === null || l.topics[1] === wantFrom) &&
          (wantTo === null || l.topics[2] === wantTo),
      ),
    );
  }
  return { ok: false, json: async () => ({}) };
};

const rail = (opts) =>
  evm({
    rpc: 'http://fake',
    network: 'eip155:84532',
    tokens: [USDC],
    fetchImpl: node(opts),
  });

const SINCE = new Date(tsOf(BLOCK - 10) * 1000).toISOString();

test('GATE: finds the E2E settlement that went through Multicall3', async () => {
  const moves = await rail().movements(PAYER, SINCE);
  const debit = moves.find((m) => m.kind === 'debit');

  assert.equal(debit.txHash, E2E_TX);
  assert.equal(debit.amount, 20000n, '0.02 USDC at 6 decimals');
  assert.equal(debit.asset, USDC);
  assert.equal(debit.counterparty, COLLECTOR);
});

test('WHY NOT tx.to: the transaction was sent to Multicall3, not the token or the payee', () => {
  assert.equal(receipt.to.toLowerCase(), MULTICALL3);
  assert.notEqual(receipt.to.toLowerCase(), USDC);
  assert.notEqual(receipt.to.toLowerCase(), COLLECTOR);
  // A `tx.to` filter on either the token or the recipient reports this real,
  // settled payment as missing. That is the silent failure this rail exists for.
});

test('the same settlement reads as a credit on the collector account', async () => {
  const moves = await rail().movements(COLLECTOR, SINCE);
  const credit = moves.find((m) => m.kind === 'credit');
  assert.equal(credit.amount, 20000n);
  assert.equal(credit.counterparty, PAYER);
});

test('a rejected chunk aborts everything: partial coverage is not coverage', async () => {
  assert.equal(await rail({ logsFail: true }).movements(PAYER, SINCE), null);
});

test('an ungovernable window is refused rather than silently truncated', async () => {
  const moves = await rail().movements(PAYER, '2020-01-01T00:00:00Z');
  assert.equal(moves, null);
});

test('the chunk size is the limit the RPC declares, not a guess', () => {
  assert.equal(CHUNK, 10_000);
});
