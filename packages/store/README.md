# `@facturify/store`

The audit-trail store for [Facturify](https://facturify.app).

```bash
pnpm add @facturify/store
```

```ts
import { memoryStore, jsonlStore } from '@facturify/store'

const store = memoryStore()                  // tests, browser, Workers
const store = await jsonlStore('./ledger.jsonl')   // Node, on disk
```

## Append-only is structural, not a convention

The port has **no `update` and no `delete`.** There is no method to call. A correction is a new
entry, the way a ledger books a reversal instead of erasing a line — an adapter that could
rewrite history would quietly void the only guarantee this product sells.

Both adapters enforce the sequence and the hash link on every append, including **across process
restarts** in the `jsonl` one:

```ts
await store.append(outOfOrderEntry)   // throws AppendOnlyViolation
await store.append(brokenLinkEntry)   // throws AppendOnlyViolation
```

`bigint` amounts survive the round-trip to disk intact. A money value that comes back as a string
is a bug, not a formatting detail.

## Implementing your own

Three methods — `append`, `all`, `last`. Postgres, SQLite, Turso, an object store; anything that
can append and read back in order.

## License

Apache-2.0
