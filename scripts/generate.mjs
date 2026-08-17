#!/usr/bin/env node
/**
 * Generátor webu ULTRA PEPTIDY.
 *
 * Zdroj pravdy:
 *   data/kategorie.csv          — kategórie a ich poradie
 *   data/produkty.csv           — jeden riadok = jedna gramáž (SKU)
 *   content/produkty/<slug>.md  — popisný text produktu (voliteľné)
 *   templates/produkt.html      — šablóna produktovej stránky
 *
 * ZOSKUPOVANIE GRAMÁŽÍ
 * Riadky so **rovnakým `slug`** sú tá istá látka v rôznych silách a v katalógu
 * z nich vznikne JEDEN produkt s prepínačom gramáže. `reference` zostáva
 * jedinečná pre každú silu — je to skladová jednotka.
 *
 * Čo robí:
 *   1) doplní bloky medzi značky <!-- GEN:xxx --> … <!-- /GEN:xxx -->
 *      v site/index.html a site/katalog.html
 *   2) vygeneruje site/produkt-<slug>.html pre každý produkt
 *   3) prepíše site/sitemap.xml
 *
 * Spustenie:  node scripts/generate.mjs
 * Kontrola:   node scripts/generate.mjs --check   (nič nezapíše)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const CHECK = process.argv.includes('--check');

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const eurShort = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')) + ' €';
const eurFull  = (n) => n.toFixed(2).replace('.', ',') + ' €';

function readCsv(path) {
  const rows = readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const head = rows.shift().split(';').map((h) => h.trim());
  return rows.map((line) => {
    const cells = line.split(';');
    return Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

/* ── dáta ────────────────────────────────────────────────────────────────── */
const categories = readCsv(join(ROOT, 'data/kategorie.csv'))
  .sort((a, b) => Number(a.poradie) - Number(b.poradie));

const skus = readCsv(join(ROOT, 'data/produkty.csv'))
  .filter((r) => r.active === '1')
  .map((r) => ({
    ...r,
    price: Number(r.price_gross_eur),
    tier: r.tier3_gross_eur ? Number(r.tier3_gross_eur) : null,
  }));

/* ── zoskupenie na produkty ──────────────────────────────────────────────── */
const bySlug = new Map();
for (const s of skus) {
  if (!bySlug.has(s.slug)) bySlug.set(s.slug, []);
  bySlug.get(s.slug).push(s);
}
const products = [...bySlug.entries()].map(([slug, variants]) => {
  const first = variants[0];
  return {
    slug,
    name: first.name,
    category: first.category,
    form: first.form,
    featured: variants.some((v) => v.featured === '1'),
    variants,
    minPrice: Math.min(...variants.map((v) => v.price)),
    maxPrice: Math.max(...variants.map((v) => v.price)),
    multi: variants.length > 1,
  };
});

/* ── validácia ───────────────────────────────────────────────────────────── */
const problems = [];
const catSlugs = new Set(categories.map((c) => c.slug));
const seenRef = new Set();
for (const p of products) {
  if (!catSlugs.has(p.category)) problems.push(`${p.slug}: neznáma kategória "${p.category}"`);
  const mgs = new Set();
  for (const v of p.variants) {
    if (seenRef.has(v.reference)) problems.push(`${v.reference}: duplicitná referencia`);
    seenRef.add(v.reference);
    if (mgs.has(v.mg)) problems.push(`${p.slug}: gramáž "${v.mg}" je v skupine dvakrát`);
    mgs.add(v.mg);
    if (!Number.isFinite(v.price)) problems.push(`${v.reference}: neplatná cena`);
    if (v.tier !== null && v.tier >= v.price) problems.push(`${v.reference}: množstevná cena nie je nižšia`);
    if (v.name !== p.name) problems.push(`${v.reference}: názov sa nezhoduje so skupinou "${p.slug}"`);
    if (v.category !== p.category) problems.push(`${v.reference}: kategória sa nezhoduje so skupinou "${p.slug}"`);
  }
  if (p.multi && p.variants.some((v) => !v.mg)) {
    problems.push(`${p.slug}: skupina s viacerými silami musí mať vyplnenú gramáž v každom riadku`);
  }
}
if (problems.length) {
  console.error('CHYBY V DÁTACH:\n  ' + problems.join('\n  '));
  process.exit(1);
}

/* ── obsah z markdownu ───────────────────────────────────────────────────── */
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
      if (cur.items.length && !cur.paras.length) cur.items[cur.items.length - 1] += ' ' + line;
      else cur.paras.push(line);
    }
  }
  return { perex: perex.join(' '), blocks };
}

/* ── kúsky ───────────────────────────────────────────────────────────────── */
const STOCK = {
  in:  { cls: '', label: 'Na sklade' },
  low: { cls: ' stock-pill--low', label: 'Posledné kusy' },
  out: { cls: ' stock-pill--out', label: 'Vypredané' },
};
const stockOf = (v) => STOCK[v.stock] ?? STOCK.in;
const catIcon = (slug) => categories.find((c) => c.slug === slug)?.icon ?? 'i-drop';
const catName = (slug) => categories.find((c) => c.slug === slug)?.name ?? slug;
const vialNameClass = (name) => (name.length >= 12 ? ' vial__name--xs' : name.length >= 8 ? ' vial__name--sm' : '');

/** Zoznam síl do jedného chipu: „10 · 30 · 40 mg" */
function strengthChip(p) {
  if (!p.multi) return p.variants[0].mg ? `<span class="chip">${esc(p.variants[0].mg)}</span>` : '';
  const unit = (p.variants[0].mg.match(/[a-zA-Z]+$/) || [''])[0];
  const nums = p.variants.map((v) => v.mg.replace(/\s*[a-zA-Z]+$/, ''));
  return `<span class="chip chip--multi">${esc(nums.join(' · '))}${unit ? ' ' + esc(unit) : ''}</span>`;
}

function priceRowsGroup(p) {
  // pri viacerých silách ukáž „od" — presnú cenu si zákazník vyberie na detaile
  const v = p.variants.reduce((a, b) => (a.price <= b.price ? a : b));
  const pref = p.multi ? '<span class="price-row__from">od</span> ' : '';
  const one = `<div class="price-row"><span class="price-row__label">1 ks</span>` +
              `<span class="price-row__value">${pref}${eurFull(v.price)}</span></div>`;
  const tier = v.tier !== null
    ? `<div class="price-row price-row--tier"><span class="price-row__label">3+ ks<small>za kus</small></span>` +
      `<span class="price-row__value">${pref}${eurFull(v.tier)}</span></div>`
    : `<div class="price-row price-row--tier"><span class="price-row__label">3+ ks<small>za kus</small></span>` +
      `<span class="price-row__value" style="color:var(--up-text-mute)">–</span></div>`;
  return one + tier;
}

function card(p) {
  const href = `produkt-${p.slug}.html`;
  // stav skladu skupiny: najlepší dostupný zo variantov
  const order = ['in', 'low', 'out'];
  const best = p.variants.map((v) => v.stock).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
  const st = STOCK[best] ?? STOCK.in;
  const note = p.multi
    ? `<span class="prod-card__note">${p.variants.length} gramáže na výber</span>`
    : '';
  return `
      <article class="prod-card holo-border foil sheen">
        <a class="prod-card__media" href="${href}" aria-label="${esc(p.name)}"><span class="vial"><img class="vial__photo" src="assets/img/vial.jpg" alt="" width="306" height="812" loading="lazy" decoding="async"><span class="vial__name${vialNameClass(p.name)}">${esc(p.name)}</span></span></a>
        <div class="prod-card__body">
          <h3 class="prod-card__name"><a href="${href}">${esc(p.name)}</a></h3>${strengthChip(p)}
          <span class="stock-pill${st.cls}">${st.label}</span>${note}
          <div class="prod-card__prices price-tiers">${priceRowsGroup(p)}</div>
          <a class="btn-holo btn-block" style="padding:9px 14px;font-size:.75rem" href="${href}">Detail</a>
        </div>
      </article>`;
}

/* ── bloky do stránok ────────────────────────────────────────────────────── */
function renderChips() {
  return `    <div class="cat-nav">
${categories.map((c) => {
  const n = products.filter((p) => p.category === c.slug).length;
  return `      <a class="cat-chip" href="katalog.html#${c.slug}"><svg fill="none"><use href="#${c.icon}"/></svg><span class="cat-chip__name">${esc(c.name)}</span><span class="cat-chip__n">${n}</span></a>`;
}).join('\n')}
    </div>`;
}

function renderFeatured() {
  return `    <div class="prod-grid">${products.filter((p) => p.featured).map(card).join('\n')}
    </div>`;
}

function renderCatalogue() {
  return categories.map((c) => {
    const list = products.filter((p) => p.category === c.slug);
    if (!list.length) return '';
    const word = list.length === 1 ? 'produkt' : list.length < 5 ? 'produkty' : 'produktov';
    const sku = list.reduce((n, p) => n + p.variants.length, 0);
    const extra = sku !== list.length ? ` · ${sku} gramáží` : '';
    return `
<section class="up-section" id="${c.slug}" style="padding-top:0">
  <div class="up-container">
    <div class="section-head">
      <div style="display:flex;align-items:center;gap:var(--up-sp-3)">
        <span class="cat-tile__icon"><svg fill="none"><use href="#${c.icon}"/></svg></span>
        <div><p class="eyebrow">${list.length} ${word}${extra}</p><h2 class="section-title">${esc(c.name)}</h2></div>
      </div>
    </div>
    <div class="prod-grid">${list.map(card).join('\n')}
    </div>
  </div>
</section>`;
  }).join('\n');
}

/** Cenník zostáva po gramážach — presne tak, ako je v tlačenom cenníku. */
function renderPricelist() {
  return `      <div class="pricelist">
${categories.map((c) => {
  const list = products.filter((p) => p.category === c.slug);
  if (!list.length) return '';
  const rows = list.flatMap((p) => p.variants.map((v) => {
    const label = esc(p.name + (v.mg ? ' ' + v.mg : ''));
    const tier = v.tier !== null ? `<td class="pl-3ks">${eurShort(v.tier)}</td>` : `<td class="pl-none">–</td>`;
    return `              <tr><td><a href="produkt-${p.slug}.html">${label}</a></td><td class="pl-1ks">${eurShort(v.price)}</td>${tier}</tr>`;
  }));
  return `        <div class="pl-group">
          <div class="pl-group__head"><svg fill="none" stroke-linecap="round"><use href="#${c.icon}"/></svg><h3 class="pl-group__title">${esc(c.name)}</h3></div>
          <table class="pl-table">
            <thead><tr><th>Produkt</th><th>1 ks</th><th>3+ ks<small>za kus</small></th></tr></thead>
            <tbody>
${rows.join('\n')}
            </tbody>
          </table>
        </div>`;
}).filter(Boolean).join('\n')}
      </div>`;
}

/* ── produktová stránka ──────────────────────────────────────────────────── */
function renderBlocks(blocks) {
  if (!blocks.length) {
    return `      <div class="infoblock">
        <div class="infoblock__head"><span class="brush-label">Popis</span></div>
        <p style="font-size:var(--up-fs-body);color:var(--up-text-dim);line-height:1.6">
          Popis tejto položky pripravujeme. Analytické údaje sú v špecifikácii nižšie
          a v certifikáte analýzy.</p>
      </div>`;
  }
  return blocks.map((b) => {
    const ul = b.items.length
      ? `\n        <ul>\n${b.items.map((i) => `          <li>${esc(i)}</li>`).join('\n')}\n        </ul>`
      : '';
    const ps = b.paras.map((x) =>
      `\n        <p style="font-size:var(--up-fs-body);color:var(--up-text-dim);line-height:1.6;margin:0">${esc(x)}</p>`).join('');
    return `      <div class="infoblock">
        <div class="infoblock__head"><span class="brush-label">${esc(b.title)}</span></div>${ul}${ps}
      </div>`;
  }).join('\n\n');
}

/**
 * Prepínač gramáže. Každá voľba nesie svoje dáta v atribútoch, takže JS
 * nemusí nič dopytovať — prepne cenu, šaržu, čistotu aj sklad z DOM.
 */
function renderStrengths(p) {
  if (!p.multi) return '';
  return `
      <div class="strengths" role="radiogroup" aria-label="Gramáž aktívnej látky" data-strengths>
        <p class="strengths__label">Gramáž aktívnej látky</p>
        <div class="strengths__opts">
${p.variants.map((v, i) => {
  const st = stockOf(v);
  return `          <label class="strength${v.stock === 'out' ? ' is-out' : ''}">
            <input type="radio" name="up-strength" value="${esc(v.reference)}"${i === 0 ? ' checked' : ''}
                   ${v.stock === 'out' ? 'disabled ' : ''}data-mg="${esc(v.mg)}"
                   data-price="${v.price}" data-tier="${v.tier ?? ''}"
                   data-batch="${esc(v.batch)}" data-purity="${v.purity ? String(v.purity).replace('.', ',') + ' %' : ''}"
                   data-stock-cls="${st.cls.trim()}" data-stock-label="${esc(st.label)}"
                   data-ref="${esc(v.reference)}">
            <span>${esc(v.mg)}</span>
          </label>`;
}).join('\n')}
        </div>
      </div>`;
}

function renderRelated(p) {
  const same = products.filter((x) => x.category === p.category && x.slug !== p.slug);
  const rest = products.filter((x) => x.category !== p.category && x.slug !== p.slug);
  return [...same, ...rest].slice(0, 4).map(card).join('\n');
}

/**
 * Tabuľka zobrazuje VŠETKY gramáže naraz — je to referenčný prehľad skladových
 * jednotiek. Vybraná sila sa len zvýrazní, ostatné sa neskrývajú: zákazník tak
 * na jednom mieste vidí ceny, šarže aj čistoty všetkých síl.
 */
function renderSpecRows(p) {
  return p.variants.map((v, i) => `        <tr data-spec-ref="${esc(v.reference)}"${i === 0 ? ' class="is-active"' : ''}>
          <th scope="row">${esc(v.mg || '—')}</th>
          <td>${esc(v.reference)}</td>
          <td>šarža ${esc(v.batch || '—')}</td>
          <td>${v.purity ? esc(String(v.purity).replace('.', ',')) + ' %' : '—'}</td>
          <td class="num">${eurShort(v.price)}</td>
          <td class="num${v.tier !== null ? ' tier' : ''}">${v.tier !== null ? eurShort(v.tier) : '–'}</td>
        </tr>`).join('\n');
}

function renderProductPage(tpl, p, pricelist) {
  const { perex, blocks } = loadContent(p.slug);
  const v0 = p.variants[0];
  const st = stockOf(v0);
  const saving = v0.tier !== null ? (v0.price - v0.tier) * 3 : 0;
  const title = p.name + (p.multi ? '' : v0.mg ? ' ' + v0.mg : '');

  const map = {
    NAME: esc(p.name),
    TITLE: esc(title),
    MG: esc(v0.mg || '—'),
    MG_CHIP: v0.mg ? `<span class="chip" data-chip-mg>${esc(v0.mg)}</span>` : '',
    SLUG: p.slug,
    REFERENCE: esc(v0.reference),
    FORM: esc(p.form || '—'),
    PEREX: esc(perex || `${p.name}. Referenčná látka na laboratórne a výskumné použitie.`),
    CAT_SLUG: p.category,
    CAT_NAME: esc(catName(p.category)),
    CAT_ICON: catIcon(p.category),
    PURITY: v0.purity ? `${String(v0.purity).replace('.', ',')} %` : 'viď certifikát',
    PURITY_ROW: v0.purity
      ? `<span class="coa-badge"><svg fill="none" stroke-width="1.5"><use href="#i-micro"/></svg> Čistota <span data-purity>${String(v0.purity).replace('.', ',')} %</span> <a href="#coa">COA ↓</a></span>`
      : `<span class="coa-badge"><svg fill="none" stroke-width="1.5"><use href="#i-micro"/></svg> <a href="#coa">Certifikát analýzy ↓</a></span>`,
    BATCH: esc(v0.batch || '—'),
    STOCK_CLS: st.cls,
    STOCK_LABEL: st.label,
    STRENGTHS: renderStrengths(p),
    SPEC_ROWS: renderSpecRows(p),
    SPEC_CAPTION: p.multi
      ? `Dostupné gramáže (${p.variants.length})`
      : 'Skladová jednotka',
    PRICE1: eurFull(v0.price),
    PRICE1_NUM: String(v0.price),
    PRICE3: v0.tier !== null ? eurFull(v0.tier) : '–',
    PRICE3_NUM: String(v0.tier ?? v0.price),
    PRICE3_STYLE: v0.tier !== null ? '' : ' style="color:var(--up-text-mute)"',
    VIAL_NAME_CLASS: vialNameClass(p.name),
    BLOCKS: renderBlocks(blocks),
    RELATED: renderRelated(p),
    PRICELIST: pricelist,
    SAVING_NOTE: saving > 0 ? `Pri 3 kusoch ušetríš ${eurFull(saving)}.` : 'Pri tejto položke nie je stanovená množstevná cena.',
  };
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in map ? map[k] : m));
}

/* ── injektovanie ────────────────────────────────────────────────────────── */
function inject(html, key, content) {
  const re = new RegExp(`(<!-- GEN:${key} -->)[\\s\\S]*?(<!-- /GEN:${key} -->)`);
  if (!re.test(html)) throw new Error(`V šablóne chýba značka GEN:${key}`);
  return html.replace(re, `$1\n${content}\n$2`);
}

/* ── beh ─────────────────────────────────────────────────────────────────── */
const pricelist = renderPricelist();
const written = [];
const write = (path, content) => {
  if (!CHECK) writeFileSync(path, content, 'utf8');
  written.push(path);
};

let index = readFileSync(join(SITE, 'index.html'), 'utf8');
index = inject(index, 'kategorie', renderChips());
index = inject(index, 'featured', renderFeatured());
index = inject(index, 'cennik', pricelist);
write(join(SITE, 'index.html'), index);

let katalog = readFileSync(join(SITE, 'katalog.html'), 'utf8');
katalog = inject(katalog, 'katalog', renderCatalogue());
katalog = inject(katalog, 'cennik', pricelist);
write(join(SITE, 'katalog.html'), katalog);

const tpl = readFileSync(join(ROOT, 'templates/produkt.html'), 'utf8');
const keep = new Set(products.map((p) => `produkt-${p.slug}.html`));
for (const f of readdirSync(SITE)) {
  if (f.startsWith('produkt-') && f.endsWith('.html') && !keep.has(f)) {
    if (!CHECK) unlinkSync(join(SITE, f));
    console.log(`  – zmazané osirelé: ${f}`);
  }
}
for (const p of products) write(join(SITE, `produkt-${p.slug}.html`), renderProductPage(tpl, p, pricelist));

const urls = ['', 'katalog.html', ...products.map((p) => `produkt-${p.slug}.html`)];
write(join(SITE, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `  <url><loc>/${u}</loc></url>`).join('\n') + `\n</urlset>\n`);

const multi = products.filter((p) => p.multi);
console.log(
  `${CHECK ? 'KONTROLA' : 'HOTOVO'}: ${categories.length} kategórií, ${products.length} produktov ` +
  `(${skus.length} gramáží), z toho ${multi.length} s prepínačom sily, ${written.length} súborov` +
  `${CHECK ? ' (nič sa nezapísalo)' : ''}`
);
