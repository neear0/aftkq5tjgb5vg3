# ULTRA PEPTIDY — web a obsahový systém

Katalóg výskumných peptidov. Stránky sa **generujú z dát**, takže pridanie
produktu alebo zmena ceny je úprava jedného riadku v CSV — nie editovanie HTML.

---

## Ako to je poskladané

```
data/kategorie.csv          kategórie a ich poradie
data/produkty.csv           katalóg: ceny, gramáž, sklad, čistota, šarža
content/produkty/<slug>.md  popisný text produktu (voliteľné)
templates/produkt.html      šablóna produktovej stránky
        │
        ▼  node scripts/generate.mjs
site/                       hotový web — TOTO SA NASADZUJE
```

`site/index.html` a `site/katalog.html` sú ručne navrhnuté stránky, do ktorých
generátor dopĺňa len bloky medzi značkami `<!-- GEN:xxx -->`. Produktové stránky
(`site/produkt-<slug>.html`) vznikajú celé zo šablóny.

> **Súbory `site/produkt-*.html` needituj.** Prepíše ich najbližší build.
> Uprav dáta alebo `templates/produkt.html`.

---

## Ako pridať produkt

**1. Riadok do `data/produkty.csv`**

```
reference;slug;name;mg;category;form;purity;batch;stock;featured;price_gross_eur;price_net_eur;tier3_gross_eur;tier3_discount_gross_eur;active
UP-NOVY-10;novy-peptid-10mg;Nový peptid;10 mg;regeneracia;Lyofilizat;99.10;NP-2409;in;0;55.00;44.715447;50.00;5.00;1
```

| Stĺpec | Čo tam patrí |
|---|---|
| `reference` | interné katalógové číslo, musí byť jedinečné |
| `slug` | časť URL. **Riadky s rovnakým slugom sú tá istá látka v rôznych silách** a v katalógu z nich vznikne jeden produkt s prepínačom gramáže. |
| `name` | názov na karte a na etikete fľaštičky |
| `mg` | gramáž aktívnej látky vrátane jednotky (`10 mg`, `3 ml`). V skupine s viacerými silami je povinná a musí byť jedinečná. |
| `category` | **slug** kategórie z `data/kategorie.csv` |
| `form` | `Lyofilizat` alebo `Roztok` |
| `purity` | číslo s bodkou, napr. `99.24`; prázdne = „viď certifikát" |
| `batch` | číslo šarže |
| `stock` | `in` (na sklade), `low` (posledné kusy), `out` (vypredané) |
| `featured` | `1` = ukáž na homepage. Stačí na jednom riadku skupiny. |
| `price_gross_eur` | cena za 1 ks **s DPH** |
| `price_net_eur` | cena bez DPH (pri 23 %: cena s DPH ÷ 1,23) |
| `tier3_gross_eur` | cena za kus od 3 ks; **nechaj prázdne**, ak neplatí |
| `tier3_discount_gross_eur` | rozdiel oproti cene za 1 ks (pre neskorší e-shop) |
| `active` | `1` = zobraziť, `0` = skryť bez mazania riadku |

**2. Voliteľne text: `content/produkty/novy-peptid-10mg.md`**

Súbor sa musí volať presne ako `slug`. Skopíruj `content/produkty/_sablona.md`.
Formát je jednoduchý:

```md
> Perex — jedna až dve vety pod názvom.

## Čo je to?
- odrážka
- odrážka

## Stav poznania
Voľný odstavec.
```

Bez tohto súboru sa stránka aj tak vygeneruje — bude mať špecifikáciu,
cenu a certifikát, len bez popisu.

**3. Vygeneruj a skontroluj**

```bash
node scripts/generate.mjs
node scripts/check.mjs
```

**4. Commitni a pushni.** GitHub Actions build zopakuje a nasadí.

## Ako pridať ďalšiu gramáž existujúceho produktu

Pridaj riadok s **rovnakým `slug`**, iným `reference` a inou `mg`.
Nič viac. Z dvoch riadkov sa stane jeden produkt s prepínačom gramáže,
karta ukáže „od" najnižšej ceny a cenník zostane po gramážach.

```
UP-TESA-5;tesamorelin;Tesamorelin;5 mg;rastove-hormony;...;40.00;...
UP-TESA-10;tesamorelin;Tesamorelin;10 mg;rastove-hormony;...;65.00;...
UP-TESA-20;tesamorelin;Tesamorelin;20 mg;rastove-hormony;...;87.00;...
```

V rámci skupiny musí `name`, `category` a `form` sedieť na všetkých
riadkoch — generátor to kontroluje a pri nezhode spadne.

## Ako zmeniť cenu

Uprav `price_gross_eur` (a `tier3_gross_eur`) v CSV a pushni. Cena sa sama
prepíše na karte, v cenníku, na produktovej stránke aj v pop-upe — nikde inde
sa ručne nemení. `scripts/check.mjs` overí, že to sedí všade.

## Ako pridať kategóriu

Riadok do `data/kategorie.csv`. Stĺpec `icon` je id symbolu zo SVG sprite
(`i-syringe`, `i-face`, `i-heart`, `i-growth`, `i-brain`, `i-drop`).
Pre novú ikonu pridaj `<symbol>` do sprite v `templates/produkt.html`,
`site/index.html` a `site/katalog.html`.

---

## Príkazy

| Príkaz | Čo robí |
|---|---|
| `node scripts/generate.mjs` | Vygeneruje web z dát |
| `node scripts/generate.mjs --check` | Suchý beh, nič nezapíše |
| `node scripts/check.mjs` | Overí, že každá položka má stránku, kartu, cenník a správnu cenu |
| `bash scripts/build-prototyp.sh` | Zlúči web do jedného HTML pre náhľad |
| `node scripts/export-woocommerce.mjs` | CSV pre import katalógu do WooCommerce |
| `node scripts/package.mjs` | **Zloží `dist/` — presne to, čo sa nahráva na Websupport** |
| `cd site && python -m http.server 8080` | Lokálny server |

Generátor spadne, ak sú dáta nekonzistentné — duplicitný slug, neznáma
kategória, množstevná cena vyššia ako základná. To je zámer: lepšie zlyhať
pri builde než nasadiť web so zlou cenou.

---

## Nasadenie

Push do `main` spustí workflow: vygeneruje web z dát, overí úplnosť katalógu
a nasadí `site/` na GitHub Pages. Zlyhaná kontrola nasadenie zastaví.

### Vlastná doména

**Najprv DNS, potom CNAME.** Kým `site/CNAME` existuje, GitHub presmeruje
adresu `*.github.io` na tvoju doménu — ak DNS ešte nesmeruje na GitHub,
stránka je nedostupná. Preto tam ten súbor zatiaľ nie je.

```
@   A     185.199.108.153
@   A     185.199.109.153
@   A     185.199.110.153
@   A     185.199.111.153
www CNAME neear0.github.io.
```

Až keď sa DNS propaguje (`nslookup <domena>`):

```bash
echo <domena> > site/CNAME
git add site/CNAME && git commit -m "Vlastná doména" && git push
```

Potom v **Settings → Pages** zapni **Enforce HTTPS**.

---

## Nasadenie na Websupport

```bash
node scripts/generate.mjs
node scripts/export-woocommerce.mjs
node scripts/package.mjs
```

V `dist/` vznikne presne to, čo sa nahráva, a nič viac:

| Čo | Kam |
|---|---|
| `web-staticky/` | FTP do DocumentRootu. Vrátane `.htaccess` — bez neho nebude kompresia, cache ani bezpečnostné hlavičky. |
| `ultrapeptidy-theme.zip` | Vzhľad → Témy → Nahrať. Najprv nainštaluj rodičovskú tému **Storefront**. |
| `ultrapeptidy-cennik.zip` | Pluginy → Nahrať. Bez neho sa množstevné ceny nikde neprejavia. |
| `import/` | Produkty → Import |
| `NAHRAJ-MA.txt` | postup krok za krokom vrátane kontrolného zoznamu |

Dve časti sú nezávislé. **Statický web funguje hneď**, bez PHP a databázy —
doména môže niečo ukazovať ešte dnes. E-shop sa dá pridať kedykoľvek potom.

> Statický web a e-shop si nesmú sadnúť na tú istú cestu. Buď dáš e-shop na
> subdoménu, alebo statický web do podadresára. Rozhodni to **pred** inštaláciou.

ZIP-y sa skladajú vlastným writerom (`scripts/lib/zip.mjs`), nie
`Compress-Archive` — ten v PowerShelli 5.1 ukladá cesty so spätnými lomítkami
a WordPress takú tému rozbalí rozsypanú.

---

## Kam to smeruje

Toto je statický web — má katalóg, cenník a produktové stránky, ale **nemá
košík, platby ani objednávky**. GitHub Pages nevie spustiť PHP ani databázu.

Skutočný e-shop pobeží na **Websupporte, na WordPresse s WooCommerce**.
Admin panel bude WooCommerce — pridávanie produktov, popisy, ceny, sklad,
objednávky, faktúry. Podrobne v `PLAN.md`.

Dátová vrstva je pripravená na prevzatie:

| Príkaz | Čo vyrobí |
|---|---|
| `node scripts/export-woocommerce.mjs` | `export/woocommerce-produkty.csv` — celý katalóg **aj s množstevnými cenami**, jeden import |
| `node scripts/export-prestashop.mjs` | to isté pre PrestaShop, keby sa rozhodnutie prehodnotilo |

WooCommerce nevie množstevné ceny (3+ ks) natívne. Rieši to vlastný plugin
`wp-plugin/ultrapeptidy-cennik/` — pole v administrácii, aplikovanie ceny
v košíku a shortcode `[up_cennik]` na cenníkovú tabuľku. Bez pluginu sa
importované ceny nikde neprejavia; postup je v `export/WOOCOMMERCE.txt`.

---

## Design systém

Tmavý, holografický. Všetko v `site/assets/css/ultrapeptidy.css`:

- **Holo text** — `background-clip: text` nad animovaným gradientom. Len na
  nadpisoch ≥ 32 px a ≥ 700 weight (WCAG „large text" 3:1). Nikdy na cene,
  popise ani v checkoute.
- **Iridescentný okraj** — `conic-gradient` v `border-box` + `@property`.
  Používa ho karta produktu aj pop-up cenníka.
- **Foil sweep**, **sheen za kurzorom** — jediné miesto, kde JS ovplyvňuje vzhľad.
- **Sieť na pozadí** sa pomaly posúva (26 s) a uzly pulzujú; gradient v logu
  drží rovnaké tempo.
- `prefers-reduced-motion: reduce` vypína všetky animácie — vrátane pohybu
  pozadia. Ak sa nič nehýbe, skontroluj systémové nastavenie animácií.

**Fľaštička** je jedna fotka (`vial.jpg`) s vyprázdneným čiernym pásom;
názov produktu ide cezeň ako HTML text. Percentá pásu sú v CSS odmerané
priamo z fotky — pri prekreslení fotky ich treba prepočítať.

Fonty sú **systémové**. Ak sa nahradia licencovanými, self-hostuj `woff2`
a nepoužívaj Google Fonts CDN — v EÚ je to problém s GDPR.

## Čo ešte nie je hotové

- **Fotky ostatných produktov.** Všetky používajú tú istú fľaštičku s vymeneným
  názvom. Jedna svetelná zostava a nafotiť celý katalóg je najväčší jednorazový
  skok v kvalite.
- **Popisné texty.** Hotové sú MOTS-C a BPC-157, zvyšných 30 má šablónu.
- **Košík, platby, právne stránky.**
- **Bariéra 18+** je zatiaľ len UI vrstva v `localStorage`. Na skutočnom
  e-shope k tomu treba server-side cookie a audit záznam, inak nemá právnu váhu.
