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

/* ── produkty ────────────────────────────────────────────────────────────── */
const head = [
  'Type', 'SKU', 'Name', 'Published', 'Is featured?', 'Visibility in catalogue',
  'Short description', 'Description',
  'Tax status', 'Tax class',
  'In stock?', 'Stock', 'Backorders allowed?', 'Sold individually?',
  'Regular price', 'Categories',
  'Attribute 1 name', 'Attribute 1 value(s)', 'Attribute 1 visible', 'Attribute 1 global',
  'Attribute 2 name', 'Attribute 2 value(s)', 'Attribute 2 visible', 'Attribute 2 global',
  'Attribute 3 name', 'Attribute 3 value(s)', 'Attribute 3 visible', 'Attribute 3 global',
  'Meta: _up_tier3_price',
  'Meta: _up_batch',
  'Meta: _up_purity',
  'Images',
];

const STOCK_QTY = { in: 25, low: 3, out: 0 };

const rows = products.map((p) => {
  const { short, long } = contentHtml(p.slug);
  const label = p.name + (p.mg ? ' ' + p.mg : '');
  const forma = p.form === 'Roztok' ? 'Roztok' : 'Lyofilizát';

  return row([
    'simple',
    p.reference,
    label,
    1,
    p.featured === '1' ? 1 : 0,
    'visible',
    short,
    long,
    'taxable',
    '',                                   // predvolená daňová trieda
    (STOCK_QTY[p.stock] ?? 0) > 0 ? 1 : 0,
    STOCK_QTY[p.stock] ?? 0,
    0,                                    // bez backorderov — šaržový tovar
    0,
    p.price_gross_eur,                    // cena S DPH, viď nastavenie nižšie
    catName(p.category),
    'Forma', forma, 1, 1,
    'Gramáž', p.mg || '', p.mg ? 1 : 0, 1,
    'Čistota', p.purity ? String(p.purity).replace('.', ',') + ' %' : '', p.purity ? 1 : 0, 1,
    p.tier3_gross_eur || '',
    p.batch || '',
    p.purity || '',
    '',                                   // fotky doplniť, keď bude nafotený katalóg
  ]);
});

writeFileSync(join(OUT, 'woocommerce-produkty.csv'), [head.join(','), ...rows].join('\n') + '\n', 'utf8');

/* ── návod ───────────────────────────────────────────────────────────────── */
const tiers = products.filter((p) => p.tier3_gross_eur).length;
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
  Otvor ktorýkoľvek produkt a pozri pole "Cena za kus od 3 ks".
* Daj do košíka 3 kusy a over, že sa cena prepla.
* Vlož na stránku cenníka shortcode:  [up_cennik]
* Skladové množstvá sú odvodené od stavu v CSV (in=25, low=3, out=0),
  nie sú to reálne počty — nastav si ich.
* Fotky sa neimportujú, stĺpec Images je prázdny.

ATRIBÚTY
--------
Forma, Gramáž a Čistota sa vytvoria ako globálne atribúty. Vďaka tomu sa
dajú použiť na filtrovanie vo výpise kategórie.
`, 'utf8');

console.log(
  `HOTOVO: export/woocommerce-produkty.csv (${products.length} produktov, ` +
  `${tiers} s množstevnou cenou), WOOCOMMERCE.txt`
);
