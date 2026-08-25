import type { Entry, Hex, Iso } from './types.js';

/** Every chain starts here. */
export const GENESIS_PREV: Hex = '0'.repeat(64);

/**
 * Deterministic serialization. Two entries with the same content must produce
 * the same bytes on any runtime, or the chain cannot be verified by a third
 * party — which is the entire point.
 *
 * `bigint` gets a typed tag so that 100n and "100" can never collide.
 */
export function canonical(value: unknown): string {
  if (typeof value === 'bigint') return `{"$bigint":"${value.toString()}"}`;
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  const body = Object.keys(record)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`)
    .join(',');
  return `{${body}}`;
}

/** WebCrypto only: works unchanged in Node, Cloudflare Workers and the browser. */
export async function sha256(text: string): Promise<Hex> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashEntry(entry: Omit<Entry, 'hash'>): Promise<Hex> {
  return sha256(
    canonical({
      seq: entry.seq,
      ts: entry.ts,
      kind: entry.kind,
      payload: entry.payload,
      prevHash: entry.prevHash,
    }),
  );
}

/**
 * Append-only: `prev` is never modified. A correction is a new entry, the way
 * a ledger books a reversal instead of erasing a line.
 */
export async function appendEntry(
  prev: Entry | null,
  kind: Entry['kind'],
  payload: unknown,
  ts: Iso,
): Promise<Entry> {
  const draft: Omit<Entry, 'hash'> = {
    seq: prev === null ? 0 : prev.seq + 1,
    ts,
    kind,
    payload,
    prevHash: prev === null ? GENESIS_PREV : prev.hash,
  };
  return { ...draft, hash: await hashEntry(draft) };
}

export type ChainVerification =
  | { valid: true; entries: number }
  | {
      valid: false;
      brokenAt: number;
      reason: 'bad-hash' | 'broken-link' | 'bad-sequence' | 'bad-genesis';
    };

/**
 * Recomputes the whole chain from genesis. Pure, dependency-free and exported
 * on purpose: anyone holding an export must be able to check it without us.
 * A verifier you have to trust is not a verifier.
 */
export async function verifyChain(entries: Entry[]): Promise<ChainVerification> {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === undefined) return { valid: false, brokenAt: i, reason: 'bad-sequence' };

    if (entry.seq !== i) return { valid: false, brokenAt: i, reason: 'bad-sequence' };

    const prev = i === 0 ? null : entries[i - 1];
    const expectedPrev = prev === undefined || prev === null ? GENESIS_PREV : prev.hash;
    if (entry.prevHash !== expectedPrev) {
      return { valid: false, brokenAt: i, reason: i === 0 ? 'bad-genesis' : 'broken-link' };
    }

    if ((await hashEntry(entry)) !== entry.hash) {
      return { valid: false, brokenAt: i, reason: 'bad-hash' };
    }
  }
  return { valid: true, entries: entries.length };
}
