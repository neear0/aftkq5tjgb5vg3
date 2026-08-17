#!/usr/bin/env node
/**
 * Overí, že vygenerovaný web zodpovedá dátam.
 *
 * Dátový model: riadky s rovnakým `slug` sú tá istá látka v rôznych silách
 * a v katalógu z nich je JEDEN produkt s prepínačom gramáže.
 *
 * Kontroluje:
 *   1) každý produkt má vlastnú stránku site/produkt-<slug>.html
 *   2) každý produkt má v katalógu presne jednu kartu
 *   3) produkt s viacerými silami má prepínač s toľkými voľbami, koľko má gramáží
 *   4) každá gramáž (SKU) má riadok v cenníku na homepage aj v katalógu
 *   5) ceny v HTML sa zhodujú s CSV
 *   6) neexistuje osirelá produktová stránka
 *
 * Spustenie:  node scripts/check.mjs      (exit 1 pri chybe → vhodné do CI)
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

const skus = readCsv(join(ROOT, 'data/produkty.csv')).filter((r) => r.active === '1')
  .map((r) => ({ ...r, price: Number(r.price_gross_eur), tier: r.tier3_gross_eur ? Number(r.tier3_gross_eur) : null }));

const bySlug = new Map();
for (const s of skus) {
  if (!bySlug.has(s.slug)) bySlug.set(s.slug, []);
  bySlug.get(s.slug).push(s);
}

const index = readFileSync(join(SITE, 'index.html'), 'utf8');
const katalog = readFileSync(join(SITE, 'katalog.html'), 'utf8');
const katFlat = katalog.replace(/<a [^>]*>/g, '').replace(/<\/a>/g, '');

let bad = 0;
const w = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(`${w('PRODUKT', 24)} ${w('GRAMÁŽE', 22)} ${w('CENY', 16)} STAV`);
console.log('-'.repeat(84));

for (const [slug, variants] of bySlug) {
  const errs = [];
  const p = variants[0];
  const multi = variants.length > 1;

  // 1) stránka
  const page = `produkt-${slug}.html`;
  const pagePath = join(SITE, page);
  if (!existsSync(pagePath)) {
    errs.push('CHÝBA_STRÁNKA');
  } else {
    const html = readFileSync(pagePath, 'utf8');
    // 3) prepínač gramáže
    const opts = (html.match(/name="up-strength"/g) || []).length;
    if (multi && opts !== variants.length) {
      errs.push(`PREPÍNAČ(${opts}/${variants.length})`);
    }
    if (!multi && opts > 0) errs.push('PREPÍNAČ_NAVYŠE');
    // každá gramáž musí byť v prehľade skladových jednotiek
    for (const v of variants) {
      if (!html.includes(`data-spec-ref="${v.reference}"`)) errs.push(`SPEC_${v.reference}`);
    }
  }

  // 2) presne jedna karta v katalógu — a hľadáme ju ako celý blok, nie
  //    len podľa výskytu ceny v celom dokumente (to by prešlo aj na cudzej karte)
  const blocks = katFlat.split('<article class="prod-card').slice(1);
  const needle = `prod-card__name">${p.name}</h3>`;
  const mine = blocks.filter((b) => b.includes(needle));
  if (mine.length === 0) errs.push('CHÝBA_KARTA');
  else if (mine.length > 1) errs.push(`DUPLIKÁT_KARTY(${mine.length})`);

  // 4) + 5) cenník po gramážach
  for (const v of variants) {
    const label = p.name + (v.mg ? ' ' + v.mg : '');
    const cells = `<td class="pl-1ks">${eurShort(v.price)}</td>` +
                  (v.tier !== null ? `<td class="pl-3ks">${eurShort(v.tier)}</td>` : `<td class="pl-none">–</td>`);
    for (const [name, html] of [['HOMEPAGE', index], ['KATALÓG', katalog]]) {
      const flat = html.replace(/<a [^>]*>/g, '').replace(/<\/a>/g, '');
      if (!flat.includes(`<td>${label}</td>${cells}`)) errs.push(`CENNÍK_${name}_${v.mg || v.reference}`);
    }
  }

  // cena na karte: pri viacerých silách je to najnižšia, s predponou „od"
  const cheapest = variants.reduce((a, b) => (a.price <= b.price ? a : b));
  if (mine.length === 1) {
    const block = mine[0];
    if (!block.includes(`${eurFull(cheapest.price)}</span>`)) errs.push('KARTA_CENA_1KS');
    if (cheapest.tier !== null && !block.includes(`${eurFull(cheapest.tier)}</span>`)) {
      errs.push('KARTA_CENA_3KS');
    }
    // „od" musí byť práve tam, kde má produkt viac síl — a nikde inde
    const hasFrom = block.includes('price-row__from');
    if (multi && !hasFrom) errs.push('KARTA_CHÝBA_OD');
    if (!multi && hasFrom) errs.push('KARTA_OD_NAVYŠE');
    // počet gramáží uvedený na karte
    if (multi && !block.includes(`${variants.length} gramáže na výber`)) errs.push('KARTA_POČET_SÍL');
  }

  const ok = errs.length === 0;
  if (!ok) bad++;
  const mgs = variants.map((v) => v.mg || '–').join(', ');
  const prices = multi ? `od ${eurShort(cheapest.price)}` : eurShort(cheapest.price);
  console.log(`${w(p.name, 24)} ${w(mgs, 22)} ${w(prices, 16)} ${ok ? 'OK' : '✗ ' + errs.join(' ')}`);
}

console.log('-'.repeat(84));

const expected = new Set([...bySlug.keys()].map((s) => `produkt-${s}.html`));
const pages = readdirSync(SITE).filter((f) => f.startsWith('produkt-') && f.endsWith('.html'));
const orphans = pages.filter((f) => !expected.has(f));

const rowsIdx = (index.match(/<tr><td>/g) || []).length;
const cardsN = (katalog.match(/<article class="prod-card/g) || []).length;
const multiN = [...bySlug.values()].filter((v) => v.length > 1).length;

console.log(`Gramáží (SKU)      : ${skus.length}`);
console.log(`Produktov          : ${bySlug.size}  (z toho ${multiN} s prepínačom sily)`);
console.log(`Riadkov v cenníku  : ${rowsIdx}`);
console.log(`Kariet v katalógu  : ${cardsN}`);
console.log(`Produktových strán : ${pages.length}`);
if (orphans.length) console.log(`Osirelé stránky    : ${orphans.join(', ')}`);

const countsOk = rowsIdx === skus.length && cardsN === bySlug.size && pages.length === bySlug.size;
if (bad || orphans.length || !countsOk) {
  console.error(`\n✗ Nesedí: ${bad} produktov, ${orphans.length} osirelých stránok${countsOk ? '' : ', nesedia počty'}.`);
  process.exit(1);
}
console.log(`\n✓ ${bySlug.size} produktov a ${skus.length} gramáží sedí — stránka, karta, prepínač, cenník aj ceny.`);
