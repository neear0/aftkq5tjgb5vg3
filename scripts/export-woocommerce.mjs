#!/usr/bin/env node
/**
 * Export katalógu do formátu importéra WooCommerce.
 *
 * Vyrobí:
 *   export/woocommerce-produkty.csv   Produkty → Import
 *   export/WOOCOMMERCE.txt            postup a nastavenia, ktoré treba trafiť
 *
 * Množstevné ceny (3+ ks) idú v tom istom súbore ako meta pole
 * `Meta: _up_tier3_price`, ktoré číta plugin wp-plugin/ultrapeptidy-cennik.
 * Vďaka tomu sa celý katalóg nahrá jedným importom — na rozdiel od
 * PrestaShopu, kde sa specific_price musí dopĺňať skriptom.
 *
 * Spustenie:  node scripts/export-woocommerce.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'export');
mkdirSync(OUT, { recursive: true });

function readCsv(path) {
  const rows = readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const head = rows.shift().split(';').map((h) => h.trim());
  return rows.map((line) => {
    const c = line.split(';');
    return Object.fromEntries(head.map((h, i) => [h, (c[i] ?? '').trim()]));
  });
}

/** WooCommerce importér očakáva čiarku ako oddeľovač a " na zabalenie. */
function cell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const row = (arr) => arr.map(cell).join(',');

const categories = readCsv(join(ROOT, 'data/kategorie.csv'))
  .sort((a, b) => Number(a.poradie) - Number(b.poradie));
const products = readCsv(join(ROOT, 'data/produkty.csv')).filter((p) => p.active === '1');
const catName = (slug) => categories.find((c) => c.slug === slug)?.name ?? slug;

/* ── markdown → HTML ─────────────────────────────────────────────────────── */
function contentHtml(slug) {
  const file = join(ROOT, 'content/produkty', `${slug}.md`);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const disclaimer =
    '<p><strong>FOR RESEARCH USE ONLY.</strong> Referenčná látka určená výhradne na laboratórne '
    + 'a výskumné použitie. Nie je liekom, výživovým doplnkom ani kozmetikou a nie je určená na '
    + 'diagnostiku, liečbu ani na podávanie ľuďom či zvieratám. Neposkytujeme dávkovanie '
    + 'ani zdravotné odporúčania.</p>';

  if (!existsSync(file)) return { short: '', long: disclaimer };

  const md = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const perex = [];
  const blocks = [];
  let cur = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('## ')) { cur = { title: line.slice(3).trim(), items: [], paras: [] }; blocks.push(cur); }
    else if (line.startsWith('> ')) perex.push(line.slice(2).trim());
    else if (line.startsWith('- ')) { if (cur) cur.items.push(line.slice(2).trim()); }
    else if (cur) {
      if (cur.items.length && !cur.paras.length) cur.items[cur.items.length - 1] += ' ' + line;
      else cur.paras.push(line);
    }
  }
  const long = blocks.map((b) => {
    const ul = b.items.length ? `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '';
    const ps = b.paras.map((p) => `<p>${esc(p)}</p>`).join('');
    return `<h3>${esc(b.title)}</h3>${ul}${ps}`;
  }).join('');

  return { short: esc(perex.join(' ')), long: long + disclaimer };
}

/* ── zoskupenie na produkty (rovnaký slug = tá istá látka v iných silách) ── */
const bySlug = new Map();
for (const s of products) {
  if (!bySlug.has(s.slug)) bySlug.set(s.slug, []);
  bySlug.get(s.slug).push(s);
}
const grouped = [...bySlug.entries()].map(([slug, variants]) => ({
  slug, variants, first: variants[0], multi: variants.length > 1,
}));

/* ── produkty ────────────────────────────────────────────────────────────── */
const head = [
  'Type', 'SKU', 'Name', 'Published', 'Is featured?', 'Visibility in catalogue',
  'Short description', 'Description',
  'Tax status', 'Tax class',
  'In stock?', 'Stock', 'Backorders allowed?', 'Sold individually?',
  'Regular price', 'Categories', 'Parent', 'Position',
  'Attribute 1 name', 'Attribute 1 value(s)', 'Attribute 1 visible', 'Attribute 1 global',
  'Attribute 2 name', 'Attribute 2 value(s)', 'Attribute 2 visible', 'Attribute 2 global',
  'Meta: _up_tier3_price',
  'Meta: _up_batch',
  'Meta: _up_purity',
  'Images',
];

const STOCK_QTY = { in: 25, low: 3, out: 0 };
const forma = (p) => (p.form === 'Roztok' ? 'Roztok' : 'Lyofilizát');

const rows = [];
for (const g of grouped) {
  const p = g.first;
  const { short, long } = contentHtml(g.slug);
  const mgs = g.variants.map((v) => v.mg).filter(Boolean);

  if (!g.multi) {
    // jedna sila → jednoduchý produkt
    rows.push(row([
      'simple', p.reference, p.name + (p.mg ? ' ' + p.mg : ''),
      1, p.featured === '1' ? 1 : 0, 'visible',
      short, long, 'taxable', '',
      (STOCK_QTY[p.stock] ?? 0) > 0 ? 1 : 0, STOCK_QTY[p.stock] ?? 0, 0, 0,
      p.price_gross_eur, catName(p.category), '', 0,
      'Forma', forma(p), 1, 1,
      'Gramáž', p.mg || '', p.mg ? 1 : 0, 1,
      p.tier3_gross_eur || '', p.batch || '', p.purity || '', '',
    ]));
    continue;
  }

  // viac síl → variabilný produkt: rodič bez ceny + variant pre každú gramáž
  const parentSku = `${p.reference.split('-').slice(0, 2).join('-')}-VAR`;
  rows.push(row([
    'variable', parentSku, p.name,
    1, g.variants.some((v) => v.featured === '1') ? 1 : 0, 'visible',
    short, long, 'taxable', '',
    1, '', 0, 0,
    '',                                  // cena je na variantoch
    catName(p.category), '', 0,
    'Forma', forma(p), 1, 1,
    'Gramáž', mgs.join(', '), 1, 1,      // hodnoty pre výber na produkte
    '', '', '', '',
  ]));

  g.variants.forEach((v, i) => {
    rows.push(row([
      'variation', v.reference, `${p.name} – ${v.mg}`,
      1, 0, 'visible',
      '', '', 'taxable', '',
      (STOCK_QTY[v.stock] ?? 0) > 0 ? 1 : 0, STOCK_QTY[v.stock] ?? 0, 0, 0,
      v.price_gross_eur, '', parentSku, i,
      'Forma', forma(v), 1, 1,
      'Gramáž', v.mg, 1, 1,              // konkrétna sila tohto variantu
      v.tier3_gross_eur || '', v.batch || '', v.purity || '', '',
    ]));
  });
}

writeFileSync(join(OUT, 'woocommerce-produkty.csv'), [head.join(','), ...rows].join('\n') + '\n', 'utf8');

/* ── návod ───────────────────────────────────────────────────────────────── */
const tiers = products.filter((p) => p.tier3_gross_eur).length;
const multiN = grouped.filter((g) => g.multi).length;
writeFileSync(join(OUT, 'WOOCOMMERCE.txt'),
`IMPORT KATALÓGU DO WOOCOMMERCE
==============================
Vygenerované z data/produkty.csv — needituj tento súbor, uprav dáta
a spusti znova: node scripts/export-woocommerce.mjs

PREDPOKLAD: NAJPRV NASTAVENIA, POTOM IMPORT
-------------------------------------------
1) WooCommerce -> Nastavenia -> Všeobecné
     Mena: EUR, symbol za sumou, desatinná čiarka
2) WooCommerce -> Nastavenia -> Dane
     "Zadávať ceny vrátane dane"  =  ÁNO      <<< DÔLEŽITÉ
     Základná sadzba: SK 23 % (over aktuálnu sadzbu)

   Ceny v tomto exporte sú S DPH, presne ako v tlačenom cenníku.
   Ak necháš "zadávať ceny bez dane", Woo k nim DPH ešte pripočíta
   a všetko bude o 23 % drahšie.

3) Nainštaluj a aktivuj plugin z wp-plugin/ultrapeptidy-cennik/
     Bez neho sa množstevné ceny naimportujú do meta poľa, ale nikde
     sa neprejavia — ani na produkte, ani v košíku.

IMPORT
------
Produkty -> Všetky produkty -> Import -> vyber woocommerce-produkty.csv
   Oddeľovač: ,   (čiarka)
   Na obrazovke mapovania skontroluj, že sa napárovali stĺpce:
     Meta: _up_tier3_price   ->  Meta: _up_tier3_price
     Meta: _up_batch         ->  Meta: _up_batch
     Meta: _up_purity        ->  Meta: _up_purity
   Woo ich niekedy ponúkne ako "Nechať nenaimportované" — prepni ručne.

   Pri opakovanom importe zaškrtni "Aktualizovať existujúce produkty",
   inak sa katalóg zduplikuje. Párovanie ide cez SKU.

PO IMPORTE SKONTROLUJ
---------------------
* Položiek s množstevnou cenou: ${tiers} z ${products.length}
* Variabilných produktov (výber gramáže): ${multiN}
  Otvor napr. Tesamorelin a over, že sa dá prepnúť 5 / 10 / 20 mg
  a že každá sila má vlastnú cenu.
  Otvor ktorýkoľvek produkt a pozri pole "Cena za kus od 3 ks".
* Daj do košíka 3 kusy a over, že sa cena prepla.
* Vlož na stránku cenníka shortcode:  [up_cennik]
* Skladové množstvá sú odvodené od stavu v CSV (in=25, low=3, out=0),
  nie sú to reálne počty — nastav si ich.
* Fotky sa neimportujú, stĺpec Images je prázdny.

VARIABILNÉ PRODUKTY (VÝBER GRAMÁŽE)
-----------------------------------
Tá istá látka v inej sile nie je iný produkt. Preto sú v exporte:
  Type=variable    rodič bez ceny, v atribúte Gramáž má všetky sily
  Type=variation   jeden riadok na silu, s vlastnou cenou, SKU a šaržou
Importér ich spojí cez stĺpec Parent (SKU rodiča).

Ak sa varianty naimportujú bez ceny, skontroluj v mapovaní stĺpec
"Regular price" a "Parent" — Woo ich pri variantoch občas nenapáruje sám.

ATRIBÚTY
--------
Forma, Gramáž a Čistota sa vytvoria ako globálne atribúty. Vďaka tomu sa
dajú použiť na filtrovanie vo výpise kategórie.
`, 'utf8');

console.log(
  `HOTOVO: export/woocommerce-produkty.csv (${products.length} produktov, ` +
  `${tiers} s množstevnou cenou), WOOCOMMERCE.txt`
);
