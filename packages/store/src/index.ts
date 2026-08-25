import type { Entry } from '@facturify/core';

/**
 * Append-only by design: there is no update and no delete in this port.
 * A correction is a new entry, the way a ledger books a reversal instead of
 * erasing a line. An adapter that could rewrite history would quietly void the
 * only guarantee this product sells.
 */
export interface Store {
  append(entry: Entry): Promise<void>;
  all(): Promise<Entry[]>;
  last(): Promise<Entry | null>;
}

export class AppendOnlyViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppendOnlyViolation';
  }
}

const guard = (entries: Entry[], next: Entry): void => {
  const prev = entries[entries.length - 1];
  const expectedSeq = prev === undefined ? 0 : prev.seq + 1;
  if (next.seq !== expectedSeq) {
    throw new AppendOnlyViolation(`expected seq ${expectedSeq}, got ${next.seq}`);
  }
  if (prev !== undefined && next.prevHash !== prev.hash) {
    throw new AppendOnlyViolation(`entry ${next.seq} does not link to ${prev.seq}`);
  }
};

export function memoryStore(seed: Entry[] = []): Store {
  const entries: Entry[] = [...seed];
  return {
    async append(entry) {
      guard(entries, entry);
      entries.push(entry);
    },
    async all() {
      return [...entries];
    },
    async last() {
      return entries[entries.length - 1] ?? null;
    },
  };
}

/** Newline-delimited JSON on disk. Node only; imported lazily so this module
 *  stays loadable in a browser and in Workers. */
export async function jsonlStore(path: string): Promise<Store> {
  const { appendFile, readFile } = await import('node:fs/promises');

  const read = async (): Promise<Entry[]> => {
    try {
      const raw = await readFile(path, 'utf8');
      return raw
        .split('\n')
        .filter((l: string) => l.trim() !== '')
        .map((l: string) => JSON.parse(l, (_k, v) =>
          typeof v === 'object' && v !== null && '$bigint' in v ? BigInt(v.$bigint) : v,
        ) as Entry);
    } catch {
      return [];
    }
  };

  return {
    async append(entry) {
      guard(await read(), entry);
      const line = JSON.stringify(entry, (_k, v) =>
        typeof v === 'bigint' ? { $bigint: v.toString() } : v,
      );
      await appendFile(path, `${line}\n`, 'utf8');
    },
    all: read,
    async last() {
      const entries = await read();
      return entries[entries.length - 1] ?? null;
    },
  };
}
