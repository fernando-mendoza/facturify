import { matchClaim, type Claim, type Verdict } from '@facturify/core';
import { stellar } from '@facturify/rail-stellar';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/* ── the instrument ──────────────────────────────────────────── */
const rail = stellar();
const out = $<HTMLPreElement>('out');
const chip = $<HTMLSpanElement>('chip');
const runBtn = $<HTMLButtonElement>('run');

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Renders the verdict as the JSON the CLI prints — same shape, same words. */
function render(v: Verdict): void {
  const state = v.state;
  chip.textContent = state;
  chip.className = `chip chip--${state === 'not-settled' ? 'notsettled' : state}`;
  const body =
    state === 'settled'
      ? `{
  <span class="tok-key">"state"</span>: <span class="tok-str">"settled"</span>,
  <span class="tok-key">"evidence"</span>: {
    <span class="tok-key">"txHash"</span>: <span class="tok-str">"${esc(v.evidence.txHash)}"</span>,
    <span class="tok-key">"ts"</span>: <span class="tok-str">"${esc(v.evidence.ts)}"</span>,
    <span class="tok-key">"amountObserved"</span>: <span class="tok-str">"${v.evidence.amountObserved}"</span>
  },
  <span class="tok-key">"ambiguous"</span>: <span class="tok-num">${v.ambiguous}</span>,
  <span class="tok-key">"candidates"</span>: <span class="tok-num">${v.candidates}</span>
}${
  v.ambiguous
    ? `\n\n<span class="tok-pun">// ${v.candidates} movements matched. The earliest is shown.\n// Pass a txHash to disambiguate — it will not pick one for you.</span>`
    : ''
}`
      : `{
  <span class="tok-key">"state"</span>: <span class="tok-str">"${state}"</span>,
  <span class="tok-key">"reason"</span>: <span class="tok-str">"${esc(v.reason)}"</span>
}${
  state === 'unknown'
    ? '\n\n<span class="tok-pun">// The chain could not be read. This is NOT "it did not settle".</span>'
    : ''
}`;
  out.innerHTML = body;
}

$<HTMLFormElement>('verify-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const hours = Number($<HTMLInputElement>('in-hours').value) || 24;
  const amountRaw = $<HTMLInputElement>('in-amount').value.trim();

  if (!/^\d+$/.test(amountRaw)) {
    chip.textContent = 'input';
    chip.className = 'chip chip--notsettled';
    out.innerHTML = '<span class="tok-pun">// Amount must be an atomic integer.\n// 0.001 USDC on Stellar is 10000, not 0.001.</span>';
    return;
  }

  const to = new Date();
  const claim: Claim = {
    network: 'stellar:pubnet',
    payTo: $<HTMLInputElement>('in-payto').value.trim(),
    asset: $<HTMLInputElement>('in-asset').value.trim(),
    amount: BigInt(amountRaw),
    window: { from: new Date(to.getTime() - hours * 3600_000).toISOString(), to: to.toISOString() },
  };

  runBtn.disabled = true;
  chip.textContent = 'reading';
  chip.className = 'chip chip--idle';
  out.innerHTML = '<span class="tok-pun">// Reading Horizon…</span>';

  try {
    const movements = await rail.movements(claim.payTo, claim.window.from);
    render(matchClaim(claim, movements));
  } catch {
    render({ state: 'unknown', reason: 'rail-unreadable' });
  } finally {
    runBtn.disabled = false;
  }
});

/* ── copy buttons · silent success ───────────────────────────── */
document.querySelectorAll<HTMLButtonElement>('.copy').forEach((button) => {
  button.addEventListener('click', async () => {
    const source = document.getElementById(`snip-${button.dataset['copy']}`);
    if (source === null) return;
    try {
      await navigator.clipboard.writeText(source.textContent ?? '');
      const previous = button.textContent;
      button.textContent = 'copied';
      button.dataset['state'] = 'done';
      setTimeout(() => {
        button.textContent = previous;
        delete button.dataset['state'];
      }, 1400);
    } catch {
      button.textContent = 'select it';
    }
  });
});

/* ── reveals ─────────────────────────────────────────────────── */
if (window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
} else {
  document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-in'));
}

/* ── ⌘K palette — it actually works ──────────────────────────── */
const COMMANDS: { label: string; hint: string; go: () => void }[] = [
  { label: 'Verify a payment', hint: '#verify', go: () => jump('#verify') },
  { label: 'The three verdicts', hint: '#verdicts', go: () => jump('#verdicts') },
  { label: 'Why /payments does not work', hint: '#findings', go: () => jump('#findings') },
  { label: 'Why tx.to does not work', hint: '#findings', go: () => jump('#findings') },
  { label: 'Install the CLI', hint: '#install', go: () => jump('#install') },
  { label: 'Focus the collector field', hint: 'input', go: () => { jump('#verify'); $<HTMLInputElement>('in-payto').focus(); } },
  { label: 'Source on GitHub', hint: '↗', go: () => { window.open('https://github.com/fernando-mendoza/facturify', '_blank', 'noopener'); } },
  { label: 'Packages on npm', hint: '↗', go: () => { window.open('https://www.npmjs.com/package/facturify', '_blank', 'noopener'); } },
];

const pal = $<HTMLDivElement>('pal');
const palInput = $<HTMLInputElement>('pal-input');
const palList = $<HTMLUListElement>('pal-list');
let selected = 0;
let lastFocus: HTMLElement | null = null;

const jump = (hash: string): void => {
  document.querySelector(hash)?.scrollIntoView({ block: 'start' });
};

function paint(): void {
  const query = palInput.value.toLowerCase();
  const hits = COMMANDS.filter((c) => c.label.toLowerCase().includes(query));
  if (hits.length === 0) {
    palList.innerHTML = '<li class="pal__empty">Nothing matches.</li>';
    return;
  }
  if (selected >= hits.length) selected = hits.length - 1;
  palList.innerHTML = hits
    .map(
      (c, i) =>
        `<li class="pal__row" role="option" aria-selected="${i === selected}" data-i="${i}">
           <span>${c.label}</span><span>${c.hint}</span></li>`,
    )
    .join('');
  palList.querySelectorAll<HTMLLIElement>('.pal__row').forEach((row) => {
    row.addEventListener('click', () => {
      hits[Number(row.dataset['i'])]?.go();
      close();
    });
  });
}

function open(): void {
  lastFocus = document.activeElement as HTMLElement;
  pal.setAttribute('open', '');
  palInput.value = '';
  selected = 0;
  paint();
  palInput.focus();
}
function close(): void {
  pal.removeAttribute('open');
  lastFocus?.focus();
}

$<HTMLButtonElement>('pal-open').addEventListener('click', open);
pal.addEventListener('click', (e) => { if (e.target === pal) close(); });
palInput.addEventListener('input', () => { selected = 0; paint(); });

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    pal.hasAttribute('open') ? close() : open();
    return;
  }
  if (!pal.hasAttribute('open')) return;
  const hits = COMMANDS.filter((c) => c.label.toLowerCase().includes(palInput.value.toLowerCase()));
  if (e.key === 'Escape') { e.preventDefault(); close(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); selected = Math.min(selected + 1, hits.length - 1); paint(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); selected = Math.max(selected - 1, 0); paint(); }
  else if (e.key === 'Enter') { e.preventDefault(); hits[selected]?.go(); close(); }
});
