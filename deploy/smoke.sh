#!/usr/bin/env bash
# Test dymny wdrożenia (zadanie 11): build obrazów → up → fake generacja →
# publikacja → sesja dziecka → restart web+worker → odczyt tych samych wyników
# i plików. Działa w osobnym projekcie compose (knowli-smoke) z własnymi
# wolumenami i fake providerami; po próbie wszystko jest usuwane.
# Użycie (z dowolnego katalogu): deploy/smoke.sh
set -euo pipefail

cd "$(dirname "$0")/.."
project=knowli-smoke
port="${SMOKE_PORT:-24700}"
envfile=$(mktemp)
statefile=$(mktemp -d)/state.json
cleanup() {
  rm -f "$envfile"
  rm -rf "$(dirname "$statefile")"
}
trap cleanup EXIT

# własne hasło smoke (nie czyta i nie dotyka rodzinnych danych/wolumenów)
printf 'POSTGRES_PASSWORD=smoke-test\n' > "$envfile"

compose() {
  docker compose --env-file "$envfile" -p "$project" -f deploy/compose.yaml -f deploy/compose.smoke.yaml "$@"
}

echo "== [1/5] build obrazów web i worker"
compose build

echo "== [2/5] start stacku (migracje + healthchecki)"
compose up -d --wait

echo "== [3/5] faza A: obieg generacja → publikacja → sesja"
node deploy/smoke.mjs run "http://127.0.0.1:${port}" "$statefile"

echo "== [4/5] restart web i worker (symulacja awarii procesów)"
compose restart web worker
compose up -d --wait

echo "== [5/5] faza B: te same wyniki i pliki po restarcie"
node deploy/smoke.mjs verify "http://127.0.0.1:${port}" "$statefile"

echo "PASS: test dymny wdrożenia"
compose down -v --remove-orphans
