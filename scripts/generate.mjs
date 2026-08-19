#!/usr/bin/env node
/**
 * Generátor webu ULTRA PEPTIDY — dvojjazyčný.
 *
 * Zdroj pravdy:
 *   data/kategorie.csv             — kategórie, ich poradie a názvy v oboch jazykoch
 *   data/produkty.csv              — jeden riadok = jedna gramáž (SKU)
 *   data/i18n/<jazyk>.json         — všetky texty rozhrania, adresy stránok, formát ceny
 *   data/site.json                 — adresa webu (kým je prázdna, sitemap je relatívna)
 *   content/produkty/<slug>.md     — popis produktu po slovensky
 *   content/en/produkty/<slug>.md  — ten istý popis po anglicky
 *   content/stranky/*.md           — právne a informačné stránky (rovnako pre en/)
 *   templates/*.html               — šablóny bez jediného natvrdo napísaného textu
 *
 * ZOSKUPOVANIE GRAMÁŽÍ
 * Riadky so **rovnakým `slug`** sú tá istá látka v rôznych silách a v katalógu
 * z nich vznikne JEDEN produkt s prepínačom gramáže. `reference` zostáva
 * jedinečná pre každú silu — je to skladová jednotka.
 *
 * JAZYKY
 * Slovenčina ide do koreňa `site/`, angličtina do `site/en/`. Dáta sú spoločné,
 * líšia sa len texty, názvy súborov a formát čísla. Nový jazyk = nový JSON
 * v data/i18n + preložený obsah; v šablónach sa nemení nič.
 *
 * Spustenie:  node scripts/generate.mjs
 * Kontrola:   node scripts/generate.mjs --check   (nič nezapíše)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const CHECK = process.argv.includes('--check');

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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

const SITE_URL = (() => {
  const f = join(ROOT, 'data/site.json');
  if (!existsSync(f)) return '';
  return (JSON.parse(readFileSync(f, 'utf8')).url ?? '').replace(/\/+$/, '');
})();

const LOCALES = readdirSync(join(ROOT, 'data/i18n'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(ROOT, 'data/i18n', f), 'utf8')))
  // slovenčina je primárna, ide do koreňa
  .sort((a, b) => (a.dir === '' ? -1 : b.dir === '' ? 1 : a.lang.localeCompare(b.lang)));

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

/* Povolené varianty fľaštičky. Preklep v stĺpci 'vial' by inak vygeneroval
   triedu, ktorú CSS nepozná, a fľaštička by ticho vyzerala ako peptidová. */
const VIAL_VARIANTS = new Set(['voda']);

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
    if (v.vial && !VIAL_VARIANTS.has(v.vial)) problems.push(`${v.reference}: neznámy variant fľaštičky "${v.vial}"`);
    if ((v.vial ?? '') !== (p.variants[0].vial ?? '')) problems.push(`${v.reference}: variant fľaštičky sa nezhoduje so skupinou "${p.slug}"`);
  }
  if (p.multi && p.variants.some((v) => !v.mg)) {
    problems.push(`${p.slug}: skupina s viacerými silami musí mať vyplnenú gramáž v každom riadku`);
  }
}
for (const c of categories) {
  for (const L of LOCALES) {
    if (!c[L.categoryField]) problems.push(`kategória "${c.slug}": chýba stĺpec ${L.categoryField}`);
  }
}
if (problems.length) {
  console.error('CHYBY V DÁTACH:\n  ' + problems.join('\n  '));
  process.exit(1);
}

/* ── inline formátovanie v texte ─────────────────────────────────────────
   Zámerne minimum: tučné, odkaz a kód. Nič viac právne stránky nepotrebujú
   a každá ďalšia značka je ďalšie miesto, kde sa dá pokaziť escapovanie.
   Poradie je dôležité — najprv escapujeme, až potom vkladáme značky. */
function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, href) =>
      `<a href="${href}">${label}</a>`);
}

/* ── stránky (právne dokumenty a informácie) ─────────────────────────────
   Metadáta sú riadky `:: kľúč: hodnota` na začiatku súboru. */
function readPages(contentDir) {
  const dir = join(ROOT, contentDir, 'stranky');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => {
      const slug = f.replace(/\.md$/, '');
      const src = readFileSync(join(dir, f), 'utf8');
      const meta = {};
      const body = [];
      for (const raw of src.split(/\r?\n/)) {
        const m = raw.match(/^::\s*(\w+):\s*(.*)$/);
        if (m) meta[m[1]] = m[2].trim();
        else body.push(raw);
      }
      return { slug, meta, body: body.join('\n') };
    })
    .sort((a, b) => Number(a.meta.order ?? 99) - Number(b.meta.order ?? 99));
}

/**
 * Telo stránky. Podporuje ##, ###, odrážky, odstavce, markdown tabuľky
 * a bloky ```…``` (tie sa nechávajú doslovne, používajú sa na vzorové formuláre).
 */
function renderPageBody(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let list = null;      // otvorený <ul>
  let table = null;     // { head: [], rows: [][] }
  let code = null;      // otvorený blok kódu

  const closeList = () => { if (list) { out.push(`    <ul>\n${list.join('\n')}\n    </ul>`); list = null; } };
  const closeTable = () => {
    if (!table) return;
    out.push(
      `    <div class="legal__tablewrap"><table class="legal__table">\n` +
      `      <thead><tr>${table.head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead>\n` +
      `      <tbody>\n${table.rows.map((r) =>
        `        <tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('\n')}\n` +
      `      </tbody>\n    </table></div>`
    );
    table = null;
  };
  const closeAll = () => { closeList(); closeTable(); };

  for (const raw of lines) {
    const line = raw.trim();

    if (line.startsWith('```')) {
      if (code) { out.push(`    <pre class="legal__pre">${esc(code.join('\n'))}</pre>`); code = null; }
      else { closeAll(); code = []; }
      continue;
    }
    if (code) { code.push(raw); continue; }

    if (!line) { closeAll(); continue; }

    // tabuľka: | a | b |   (oddeľovací riadok |---|---| sa zahodí)
    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line.slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      closeList();
      if (!table) table = { head: cells, rows: [] };
      else table.rows.push(cells);
      continue;
    }
    closeTable();

    if (line.startsWith('### ')) {
      closeList();
      out.push(`    <h3>${inline(line.slice(4))}</h3>`);
    } else if (line.startsWith('## ')) {
      closeList();
      // podpora {#anchor} na konci nadpisu
      const m = line.slice(3).match(/^(.*?)\s*\{#([\w-]+)\}$/);
      const [txt, id] = m ? [m[1], m[2]] : [line.slice(3), null];
      out.push(`    <h2${id ? ` id="${id}"` : ''}>${inline(txt)}</h2>`);
    } else if (line.startsWith('- ')) {
      if (!list) list = [];
      list.push(`      <li>${inline(line.slice(2))}</li>`);
    } else if (list) {
      // pokračovanie zalomenej odrážky
      list[list.length - 1] = list[list.length - 1].replace(/<\/li>$/, ' ' + inline(line) + '</li>');
    } else {
      out.push(`    <p>${inline(line)}</p>`);
    }
  }
  closeAll();
  if (code) out.push(`    <pre class="legal__pre">${esc(code.join('\n'))}</pre>`);

  return out.join('\n');
}

/* ── obsah z markdownu ───────────────────────────────────────────────────── */
function loadContent(contentDir, slug) {
  const file = join(ROOT, contentDir, 'produkty', `${slug}.md`);
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

/* ── vzhľad nezávislý od jazyka ──────────────────────────────────────────── */
const catIcon = (slug) => categories.find((c) => c.slug === slug)?.icon ?? 'i-drop';
const vialNameClass = (name) => (name.length >= 12 ? ' vial__name--xs' : name.length >= 8 ? ' vial__name--sm' : '');

/** Variant fľaštičky zo stĺpca 'vial'. Prázdne = štandardná peptidová fotka. */
const vialVariant = (p) => {
  const v = (p.variants[0].vial ?? '').trim();
  return v ? ' vial--' + v : '';
};

/* ══════════════════════════════════════════════════════════════════════════
   VYKRESLENIE JEDNEJ JAZYKOVEJ MUTÁCIE
   Všetko, čo závisí od jazyka, je vnútri. Von ide len zoznam zapísaných
   súborov — dáta sa nikde nekopírujú, len sa inak popíšu.
   ══════════════════════════════════════════════════════════════════════════ */
function buildLocale(L, written) {
  const t = (key, vars) => {
    let s = L.strings[key];
    if (s === undefined) throw new Error(`${L.lang}: chýba reťazec "${key}"`);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
    return s;
  };
  const dec = (s) => (L.decimal === ',' ? s : s.replace(',', '.'));
  const eurShort = (n) => dec(Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')) + ' €';
  const eurFull  = (n) => dec(n.toFixed(2).replace('.', ',')) + ' €';
  const num = (n) => dec(String(n).replace('.', ','));

  const A = L.assets;
  const R = L.routes;
  const productUrl = (slug) => `${R.product}${slug}.html`;
  const catName = (slug) => categories.find((c) => c.slug === slug)?.[L.categoryField] ?? slug;

  const STOCK = {
    in:  { cls: '', label: t('STOCK_IN') },
    low: { cls: ' stock-pill--low', label: t('STOCK_LOW') },
    out: { cls: ' stock-pill--out', label: t('STOCK_OUT') },
  };
  const stockOf = (v) => STOCK[v.stock] ?? STOCK.in;

  const pages = readPages(L.content);
  const termsPage = pages.find((p) => p.meta.id === 'terms') ?? pages[0];
  const U_TERMS = termsPage ? `${termsPage.slug}.html` : R.home;

  /* ── prepínač jazyka ─────────────────────────────────────────────────────
     Odkaz smeruje na ten istý dokument v druhom jazyku, nie na domovskú
     stránku — inak by prepnutie jazyka znamenalo stratu miesta v katalógu. */
  const hop = (to) => (L.dir === to.dir ? '' : L.dir ? '../' : `${to.dir}/`);
  const langSwitch = (altFor) => LOCALES
    .filter((o) => o.lang !== L.lang)
    .map((o) => {
      const href = hop(o) + altFor(o);
      return `<a class="lang-switch__opt" href="${href}" hreflang="${o.lang}" lang="${o.lang}">${o.lang.toUpperCase()}</a>`;
    })
    .join('');
  const switcher = (altFor) =>
    `<div class="lang-switch" role="group" aria-label="${esc(t('LANG_SWITCH_ARIA'))}">` +
    `<span class="lang-switch__cur" aria-current="true">${L.lang.toUpperCase()}</span>${langSwitch(altFor)}</div>`;

  /* ── kúsky katalógu ──────────────────────────────────────────────────────── */
  function strengthChip(p) {
    if (!p.multi) return p.variants[0].mg ? `<span class="chip">${esc(p.variants[0].mg)}</span>` : '';
    const unit = (p.variants[0].mg.match(/[a-zA-Z]+$/) || [''])[0];
    const nums = p.variants.map((v) => v.mg.replace(/\s*[a-zA-Z]+$/, ''));
    return `<span class="chip chip--multi">${esc(nums.join(' · '))}${unit ? ' ' + esc(unit) : ''}</span>`;
  }

  function priceRowsGroup(p) {
    // pri viacerých silách ukáž „od" — presnú cenu si zákazník vyberie na detaile
    const v = p.variants.reduce((a, b) => (a.price <= b.price ? a : b));
    const pref = p.multi ? `<span class="price-row__from">${esc(t('PL_FROM'))}</span> ` : '';
    const one = `<div class="price-row"><span class="price-row__label">${esc(t('PL_TH_ONE'))}</span>` +
                `<span class="price-row__value">${pref}${eurFull(v.price)}</span></div>`;
    const tierLabel = `<span class="price-row__label">${esc(t('PL_TH_TIER'))}<small>${esc(t('PL_TH_EACH'))}</small></span>`;
    const tier = v.tier !== null
      ? `<div class="price-row price-row--tier">${tierLabel}` +
        `<span class="price-row__value">${pref}${eurFull(v.tier)}</span></div>`
      : `<div class="price-row price-row--tier">${tierLabel}` +
        `<span class="price-row__value" style="color:var(--up-text-mute)">–</span></div>`;
    return one + tier;
  }

  function card(p) {
    const href = productUrl(p.slug);
    // stav skladu skupiny: najlepší dostupný zo variantov
    const order = ['in', 'low', 'out'];
    const best = p.variants.map((v) => v.stock).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
    const st = STOCK[best] ?? STOCK.in;
    const note = p.multi
      ? `<span class="prod-card__note">${esc(t('CARD_STRENGTHS', { n: p.variants.length }))}</span>`
      : '';
    return `
      <article class="prod-card holo-border foil sheen">
        <a class="prod-card__media" href="${href}" aria-label="${esc(p.name)}"><span class="vial${vialVariant(p)}"><img class="vial__photo" src="${A}img/vial.jpg" alt="" width="306" height="812" loading="lazy" decoding="async"><span class="vial__name${vialNameClass(p.name)}">${esc(p.name)}</span></span></a>
        <div class="prod-card__body">
          <h3 class="prod-card__name"><a href="${href}">${esc(p.name)}</a></h3>${strengthChip(p)}
          <span class="stock-pill${st.cls}">${st.label}</span>${note}
          <div class="prod-card__prices price-tiers">${priceRowsGroup(p)}</div>
          <a class="btn-holo btn-block" style="padding:9px 14px;font-size:.75rem" href="${href}">${esc(t('CARD_DETAIL'))}</a>
        </div>
      </article>`;
  }

  /* ── bloky do stránok ────────────────────────────────────────────────────── */
  const renderChips = () => `    <div class="cat-nav">
${categories.map((c) => {
  const n = products.filter((p) => p.category === c.slug).length;
  return `      <a class="cat-chip" href="${R.catalog}#${c.slug}"><svg fill="none"><use href="#${c.icon}"/></svg><span class="cat-chip__name">${esc(catName(c.slug))}</span><span class="cat-chip__n">${n}</span></a>`;
}).join('\n')}
    </div>`;

  const renderFeatured = () => `    <div class="prod-grid">${products.filter((p) => p.featured).map(card).join('\n')}
    </div>`;

  /** Slovenčina skloňuje počet, angličtina nie — obe vetvy idú cez ten istý kľúč. */
  const countWord = (n) => t(n === 1 ? 'CAT_COUNT_ONE' : n < 5 ? 'CAT_COUNT_FEW' : 'CAT_COUNT_MANY', { n });

  const renderCatalogue = () => categories.map((c) => {
    const list = products.filter((p) => p.category === c.slug);
    if (!list.length) return '';
    const sku = list.reduce((n, p) => n + p.variants.length, 0);
    const extra = sku !== list.length ? ` · ${esc(t('CAT_SKUS', { n: sku }))}` : '';
    return `
<section class="up-section" id="${c.slug}" style="padding-top:0">
  <div class="up-container">
    <div class="section-head">
      <div style="display:flex;align-items:center;gap:var(--up-sp-3)">
        <span class="cat-tile__icon"><svg fill="none"><use href="#${c.icon}"/></svg></span>
        <div><p class="eyebrow">${esc(countWord(list.length))}${extra}</p><h2 class="section-title">${esc(catName(c.slug))}</h2></div>
      </div>
    </div>
    <div class="prod-grid">${list.map(card).join('\n')}
    </div>
  </div>
</section>`;
  }).join('\n');

  /** Cenník zostáva po gramážach — presne tak, ako je v tlačenom cenníku. */
  const renderPricelist = () => `      <div class="pricelist">
${categories.map((c) => {
  const list = products.filter((p) => p.category === c.slug);
  if (!list.length) return '';
  const rows = list.flatMap((p) => p.variants.map((v) => {
    const label = esc(p.name + (v.mg ? ' ' + v.mg : ''));
    const tier = v.tier !== null ? `<td class="pl-3ks">${eurShort(v.tier)}</td>` : `<td class="pl-none">–</td>`;
    return `              <tr><td><a href="${productUrl(p.slug)}">${label}</a></td><td class="pl-1ks">${eurShort(v.price)}</td>${tier}</tr>`;
  }));
  return `        <div class="pl-group">
          <div class="pl-group__head"><svg fill="none" stroke-linecap="round"><use href="#${c.icon}"/></svg><h3 class="pl-group__title">${esc(catName(c.slug))}</h3></div>
          <table class="pl-table">
            <thead><tr><th>${esc(t('PL_TH_PRODUCT'))}</th><th>${esc(t('PL_TH_ONE'))}</th><th>${esc(t('PL_TH_TIER'))}<small>${esc(t('PL_TH_EACH'))}</small></th></tr></thead>
            <tbody>
${rows.join('\n')}
            </tbody>
          </table>
        </div>`;
}).filter(Boolean).join('\n')}
      </div>`;

  /* ── produktová stránka ──────────────────────────────────────────────────── */
  function renderBlocks(blocks) {
    if (!blocks.length) {
      return `      <div class="infoblock">
        <div class="infoblock__head"><span class="brush-label">${esc(t('DESC_FALLBACK_TITLE'))}</span></div>
        <p style="font-size:var(--up-fs-body);color:var(--up-text-dim);line-height:1.6">
          ${esc(t('DESC_FALLBACK_BODY'))}</p>
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
      <div class="strengths" role="radiogroup" aria-label="${esc(t('STRENGTH_LABEL'))}" data-strengths>
        <p class="strengths__label">${esc(t('STRENGTH_LABEL'))}</p>
        <div class="strengths__opts">
${p.variants.map((v, i) => {
  const st = stockOf(v);
  return `          <label class="strength${v.stock === 'out' ? ' is-out' : ''}">
            <input type="radio" name="up-strength" value="${esc(v.reference)}"${i === 0 ? ' checked' : ''}
                   ${v.stock === 'out' ? 'disabled ' : ''}data-mg="${esc(v.mg)}"
                   data-price="${v.price}" data-tier="${v.tier ?? ''}"
                   data-batch="${esc(v.batch)}" data-purity="${v.purity ? num(v.purity) + ' %' : ''}"
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
   * jednotiek. Vybraná sila sa len zvýrazní, ostatné sa neskrývajú.
   */
  function renderSpecRows(p) {
    return p.variants.map((v, i) => `        <tr data-spec-ref="${esc(v.reference)}"${i === 0 ? ' class="is-active"' : ''}>
          <th scope="row">${esc(v.mg || '—')}</th>
          <td>${esc(v.reference)}</td>
          <td>${esc(t('BATCH').toLowerCase())} ${esc(v.batch || '—')}</td>
          <td>${v.purity ? num(v.purity) + ' %' : '—'}</td>
          <td class="num">${eurShort(v.price)}</td>
          <td class="num${v.tier !== null ? ' tier' : ''}">${v.tier !== null ? eurShort(v.tier) : '–'}</td>
        </tr>`).join('\n');
  }

  /* ── navigácia v pätičke ─────────────────────────────────────────────────── */
  const navList = (kind) => pages
    .filter((p) => (p.meta.nav ?? 'info') === kind)
    .map((p) => `          <li><a href="${p.slug}.html">${esc(p.meta.title)}</a></li>`)
    .join('\n');
  const NAV_INFO = [
    `          <li><a href="${R.catalog}#cennik" data-open-cennik>${esc(t('NAV_PRICELIST'))}</a></li>`,
    navList('info'),
    `          <li><a href="${R.home}#faq">${esc(t('FOOT_FAQ'))}</a></li>`,
  ].filter(Boolean).join('\n');
  const NAV_LEGAL = navList('legal');
  const NAV_CATS = categories
    .map((c) => `          <li><a href="${R.catalog}#${c.slug}">${esc(catName(c.slug))}</a></li>`)
    .join('\n');

  /* ── spoločné hodnoty pre každú šablónu ──────────────────────────────────── */
  const pricelist = renderPricelist();
  const base = {
    LANG: L.lang,
    A,
    U_HOME: R.home,
    U_CATALOG: R.catalog,
    U_CART: R.cart,
    U_PRODUCT: R.product,
    U_TERMS,
    NAV_INFO, NAV_LEGAL, NAV_CATS,
    PRICELIST: pricelist,
  };
  const strings = Object.fromEntries(
    Object.entries(L.strings).map(([k, v]) => [`T_${k}`, v])
  );

  const fill = (tpl, map) => tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    const all = { ...strings, ...base, ...map };
    return k in all ? all[k] : m;
  });

  const tpl = (name) => readFileSync(join(ROOT, 'templates', name), 'utf8');
  const outDir = L.dir ? join(SITE, L.dir) : SITE;
  if (!CHECK && L.dir && !existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const write = (file, content) => {
    if (!CHECK) writeFileSync(join(outDir, file), content, 'utf8');
    written.push(join(L.dir || '.', file));
  };

  const counts = { skus: skus.length, cats: categories.length, products: products.length };

  /* ── domovská stránka ────────────────────────────────────────────────────── */
  write(R.home, fill(tpl('index.html'), {
    CATEGORIES: renderChips(),
    FEATURED: renderFeatured(),
    LANG_SWITCH: switcher((o) => o.routes.home),
    T_HOME_DESC: t('HOME_DESC', counts),
    T_HOME_CATS_EYEBROW: t('HOME_CATS_EYEBROW', counts),
    T_HERO_FACT3: t('HERO_FACT3', counts),
    T_HOME_ALL: t('HOME_ALL', counts),
  }));

  /* ── katalóg ─────────────────────────────────────────────────────────────── */
  write(R.catalog, fill(tpl('katalog.html'), {
    CATALOGUE: renderCatalogue(),
    LANG_SWITCH: switcher((o) => o.routes.catalog),
    T_CATALOG_DESC: t('CATALOG_DESC', counts),
    T_CATALOG_EYEBROW: t('CATALOG_EYEBROW', counts),
  }));

  /* ── produktové stránky ──────────────────────────────────────────────────── */
  const productTpl = tpl('produkt.html');
  const keep = new Set(products.map((p) => productUrl(p.slug)));
  for (const f of (existsSync(outDir) ? readdirSync(outDir) : [])) {
    if (f.startsWith(R.product) && f.endsWith('.html') && !keep.has(f)) {
      if (!CHECK) unlinkSync(join(outDir, f));
      console.log(`  – zmazané osirelé: ${join(L.dir || '.', f)}`);
    }
  }
  for (const p of products) {
    const { perex, blocks } = loadContent(L.content, p.slug);
    const v0 = p.variants[0];
    const st = stockOf(v0);
    const saving = v0.tier !== null ? (v0.price - v0.tier) * 3 : 0;
    const title = p.name + (p.multi ? '' : v0.mg ? ' ' + v0.mg : '');
    const purityTxt = v0.purity ? `${num(v0.purity)} %` : t('PURITY_SEE_COA');

    write(productUrl(p.slug), fill(productTpl, {
      NAME: esc(p.name),
      TITLE: esc(title),
      MG: esc(v0.mg || '—'),
      MG_RAW: esc(v0.mg || ''),
      MG_CHIP: v0.mg ? `<span class="chip" data-chip-mg>${esc(v0.mg)}</span>` : '',
      SLUG: p.slug,
      REFERENCE: esc(v0.reference),
      FORM: esc(L.strings[`FORM_${p.form}`] ?? p.form ?? '—'),
      PEREX: esc(perex || t('PEREX_FALLBACK', { name: p.name })),
      CAT_SLUG: p.category,
      CAT_NAME: esc(catName(p.category)),
      CAT_ICON: catIcon(p.category),
      PURITY: purityTxt,
      PURITY_ROW: v0.purity
        ? `<span class="coa-badge"><svg fill="none" stroke-width="1.5"><use href="#i-micro"/></svg> ${esc(t('PURITY'))} <span data-purity>${num(v0.purity)} %</span> <a href="#coa">${esc(t('COA_LINK'))}</a></span>`
        : `<span class="coa-badge"><svg fill="none" stroke-width="1.5"><use href="#i-micro"/></svg> <a href="#coa">${esc(t('COA_LINK_LONG'))}</a></span>`,
      BATCH: esc(v0.batch || '—'),
      STOCK_CLS: st.cls,
      STOCK_LABEL: st.label,
      STRENGTHS: renderStrengths(p),
      SPEC_ROWS: renderSpecRows(p),
      SPEC_CAPTION: p.multi
        ? t('SPEC_CAPTION_MULTI', { n: p.variants.length })
        : t('SPEC_CAPTION_ONE'),
      PRICE1: eurFull(v0.price),
      PRICE1_NUM: String(v0.price),
      PRICE3: v0.tier !== null ? eurFull(v0.tier) : '–',
      PRICE3_NUM: String(v0.tier ?? v0.price),
      PRICE3_STYLE: v0.tier !== null ? '' : ' style="color:var(--up-text-mute)"',
      VIAL_NAME_CLASS: vialNameClass(p.name),
      VIAL_CLASS: vialVariant(p),
      BLOCKS: renderBlocks(blocks),
      RELATED: renderRelated(p),
      LANG_SWITCH: switcher((o) => `${o.routes.product}${p.slug}.html`),
      T_SAVING_NOTE: saving > 0 ? t('SAVING_NOTE', { amount: eurFull(saving) }) : t('SAVING_NONE'),
      SAVING_NOTE: saving > 0 ? t('SAVING_NOTE', { amount: eurFull(saving) }) : t('SAVING_NONE'),
    }));
  }

  /* ── právne a informačné stránky ─────────────────────────────────────────── */
  const pageTpl = tpl('stranka.html');
  for (const pg of pages) {
    write(`${pg.slug}.html`, fill(pageTpl, {
      TITLE: esc(pg.meta.title ?? pg.slug),
      EYEBROW: esc(pg.meta.eyebrow ?? t('FOOT_INFO')),
      PEREX: esc(pg.meta.perex ?? ''),
      UPDATED: esc(pg.meta.updated ?? ''),
      ROBOTS: esc(pg.meta.robots ?? 'index,follow'),
      BODY: renderPageBody(pg.body),
      LANG_SWITCH: switcher((o) => `${pg.meta.alt || pg.slug}.html`),
    }));
  }

  /* ── košík ───────────────────────────────────────────────────────────────── */
  write(R.cart, fill(tpl('kosik.html'), {
    LANG_SWITCH: switcher((o) => o.routes.cart),
    T_CART_DISCLAIMER: t('CART_DISCLAIMER', { terms: U_TERMS }),
  }));

  /* ── 404 ─────────────────────────────────────────────────────────────────── */
  write('404.html', fill(tpl('404.html'), { LANG_SWITCH: '' }));

  /* Apache berie ErrorDocument z koreňa, takže bez tohto by anglická vetva
     dostala slovenskú 404. Dve riadky, ale inak je celá stránka nedostupná. */
  if (L.dir) write('.htaccess', `ErrorDocument 404 /${L.dir}/404.html
ErrorDocument 403 /${L.dir}/404.html
`);

  return { pages, routes: R, dir: L.dir };
}

/* ══ beh ═══════════════════════════════════════════════════════════════════ */
const written = [];
const built = LOCALES.map((L) => buildLocale(L, written));

/* ── sitemap ─────────────────────────────────────────────────────────────────
   Kým `data/site.json` nemá adresu, sú <loc> relatívne. Protokol sitemáp
   vyžaduje absolútne URL, takže bez domény ju vyhľadávače odmietnu — je to
   zámerné pripomenutie, nie prehliadnutie. */
const urls = built.flatMap((b) => {
  const pre = b.dir ? `${b.dir}/` : '';
  return [
    pre,
    `${pre}${b.routes.catalog}`,
    `${pre}${b.routes.cart}`,
    ...products.map((p) => `${pre}${b.routes.product}${p.slug}.html`),
    ...b.pages.map((p) => `${pre}${p.slug}.html`),
  ];
});
if (!CHECK) {
  writeFileSync(join(SITE, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${SITE_URL ? SITE_URL + '/' + u : '/' + u}</loc></url>`).join('\n') +
    `\n</urlset>\n`, 'utf8');
  writeFileSync(join(SITE, 'robots.txt'),
    `User-agent: *\nAllow: /\n` + (SITE_URL ? `\nSitemap: ${SITE_URL}/sitemap.xml\n` : ''), 'utf8');
}
written.push('sitemap.xml', 'robots.txt');

const multi = products.filter((p) => p.multi);
console.log(
  `${CHECK ? 'KONTROLA' : 'HOTOVO'}: ${LOCALES.map((l) => l.lang).join(' + ')} · ` +
  `${categories.length} kategórií, ${products.length} produktov ` +
  `(${skus.length} gramáží), z toho ${multi.length} s prepínačom sily, ${written.length} súborov` +
  `${CHECK ? ' (nič sa nezapísalo)' : ''}`
);
