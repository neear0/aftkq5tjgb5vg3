#!/usr/bin/env node
/**
 * Overí, že vygenerovaný web zodpovedá dátam — a to v každej jazykovej mutácii.
 *
 * Dátový model: riadky s rovnakým `slug` sú tá istá látka v rôznych silách
 * a v katalógu z nich je JEDEN produkt s prepínačom gramáže.
 *
 * Kontroluje pre každý jazyk:
 *   1) každý produkt má vlastnú stránku
 *   2) každý produkt má v katalógu presne jednu kartu
 *   3) produkt s viacerými silami má prepínač s toľkými voľbami, koľko má gramáží
 *   4) každá gramáž (SKU) má riadok v cenníku na homepage aj v katalógu
 *   5) ceny v HTML sa zhodujú s CSV vrátane formátu čísla pre daný jazyk
 *   6) neexistuje osirelá produktová stránka
 *   7) v HTML nezostala nenahradená značka {{…}}
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

const skus = readCsv(join(ROOT, 'data/produkty.csv')).filter((r) => r.active === '1')
  .map((r) => ({ ...r, price: Number(r.price_gross_eur), tier: r.tier3_gross_eur ? Number(r.tier3_gross_eur) : null }));

const bySlug = new Map();
for (const s of skus) {
  if (!bySlug.has(s.slug)) bySlug.set(s.slug, []);
  bySlug.get(s.slug).push(s);
}

const LOCALES = readdirSync(join(ROOT, 'data/i18n'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(ROOT, 'data/i18n', f), 'utf8')))
  .sort((a, b) => (a.dir === '' ? -1 : b.dir === '' ? 1 : a.lang.localeCompare(b.lang)));

const w = (s, n) => String(s).padEnd(n).slice(0, n);
let failed = 0;

for (const L of LOCALES) {
  const dir = L.dir ? join(SITE, L.dir) : SITE;
  const R = L.routes;
  const dec = (s) => (L.decimal === ',' ? s : s.replace(',', '.'));
  const eurShort = (n) => dec(Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')) + ' €';
  const eurFull  = (n) => dec(n.toFixed(2).replace('.', ',')) + ' €';
  const strengthsNote = (n) => L.strings.CARD_STRENGTHS.split('{n}').join(n);

  const index = readFileSync(join(dir, R.home), 'utf8');
  const katalog = readFileSync(join(dir, R.catalog), 'utf8');
  const katFlat = katalog.replace(/<a [^>]*>/g, '').replace(/<\/a>/g, '');

  let bad = 0;
  console.log(`\n═══ ${L.lang.toUpperCase()} — ${L.dir ? 'site/' + L.dir : 'site/'} ${'═'.repeat(40)}`);
  console.log(`${w('PRODUKT', 24)} ${w('GRAMÁŽE', 22)} ${w('CENY', 16)} STAV`);
  console.log('-'.repeat(84));

  for (const [slug, variants] of bySlug) {
    const errs = [];
    const p = variants[0];
    const multi = variants.length > 1;

    // 1) stránka
    const page = `${R.product}${slug}.html`;
    const pagePath = join(dir, page);
    if (!existsSync(pagePath)) {
      errs.push('CHÝBA_STRÁNKA');
    } else {
      const html = readFileSync(pagePath, 'utf8');
      // 3) prepínač gramáže
      const opts = (html.match(/name="up-strength"/g) || []).length;
      if (multi && opts !== variants.length) errs.push(`PREPÍNAČ(${opts}/${variants.length})`);
      if (!multi && opts > 0) errs.push('PREPÍNAČ_NAVYŠE');
      // každá gramáž musí byť v prehľade skladových jednotiek
      for (const v of variants) {
        if (!html.includes(`data-spec-ref="${v.reference}"`)) errs.push(`SPEC_${v.reference}`);
      }
    }

    // 2) presne jedna karta v katalógu — hľadáme celý blok, nie výskyt ceny
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
      if (cheapest.tier !== null && !block.includes(`${eurFull(cheapest.tier)}</span>`)) errs.push('KARTA_CENA_3KS');
      const hasFrom = block.includes('price-row__from');
      if (multi && !hasFrom) errs.push('KARTA_CHÝBA_OD');
      if (!multi && hasFrom) errs.push('KARTA_OD_NAVYŠE');
      if (multi && !block.includes(strengthsNote(variants.length))) errs.push('KARTA_POČET_SÍL');
    }

    const ok = errs.length === 0;
    if (!ok) bad++;
    const mgs = variants.map((v) => v.mg || '–').join(', ');
    const prices = multi ? `od ${eurShort(cheapest.price)}` : eurShort(cheapest.price);
    console.log(`${w(p.name, 24)} ${w(mgs, 22)} ${w(prices, 16)} ${ok ? 'OK' : '✗ ' + errs.join(' ')}`);
  }

  console.log('-'.repeat(84));

  const expected = new Set([...bySlug.keys()].map((s) => `${R.product}${s}.html`));
  const pages = readdirSync(dir).filter((f) => f.startsWith(R.product) && f.endsWith('.html'));
  const orphans = pages.filter((f) => !expected.has(f));

  const rowsIdx = (index.match(/<tr><td>/g) || []).length;
  const cardsN = (katalog.match(/<article class="prod-card/g) || []).length;
  const multiN = [...bySlug.values()].filter((v) => v.length > 1).length;

  // 7) nenahradené značky šablóny
  const leftovers = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.html'))) {
    const m = readFileSync(join(dir, f), 'utf8').match(/\{\{\w+\}\}/g);
    if (m) leftovers.push(`${f}: ${[...new Set(m)].join(' ')}`);
  }

  console.log(`Gramáží (SKU)      : ${skus.length}`);
  console.log(`Produktov          : ${bySlug.size}  (z toho ${multiN} s prepínačom sily)`);
  console.log(`Riadkov v cenníku  : ${rowsIdx}`);
  console.log(`Kariet v katalógu  : ${cardsN}`);
  console.log(`Produktových strán : ${pages.length}`);
  if (orphans.length) console.log(`Osirelé stránky    : ${orphans.join(', ')}`);
  if (leftovers.length) console.log(`Nenahradené značky : ${leftovers.join(' | ')}`);

  const countsOk = rowsIdx === skus.length && cardsN === bySlug.size && pages.length === bySlug.size;
  if (bad || orphans.length || leftovers.length || !countsOk) {
    console.error(`✗ ${L.lang}: ${bad} produktov nesedí, ${orphans.length} osirelých stránok` +
      `${leftovers.length ? ', nenahradené značky' : ''}${countsOk ? '' : ', nesedia počty'}.`);
    failed++;
  } else {
    console.log(`✓ ${L.lang}: ${bySlug.size} produktov a ${skus.length} gramáží sedí — stránka, karta, prepínač, cenník aj ceny.`);
  }
}

/* ── obsah musí existovať v každom jazyku rovnako ────────────────────────── */
const missing = [];
for (const L of LOCALES) {
  for (const slug of bySlug.keys()) {
    if (!existsSync(join(ROOT, L.content, 'produkty', `${slug}.md`))) missing.push(`${L.lang}/${slug}`);
  }
}
if (missing.length) {
  console.log(`\nBez popisu (použije sa náhradný text): ${missing.join(', ')}`);
}

if (failed) process.exit(1);
console.log(`\n✓ všetky jazyky (${LOCALES.map((l) => l.lang).join(', ')}) sedia s dátami.`);
