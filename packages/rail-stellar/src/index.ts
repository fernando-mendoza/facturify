import type { Atomic, Iso, Movement, NetworkRef, Rail } from '@facturify/core';

/** Stellar amounts are fixed-point with 7 decimals. */
const STROOPS = 7;

/** "0.0200000" -> 200000n. Exact: money never round-trips through a float. */
export function toAtomic(decimal: string, decimals = STROOPS): Atomic {
  const [whole = '0', frac = ''] = decimal.split('.');
  return BigInt(whole + frac.padEnd(decimals, '0').slice(0, decimals));
}

export interface StellarOptions {
  horizon?: string;
  network?: NetworkRef;
  /** Injected so tests run offline against recorded chain data. */
  fetchImpl?: typeof fetch;
  /** Effects page size. */
  limit?: number;
}

interface Effect {
  type: string;
  account: string;
  amount?: string;
  asset_code?: string;
  asset_issuer?: string;
  asset_type?: string;
  created_at: string;
  _links: { operation: { href: string } };
}

const assetRef = (e: Effect): string =>
  e.asset_type === 'native'
    ? 'native'
    : e.asset_issuer === undefined
      ? (e.asset_code ?? 'unknown')
      : `${e.asset_code}:${e.asset_issuer}`;

/**
 * Read-only Stellar rail. Takes a Horizon URL and nothing else — there is no
 * parameter here that could carry a key.
 *
 * It reads /effects, NOT /payments. A payment made through a Soroban contract
 * (every SAC/USDC transfer here) shows up as an `invoke_host_function`
 * operation carrying no amount, no asset and no counterparty, so /payments
 * reports the transfer as if it had no money in it. Only the effects
 * (`account_debited` / `account_credited`) expose the figures.
 *
 * The txHash is not in the effect either: it is resolved through the effect's
 * link to its operation. That costs one cached request per operation, and it is
 * the price of reporting a real hash instead of "verify it in the explorer".
 */
export function stellar(options: StellarOptions = {}): Rail {
  const horizon = options.horizon ?? 'https://horizon.stellar.org';
  const network = options.network ?? ('stellar:pubnet' as NetworkRef);
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const limit = options.limit ?? 200;

  const getJson = async (url: string): Promise<any | null> => {
    try {
      const res = await doFetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null; // "could not read" — never mistaken for "nothing there"
    }
  };

  return {
    network,

    async movements(account: string, since: Iso): Promise<Movement[] | null> {
      const page = await getJson(
        `${horizon}/accounts/${account}/effects?order=desc&limit=${limit}`,
      );
      if (page === null) return null;

      const effects: Effect[] = page?._embedded?.records ?? [];
      const relevant = effects.filter(
        (e) =>
          (e.type === 'account_debited' || e.type === 'account_credited') &&
          Date.parse(e.created_at) >= Date.parse(since),
      );

      const opCache = new Map<string, { txHash: string; sides: Effect[] } | null>();
      const loadOp = async (href: string) => {
        if (opCache.has(href)) return opCache.get(href) ?? null;
        const [op, opEffects] = await Promise.all([getJson(href), getJson(`${href}/effects`)]);
        const value =
          op === null || typeof op.transaction_hash !== 'string'
            ? null
            : { txHash: op.transaction_hash, sides: opEffects?._embedded?.records ?? [] };
        opCache.set(href, value);
        return value;
      };

      const out: Movement[] = [];
      for (const e of relevant) {
        const op = await loadOp(e._links.operation.href);
        // Without a real txHash we do not emit a movement: a movement that
        // cannot be cited is not evidence.
        if (op === null) return null;

        const other = op.sides.find(
          (s: Effect) =>
            s.account !== e.account &&
            (s.type === 'account_debited' || s.type === 'account_credited'),
        );

        out.push({
          ts: e.created_at,
          kind: e.type === 'account_debited' ? 'debit' : 'credit',
          amount: toAtomic(e.amount ?? '0'),
          asset: assetRef(e),
          ...(other === undefined ? {} : { counterparty: other.account }),
          txHash: op.txHash,
        });
      }
      return out;
    },

    async balance(account: string, asset: string): Promise<Atomic | null> {
      const acc = await getJson(`${horizon}/accounts/${account}`);
      if (acc === null) return null;
      const [code, issuer] = asset.split(':');
      const line = (acc.balances ?? []).find((b: any) =>
        asset === 'native'
          ? b.asset_type === 'native'
          : b.asset_code === code && b.asset_issuer === issuer,
      );
      return line === undefined ? 0n : toAtomic(line.balance);
    },
  };
}
