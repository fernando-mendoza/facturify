# `@facturify/sdk`

[Facturify](https://facturify.app) — did this agent payment actually settle?

A flawless `402` is not a settled payment, and a `200` is not a verified delivery. This SDK reads
the chain and tells you which one you got. **It never touches keys or funds.**

```bash
pnpm add @facturify/sdk @facturify/rail-stellar
```

```ts
import { facturify } from '@facturify/sdk'
import { stellar } from '@facturify/rail-stellar'

const f = facturify({ rails: [stellar()] })

// Verify something that already happened — yours or somebody else's.
await f.verify(claim)
// → settled · not-settled · unknown

// Or register before paying, then wait for settlement.
const receipt = await f.record(claim)
await receipt.awaitSettlement({ deadlineMs: 60_000 })
// → settled · not-settled · unknown · pending
```

## Why this exists

The stack that is standardizing — AgentCore Payments for the permission, the OpenAI Agents SDK
for the orchestration — settles *whether an agent may pay* and leaves *whether the payment
happened* to you. From OpenAI's own cookbook, the developer owns storing receipts and validating
the model's answer against them, and **verifying on-chain settlement is listed as requiring
"independent evidence"**.

That last row is this package.

## Four details that are the whole point

- **`verify` reads the collector's account**, because that is where a payment to someone lands.
  You do not need to have made the payment, or be trusted by anyone, to check it.
- **At the deadline it returns `pending`, never `not-settled`.** Late settlements are routine;
  *not yet* is not *no*.
- **`unknown` never collapses.** A chain that could not be read is reported as such.
- **The trail validates without us** — `verifyChain(await f.export())` is a pure function.

## License

Apache-2.0
