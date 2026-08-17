> Jedna až dve vety, ktoré sa zobrazia hneď pod názvom produktu.
> Píš vecne: čo to je, koľko aminokyselín, v akej forme sa dodáva.

## Čo je to?
- Krátke odrážky, každá na vlastnom riadku začínajúca pomlčkou.
- Držte sa opisu látky, nie sľubov.

## Dokumentovaný mechanizmus
- Formulácie uvádzaj vždy s odstupom: „v modeloch", „publikované práce opisujú",
  „skúma sa v súvislosti s".
- Nikdy nepíš „zlepší", „vylieči", „schudneš".

## Oblasti výskumu
- V akých oblastiach sa látka skúma.

## Stav poznania
Voľný odstavec bez odrážok. Sem patrí, odkiaľ dáta pochádzajú — či ide
o laboratórne modely, zvieracie štúdie alebo klinické dáta.

<!--
  AKO TO FUNGUJE
  ──────────────
  Súbor sa musí volať rovnako ako `slug` v data/produkty.csv, s príponou .md
  Napríklad produkt so slugom `mots-c-40mg` -> content/produkty/mots-c-40mg.md

  > riadok     = perex pod názvom
  ## Nadpis    = nový blok
  - odrážka    = položka zoznamu
  obyčajný text = odstavec

  Ak súbor pre produkt neexistuje, stránka sa aj tak vygeneruje — bude mať
  špecifikačnú tabuľku a cenu, len bez popisného textu.

  Tento komentár sa na web nedostane.
-->
