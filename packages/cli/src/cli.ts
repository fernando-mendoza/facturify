#!/usr/bin/env node
import { verifyChain, type Claim } from '@facturify/core';
import { facturify } from '@facturify/sdk';
import { jsonlStore } from '@facturify/store';
import { stellar } from '@facturify/rail-stellar';
import { evm } from '@facturify/rail-evm';

const USAGE = `facturify — did this agent payment actually settle?

  facturify verify --network <ref> --pay-to <account> --amount <atomic> --asset <ref>
                   [--tx <hash>] [--payer <account>] [--from <iso>] [--to <iso>]
  facturify export --file <path> [--verify]

Networks: stellar:pubnet, stellar:testnet, eip155:<chainId>
Amounts are ATOMIC integers (0.001 USDC on Stellar = 10000).

Exit codes: 0 settled · 1 not settled · 2 unknown (could not tell) · 3 usage
`;

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined || !token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function buildClaim(args: Record<string, string | boolean>): Claim | string {
  const network = str(args['network']);
  const payTo = str(args['pay-to']);
  const amount = str(args['amount']);
  const asset = str(args['asset']);
  if (network === undefined) return 'missing --network';
  if (payTo === undefined) return 'missing --pay-to';
  if (amount === undefined) return 'missing --amount';
  if (asset === undefined) return 'missing --asset';
  if (!/^\d+$/.test(amount)) return '--amount must be an atomic integer, not a decimal';

  const to = str(args['to']) ?? new Date().toISOString();
  const from = str(args['from']) ?? new Date(Date.parse(to) - 24 * 3600 * 1000).toISOString();

  return {
    network: network as Claim['network'],
    payTo,
    asset,
    amount: BigInt(amount),
    window: { from, to },
    ...(str(args['tx']) === undefined ? {} : { txHash: str(args['tx'])! }),
    ...(str(args['payer']) === undefined ? {} : { payer: str(args['payer'])! }),
  };
}

const EXIT = { settled: 0, 'not-settled': 1, unknown: 2 } as const;

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);

  if (command === 'verify') {
    const claim = buildClaim(args);
    if (typeof claim === 'string') {
      process.stderr.write(`${claim}\n\n${USAGE}`);
      return 3;
    }
    const rails = [
      stellar({
        ...(claim.network === 'stellar:testnet'
          ? { horizon: 'https://horizon-testnet.stellar.org' }
          : {}),
        network: claim.network,
      }),
    ];
    if (claim.network.startsWith('eip155:')) {
      const rpc = str(args['rpc']);
      if (rpc === undefined) {
        process.stderr.write('EVM networks need --rpc\n');
        return 3;
      }
      rails.push(evm({ rpc, network: claim.network, tokens: [claim.asset] }));
    }

    const f = facturify({ rails });
    const verdict = await f.verify(claim);
    process.stdout.write(`${JSON.stringify(verdict, bigintSafe, 2)}\n`);
    if (verdict.state === 'settled' && verdict.ambiguous) {
      process.stderr.write(
        `warning: ${verdict.candidates} movements matched; pass --tx to disambiguate\n`,
      );
    }
    return EXIT[verdict.state];
  }

  if (command === 'export') {
    const file = str(args['file']);
    if (file === undefined) {
      process.stderr.write(`missing --file\n\n${USAGE}`);
      return 3;
    }
    const entries = await (await jsonlStore(file)).all();
    if (args['verify'] === true) {
      const result = await verifyChain(entries);
      process.stdout.write(`${JSON.stringify(result, bigintSafe, 2)}\n`);
      return result.valid ? 0 : 1;
    }
    process.stdout.write(`${JSON.stringify(entries, bigintSafe, 2)}\n`);
    return 0;
  }

  process.stdout.write(USAGE);
  return command === undefined || command === '--help' ? 0 : 3;
}

const bigintSafe = (_k: string, v: unknown): unknown =>
  typeof v === 'bigint' ? v.toString() : v;

const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].endsWith('cli.js');
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`${String(err)}\n`);
      process.exit(2);
    },
  );
}
