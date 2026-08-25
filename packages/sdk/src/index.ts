import {
  appendEntry,
  matchClaim,
  reconcile,
  verifyChain,
  type Claim,
  type Entry,
  type Rail,
  type ReconcileInput,
  type ReconcileResult,
  type Verdict,
} from '@facturify/core';
import { memoryStore, type Store } from '@facturify/store';

export type Pending = { state: 'pending'; checks: number };
export type SettlementOutcome = Verdict | Pending;

export interface FacturifyOptions {
  rails: Rail[];
  store?: Store;
  /** Injected in tests so the clock is not a source of flakiness. */
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface AwaitOptions {
  deadlineMs?: number;
  intervalMs?: number;
}

export interface Receipt {
  claim: Claim;
  entry: Entry;
  awaitSettlement(options?: AwaitOptions): Promise<SettlementOutcome>;
}

export function facturify(options: FacturifyOptions) {
  const store = options.store ?? memoryStore();
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const railFor = (claim: Claim): Rail | undefined =>
    options.rails.find((r) => r.network === claim.network);

  const write = async (kind: Entry['kind'], payload: unknown): Promise<Entry> => {
    const entry = await appendEntry(await store.last(), kind, payload, now().toISOString());
    await store.append(entry);
    return entry;
  };

  /** Reads the collector's account, because that is where a payment to it lands. */
  const check = async (claim: Claim): Promise<Verdict> => {
    const rail = railFor(claim);
    if (rail === undefined) return { state: 'unknown', reason: 'network-unsupported' };
    const movements = await rail.movements(claim.payTo, claim.window.from);
    return matchClaim(claim, movements);
  };

  return {
    /** Registers the claim before paying. Optional, but it is what makes a
     *  later settlement attributable to a specific intent. */
    async record(claim: Claim): Promise<Receipt> {
      const entry = await write('claim', claim);
      return {
        claim,
        entry,
        async awaitSettlement(awaitOptions: AwaitOptions = {}): Promise<SettlementOutcome> {
          const deadline = awaitOptions.deadlineMs ?? 60_000;
          const interval = awaitOptions.intervalMs ?? 2_000;
          const started = now().getTime();
          let checks = 0;
          for (;;) {
            const verdict = await check(claim);
            checks++;
            // `unknown` is not a reason to keep polling a broken rail forever,
            // but it is also not a failure: it is reported as what it is.
            if (verdict.state === 'settled') {
              await write('verdict', verdict);
              return verdict;
            }
            if (now().getTime() - started + interval >= deadline) {
              if (verdict.state === 'unknown') {
                await write('verdict', verdict);
                return verdict;
              }
              // Deadline reached without a settlement. Not settled YET is not
              // the same as not settled: x402 settlements land late routinely.
              return { state: 'pending', checks };
            }
            await sleep(interval);
          }
        },
      };
    },

    /** Verifies something that already happened — ours or somebody else's. */
    async verify(claim: Claim): Promise<Verdict> {
      const verdict = await check(claim);
      await write('verdict', { claim, verdict });
      return verdict;
    },

    async reconcile(input: ReconcileInput): Promise<ReconcileResult> {
      const result = reconcile(input);
      await write('reconciliation', result);
      return result;
    },

    /** The audit trail. Validate it with verifyChain(), without us. */
    async export(): Promise<Entry[]> {
      return store.all();
    },

    async verifyOwnChain() {
      return verifyChain(await store.all());
    },
  };
}

export type Facturify = ReturnType<typeof facturify>;
