import type { Atomic, Movement, ReconOutcome } from './types.js';

/** A settlement the ledger already explains. */
export interface ExplainedDebit {
  amount: Atomic;
  txHash?: string;
}

/** A decision that was authorized but has not been seen settling yet. */
export interface PendingSettlement {
  amount: Atomic;
  ref: string;
}

export interface ReconcileInput {
  /** null = could not read the chain. Never treated as zero. */
  balanceObserved: Atomic | null;
  /** What the ledger says the balance should be. */
  balanceExpected: Atomic;
  /** null = rail has no per-operation reading; degrades to balance-only. */
  movements: Movement[] | null;
  explained: ExplainedDebit[];
  pending: PendingSettlement[];
  isFirstRun: boolean;
}

export interface ReconcileResult {
  outcome: ReconOutcome;
  delta: Atomic;
  /** Debits seen on-chain that nothing in the ledger explains. */
  unloggedDebits: Movement[] | null;
  /** Set when a pending settlement is matched to a real debit. */
  resolved?: { ref: string; txHash?: string };
  reason: string;
  /** True when a human has to look. Maps to a non-zero exit in the CLI. */
  alert: boolean;
}

/**
 * Precedence is deliberate and matches the engine this is ported from:
 *
 *   mismatch > unlogged-debit > late-settlement > credit > ok
 *
 * The one that matters most is `unlogged-debit`, and it alerts EVEN WHEN THE
 * BALANCE ADDS UP. Comparing a single number lets two movements cancel out: an
 * unrecorded debit plus a similar incoming credit in the same window nets to
 * zero, and a balance-only check happily signs off. An audit trail that netting
 * can fool is not doing its job — and the audit trail is the product.
 */
export function reconcile(input: ReconcileInput): ReconcileResult {
  const { balanceObserved, balanceExpected, movements, explained, pending, isFirstRun } = input;

  // "I could not look" is never "everything is fine".
  if (balanceObserved === null) {
    return {
      outcome: 'unreadable',
      delta: 0n,
      unloggedDebits: null,
      reason: 'balance could not be read; nothing is asserted',
      alert: true,
    };
  }

  const delta = balanceObserved - balanceExpected;

  if (isFirstRun) {
    return {
      outcome: 'baseline',
      delta,
      unloggedDebits: null,
      reason: `baseline anchored at ${balanceObserved.toString()}`,
      alert: false,
    };
  }

  // Per-operation signal, when the rail supports it.
  let unloggedDebits: Movement[] | null = null;
  if (movements !== null) {
    const remaining = explained.map((e) => e.amount);
    unloggedDebits = [];
    for (const m of movements) {
      if (m.kind !== 'debit') continue;
      const i = remaining.indexOf(m.amount);
      if (i === -1) unloggedDebits.push(m);
      else remaining.splice(i, 1);
    }
  }

  const missing = delta < 0n ? -delta : 0n;
  const pendingMatch = missing > 0n ? pending.find((p) => p.amount === missing) : undefined;

  if (missing > 0n && pendingMatch === undefined) {
    return {
      outcome: 'mismatch',
      delta,
      unloggedDebits,
      reason: `${missing.toString()} atomic units missing and nothing explains them`,
      alert: true,
    };
  }

  if (unloggedDebits !== null && unloggedDebits.length > 0) {
    return {
      outcome: 'unlogged-debit',
      delta,
      unloggedDebits,
      reason:
        `${unloggedDebits.length} on-chain debit(s) with no ledger entry` +
        (delta === 0n ? ' (balance still adds up — this is the netting case)' : ''),
      alert: true,
    };
  }

  if (pendingMatch !== undefined) {
    // A late settlement: the 402 can land before the debit does.
    const debit = movements?.find(
      (m) => m.kind === 'debit' && m.amount === pendingMatch.amount,
    );
    return {
      outcome: 'late-settlement',
      delta,
      unloggedDebits,
      resolved:
        debit === undefined
          ? { ref: pendingMatch.ref }
          : { ref: pendingMatch.ref, txHash: debit.txHash },
      reason:
        debit === undefined
          ? `late settlement of ${pendingMatch.ref} attributed by amount; no txHash`
          : `late settlement of ${pendingMatch.ref} identified as ${debit.txHash}`,
      alert: false,
    };
  }

  if (delta > 0n) {
    return {
      outcome: 'credit',
      delta,
      unloggedDebits,
      reason: `${delta.toString()} atomic units more than expected (funding or swap in)`,
      alert: false,
    };
  }

  return {
    outcome: 'ok',
    delta,
    unloggedDebits,
    reason:
      movements === null
        ? 'balance matches (balance-only: rail has no per-operation reading)'
        : 'balance matches and every on-chain debit has a ledger entry',
    alert: false,
  };
}
