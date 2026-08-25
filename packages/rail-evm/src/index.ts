import type { Atomic, Iso, Movement, NetworkRef, Rail } from '@facturify/core';

/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** The RPC declares this limit itself when you exceed it. Measured, not chosen. */
export const CHUNK = 10_000;
/** 60 chunks ~= 14 days on a 2s chain. A daily run uses about four. */
export const MAX_CHUNKS = 60;

const topicToAddress = (topic: string): string => `0x${topic.slice(-40)}`.toLowerCase();
const pad = (address: string): string => `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;

export interface EvmOptions {
  rpc: string;
  network: NetworkRef;
  /** ERC-20 contracts to watch. Empty means every token, which is rarely wanted. */
  tokens: string[];
  fetchImpl?: typeof fetch;
}

/**
 * Read-only EVM rail. Takes an RPC URL and a token list — nothing that could
 * sign.
 *
 * It reads ERC-20 `Transfer` logs and NOT `tx.to`. A settlement can be batched:
 * the E2E this was built against went through Multicall3, so the transaction's
 * destination was `0xca11…ca11` and neither the token nor the recipient. Any
 * filter on `tx.to` would have reported a real, on-chain payment as missing.
 */
export function evm(options: EvmOptions): Rail {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  let id = 0;

  const rpc = async (method: string, params: unknown[]): Promise<any | null> => {
    try {
      const res = await doFetch(options.rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
      });
      if (!res.ok) return null;
      const body = await res.json();
      return body?.error !== undefined ? null : (body?.result ?? null);
    } catch {
      return null;
    }
  };

  const blockTs = async (n: number): Promise<number | null> => {
    const b = await rpc('eth_getBlockByNumber', [`0x${n.toString(16)}`, false]);
    return b === null || b?.timestamp === undefined ? null : parseInt(b.timestamp, 16);
  };

  /**
   * Time -> block by BISECTION, never by dividing through an average block
   * time. An estimate that lands even slightly late silently drops movements,
   * and a window with holes presented as complete is worse than not looking.
   */
  const blockAt = async (iso: Iso): Promise<number | null> => {
    const target = Math.floor(Date.parse(iso) / 1000);
    const headHex = await rpc('eth_blockNumber', []);
    if (headHex === null) return null;
    let hi = parseInt(headHex, 16);
    let lo = 0;
    const headTs = await blockTs(hi);
    if (headTs === null) return null;
    if (headTs <= target) return hi;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const ts = await blockTs(mid);
      if (ts === null) return null;
      if (ts < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  return {
    network: options.network,

    async movements(account: string, since: Iso): Promise<Movement[] | null> {
      const from = await blockAt(since);
      const headHex = await rpc('eth_blockNumber', []);
      if (from === null || headHex === null) return null;
      const head = parseInt(headHex, 16);

      if (Math.ceil((head - from + 1) / CHUNK) > MAX_CHUNKS) {
        return null; // ungovernable window: refuse rather than return a partial one
      }

      const me = pad(account);
      const logs: any[] = [];
      for (let start = from; start <= head; start += CHUNK) {
        const end = Math.min(start + CHUNK - 1, head);
        const range = {
          fromBlock: `0x${start.toString(16)}`,
          toBlock: `0x${end.toString(16)}`,
          ...(options.tokens.length > 0 ? { address: options.tokens } : {}),
        };
        // Two passes: the account as sender, then as recipient.
        const [out, incoming] = await Promise.all([
          rpc('eth_getLogs', [{ ...range, topics: [TRANSFER_TOPIC, me, null] }]),
          rpc('eth_getLogs', [{ ...range, topics: [TRANSFER_TOPIC, null, me] }]),
        ]);
        // A rejected chunk aborts everything. Partial coverage is not coverage.
        if (out === null || incoming === null) return null;
        logs.push(...out, ...incoming);
      }

      const tsCache = new Map<number, number | null>();
      const out: Movement[] = [];
      for (const log of logs) {
        const blockNumber = parseInt(log.blockNumber, 16);
        if (!tsCache.has(blockNumber)) tsCache.set(blockNumber, await blockTs(blockNumber));
        const ts = tsCache.get(blockNumber);
        if (ts === null || ts === undefined) return null;

        const sender = topicToAddress(log.topics[1]);
        const recipient = topicToAddress(log.topics[2]);
        const isDebit = sender === account.toLowerCase();
        out.push({
          ts: new Date(ts * 1000).toISOString(),
          kind: isDebit ? 'debit' : 'credit',
          amount: BigInt(log.data),
          asset: String(log.address).toLowerCase(),
          counterparty: isDebit ? recipient : sender,
          txHash: log.transactionHash,
        });
      }
      return out;
    },

    async balance(account: string, asset: string): Promise<Atomic | null> {
      // balanceOf(address)
      const data = `0x70a08231${account.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
      const res = await rpc('eth_call', [{ to: asset, data }, 'latest']);
      return res === null || res === '0x' ? null : BigInt(res);
    },
  };
}
