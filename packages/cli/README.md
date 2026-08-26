# `facturify`

Did this agent payment actually settle? — the CLI for
[Facturify](https://facturify.app).

```bash
pnpm add -g facturify
```

## Verify a payment you did not make

`agent402` sells `/api/uuid` for $0.001 USDC on Stellar pubnet, and strangers pay it all day.
Anyone can confirm one of those:

```bash
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

## Exit codes are the API

| code | meaning |
|---|---|
| `0` | settled |
| `1` | not settled |
| `2` | **unknown** — the chain could not be read |
| `3` | usage error |

`unknown` has its own code on purpose. A script that treats *"I could not read the chain"* as
*"it did not settle"* commits the exact failure this tool exists to prevent — so it can never be
confused with either answer.

## Amounts are atomic integers

`0.001` USDC on Stellar is `10000`, not `0.001`. A decimal `--amount` is refused with an explicit
message **before anything touches the network**.

## Other commands

```bash
facturify verify --tx <hash> --network stellar:pubnet …   # unambiguous path
facturify export --file ledger.jsonl --verify             # validate the audit trail
```

EVM networks (`eip155:<chainId>`) need `--rpc`.

## License

Apache-2.0
