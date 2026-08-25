#!/usr/bin/env bash
# Live gate — hits Stellar pubnet. Read-only, free, no keys involved.
#
# Verifies a payment WE DID NOT MAKE: agent402 sells /api/uuid for $0.001 USDC
# and its collector receives settlements from unrelated buyers. If this passes,
# the product does what it claims — it verifies somebody else's payment, with a
# citable hash, without having participated in it.
#
# Not part of `pnpm test`: it depends on the network and on a stranger's
# activity in the window. Unit tests stay offline and deterministic.
set -euo pipefail
cd "$(dirname "$0")/.."

COLLECTOR=GDNJXCKW7ZM7GEEVP674TWPU26YJNBQ2FI4ZIPRKTPTNUEJMDHFJWWRL
ASSET=USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
FROM=$(date -u -d "${1:-26 hours ago}" +%Y-%m-%dT%H:%M:%SZ)
CLI=packages/cli/dist/cli.js

echo "→ settled: a real payment made by a third party"
node "$CLI" verify --network stellar:pubnet \
  --pay-to "$COLLECTOR" --amount 10000 --asset "$ASSET" --from "$FROM"

echo "→ not-settled: an amount nobody paid"
if node "$CLI" verify --network stellar:pubnet \
  --pay-to "$COLLECTOR" --amount 99999999 --asset "$ASSET" --from "$FROM"; then
  echo "FAIL: a payment that never happened was reported as settled" >&2
  exit 1
fi

echo "→ unknown: a network we cannot read must not say 'not settled'"
set +e
node "$CLI" verify --network stellar:testnet \
  --pay-to "$COLLECTOR" --amount 10000 --asset "$ASSET" --from "$FROM" >/dev/null 2>&1
code=$?
set -e
[ "$code" -eq 2 ] || { echo "FAIL: expected exit 2 (unknown), got $code" >&2; exit 1; }

echo "✅ live gate passed"
