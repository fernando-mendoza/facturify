# `@facturify/core`

The engine behind [Facturify](https://facturify.app) — verifiable receipts for agent payments.

Pure: **no I/O, no Node built-ins, no dependencies.** It runs unchanged in Node, in Cloudflare
Workers and in the browser. Give it a claim and the movements a rail observed; it returns a
verdict.

```bash
pnpm add @facturify/core
```

## Verdicts have three states, and they never collapse

```ts
import { matchClaim } from '@facturify/core'

const verdict = matchClaim(claim, movements)
// { state: 'settled',     evidence, ambiguous, candidates }
// { state: 'not-settled', reason: 'no-matching-movement' }
// { state: 'unknown',     reason: 'rail-unreadable' | … }
```

`unknown` is a first-class outcome. **"I could not look" is not "there is nothing."** A chain read
that failed, reported as `not-settled`, is the failure this library exists to prevent — so
`movements === null` (the rail could not be read) never becomes an empty list.

## Ambiguity is declared, not resolved

Without a `txHash`, matching on `(payTo, asset, amount, window)` cannot tell two identical
payments apart. `matchClaim` returns the earliest with `ambiguous: true` and a candidate count.
It never silently picks one.

## The audit trail

```ts
import { appendEntry, verifyChain } from '@facturify/core'

const entry = await appendEntry(previous, 'verdict', payload, ts)
await verifyChain(entries)   // → { valid: true, entries: n }
```

SHA-256 over a canonical serialization (keys sorted, `bigint` tagged so `100n` and `"100"` can
never collide). `verifyChain` is exported deliberately: **anyone holding an export must be able
to check it without us.** A verifier you have to trust is not a verifier.

## Reconciliation

Six outcomes plus `unreadable`, in precedence order:

`mismatch` › `unlogged-debit` › `late-settlement` › `credit` › `ok`

The one that matters is **`unlogged-debit`: it alerts even when the balance adds up.** Comparing a
single number lets two movements cancel out — an unrecorded debit plus a similar incoming credit
nets to zero, and a balance-only check signs off. An audit trail that netting can fool is not
doing its job.

## Money is `bigint`

Every amount is atomic units as `bigint`, across the whole public surface. A `number` here is a
money bug waiting to happen.

## License

Apache-2.0
