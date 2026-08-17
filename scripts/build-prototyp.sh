#!/bin/bash
# Zlúči site/ (3 stránky) do jedného samostatného HTML pre publikovaný náhľad.
# Artifact nemôže načítať externé súbory, takže CSS, JS aj obrázky idú inline
# a zo stránok sa stanú tri prepínateľné pohľady.
#
# site/ je jediný zdroj pravdy. theme/ obsahuje LEN tento generovaný výstup.
#
# Použitie:  bash scripts/build-prototyp.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE="$ROOT/site"
IMG="$SITE/assets/img"
OUT="$ROOT/theme/artifact-prototyp.html"
mkdir -p "$(dirname "$OUT")"

# ── obrázky ako data URI ───────────────────────────────────────────────────
# Bez tohto by v publikovanom náhľade chýbala ampulka aj logo — artifact
# je jeden súbor a k adresáru assets/ sa nedostane.
VIAL_JPG="data:image/jpeg;base64,$(base64 -w0 "$IMG/vial.jpg")"
VIAL_MASK="data:image/png;base64,$(base64 -w0 "$IMG/vial-mask.png")"
LOGO_PNG="data:image/png;base64,$(base64 -w0 "$IMG/logo.png")"
LOGO_MARK="data:image/png;base64,$(base64 -w0 "$IMG/logo-mark.png")"

# Fotka ampulky sa na stránke opakuje 40+ krát. Keby sa data URI vložilo do
# každého <img src>, náhľad má 4,5 MB. Preto ide fotka RAZ do CSS ako pozadie
# a <img> dostane prázdny SVG placeholder, ktorý drží pomer strán.
BLANK="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='306'%20height='812'%3E%3C/svg%3E"

# poradie je dôležité: logo-mark.png musí ísť pred logo.png
inline_assets() {
  sed -e "s|assets/img/vial\.jpg|${BLANK}|g" \
      -e "s|assets/img/logo-mark\.png|${LOGO_MARK}|g" \
      -e "s|assets/img/logo\.png|${LOGO_PNG}|g"
}

# ── výrezy stránok ─────────────────────────────────────────────────────────
main_of() { sed -n '/^<main>/,/^<\/main>/p'   "$1" | sed '1d;$d'; }
head_of() { sed -n '/^<body>/,/^<main>/p'     "$1" | sed '1d;$d'; }
foot_of() { sed -n '/^<\/main>/,/^<\/body>/p' "$1" | sed '1d;$d' | grep -v '<script src='; }

# odkazy medzi stránkami → prepínanie pohľadov
relink() {
  sed -E \
    -e 's|href="index\.html(#[^"]*)?"|href="#" data-view-to="home"|g' \
    -e 's|href="katalog\.html(#[^"]*)?"|href="#" data-view-to="katalog"|g' \
    -e 's|href="produkt-mots-c\.html(#[^"]*)?"|href="#" data-view-to="produkt"|g'
}

prep() { relink | inline_assets; }

{
  echo '<title>Ultra Peptidy</title>'

  echo '<style>'
  sed -e "s#url('../img/vial-mask.png')#url('${VIAL_MASK}')#g" \
      -e "s#url('../img/logo-mark.png')#url('${LOGO_MARK}')#g" \
      -e "s#url('../img/logo.png')#url('${LOGO_PNG}')#g" \
      "$SITE/assets/css/ultrapeptidy.css"
  cat <<'CSS'
/* ── len pre publikovaný náhľad ─────────────────────────────────────────── */
.pv-note{border-bottom:1px solid var(--up-hairline);background:rgba(139,92,246,.07)}
.pv-note p{margin:0;padding:9px 0;font:500 var(--up-fs-xs)/1.5 var(--up-font-mono);
  letter-spacing:.06em;color:var(--up-text-mute);text-transform:uppercase}
.pv-note strong{color:var(--up-purple-glow)}
.pv-switch{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:200;
  display:flex;gap:4px;padding:4px;border:1px solid var(--up-hairline);
  border-radius:var(--up-r-pill);background:rgba(8,8,10,.92);
  -webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);
  box-shadow:0 10px 30px -10px rgba(0,0,0,.9)}
.pv-switch button{padding:9px 20px;border:0;cursor:pointer;border-radius:var(--up-r-pill);
  background:transparent;color:var(--up-text-mute);
  font:600 .8125rem/1 var(--up-font-body);
  transition:background .2s var(--up-ease),color .2s var(--up-ease)}
.pv-switch button[aria-current="true"]{background:var(--up-purple);color:#fff}
@media (max-width:899px){.pv-switch{bottom:80px}}
CSS
  printf '.vial__photo{background:url("%s") center/100%% 100%% no-repeat}\n' "$VIAL_JPG"
  echo '</style>'

  # sprite, pozadie, age gate, hlavička — z index.html
  head_of "$SITE/index.html" | prep

  cat <<'HTML'
<div class="pv-note"><div class="up-container"><p>Náhľad dizajnu &middot; <strong>systémové fonty</strong> &middot; tri pohľady prepínačom dole</p></div></div>
HTML

  echo '<main data-view="home">';           main_of "$SITE/index.html"          | prep; echo '</main>'
  echo '<main data-view="katalog" hidden>'; main_of "$SITE/katalog.html"        | prep; echo '</main>'
  echo '<main data-view="produkt" hidden>'; main_of "$SITE/produkt-mots-c.html" | prep; echo '</main>'

  foot_of "$SITE/index.html" | prep

  cat <<'HTML'
<div class="pv-switch" role="group" aria-label="Prepnúť pohľad">
  <button data-view-to="home" aria-current="true">Domov</button>
  <button data-view-to="katalog" aria-current="false">Katalóg</button>
  <button data-view-to="produkt" aria-current="false">Produkt</button>
</div>
HTML

  echo '<script>'
  cat "$SITE/assets/js/site.js"
  cat <<'JS'
/* prepínanie pohľadov — existuje len v publikovanom náhľade */
(() => {
  const views = document.querySelectorAll('[data-view]');
  const show = (name) => {
    views.forEach((v) => { v.hidden = v.dataset.view !== name; });
    document.querySelectorAll('[data-view-to]').forEach((b) => {
      b.setAttribute('aria-current', String(b.dataset.viewTo === name));
    });
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-view-to]');
    if (!t) return;
    e.preventDefault();
    show(t.dataset.viewTo);
  });
})();
JS
  echo '</script>'
} > "$OUT"

printf 'Hotovo: %s (%s KB)\n' "$OUT" "$(( $(wc -c < "$OUT") / 1024 ))"
