# ULTRA PEPTIDY — statický web

Prezentácia a katalóg výskumných peptidov, nasadzovaná na GitHub Pages.
Tmavý holografický dizajn: čierna, purpurová, iridescentné akcenty.

---

## Štruktúra

| Cesta | Obsah |
|---|---|
| `site/` | **Zdroj GitHub Pages a jediný zdroj pravdy pre dizajn.** Toto sa nasadzuje. |
| `site/index.html` | Homepage — hero, kategórie, najžiadanejšie, kvalita, **celý cenník**, FAQ |
| `site/katalog.html` | Katalóg — **všetkých 32 produktov** ako karty v 6 kategóriách |
| `site/produkt-mots-c.html` | Produktová stránka (referenčná implementácia) |
| `site/assets/css/ultrapeptidy.css` | Celý design systém |
| `brand/` | Logo systém (SVG) — pripravený, web ho zatiaľ nepoužíva |
| `data/produkty.csv` | Katalóg 32 položiek: kategória, gramáž, ceny, netto pri DPH 23 % |
| `scripts/check-cennik.sh` | **Overí, že všetko z cenníka je na webe a ceny sedia** |
| `scripts/build-prototyp.sh` | Zlúči `site/` do jedného HTML pre náhľad |
| `scripts/set-specific-prices.php` | Množstevné ceny 3+ ks v PrestaShope (na neskôr) |

GitHub Pages hostuje **len statické súbory** — nie PHP, nie databázu, nie košík.
Tento web je prezentácia a katalóg. Skutočný e-shop s platbami je samostatný projekt.

---

## Lokálny vývoj

Žiadny build, žiadne závislosti.

```bash
cd site && python -m http.server 8080
# http://localhost:8080
```

Lokálny server je lepší než otvorenie cez `file://` — relatívne cesty
a `<use href="#id">` sa chovajú rovnako ako v produkcii.

## Kontrola úplnosti cenníka

Po každej zmene cien alebo katalógu:

```bash
bash scripts/check-cennik.sh
```

Skript prejde `data/produkty.csv` a pre každú položku overí, že je
**na oboch miestach** — ako riadok v cenníkovej tabuľke aj ako produktová
karta — a že ceny na webe sa zhodujú s cenami v CSV. Skončí s kódom 1,
ak niečo chýba alebo nesúhlasí, takže sa dá zapojiť do CI.

---

## Nasadenie

Pushom do `main` sa spustí workflow `.github/workflows/pages.yml`, ktorý
nahráva **len obsah `site/`** — `data/`, `brand/` ani `scripts/` sa na web nedostanú.

Zapnutie: **Settings → Pages → Source: GitHub Actions** (nie „Deploy from a branch").

### Vlastná doména

Poradie je dôležité: **najprv DNS, potom CNAME.** Kým `site/CNAME` existuje,
GitHub presmeruje adresu `*.github.io` na tvoju doménu — a ak DNS ešte
nesmeruje na GitHub, stránka je nedostupná. Preto tam ten súbor zatiaľ nie je.

Najprv v DNS u registrátora:

```
; apex
@   A     185.199.108.153
@   A     185.199.109.153
@   A     185.199.110.153
@   A     185.199.111.153
; www
www CNAME neear0.github.io.
```

Až keď sa DNS propaguje (`nslookup <domena>`):

```bash
echo <domena> > site/CNAME
git add site/CNAME && git commit -m "Vlastná doména" && git push
```

CNAME musí byť v `site/`, nie v koreni — workflow nasadzuje len ten adresár.
Potom v **Settings → Pages** zapni **Enforce HTTPS**.

> Doména môže smerovať naraz len na jedno miesto. Keď raz pobeží skutočný
> e-shop na vlastnom hostingu, treba sa rozhodnúť, čo je na doméne a čo
> na subdoméne — **pred** nastavením DNS, nie po.

---

## Design systém

Tmavý, holografický. Kľúčové veci v `site/assets/css/ultrapeptidy.css`:

- **Holo text** — `background-clip: text` nad animovaným gradientom.
  Len na nadpisoch ≥ 32 px a ≥ 700 weight (WCAG „large text" 3:1).
  Nikdy na cene, popise ani v checkoute.
- **Iridescentný okraj** — `conic-gradient` v `border-box` + `@property --holo-angle`.
  Fallback pre prehliadače bez `@property` je v `@supports`.
- **Foil sweep** — `mix-blend-mode: color-dodge` na diagonálnom pruhu.
- **Sheen za kurzorom** — jediné miesto, kde JS ovplyvňuje vzhľad;
  delegovaný listener, rAF throttle, na touch sa vôbec nenaviaže.
- **Glass** — `backdrop-filter` je drahý na GPU. Max 3–4 prvky vo viewporte,
  nikdy na scrollujúcom zozname kariet.
- `prefers-reduced-motion: reduce` vypína všetky animácie.

Fonty sú **systémové**. Ak sa nahradia licencovanými, self-hostuj `woff2`
a nepoužívaj Google Fonts CDN — v EÚ je to problém s GDPR a navyše pomalšie.

## Čo ešte nie je hotové

- **Fotky produktov.** Fľaštičky sú SVG kresba. Celý vizuál stojí na tom
  holografickom skle — jedna svetelná zostava a nafotiť všetkých 32 naraz.
- **Vlastnú stránku má zatiaľ len MOTS-C.** Ostatných 31 je v katalógu ako karty.
- **Košík a platby.** Statický web ich mať nemôže.
- **Právne stránky** (VOP, reklamácie, odstúpenie, GDPR) — odkazy vo footri
  vedú na `#`.
- **Bariéra 18+** je zatiaľ len UI vrstva v `localStorage`. Na skutočnom
  e-shope k tomu treba server-side cookie a audit záznam, inak nemá právnu váhu.
