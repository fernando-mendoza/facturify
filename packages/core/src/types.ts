/**
 * The whole product is one function: verify(claim, rail) -> verdict.
 *
 * Facturify does not originate payments, does not authorize them and does not
 * hold funds. It compares an assertion against the chain and signs the result.
 */

/** Atomic units. Never a float — this is money. */
export type Atomic = bigint;
export type Iso = string;
export type Hex = string;

/** CAIP-2 style network reference. */
export type NetworkRef = `stellar:${string}` | `eip155:${number}`;

/** Stellar SAC address or EVM ERC-20 contract address. */
export type AssetRef = string;

/** What someone claims happened. Nothing here is trusted; the chain arbitrates. */
export interface Claim {
  network: NetworkRef;
  /** The collector that should have received the funds. */
  payTo: string;
  asset: AssetRef;
  amount: Atomic;
  window: { from: Iso; to: Iso };
  /** When present this is the strong path: direct, unambiguous verification. */
  txHash?: string;
  /** Optional, narrows the search. */
  payer?: string;
  /** Binds "this is what I received" to "this is what I paid for". */
  responseHash?: Hex;
}

export interface Evidence {
  txHash: string;
  ts: Iso;
  amountObserved: Atomic;
}

/**
 * Why we could not tell. `unknown` is a first-class outcome and must never be
 * collapsed into `not-settled`: "I could not look" is not "there is nothing".
 */
export type UnknownReason =
  | 'rail-unreadable'
  | 'window-ungovernable'
  | 'network-unsupported';

export type Verdict =
  | {
      state: 'settled';
      evidence: Evidence;
      /** True when more than one movement matched and none can be singled out. */
      ambiguous: boolean;
      candidates: number;
    }
  | { state: 'not-settled'; reason: 'no-matching-movement' }
  | { state: 'unknown'; reason: UnknownReason };

/** A movement observed on-chain. `null` from a rail means "could not read". */
export interface Movement {
  ts: Iso;
  kind: 'debit' | 'credit';
  amount: Atomic;
  asset: AssetRef;
  counterparty: string;
  txHash: string;
}

/** Read-only by construction: no adapter ever accepts a secret key. */
export interface Rail {
  readonly network: NetworkRef;
  /** Returns null when the chain could not be read — never an empty array. */
  movements(since: Iso): Promise<Movement[] | null>;
  balance(account: string, asset: AssetRef): Promise<Atomic | null>;
}

export type ReconOutcome =
  | 'baseline'
  | 'ok'
  | 'late-settlement'
  | 'credit'
  | 'unlogged-debit'
  | 'mismatch';

/** Append-only. Corrections are new entries, as in accounting. */
export interface Entry {
  seq: number;
  ts: Iso;
  kind: 'genesis' | 'claim' | 'verdict' | 'reconciliation';
  payload: unknown;
  prevHash: Hex;
  hash: Hex;
}
