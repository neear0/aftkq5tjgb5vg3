#!/bin/bash
# Overí, že KAŽDÁ položka z data/produkty.csv je na webe — a to na oboch miestach:
#   1) ako riadok v cenníkovej tabuľke  (site/index.html)
#   2) ako produktová karta             (site/katalog.html)
# a že ceny na webe sa zhodujú s cenami v CSV.
#
# Použitie:  bash scripts/check-cennik.sh
# Návratový kód 0 = všetko sedí, 1 = niečo chýba alebo nesúhlasí.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CSV="$ROOT/data/produkty.csv"
IDX="$ROOT/site/index.html"
KAT="$ROOT/site/katalog.html"

for f in "$CSV" "$IDX" "$KAT"; do
  [ -r "$f" ] || { echo "CHYBA: nedá sa čítať $f"; exit 1; }
done

# Karty majú názov niekedy zabalený v <a> (odkaz na detail) — normalizuj to preč,
# aby porovnanie nezávisело od toho, či položka má vlastnú stránku.
KATN="$(mktemp)"; trap 'rm -f "$KATN"' EXIT
sed -e 's|<a [^>]*>||g' -e 's|</a>||g' "$KAT" > "$KATN"

fail=0; checked=0
printf '%-26s %-8s %8s %8s   %s\n' "POLOŽKA" "GRAMÁŽ" "1 KS" "3+ KS" "STAV"
printf '%s\n' "------------------------------------------------------------------------"

# preskoč hlavičku; polia: 1=ref 2=name 3=mg 4=category 5=form 6=gross 7=net 8=tier 9=diff
tail -n +2 "$CSV" | while IFS=';' read -r ref name mg cat form gross net tier diff active; do
  [ -n "${ref:-}" ] || continue
  checked=$((checked+1))
  errs=""

  # ── ceny v celých eurách, ako ich uvádza tlačený cenník ──────────────────
  p1_int="${gross%%.*}"
  if [ -n "$tier" ]; then t_int="${tier%%.*}"; else t_int=""; fi

  # ── 1) riadok v cenníkovej tabuľke na homepage ───────────────────────────
  if [ -n "$mg" ]; then label="$name $mg"; else label="$name"; fi
  row="$(grep -F "<td>$label</td>" "$IDX" | head -1)"
  if [ -z "$row" ]; then
    errs="$errs cenník:CHÝBA_RIADOK"
  else
    case "$row" in *">$p1_int €<"*) ;; *) errs="$errs cenník:CENA_1KS" ;; esac
    if [ -n "$t_int" ]; then
      case "$row" in *">$t_int €<"*) ;; *) errs="$errs cenník:CENA_3KS" ;; esac
    else
      case "$row" in *'pl-none">–<'*) ;; *) errs="$errs cenník:CHYBA_POMLCKA" ;; esac
    fi
  fi

  # ── 2) produktová karta v katalógu ───────────────────────────────────────
  if [ -n "$mg" ]; then
    needle="prod-card__name\">$name</h3><span class=\"chip\">$mg</span>"
  else
    needle="prod-card__name\">$name</h3>"
  fi
  n_cards="$(grep -c -F "$needle" "$KATN")"
  if [ "$n_cards" -eq 0 ]; then
    errs="$errs katalóg:CHÝBA_KARTA"
  elif [ "$n_cards" -gt 1 ]; then
    errs="$errs katalóg:DUPLIKÁT(${n_cards})"
  fi

  # ceny na karte sú formátované na 2 desatiny (75,00 €)
  p1_fmt="$(printf '%s' "$gross" | sed 's/\./,/')"
  grep -q -F ">$p1_fmt €<" "$KATN" || errs="$errs katalóg:CENA_1KS"
  if [ -n "$tier" ]; then
    t_fmt="$(printf '%s' "$tier" | sed 's/\./,/')"
    grep -q -F ">$t_fmt €<" "$KATN" || errs="$errs katalóg:CENA_3KS"
  fi

  if [ -z "$errs" ]; then
    printf '%-26s %-8s %8s %8s   OK\n' "$name" "${mg:--}" "$p1_int €" "${t_int:-–} €"
  else
    printf '%-26s %-8s %8s %8s   ✗%s\n' "$name" "${mg:--}" "$p1_int €" "${t_int:-–} €" "$errs"
    echo "FAIL" >> "$KATN.errors"
  fi
done

printf '%s\n' "------------------------------------------------------------------------"

# ── súhrnné počty ──────────────────────────────────────────────────────────
csv_n=$(( $(wc -l < "$CSV") - 1 ))
row_n=$(grep -c '<tr><td>' "$IDX")
card_n=$(grep -c '<article class="prod-card' "$KAT")

printf 'CSV položiek        : %s\n' "$csv_n"
printf 'Riadkov v cenníku   : %s\n' "$row_n"
printf 'Kariet v katalógu   : %s\n' "$card_n"

if [ -f "$KATN.errors" ]; then
  n=$(wc -l < "$KATN.errors"); rm -f "$KATN.errors"
  printf '\n✗ %s položiek nesedí.\n' "$n"; exit 1
fi
if [ "$row_n" -ne "$csv_n" ] || [ "$card_n" -ne "$csv_n" ]; then
  printf '\n✗ Počty nesedia (%s CSV vs %s riadkov vs %s kariet).\n' "$csv_n" "$row_n" "$card_n"
  exit 1
fi

printf '\n✓ Všetkých %s položiek z cenníka je na webe, ceny sa zhodujú.\n' "$csv_n"
