#!/usr/bin/env node
/**
 * Zloží nasadzovací balík pre Websupport.
 *
 * Vyrobí adresár dist/ s presne tým, čo sa nahráva — nič viac:
 *
 *   dist/web-staticky/               obsah pre DocumentRoot (FTP)
 *   dist/ultrapeptidy-theme.zip      WordPress -> Vzhľad -> Témy -> Nahrať
 *   dist/ultrapeptidy-cennik.zip     WordPress -> Pluginy -> Nahrať
 *   dist/import/                     CSV pre import katalógu
 *   dist/NAHRAJ-MA.txt               postup v poradí, v akom sa má robiť
 *
 * Spustenie:  node scripts/package.mjs
 * Bez závislostí — ZIP sa skladá vlastným writerom (scripts/lib/zip.mjs).
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from './lib/zip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

/* ── čistý štart ─────────────────────────────────────────────────────────── */
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

/** Zabalí adresár do ZIP-u tak, aby bol vnútri ako podadresár (WP to čaká). */
function zipDir(srcDir, zipPath, innerName) {
  const files = [];
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      const inner = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, inner);
      else files.push({ name: `${innerName}/${inner}`, data: readFileSync(full), mtime: statSync(full).mtime });
    }
  };
  walk(srcDir, "");
  writeFileSync(zipPath, createZip(files));
  return files.length;
}

function du(p) {
  let total = 0;
  for (const f of readdirSync(p, { withFileTypes: true })) {
    const full = join(p, f.name);
    total += f.isDirectory() ? du(full) : statSync(full).size;
  }
  return total;
}
const kb = (b) => `${Math.round(b / 1024)} kB`;

/* ── 1) statický web ─────────────────────────────────────────────────────── */
const webOut = join(DIST, 'web-staticky');
cpSync(join(ROOT, 'site'), webOut, { recursive: true });
// .nojekyll je len pre GitHub Pages, na Websupporte nemá čo robiť
rmSync(join(webOut, '.nojekyll'), { force: true });
if (!existsSync(join(webOut, '.htaccess'))) {
  throw new Error('site/.htaccess chýba — bez neho nebude web komprimovaný ani zabezpečený');
}

/* ── 2) WordPress téma a plugin ──────────────────────────────────────────── */
zipDir(join(ROOT, 'wp-theme/ultrapeptidy'), join(DIST, 'ultrapeptidy-theme.zip'), 'ultrapeptidy');
zipDir(join(ROOT, 'wp-plugin/ultrapeptidy-cennik'), join(DIST, 'ultrapeptidy-cennik.zip'), 'ultrapeptidy-cennik');

/* ── 3) import katalógu ──────────────────────────────────────────────────── */
const impOut = join(DIST, 'import');
mkdirSync(impOut, { recursive: true });
for (const f of ['woocommerce-produkty.csv', 'WOOCOMMERCE.txt']) {
  const src = join(ROOT, 'export', f);
  if (!existsSync(src)) {
    throw new Error(`chýba export/${f} — spusti najprv: node scripts/export-woocommerce.mjs`);
  }
  cpSync(src, join(impOut, f));
}

/* ── 4) postup ───────────────────────────────────────────────────────────── */
const skus = readFileSync(join(ROOT, 'data/produkty.csv'), 'utf8')
  .split(/\r?\n/).filter((l) => l.trim()).length - 1;
const countHtml = (dir) => readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? countHtml(join(dir, e.name)) : e.name.endsWith('.html') ? 1 : 0), 0);
const pages = countHtml(webOut);   // vrátane jazykových podadresárov

writeFileSync(join(DIST, 'NAHRAJ-MA.txt'),
`NASADENIE NA WEBSUPPORT
=======================
Vygenerované: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}
Katalóg: ${skus} gramáží, ${pages} HTML stránok

Balík má dve časti, ktoré sa dajú nasadiť NEZÁVISLE od seba.
Odporúčam poradie A -> B, aby doména niečo ukazovala už dnes.


ČASŤ A — STATICKÝ WEB (funguje hneď, bez databázy)
--------------------------------------------------
1) FTP alebo Webová konzola vo WebAdmine
2) Nahraj CELÝ obsah adresára  web-staticky/  do DocumentRootu
   (zvyčajne  web/  alebo  public_html/ )
3) DÔLEŽITÉ: musí sa nahrať aj skrytý súbor .htaccess
   V FileZille: Server -> Vynútiť zobrazenie skrytých súborov
   Bez neho nebude kompresia, cache ani bezpečnostné hlavičky.
4) Vo WebAdmine zapni Let's Encrypt certifikát
5) Až KEĎ certifikát funguje, over web na https://
   V .htaccess je presmerovanie na HTTPS — ak certifikát nie je,
   web sa zacyklí.

Hotovo. Web beží. PHP ani databázu na toto nepotrebuješ.


ČASŤ B — E-SHOP (WordPress + WooCommerce)
-----------------------------------------
POZOR: Časť A a časť B si nesmú sadnúť na tú istú cestu. Buď dáš
e-shop na subdoménu (shop.domena.eu), alebo statický web presuniesť
do podadresára. Rozhodni PRED inštaláciou.

1) WebAdmin -> Inštalátor CMS -> WordPress
   Prihlasovacie údaje prídu mailom.

2) WordPress -> Pluginy -> Pridať nový -> WooCommerce -> aktivovať
   Prejdi úvodným sprievodcom: krajina Slovensko, mena EUR.

3) NASTAVENIA PRED IMPORTOM — v tomto poradí:
   WooCommerce -> Nastavenia -> Dane
       "Zadávať ceny vrátane dane"  =  ÁNO
       Základná sadzba: SK 23 %  (over aktuálnu sadzbu)

   Toto sa musí urobiť PRED importom. Ceny v CSV sú s DPH; keby si
   to nechal opačne, Woo k nim DPH pripočíta a celý katalóg bude
   o 23 % drahší.

4) Pluginy -> Pridať nový -> Nahrať plugin -> ultrapeptidy-cennik.zip
   -> aktivovať
   Bez tohto pluginu sa množstevné ceny (3+ ks) naimportujú do
   databázy, ale nikde sa neprejavia.

5) Vzhľad -> Témy -> Pridať novú -> Nahrať -> ultrapeptidy-theme.zip
   Najprv musí byť nainštalovaná rodičovská téma Storefront
   (Vzhľad -> Témy -> Pridať novú -> vyhľadaj "Storefront").
   Potom aktivuj ULTRA PEPTIDY.

6) Produkty -> Všetky produkty -> Import
   Súbor: import/woocommerce-produkty.csv     Oddeľovač: ,
   Na obrazovke mapovania skontroluj, že sa napárovali:
       Meta: _up_tier3_price
       Meta: _up_batch
       Meta: _up_purity
       Parent          (spája varianty s rodičom)
       Regular price   (pri variantoch to Woo občas vynechá)

7) wp-config.php — pridaj nad riadok "That's all, stop editing":
       define('DISABLE_WP_CRON', true);
   a vo WebAdmine nastav CRON úlohu:
       Typ: PHP skript   Cesta: web/wp-cron.php   Interval: 5 minút
   WP-Cron pri každom načítaní stránky je na 25 workeroch zlý nápad.

8) Vytvor stránku "Cenník" a vlož do nej shortcode:
       [up_cennik]


PO NASADENÍ SKONTROLUJ
----------------------
[ ] https funguje a http presmeruje
[ ] 404 stránka sa zobrazuje v dizajne (skús /neexistuje)
[ ] Tesamorelin ponúka výber 5 / 10 / 20 mg a každá má inú cenu
[ ] 3 kusy v košíku prepli cenu na množstevnú
[ ] Cenník zo shortcode ukazuje všetky gramáže
[ ] Testovacia objednávka prešla a prišel mail
[ ] SPF, DKIM a DMARC v DNS  (over na mail-tester.com)


ČO EŠTE CHÝBA A NIE JE TO CHYBA NASADENIA
-----------------------------------------
* Fotky produktov — všetky používajú tú istú ampulku s vymeneným
  názvom. Stĺpec Images v CSV je prázdny zámerne.
* Popisy — hotové sú MOTS-C a BPC-157, zvyšok má šablónu.
* Platobná a dopravná brána — Besteron/GoPay, Packeta/GLS.
* Právne stránky — VOP, reklamácie, odstúpenie, GDPR.
* Bariéra 18+ je na statickom webe len UI vrstva. Na e-shope k tomu
  treba server-side cookie a audit záznam, inak nemá právnu váhu.
* Časť sortimentu má charakter liečiv. Pred spustením predaja si daj
  potvrdiť advokátom, či je B2C model priechodný.
`, 'utf8');

/* ── výpis ───────────────────────────────────────────────────────────────── */
console.log('BALÍK HOTOVÝ — dist/');
console.log(`  web-staticky/              ${kb(du(webOut))}  (${pages} stránok, FTP do DocumentRootu)`);
for (const z of ['ultrapeptidy-theme.zip', 'ultrapeptidy-cennik.zip']) {
  console.log(`  ${z.padEnd(27)}${kb(statSync(join(DIST, z)).size)}`);
}
console.log(`  import/                    ${kb(du(impOut))}  (${skus} gramáží)`);
console.log('  NAHRAJ-MA.txt              postup krok za krokom');
