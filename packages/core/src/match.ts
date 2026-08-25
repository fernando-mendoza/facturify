import type { Claim, Movement, Verdict } from './types.js';

const inWindow = (ts: string, from: string, to: string): boolean =>
  Date.parse(ts) >= Date.parse(from) && Date.parse(ts) <= Date.parse(to);

/**
 * Compares a claim against what the chain shows. Pure: the caller supplies the
 * movements, so this runs offline, in tests and in a browser.
 *
 * `movements === null` means the rail could not be read, and that is NOT the
 * same as "no movement was found". Collapsing the two would turn this tool into
 * the exact lie it exists to prevent, so it returns `unknown` instead.
 */
export function matchClaim(claim: Claim, movements: Movement[] | null): Verdict {
  if (movements === null) return { state: 'unknown', reason: 'rail-unreadable' };

  // We verify by reading the collector's account, so the payment shows up there
  // as a credit.
  const sameShape = movements.filter(
    (m) =>
      m.kind === 'credit' &&
      m.asset === claim.asset &&
      m.amount === claim.amount &&
      inWindow(m.ts, claim.window.from, claim.window.to),
  );

  const candidates =
    claim.payer === undefined
      ? sameShape
      : sameShape.filter((m) => m.counterparty === claim.payer);

  // The claim names a payer, nothing confirmed it, and something matched on
  // every other field with an unreadable counterparty. We cannot say it settled
  // and we have not earned the right to say it did not.
  if (
    claim.payer !== undefined &&
    candidates.length === 0 &&
    sameShape.some((m) => m.counterparty === undefined)
  ) {
    return { state: 'unknown', reason: 'payer-unverifiable' };
  }

  // Strong path: the claim carries a txHash, so there is nothing to guess.
  if (claim.txHash !== undefined) {
    const exact = candidates.find((m) => m.txHash === claim.txHash);
    if (exact === undefined) return { state: 'not-settled', reason: 'no-matching-movement' };
    return {
      state: 'settled',
      evidence: { txHash: exact.txHash, ts: exact.ts, amountObserved: exact.amount },
      ambiguous: false,
      candidates: 1,
    };
  }

  // Weak path: matching on (payTo, asset, amount, window) is ambiguous BY
  // CONSTRUCTION — two identical payments in the same window cannot be told
  // apart. We report the earliest and say so. Picking one silently would be the
  // bug nobody would ever find out about.
  if (candidates.length === 0) return { state: 'not-settled', reason: 'no-matching-movement' };

  const earliest = candidates.reduce((a, b) => (Date.parse(a.ts) <= Date.parse(b.ts) ? a : b));
  return {
    state: 'settled',
    evidence: { txHash: earliest.txHash, ts: earliest.ts, amountObserved: earliest.amount },
    ambiguous: candidates.length > 1,
    candidates: candidates.length,
  };
}
