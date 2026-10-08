#!/usr/bin/env bash
# Odtwarzanie backupu (deploy/backup.sh) do instancji compose.
#
# Użycie: deploy/restore.sh <katalog_backupu> [-p projekt] [--port N] [--yes]
#
# Domyślnie przywraca do OSOBNEGO, pustego projektu knowli-restore na porcie
# 24710 — tak weryfikuje się backup bez dotykania danych rodzinnych.
# Przywrócenie do projektu knowli (dane produkcyjne!) nadpisuje bazę i media
# wymaga jawnego --yes.
set -euo pipefail

cd "$(dirname "$0")/.."

project=knowli-restore
port=24710
force=0
src=""
while [ $# -gt 0 ]; do
  case "$1" in
    -p|--project) project="$2"; shift 2 ;;
    --port) port="$2"; shift 2 ;;
    --yes) force=1; shift ;;
    *)
      if [ -z "$src" ]; then src="$1"; shift; else
        echo "nieznany argument: $1" >&2; exit 1
      fi ;;
  esac
done

if [ -z "$src" ] || [ ! -f "$src/db.dump" ] || [ ! -f "$src/media.tgz" ]; then
  echo "użycie: deploy/restore.sh <katalog_backupu> [-p projekt] [--port N] [--yes]" >&2
  exit 1
fi
src="$(cd "$src" && pwd)"

envfile="${KNOWLI_ENV_FILE:-.env}"
db="${KNOWLI_DB:-knowli}"
if [ ! -f "$envfile" ]; then
  echo "brak pliku env: $envfile (skopiuj .env.example i uzupełnij)" >&2
  exit 1
fi

if [ "$project" = "knowli" ] && [ "$force" -ne 1 ]; then
  echo "odtwarzanie do projektu knowli nadpisuje dane rodzinne; dodaj --yes" >&2
  exit 1
fi

if [ -f "$src/SHA256SUMS" ]; then
  echo "[restore] kontrola sum SHA256…"
  (cd "$src" && sha256sum --check --status SHA256SUMS)
fi

compose() {
  docker compose --env-file "$envfile" -p "$project" -f deploy/compose.yaml "$@"
}

host_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

echo "[restore] projekt $project: czysta baza danych"
if [ "$project" != "knowli" ]; then
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  export WEB_PORT="$port"
else
  compose stop web worker migrate >/dev/null 2>&1 || true
fi
compose up -d --wait db

echo "[restore] pg_restore do bazy $db…"
compose exec -T db pg_restore -U postgres --no-owner --clean --if-exists -d "$db" < "$src/db.dump"

echo "[restore] rozpakowanie mediów do wolumenu…"
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "${project}_knowli-media":/media \
  -v "$(host_path "$src")":/backup:ro \
  postgres:17.11-alpine \
  sh -c "rm -rf /media/* && tar xzf /backup/media.tgz -C /media && chown -R 1000:1000 /media"

echo "[restore] start aplikacji (migracje są no-op na odtworzonym schemacie)…"
compose up -d --wait

echo "[restore] gotowe na http://127.0.0.1:${WEB_PORT:-8080}"
echo "[restore] weryfikacja ręczna (PIN rodzica z backupowanego stacka):"
echo "  node deploy/smoke.mjs inspect http://127.0.0.1:${WEB_PORT:-8080} <PIN>"
