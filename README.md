# Facturify

[![npm](https://img.shields.io/npm/v/facturify?label=facturify&color=1b5cf0)](https://www.npmjs.com/package/facturify)
[![npm](https://img.shields.io/npm/v/%40facturify%2Fsdk?label=%40facturify%2Fsdk&color=1b5cf0)](https://www.npmjs.com/package/@facturify/sdk)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-70%20passing-brightgreen)](#tests)

**Verifiable receipts for agent payments.**

🌐 **[facturify.app](https://facturify.app)** — try the verifier in your browser, no install.

A perfect `402` is not a settled payment, and a `200` is not a verified delivery.
Today nothing in the agent payment stack tells you the difference.

```ts
verify(claim, rail) → verdict
```

Facturify does not originate payments, does not authorize them and never holds
funds or keys. It compares an assertion against the chain and signs the result.

## Quickstart

```bash
# The CLI — verify a payment from your terminal
pnpm add -g facturify

# Or the SDK, in your agent
pnpm add @facturify/sdk @facturify/rail-stellar
```

```ts
import { facturify } from '@facturify/sdk'
import { stellar } from '@facturify/rail-stellar'

const f = facturify({ rails: [stellar()] })
const verdict = await f.verify(claim)
// → settled · not-settled · unknown
```

## Why this exists

The stack that is standardizing — AgentCore Payments for the permission, the
OpenAI Agents SDK for the orchestration — settles *whether an agent may pay* and
leaves *whether the payment happened* to you. From OpenAI's own cookbook:

| Piece | Owner |
|---|---|
| Generate the scoped payment proof | AWS |
| Orchestrate the agent loop | OpenAI |
| **Store receipts and audit trail** | **you** |
| **Validate the model's answer against the receipt** | **you** |
| **Verify on-chain settlement** | **nobody** — *"requires independent evidence"* |

That last row is this project.

### It is not a theoretical gap

A vendor can return a flawless `402` and settle nothing, for weeks. On
2026-08-25 the OpenZeppelin Channels sponsor behind one live x402 vendor on
`stellar:pubnet` had not signed a transaction **for anyone** since
2026-08-10 — 15 days — while its `402` kept answering correctly.

## Verdicts have three states, and they never collapse

```ts
type Verdict =
  | { state: 'settled';     evidence; ambiguous; candidates }
  | { state: 'not-settled'; reason: 'no-matching-movement' }
  | { state: 'unknown';     reason: UnknownReason }
```

`unknown` is a first-class outcome. **"I could not look" is not "there is
nothing".** A chain read that failed, reported as `not-settled`, turns this tool
into exactly the lie it exists to prevent.

Likewise, matching without a `txHash` is ambiguous by construction: two
identical payments in the same window cannot be told apart. Facturify returns
`ambiguous: true` with a candidate count. **It never silently picks one.**

## Packages

All published on npm under Apache-2.0.

| Package | npm | What | Source |
|---|---|---|---|
| **`facturify`** | [![npm](https://img.shields.io/npm/v/facturify?color=1b5cf0&label=)](https://www.npmjs.com/package/facturify) | The CLI. `verify`, `export --verify` | [`packages/cli`](./packages/cli) |
| **`@facturify/sdk`** | [![npm](https://img.shields.io/npm/v/%40facturify%2Fsdk?color=1b5cf0&label=)](https://www.npmjs.com/package/@facturify/sdk) | `record` · `awaitSettlement` · `verify` · `reconcile` · `export` | [`packages/sdk`](./packages/sdk) |
| **`@facturify/core`** | [![npm](https://img.shields.io/npm/v/%40facturify%2Fcore?color=1b5cf0&label=)](https://www.npmjs.com/package/@facturify/core) | Verdict algebra, claim matching, SHA-256 hash chain, reconciliation. **Pure** — no I/O, no dependencies; runs in Node, Workers and the browser | [`packages/core`](./packages/core) |
| **`@facturify/rail-stellar`** | [![npm](https://img.shields.io/npm/v/%40facturify%2Frail-stellar?color=1b5cf0&label=)](https://www.npmjs.com/package/@facturify/rail-stellar) | Read-only Stellar rail — Horizon `/effects`, **not** `/payments` | [`packages/rail-stellar`](./packages/rail-stellar) |
| **`@facturify/rail-evm`** | [![npm](https://img.shields.io/npm/v/%40facturify%2Frail-evm?color=1b5cf0&label=)](https://www.npmjs.com/package/@facturify/rail-evm) | Read-only EVM rail — ERC-20 `Transfer` logs, **not** `tx.to` | [`packages/rail-evm`](./packages/rail-evm) |
| **`@facturify/store`** | [![npm](https://img.shields.io/npm/v/%40facturify%2Fstore?color=1b5cf0&label=)](https://www.npmjs.com/package/@facturify/store) | Append-only audit trail port and adapters | [`packages/store`](./packages/store) |

Each package's README explains the decision that makes it different, not just its API.

## No keys, structurally

No adapter accepts a secret. Rails take a read-only RPC or Horizon URL and
nothing else; there is no code path that can sign. This is enforced by a test
that fails the build if a signing-capable import appears — not by a promise in a
README.

## Verifying somebody else's payment

The point is that you do not need to have made the payment, or to be trusted by
anyone, to check it. `agent402` sells `/api/uuid` for $0.001 USDC on Stellar
pubnet; strangers pay it all day. Anyone can confirm one of those:

```
facturify verify \
  --network stellar:pubnet \
  --pay-to GDNJXCKW7ZM7GEEVP674TWPU26YJNBQ2FI4ZIPRKTPTNUEJMDHFJWWRL \
  --amount 10000 \
  --asset USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
```

```json
{
  "state": "settled",
  "evidence": {
    "txHash": "8897ad2de1ac181c5d8eb6d33cc44352d7a418f3381c22b4f6759102ca46918b",
    "ts": "2026-08-25T14:05:29Z",
    "amountObserved": "10000"
  },
  "ambiguous": false,
  "candidates": 1
}
```

Exit codes are the API for scripts: **0** settled · **1** not settled ·
**2** unknown · **3** usage. `unknown` has its own code on purpose — a script
that treats "I could not read the chain" as "it did not settle" is the failure
this tool exists to prevent.

`pnpm live-gate` runs that check against the real chain, plus the negative and
the unreadable cases.

## Adding a rail

A rail is two read-only methods. It receives a URL and nothing else — there is no parameter
that could carry a key.

```ts
interface Rail {
  readonly network: NetworkRef
  /** null = could not read the chain. NEVER an empty array. */
  movements(account: string, since: Iso): Promise<Movement[] | null>
  balance(account: string, asset: AssetRef): Promise<Atomic | null>
}
```

The one rule that is not negotiable: **`null` means "I could not look", and an empty array means
"I looked and there was nothing".** Collapsing the two is the bug this whole project exists to
prevent. `packages/rail-stellar` and `packages/rail-evm` are ~150 lines each; copy either.

## Tests

```bash
pnpm install
pnpm test          # 70 tests — offline, deterministic, no network
pnpm typecheck
```

Fixtures are **recorded real chain data**, not fakes: the Stellar effects of a real settlement
and a real Base receipt. If Horizon or an RPC changes shape, CI finds out before production does.

Two suites are deliberately **outside** `pnpm test`, because they depend on the network and on a
stranger's activity:

```bash
pnpm live-gate                              # hits Stellar pubnet, read-only, free
pnpm --filter @facturify/web test:e2e       # browser smoke test (needs Chrome)
```

## Repository layout

```
packages/core           pure engine — no I/O, no deps
packages/rail-stellar   Horizon /effects reader
packages/rail-evm       ERC-20 Transfer log reader
packages/store          append-only audit trail
packages/sdk            the developer-facing surface
packages/cli            the `facturify` binary
apps/web                facturify.app — docs + in-browser verifier
```

## Status

`0.1.0`, published. The engine, both rails, the SDK, the store, the CLI and the site are working
and verified against mainnet. The API may still move before `1.0`.

Not built yet, on purpose: a hosted service, spend policy (that is a different product), and
jurisdiction-aware fiscal receipts.

## Links

- **Site + live verifier** — [facturify.app](https://facturify.app)
- **npm** — [`facturify`](https://www.npmjs.com/package/facturify) · [`@facturify/sdk`](https://www.npmjs.com/package/@facturify/sdk) · [`@facturify/core`](https://www.npmjs.com/package/@facturify/core) · [`@facturify/rail-stellar`](https://www.npmjs.com/package/@facturify/rail-stellar) · [`@facturify/rail-evm`](https://www.npmjs.com/package/@facturify/rail-evm) · [`@facturify/store`](https://www.npmjs.com/package/@facturify/store)
- **Issues** — [github.com/fernando-mendoza/facturify/issues](https://github.com/fernando-mendoza/facturify/issues)

## License

Apache-2.0
