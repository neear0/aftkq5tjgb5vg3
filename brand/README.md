# ULTRA PEPTIDE — značka

## Súbory

| Súbor | Použitie |
|---|---|
| `logo.svg` | Primárny horizontálny lockup. Hlavička webu, dokumenty, e-mail podpis. |
| `logo-stacked.svg` | Vertikálny lockup. Etikety fľaštičiek, štvorcové formáty, pečiatka. |
| `mark.svg` | Samotná značka. Avatar, favicon 32 px+, pečať na obale. |
| `mark-mono.svg` | Jednofarebná. Razba, gravírovanie, jednofarebná tlač. Dedí `currentColor`. |
| `favicon.svg` | Zjednodušená pre 16–32 px. Bez uzlov a menisku. |

## Konštrukcia

Monogram **U** je zároveň nádoba. Dve stopky ukončené uzlami čítajú ako terminály
reťazca; spodný oblúk uzatvára nádobu. Vnútri je **meniskus** — hladina kvapaliny —
a to je **jediné miesto v celej identite, kde zostáva spektrum**.

To je celý zmysel redizajnu: iridescencia prestala byť efektom na všetkom a stala sa
jedným detailom, ktorý niečo znamená. Preto na webe existuje presne na troch miestach:

1. meniskus v značke,
2. 1 px linka pod hlavičkou,
3. marker čistoty pri certifikáte analýzy.

Nikde inde. Žiadne animované prechody, žiadne rotujúce okraje.

## Geometria

- Kreslené na mriežke 48 × 48.
- Stopky na `x = 13` a `x = 35`, hrúbka linky `5`, oblúk `r = 11` so stredom `(24, 26)`.
- Uzly `r = 3.1` na `y = 10.5`.
- Meniskus na `y = 23.4`, hrúbka `2.2`.
- Všetky zakončenia `round` — mäkkosť je zámerná protiváha k tvrdej čiernej.

## Farby

| Rola | Hex |
|---|---|
| Značka | `#7C5CFF` |
| Spektrum (meniskus) | `#7C5CFF` → `#5EC8D8` → `#C97BE0` |
| ULTRA | `#E8E8F0` |
| PEPTIDE | `#9E9FB0` |
| Podklad | `#0A0A10` |

## Ochranná zóna a minimálne veľkosti

- **Ochranná zóna:** výška uzla (`3.1` jednotiek ≈ 6,5 % šírky značky) na všetkých stranách. Nič do nej nevstupuje.
- **Minimálna šírka:** horizontálny lockup **120 px** / 32 mm v tlači.
- **Pod 24 px** používaj `favicon.svg`, nie `mark.svg` — meniskus sa zliepa so stopkami.

## Čo nerobiť

- Nemeniť pomer strán a neroztahovať.
- Nepridávať tieň, žiaru, obrys ani skosenie.
- Nedávať spektrum na slovnú značku — spektrum patrí len menisku.
- Neanimovať. Značka je statická.
- Nepoužívať na svetlom podklade bez zmeny: na svetlom použi `mark-mono.svg` s `color: #14141D`.
- Nerozbíjať lockup — ULTRA a PEPTIDE majú fixný vzťah.

## Pred spustením — povinný krok

Slovná značka je v SVG zapísaná ako `<text>` so systémovým fontom.
**Pred produkčným použitím ju konvertuj na krivky** (Illustrator / Inkscape → *Object to Path*).
Bez outlinov sa logo na cudzom systéme vykreslí iným fontom.

## Doména a názov

Súbory používajú **ULTRA PEPTIDE** (podľa `ultrapeptide.eu`). Existujúce tlačové
materiály majú **ULTRA PEPTIDY** (slovenský plurál). Rozhodni, čo je primárne —
zámena je v `logo.svg` a `logo-stacked.svg` jeden `<text>` element.
