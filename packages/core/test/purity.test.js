import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;
const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));
const sources = files.map((f) => [f, readFileSync(join(SRC, f), 'utf8')]);

test('GATE: core imports nothing — no Node, no rails, no store', () => {
  const forbidden = /from\s+['"](node:|fs|path|crypto|@facturify\/(rail-|store|sdk))/;
  for (const [name, code] of sources) {
    assert.equal(forbidden.test(code), false, `${name} must stay pure and portable`);
  }
});

test('GATE: no signing-capable import can reach this package', () => {
  // The "we never touch keys" guarantee is structural, not a promise in a README.
  const signing = /\b(Keypair|signTransaction|privateKeyToAccount|new Wallet|mnemonic|secretKey)\b/;
  for (const [name, code] of sources) {
    assert.equal(signing.test(code), false, `${name} must have no path that can sign`);
  }
});

test('money never touches a float', () => {
  for (const [name, code] of sources) {
    assert.equal(/amount\s*:\s*number/.test(code), false, `${name}: amount must be bigint`);
  }
});
