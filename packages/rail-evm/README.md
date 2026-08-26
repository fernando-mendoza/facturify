# `@facturify/rail-evm`

Read-only EVM rail for [Facturify](https://facturify.app). Takes an RPC URL and a token list —
**nothing that could sign.**

```bash
pnpm add @facturify/rail-evm
```

```ts
import { evm } from '@facturify/rail-evm'

const rail = evm({ rpc, network: 'eip155:8453', tokens: [USDC] })
await rail.movements(account, sinceIso)      // Movement[] | null
```

## It reads `Transfer` logs, not `tx.to`

Settlements get batched. The end-to-end payment this rail was built against went through
**Multicall3**, so the transaction's destination was `0xca11…ca11` — neither the token nor the
recipient:

```
to:        0xca11bde05977b3631167028862be2a173976ca11   // Multicall3
token:     0x036cbd53842c5426634e7929541ec2318f3dcf7e
recipient: 0xdf98b94653fc914124a5d1b7fa1435a40c656123
value:     20000
```

Any filter on `tx.to` reports that real, settled payment as missing.

## Two numbers that were measured, not chosen

- **Chunk size 10,000 blocks** — the limit the RPC declares when you exceed it.
- **Time → block by bisection**, never by dividing through an average block time. An estimate
  that lands even slightly late silently drops movements, which is exactly the failure this
  exists to catch.

A rejected chunk aborts the whole read, and a window wider than 60 chunks is refused rather than
truncated. **Partial coverage presented as complete is worse than not looking.**

## License

Apache-2.0
