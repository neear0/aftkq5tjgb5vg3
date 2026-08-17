#!/usr/bin/env node
/**
 * Export katalógu do formátu, ktorý zje CSV import PrestaShopu.
 *
 * Vyrobí:
 *   export/prestashop-kategorie.csv   Katalóg → Kategórie → Import
 *   export/prestashop-produkty.csv    Katalóg → Produkty  → Import
 *   export/README.txt                 postup importu a na čo si dať pozor
 *
 * Množstevné ceny (3+ ks) sa cez CSV import PrestaShopu nedajú nahrať —
 * na tie je scripts/set-specific-prices.php, ktorý sa spúšťa cez SSH.
 *
 * Spustenie:  node scripts/export-prestashop.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'export');
mkdirSync(OUT, { recursive: true });

/** DPH, ktorou sa prepočítava cena bez dane. Over aktuálnu sadzbu. */
const VAT = 0.23;
/** id skupiny daňových pravidiel v PrestaShope pre SK 23 % — over v BO. */
const TAX_RULES_ID = 1;

function readCsv(path) {
  const rows = readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const head = rows.shift().split(';').map((h) => h.trim());
  return rows.map((line) => {
    const c = line.split(';');
    return Object.fromEntries(head.map((h, i) => [h, (c[i] ?? '').trim()]));
  });
}

/** PrestaShop import berie ; ako oddeľovač, tak polia s ; alebo " zabalíme. */
function cell(v) {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const row = (arr) => arr.map(cell).join(';');

const categories = readCsv(join(ROOT, 'data/kategorie.csv'))
  .sort((a, b) => Number(a.poradie) - Number(b.poradie));
const products = readCsv(join(ROOT, 'data/produkty.csv')).filter((p) => p.active === '1');

/* ── obsah produktu → HTML pre pole Description ───────────────────────────── */
function contentHtml(slug) {
  const file = join(ROOT, 'content/produkty', `${slug}.md`);
  if (!existsSync(file)) return { summary: '', description: '' };
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
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const description = blocks.map((b) => {
    const ul = b.items.length ? `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '';
    const ps = b.paras.map((p) => `<p>${esc(p)}</p>`).join('');
    return `<h3>${esc(b.title)}</h3>${ul}${ps}`;
  }).join('');

  const disclaimer =
    '<p><strong>FOR RESEARCH USE ONLY.</strong> Referenčná látka určená výhradne na laboratórne ' +
    'a výskumné použitie. Nie je liekom, výživovým doplnkom ani kozmetikou a nie je určená na ' +
    'diagnostiku, liečbu ani na podávanie ľuďom či zvieratám. Neposkytujeme dávkovanie ' +
    'ani zdravotné odporúčania.</p>';

  return { summary: esc(perex.join(' ')), description: description + disclaimer };
}

/* ── kategórie ───────────────────────────────────────────────────────────── */
const catHead = ['Active', 'Name', 'Parent category', 'Rewritten URL', 'Meta title', 'Meta description'];
const catRows = categories.map((c) => row([
  1, c.name, 'Domov', c.slug,
  `${c.name} — výskumné peptidy`,
  `${c.name}: výskumné peptidy s certifikátom analýzy ku každej šarži.`,
]));
writeFileSync(join(OUT, 'prestashop-kategorie.csv'),
  [catHead.join(';'), ...catRows].join('\n') + '\n', 'utf8');

/* ── produkty ────────────────────────────────────────────────────────────── */
const prodHead = [
  'Active', 'Name', 'Categories', 'Price tax excluded', 'Tax rules ID', 'Reference',
  'Quantity', 'Minimal quantity', 'Action when out of stock',
  'Summary', 'Description',
  'Meta title', 'Meta description', 'Rewritten URL',
  'Available for order', 'Show price', 'Visibility',
  'Feature (Name:Value:Position)',
  'Image URLs',
];

const STOCK_QTY = { in: 25, low: 3, out: 0 };
const catName = (slug) => categories.find((c) => c.slug === slug)?.name ?? slug;

const prodRows = products.map((p) => {
  const gross = Number(p.price_gross_eur);
  const net = p.price_net_eur ? Number(p.price_net_eur) : gross / (1 + VAT);
  const { summary, description } = contentHtml(p.slug);
  const label = p.name + (p.mg ? ' ' + p.mg : '');

  const features = [
    p.purity ? `Čistota:${String(p.purity).replace('.', ',')} %:0` : null,
    p.batch ? `Šarža:${p.batch}:1` : null,
    p.form ? `Forma:${p.form === 'Roztok' ? 'Roztok' : 'Lyofilizát'}:2` : null,
    p.mg ? `Množstvo:${p.mg}:3` : null,
  ].filter(Boolean).join(',');

  return row([
    1,
    label,
    `Domov,${catName(p.category)}`,
    net.toFixed(6),
    TAX_RULES_ID,
    p.reference,
    STOCK_QTY[p.stock] ?? 0,
    1,
    0,                       // 0 = zakázať objednávky pri nule (chladený/šaržový tovar)
    summary,
    description,
    `${label} — ULTRA PEPTIDY`,
    summary ? summary.slice(0, 300) : `${label}. Referenčná látka na výskumné použitie.`,
    p.slug,
    1, 1, 'both',
    features,
    '',                      // fotky doplň v BO alebo cez URL, keď budú nafotené
  ]);
});

writeFileSync(join(OUT, 'prestashop-produkty.csv'),
  [prodHead.join(';'), ...prodRows].join('\n') + '\n', 'utf8');

/* ── návod ───────────────────────────────────────────────────────────────── */
const tiers = products.filter((p) => p.tier3_gross_eur).length;
writeFileSync(join(OUT, 'README.txt'),
`IMPORT KATALÓGU DO PRESTASHOPU
==============================
Vygenerované z data/produkty.csv — needituj tieto súbory, uprav dáta
a spusti znova: node scripts/export-prestashop.mjs

POSTUP
------
1) Kategórie
   Katalóg -> Kategórie -> Import (alebo Rozšírené parametre -> CSV import)
   Súbor: prestashop-kategorie.csv
   Oddeľovač polí: ;    Oddeľovač viacerých hodnôt: ,
   Kódovanie: UTF-8

2) Produkty
   Rozšírené parametre -> CSV import -> typ "Produkty"
   Súbor: prestashop-produkty.csv
   Rovnaké oddeľovače. Zaškrtni "Použiť referenciu ako kľúč" pri
   opakovanom importe, inak sa produkty zduplikujú.

3) Množstevné ceny (3+ ks) — NEJDÚ cez CSV import
   PrestaShop nemá pre specific_price importný typ. Cez SSH:
     php8.2 _cli/set-specific-prices.php --csv=/cesta/data/produkty.csv --dry-run
     php8.2 _cli/set-specific-prices.php --csv=/cesta/data/produkty.csv
   Položiek s množstevnou cenou: ${tiers} z ${products.length}

NA ČO SI DAŤ POZOR
------------------
* Ceny v stĺpci "Price tax excluded" sú BEZ DPH, prepočítané sadzbou
  ${(VAT * 100).toFixed(0)} %. Over aktuálnu sadzbu aj to, či "Tax rules ID" ${TAX_RULES_ID}
  naozaj zodpovedá SK ${(VAT * 100).toFixed(0)} % v tvojej inštalácii.
* "Action when out of stock" je 0 = pri nulovom sklade sa nedá objednať.
  Pri šaržovom tovare je to zámer, nie opomenutie.
* Stĺpec "Image URLs" je prázdny — fotky sa doplnia až keď bude
  nafotený katalóg. Import ich vie ťahať z verejných URL.
* Popisy majú na konci povinný RUO disclaimer. Needituj ho preč.
* Skladové množstvá sú odvodené od stavu v CSV (in=25, low=3, out=0),
  nie sú to reálne počty. Po importe si ich nastav v BO.
`, 'utf8');

console.log(
  `HOTOVO: export/prestashop-kategorie.csv (${categories.length}), ` +
  `export/prestashop-produkty.csv (${products.length}), README.txt\n` +
  `Množstevné ceny (${tiers} položiek) sa nahrávajú skriptom, nie importom.`
);
