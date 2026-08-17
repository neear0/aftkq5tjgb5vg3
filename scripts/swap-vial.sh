#!/bin/bash
# Nahradí SVG kresbu fľaštičky v produktových kartách skutočnou fotkou
# a doplní na etiketu názov produktu prevzatý z tej istej karty.
#
# Spúšťa sa jednorazovo pri prechode z kresby na fotku:
#   bash scripts/swap-vial.sh site/index.html site/katalog.html
set -euo pipefail

for f in "$@"; do
  [ -w "$f" ] || { echo "preskakujem (nedá sa zapisovať): $f"; continue; }
  awk '
    function esc(s) { gsub(/&/,"\\&amp;",s); return s }
    function emit(   name, i, j, tmp, rep) {
      # názov karty: buď priamo v <h3>, alebo zabalený v odkaze na detail
      name = ""
      i = index(buf, "prod-card__name\">")
      if (i > 0) {
        tmp = substr(buf, i + length("prod-card__name\">"))
        if (substr(tmp, 1, 3) == "<a ") {          # <a href=...>NÁZOV</a>
          j = index(tmp, ">"); tmp = substr(tmp, j + 1)
        }
        j = index(tmp, "<")
        if (j > 0) name = substr(tmp, 1, j - 1)
      }
      rep = "<span class=\"vial\">" \
            "<img class=\"vial__photo\" src=\"assets/img/vial.jpg\" alt=\"\"" \
            " width=\"306\" height=\"812\" loading=\"lazy\" decoding=\"async\">" \
            "<span class=\"vial__name\">" esc(name) "</span></span>"
      sub(/<svg class="vial"><use href="#vial(-motsc)?"\/><\/svg>/, rep, buf)
      printf "%s", buf
    }
    /<article/ { inart = 1; buf = "" }
    inart {
      buf = buf $0 "\n"
      if ($0 ~ /<\/article>/) { emit(); inart = 0 }
      next
    }
    { print }
  ' "$f" > "$f.tmp" && mv "$f.tmp" "$f"

  n=$(grep -c 'class="vial__photo"' "$f" || true)
  left=$(grep -c '<svg class="vial"' "$f" || true)
  printf '%-28s fotiek: %-3s  zvyšných SVG v kartách: %s\n' "$(basename "$f")" "$n" "$left"
done
