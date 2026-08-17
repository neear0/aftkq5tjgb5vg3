#!/usr/bin/env node
/**
 * Overí, že vygenerovaný web zodpovedá dátam.
 *
 * Pre každý aktívny produkt z data/produkty.csv kontroluje, že:
 *   1) má vlastnú stránku site/produkt-<slug>.html
 *   2) je ako karta v katalógu
 *   3) je ako riadok v cenníku (na homepage aj v katalógu)
 *   4) ceny v HTML sa zhodujú s cenami v CSV
 *   5) neexistuje osirelá produktová stránka bez záznamu v CSV
 *
 * Spustenie:  node scripts/check.mjs
 * Skončí kódom 1, ak niečo nesedí — dá sa zapojiť do CI.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');

function readCsv(path) {
  const rows = readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const head = rows.shift().split(';').map((h) => h.trim());
  return rows.map((line) => {
    const c = line.split(';');
    return Object.fromEntries(head.map((h, i) => [h, (c[i] ?? '').trim()]));
  });
}

const eurShort = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')) + ' €';
const eurFull  = (n) => n.toFixed(2).replace('.', ',') + ' €';

const products = readCsv(join(ROOT, 'data/produkty.csv')).filter((p) => p.active === '1');
const index   = readFileSync(join(SITE, 'index.html'), 'utf8');
const katalog = readFileSync(join(SITE, 'katalog.html'), 'utf8');
// odkazy okolo názvu prekážajú pri porovnaní, tak ich odstránime
const katFlat = katalog.replace(/<a [^>]*>/g, '').replace(/<\/a>/g, '');

let bad = 0;
const w = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(`${w('POLOŽKA', 26)} ${w('GRAMÁŽ', 8)} ${w('1 KS', 8)} ${w('3+ KS', 8)} STAV`);
console.log('-'.repeat(78));

for (const p of products) {
  const errs = [];
  const price = Number(p.price_gross_eur);
  const tier = p.tier3_gross_eur ? Number(p.tier3_gross_eur) : null;
  const label = p.name + (p.mg ? ' ' + p.mg : '');

  // 1) vlastná stránka
  const page = `produkt-${p.slug}.html`;
  if (!existsSync(join(SITE, page))) errs.push('CHÝBA_STRÁNKA');

  // 2) karta v katalógu
  const chip = p.mg ? `<span class="chip">${p.mg}</span>` : '';
  const needle = `prod-card__name">${p.name}</h3>${chip}`;
  const cards = katFlat.split(needle).length - 1;
  if (cards === 0) errs.push('CHÝBA_KARTA');
  else if (cards > 1) errs.push(`DUPLIKÁT_KARTY(${cards})`);

  // 3) + 4) riadok v cenníku a ceny, na oboch stránkach
  const row = `<tr><td>${label}</td><td class="pl-1ks">${eurShort(price)}</td>` +
              (tier !== null ? `<td class="pl-3ks">${eurShort(tier)}</td>` : `<td class="pl-none">–</td>`) +
              `</tr>`;
  if (!index.includes(row))   errs.push('CENNÍK_HOMEPAGE');
  if (!katalog.includes(row)) errs.push('CENNÍK_KATALÓG');

  // ceny na karte (formát s dvoma desatinami)
  if (!katFlat.includes(`>${eurFull(price)}<`)) errs.push('KARTA_CENA_1KS');
  if (tier !== null && !katFlat.includes(`>${eurFull(tier)}<`)) errs.push('KARTA_CENA_3KS');

  const ok = errs.length === 0;
  if (!ok) bad++;
  console.log(
    `${w(p.name, 26)} ${w(p.mg || '–', 8)} ${w(eurShort(price), 8)} ` +
    `${w(tier !== null ? eurShort(tier) : '–', 8)} ${ok ? 'OK' : '✗ ' + errs.join(' ')}`
  );
}

console.log('-'.repeat(78));

// 5) osirelé stránky
const expected = new Set(products.map((p) => `produkt-${p.slug}.html`));
const orphans = readdirSync(SITE).filter(
  (f) => f.startsWith('produkt-') && f.endsWith('.html') && !expected.has(f)
);

const rowsIdx = (index.match(/<tr><td>/g) || []).length;
const cardsN  = (katalog.match(/<article class="prod-card/g) || []).length;
const pagesN  = readdirSync(SITE).filter((f) => f.startsWith('produkt-') && f.endsWith('.html')).length;

console.log(`CSV položiek       : ${products.length}`);
console.log(`Riadkov v cenníku  : ${rowsIdx}`);
console.log(`Kariet v katalógu  : ${cardsN}`);
console.log(`Produktových strán : ${pagesN}`);
if (orphans.length) console.log(`Osirelé stránky    : ${orphans.join(', ')}`);

const countsOk = rowsIdx === products.length && cardsN === products.length && pagesN === products.length;
if (bad || orphans.length || !countsOk) {
  console.error(`\n✗ Nesedí: ${bad} položiek, ${orphans.length} osirelých stránok${countsOk ? '' : ', nesedia počty'}.`);
  process.exit(1);
}
console.log(`\n✓ Všetkých ${products.length} položiek sedí — stránka, karta, cenník aj ceny.`);
