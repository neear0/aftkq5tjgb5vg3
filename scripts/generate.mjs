#!/usr/bin/env node
/**
 * Generátor webu ULTRA PEPTIDY.
 *
 * Zdroj pravdy:
 *   data/kategorie.csv          — kategórie a ich poradie
 *   data/produkty.csv           — katalóg (ceny, gramáž, sklad, čistota, šarža)
 *   content/produkty/<slug>.md  — popisný text produktu (voliteľné)
 *   templates/produkt.html      — šablóna produktovej stránky
 *
 * Čo robí:
 *   1) doplní bloky medzi značky <!-- GEN:xxx --> … <!-- /GEN:xxx -->
 *      v site/index.html a site/katalog.html
 *   2) vygeneruje site/produkt-<slug>.html pre každý aktívny produkt
 *   3) prepíše site/sitemap.xml
 *
 * Spustenie:  node scripts/generate.mjs
 * Kontrola:   node scripts/generate.mjs --check   (nič nezapíše, len overí)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const CHECK = process.argv.includes('--check');

/* ── pomocné ─────────────────────────────────────────────────────────────── */
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 85 -> "85 €" ; 84.5 -> "84,50 €"  (cenníková tabuľka) */
const eurShort = (n) =>
  (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')) + ' €';
/** 85 -> "85,00 €"  (karty a kúpny blok) */
const eurFull = (n) => n.toFixed(2).replace('.', ',') + ' €';

function readCsv(path) {
  const rows = readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const head = rows.shift().split(';').map((h) => h.trim());
  return rows.map((line) => {
    const cells = line.split(';');
    return Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

/* ── načítanie dát ───────────────────────────────────────────────────────── */
const categories = readCsv(join(ROOT, 'data/kategorie.csv'))
  .sort((a, b) => Number(a.poradie) - Number(b.poradie));

const products = readCsv(join(ROOT, 'data/produkty.csv'))
  .filter((p) => p.active === '1')
  .map((p) => ({
    ...p,
    price: Number(p.price_gross_eur),
    tier: p.tier3_gross_eur ? Number(p.tier3_gross_eur) : null,
    featured: p.featured === '1',
  }));

/* ── validácia: radšej spadnúť pri builde než nasadiť rozbitý web ─────────── */
const problems = [];
const catSlugs = new Set(categories.map((c) => c.slug));
const seenSlug = new Set();
for (const p of products) {
  if (!p.slug) problems.push(`${p.reference}: chýba slug`);
  if (seenSlug.has(p.slug)) problems.push(`${p.slug}: duplicitný slug`);
  seenSlug.add(p.slug);
  if (!catSlugs.has(p.category)) problems.push(`${p.reference}: neznáma kategória "${p.category}"`);
  if (!Number.isFinite(p.price)) problems.push(`${p.reference}: neplatná cena`);
  if (p.tier !== null && p.tier >= p.price) problems.push(`${p.reference}: množstevná cena nie je nižšia`);
}
if (problems.length) {
  console.error('CHYBY V DÁTACH:\n  ' + problems.join('\n  '));
  process.exit(1);
}

/* ── obsah produktu z markdownu ──────────────────────────────────────────── */
function loadContent(slug) {
  const file = join(ROOT, 'content/produkty', `${slug}.md`);
  if (!existsSync(file)) return { perex: '', blocks: [] };
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
      // pokračovanie odrážky, ktorá sa zalomila na ďalší riadok
      if (cur.items.length && !cur.paras.length) cur.items[cur.items.length - 1] += ' ' + line;
      else cur.paras.push(line);
    }
  }
  return { perex: perex.join(' '), blocks };
}

/* ── render: kúsky ───────────────────────────────────────────────────────── */
const STOCK = {
  in:  { cls: '',                    label: 'Na sklade' },
  low: { cls: ' stock-pill--low',    label: 'Posledné kusy' },
  out: { cls: ' stock-pill--out',    label: 'Vypredané' },
};

function vialNameClass(name) {
  const l = name.length;
  return l >= 12 ? ' vial__name--xs' : l >= 8 ? ' vial__name--sm' : '';
}

function priceRows(p, full = true) {
  const f = full ? eurFull : eurShort;
  const one = `<div class="price-row"><span class="price-row__label">1 ks</span>` +
              `<span class="price-row__value">${f(p.price)}</span></div>`;
  const tier = p.tier !== null
    ? `<div class="price-row price-row--tier"><span class="price-row__label">3+ ks<small>za kus</small></span>` +
      `<span class="price-row__value">${f(p.tier)}</span></div>`
    : `<div class="price-row price-row--tier"><span class="price-row__label">3+ ks<small>za kus</small></span>` +
      `<span class="price-row__value" style="color:var(--up-text-mute)">–</span></div>`;
  return one + tier;
}

function card(p, { prefix = '' } = {}) {
  const st = STOCK[p.stock] ?? STOCK.in;
  const href = `${prefix}produkt-${p.slug}.html`;
  const chip = p.mg ? `<span class="chip">${esc(p.mg)}</span>` : '';
  return `
      <article class="prod-card holo-border foil sheen">
        <a class="prod-card__media" href="${href}" aria-label="${esc(p.name)}${p.mg ? ' ' + esc(p.mg) : ''}"><span class="vial"><img class="vial__photo" src="${prefix}assets/img/vial.jpg" alt="" width="306" height="812" loading="lazy" decoding="async"><span class="vial__name${vialNameClass(p.name)}">${esc(p.name)}</span></span></a>
        <div class="prod-card__body">
          <h3 class="prod-card__name"><a href="${href}">${esc(p.name)}</a></h3>${chip}
          <span class="stock-pill${st.cls}">${st.label}</span>
          <div class="prod-card__prices price-tiers">${priceRows(p)}</div>
          <a class="btn-holo btn-block" style="padding:9px 14px;font-size:.75rem" href="${href}">Detail</a>
        </div>
      </article>`;
}

function catIcon(slug) {
  return categories.find((c) => c.slug === slug)?.icon ?? 'i-drop';
}
function catName(slug) {
  return categories.find((c) => c.slug === slug)?.name ?? slug;
}

/* ── render: bloky na stránky ────────────────────────────────────────────── */
function renderChips(prefix = '') {
  return `    <div class="cat-nav">
${categories.map((c) => {
  const n = products.filter((p) => p.category === c.slug).length;
  return `      <a class="cat-chip" href="${prefix}katalog.html#${c.slug}"><svg fill="none"><use href="#${c.icon}"/></svg><span class="cat-chip__name">${esc(c.name)}</span><span class="cat-chip__n">${n}</span></a>`;
}).join('\n')}
    </div>`;
}

function renderFeatured() {
  const list = products.filter((p) => p.featured);
  return `    <div class="prod-grid">${list.map((p) => card(p)).join('\n')}
    </div>`;
}

function renderCatalogue() {
  return categories.map((c) => {
    const list = products.filter((p) => p.category === c.slug);
    if (!list.length) return '';
    const word = list.length === 1 ? 'produkt' : list.length < 5 ? 'produkty' : 'produktov';
    return `
<section class="up-section" id="${c.slug}" style="padding-top:0">
  <div class="up-container">
    <div class="section-head">
      <div style="display:flex;align-items:center;gap:var(--up-sp-3)">
        <span class="cat-tile__icon"><svg fill="none"><use href="#${c.icon}"/></svg></span>
        <div><p class="eyebrow">${list.length} ${word}</p><h2 class="section-title">${esc(c.name)}</h2></div>
      </div>
    </div>
    <div class="prod-grid">${list.map((p) => card(p)).join('\n')}
    </div>
  </div>
</section>`;
  }).join('\n');
}

function renderPricelist() {
  return `      <div class="pricelist">
${categories.map((c) => {
  const list = products.filter((p) => p.category === c.slug);
  if (!list.length) return '';
  return `        <div class="pl-group">
          <div class="pl-group__head"><svg fill="none" stroke-linecap="round"><use href="#${c.icon}"/></svg><h3 class="pl-group__title">${esc(c.name)}</h3></div>
          <table class="pl-table">
            <thead><tr><th>Produkt</th><th>1 ks</th><th>3+ ks<small>za kus</small></th></tr></thead>
            <tbody>
${list.map((p) => {
  const label = esc(p.name + (p.mg ? ' ' + p.mg : ''));
  const tier = p.tier !== null
    ? `<td class="pl-3ks">${eurShort(p.tier)}</td>`
    : `<td class="pl-none">–</td>`;
  return `              <tr><td>${label}</td><td class="pl-1ks">${eurShort(p.price)}</td>${tier}</tr>`;
}).join('\n')}
            </tbody>
          </table>
        </div>`;
}).filter(Boolean).join('\n')}
      </div>`;
}

/* ── render: produktová stránka ──────────────────────────────────────────── */
function renderBlocks(blocks) {
  if (!blocks.length) {
    return `      <div class="infoblock">
        <div class="infoblock__head"><span class="brush-label">Popis</span></div>
        <p style="font-size:var(--up-fs-body);color:var(--up-text-dim);line-height:1.6">
          Popis tejto položky pripravujeme. Analytické údaje sú v špecifikácii vyššie
          a v certifikáte analýzy.</p>
      </div>`;
  }
  return blocks.map((b) => {
    const ul = b.items.length
      ? `\n        <ul>\n${b.items.map((i) => `          <li>${esc(i)}</li>`).join('\n')}\n        </ul>`
      : '';
    const ps = b.paras.map((p) =>
      `\n        <p style="font-size:var(--up-fs-body);color:var(--up-text-dim);line-height:1.6;margin:0">${esc(p)}</p>`).join('');
    return `      <div class="infoblock">
        <div class="infoblock__head"><span class="brush-label">${esc(b.title)}</span></div>${ul}${ps}
      </div>`;
  }).join('\n\n');
}

function renderRelated(p) {
  // rovnaká kategória, potom doplnok podľa poradia v katalógu
  const same = products.filter((x) => x.category === p.category && x.slug !== p.slug);
  const rest = products.filter((x) => x.category !== p.category && x.slug !== p.slug);
  return [...same, ...rest].slice(0, 4).map((x) => card(x)).join('\n');
}

function renderProductPage(tpl, p, pricelist) {
  const { perex, blocks } = loadContent(p.slug);
  const st = STOCK[p.stock] ?? STOCK.in;
  const saving = p.tier !== null ? (p.price - p.tier) * 3 : 0;
  const map = {
    NAME: esc(p.name),
    MG: esc(p.mg || '—'),
    MG_CHIP: p.mg ? `<span class="chip">${esc(p.mg)}</span>` : '',
    TITLE: esc(p.name + (p.mg ? ' ' + p.mg : '')),
    SLUG: p.slug,
    REFERENCE: esc(p.reference),
    FORM: esc(p.form || '—'),
    PEREX: esc(perex || `${p.name}${p.mg ? ', ' + p.mg : ''}. Referenčná látka na laboratórne a výskumné použitie.`),
    CAT_SLUG: p.category,
    CAT_NAME: esc(catName(p.category)),
    CAT_ICON: catIcon(p.category),
    PURITY: p.purity ? `${String(p.purity).replace('.', ',')} %` : 'viď certifikát',
    PURITY_ROW: p.purity
      ? `<span class="coa-badge"><svg fill="none" stroke-width="1.5"><use href="#i-micro"/></svg> Čistota ${String(p.purity).replace('.', ',')} % <a href="#coa">COA ↓</a></span>`
      : `<span class="coa-badge"><svg fill="none" stroke-width="1.5"><use href="#i-micro"/></svg> <a href="#coa">Certifikát analýzy ↓</a></span>`,
    BATCH: esc(p.batch || '—'),
    STOCK_CLS: st.cls,
    STOCK_LABEL: st.label,
    PRICE1: eurFull(p.price),
    PRICE1_NUM: String(p.price),
    PRICE3: p.tier !== null ? eurFull(p.tier) : '–',
    PRICE3_NUM: String(p.tier ?? p.price),
    PRICE3_STYLE: p.tier !== null ? '' : ' style="color:var(--up-text-mute)"',
    VIAL_NAME_CLASS: vialNameClass(p.name),
    BLOCKS: renderBlocks(blocks),
    RELATED: renderRelated(p),
    PRICELIST: pricelist,
    SAVING_NOTE: saving > 0
      ? `Pri 3 kusoch ušetríš ${eurFull(saving)}.`
      : 'Pri tejto položke nie je stanovená množstevná cena.',
  };
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in map ? map[k] : m));
}

/* ── injektovanie do existujúcich stránok ────────────────────────────────── */
function inject(html, key, content) {
  const re = new RegExp(`(<!-- GEN:${key} -->)[\\s\\S]*?(<!-- /GEN:${key} -->)`);
  if (!re.test(html)) throw new Error(`V šablóne chýba značka GEN:${key}`);
  return html.replace(re, `$1\n${content}\n$2`);
}

/* ── beh ─────────────────────────────────────────────────────────────────── */
const pricelist = renderPricelist();
const written = [];

function write(path, content) {
  if (!CHECK) writeFileSync(path, content, 'utf8');
  written.push(path.replace(ROOT + '\\', '').replace(ROOT + '/', '').replace(/\\/g, '/'));
}

// 1) index.html
let index = readFileSync(join(SITE, 'index.html'), 'utf8');
index = inject(index, 'kategorie', renderChips());
index = inject(index, 'featured', renderFeatured());
index = inject(index, 'cennik', pricelist);
write(join(SITE, 'index.html'), index);

// 2) katalog.html
let katalog = readFileSync(join(SITE, 'katalog.html'), 'utf8');
katalog = inject(katalog, 'katalog', renderCatalogue());
katalog = inject(katalog, 'cennik', pricelist);
write(join(SITE, 'katalog.html'), katalog);

// 3) produktové stránky — staré najprv zmaž, aby po premenovaní slugu nezostali
const tpl = readFileSync(join(ROOT, 'templates/produkt.html'), 'utf8');
const keep = new Set(products.map((p) => `produkt-${p.slug}.html`));
for (const f of readdirSync(SITE)) {
  if (f.startsWith('produkt-') && f.endsWith('.html') && !keep.has(f)) {
    if (!CHECK) unlinkSync(join(SITE, f));
    console.log(`  – zmazané osirelé: ${f}`);
  }
}
for (const p of products) write(join(SITE, `produkt-${p.slug}.html`), renderProductPage(tpl, p, pricelist));

// 4) sitemap
const urls = ['', 'katalog.html', ...products.map((p) => `produkt-${p.slug}.html`)];
write(join(SITE, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `  <url><loc>/${u}</loc></url>`).join('\n') +
  `\n</urlset>\n`);

console.log(
  `${CHECK ? 'KONTROLA' : 'HOTOVO'}: ${categories.length} kategórií, ${products.length} produktov, ` +
  `${written.length} súborov${CHECK ? ' (nič sa nezapísalo)' : ''}`
);
