#!/usr/bin/env bash
# Rotacja kopii z deploy/backup.sh: zostawia N najnowszych KOMPLETNYCH kopii
# (katalog knowli-YYYYmmdd-HHMMSS z SHA256SUMS) i usuwa wszystkie starsze
# katalogi kopii — także niekompletne. Niekompletna kopia nowsza niż N-ta
# kompletna (np. trwający backup) zostaje. Inne pliki i katalogi są nietknięte.
#
# Użycie: deploy/backup-rotate.sh <katalog_kopii> <N>    (N ≥ 1)
set -euo pipefail

dir="${1:-}"
keep="${2:-}"

if [[ ! "$keep" =~ ^[1-9][0-9]*$ ]]; then
  echo "[rotate] N musi być liczbą całkowitą ≥ 1 (podano: '${keep}')" >&2
  echo "użycie: deploy/backup-rotate.sh <katalog_kopii> <N>" >&2
  exit 2
fi
if [ -z "$dir" ] || [ ! -d "$dir" ]; then
  echo "[rotate] brak katalogu kopii: '${dir}'" >&2
  exit 2
fi

# nazwy ze znacznikiem czasu sortują się chronologicznie; od najnowszej
cd -- "$dir" || exit 2
mapfile -t backups < <(for d in knowli-[0-9]*-[0-9]*/; do
  [[ "${d%/}" =~ ^knowli-[0-9]{8}-[0-9]{6}$ ]] && printf '%s\n' "${d%/}"
done | sort -r)

found=0
cutoff=""
for name in "${backups[@]}"; do
  if [ -f "$name/SHA256SUMS" ]; then
    found=$((found + 1))
    if [ "$found" -eq "$keep" ]; then cutoff="$name"; break; fi
  fi
done

if [ -z "$cutoff" ]; then
  echo "[rotate] kompletnych kopii: $found (zostawiam ≥ $keep) — nic do usunięcia"
  exit 0
fi

for name in "${backups[@]}"; do
  if [[ "$name" < "$cutoff" ]]; then
    echo "[rotate] usuwam $dir/$name"
    rm -rf -- "./$name"
  fi
done
