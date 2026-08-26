# `@facturify/rail-stellar`

Read-only Stellar rail for [Facturify](https://facturify.app). Takes a Horizon URL and nothing
else — **there is no parameter here that could carry a key.**

```bash
pnpm add @facturify/rail-stellar
```

```ts
import { stellar } from '@facturify/rail-stellar'

const rail = stellar()                       // defaults to horizon.stellar.org
await rail.movements(account, sinceIso)      // Movement[] | null
```

`null` means *the chain could not be read* — never an empty array, which would mean *there were
none*.

## It reads `/effects`, not `/payments`

This is the part that costs people a day of debugging. A USDC transfer through a Soroban
contract — every SAC transfer — surfaces as an `invoke_host_function` operation carrying **no
amount, no asset, no counterparty**:

```json
{ "type": "invoke_host_function",
  "amount": undefined, "asset_code": undefined,
  "from": undefined,   "to": undefined }
```

A consumer of `/payments` sees the transfer as if it had no money in it. Only the effects
(`account_debited` / `account_credited`) carry the figures.

The `txHash` is not in the effect either: it is resolved through the effect's link to its
operation, one cached request per operation. If it cannot be resolved, the read **aborts** — a
movement you cannot cite is not evidence.

## License

Apache-2.0
