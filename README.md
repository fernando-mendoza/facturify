# Facturify

**Verifiable receipts for agent payments.**

A perfect `402` is not a settled payment, and a `200` is not a verified delivery.
Today nothing in the agent payment stack tells you the difference.

```ts
verify(claim, rail) → verdict
```

Facturify does not originate payments, does not authorize them and never holds
funds or keys. It compares an assertion against the chain and signs the result.

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

| Package | What |
|---|---|
| `@facturify/core` | Verdict algebra, claim matching, SHA-256 hash chain, reconciliation. Pure — no I/O, runs in Node, Workers and the browser |
| `@facturify/rail-stellar` | Read-only Stellar rail (Horizon `/effects`) |
| `@facturify/rail-evm` | Read-only EVM rail (ERC-20 `Transfer` logs) |
| `@facturify/store` | Append-only audit trail port and adapters |
| `@facturify/sdk` | `record` · `awaitSettlement` · `verify` · `reconcile` · `export` |
| `facturify` | CLI |

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

## Status

Working: the engine, both rails, the SDK, the store and the CLI. 70 tests, all
offline and deterministic, with recorded real chain data as fixtures.

Next: the documentation site and the public in-browser verifier.

## License

Apache-2.0
