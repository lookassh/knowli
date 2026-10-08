#!/usr/bin/env bash
# Backup danych rodzinnych Umiem!: zrzut PostgreSQL (format custom pg_dump)
# + archiwum wolumenu mediów + manifest z sumami kontrolnymi.
#
# Użycie: deploy/backup.sh [katalog_docelowy]    (domyślnie backups/<data>)
# Zmienne:
#   KNOWLI_PROJECT  projekt compose (domyślnie knowli)
#   KNOWLI_ENV_FILE plik env z POSTGRES_PASSWORD (domyślnie .env)
#   KNOWLI_DB       nazwa bazy (domyślnie knowli)
set -euo pipefail

cd "$(dirname "$0")/.."
project="${KNOWLI_PROJECT:-knowli}"
envfile="${KNOWLI_ENV_FILE:-.env}"
db="${KNOWLI_DB:-knowli}"
stamp="$(date +%Y%m%d-%H%M%S)"
dest="${1:-backups/knowli-$stamp}"
media_volume="${project}_knowli-media"

if [ ! -f "$envfile" ]; then
  echo "brak pliku env: $envfile (skopiuj .env.example i uzupełnij)" >&2
  exit 1
fi

compose() {
  docker compose --env-file "$envfile" -p "$project" -f deploy/compose.yaml "$@"
}

# ścieżka hosta do -v: w Git Bash potrzebna forma Windows + bez konwersji MSYS
host_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

mkdir -p "$dest"
echo "[backup] zrzut bazy $db (pg_dump -Fc)…"
compose exec -T db pg_dump -U postgres -Fc "$db" > "$dest/db.dump"

echo "[backup] archiwum wolumenu mediów ($media_volume)…"
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$media_volume":/media:ro \
  -v "$(host_path "$PWD/$dest")":/backup \
  postgres:17.11-alpine \
  tar czf /backup/media.tgz -C /media .

pg_version="$(compose exec -T db psql -U postgres -tAc "show server_version" | tr -d "[:space:]")"
(cd "$dest" && sha256sum db.dump media.tgz > SHA256SUMS)
cat > "$dest/manifest.json" <<EOF
{
  "created": "$(date -Iseconds)",
  "project": "$project",
  "database": "$db",
  "postgresVersion": "$pg_version",
  "dbDumpBytes": $(wc -c < "$dest/db.dump" | tr -d "[:space:]"),
  "mediaArchiveBytes": $(wc -c < "$dest/media.tgz" | tr -d "[:space:]")
}
EOF
echo "[backup] gotowe: $dest (db.dump + media.tgz + SHA256SUMS + manifest.json)"
