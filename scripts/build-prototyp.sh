#!/bin/bash
# Zlúči site/ (3 stránky) do jedného samostatného HTML pre publikovaný náhľad.
# Artifact nemôže načítať externé súbory, takže CSS aj JS idú inline a zo stránok
# sa stanú tri prepínateľné pohľady.
#
# site/ je jediný zdroj pravdy. theme/ obsahuje LEN tento generovaný výstup.
#
# Použitie:  bash scripts/build-prototyp.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE="$ROOT/site"
OUT="$ROOT/theme/artifact-prototyp.html"
mkdir -p "$(dirname "$OUT")"

main_of() { sed -n '/^<main>/,/^<\/main>/p'     "$1" | sed '1d;$d'; }
head_of() { sed -n '/^<body>/,/^<main>/p'       "$1" | sed '1d;$d'; }
foot_of() { sed -n '/^<\/main>/,/^<\/body>/p'   "$1" | sed '1d;$d' | grep -v '<script src='; }

# Odkazy medzi stránkami → prepínanie pohľadov.
relink() {
  sed -E \
    -e 's|href="index\.html(#[^"]*)?"|href="#" data-view-to="home"|g' \
    -e 's|href="katalog\.html(#[^"]*)?"|href="#" data-view-to="katalog"|g' \
    -e 's|href="produkt-mots-c\.html(#[^"]*)?"|href="#" data-view-to="produkt"|g'
}

{
  echo '<title>Ultra Peptidy</title>'

  echo '<style>'
  cat "$SITE/assets/css/ultrapeptidy.css"
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
  echo '</style>'

  # sprite, pozadie, age gate, hlavička — z index.html (jeho sprite je nadmnožina)
  head_of "$SITE/index.html" | relink

  cat <<'HTML'
<div class="pv-note"><div class="up-container"><p>Náhľad dizajnu &middot; <strong>systémové fonty</strong> &middot; tri pohľady prepínačom dole</p></div></div>
HTML

  echo '<main data-view="home">';             main_of "$SITE/index.html"          | relink; echo '</main>'
  echo '<main data-view="katalog" hidden>';   main_of "$SITE/katalog.html"        | relink; echo '</main>'
  echo '<main data-view="produkt" hidden>';   main_of "$SITE/produkt-mots-c.html" | relink; echo '</main>'

  foot_of "$SITE/index.html" | relink

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

printf 'Hotovo: %s (%s B)\n' "$OUT" "$(wc -c < "$OUT" | tr -d ' ')"
