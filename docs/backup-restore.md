# Backup i odtwarzanie

Wersja bazowa: zadanie 11 planu implementacji. Backup chroni dokładnie dane
rodziny: profile dzieci, opublikowane wersje zestawów, historię prób i postęp
(baza) oraz wygenerowane audio i ilustracje (wolumen mediów).

Czego w backupie **celowo nie ma**: nagrania ustne dziecka (są przetwarzane
wyłącznie w pamięci żądania i nigdzie nie są utrwalane), klucze API
(żyją w środowisku kontenerów, nie w bazie) oraz konfiguracja PIN-u rodzica
w jawnej postaci (w bazie trafia tylko hash scrypt — wraca razem z bazą).

## Backup

```bash
deploy/backup.sh [katalog_docelowy]     # domyślnie backups/knowli-<data>
```

Działa na uruchomionym stacku (nie zatrzymuje aplikacji): wykonuje
`pg_dump -Fc` w kontenerze `db` oraz pakuje wolumen `knowli-media` do
`media.tgz`. Powstaje katalog:

- `db.dump` — spójny logicznie zrzut PostgreSQL (format custom),
- `media.tgz` — treść wolumenu mediów (bloby adresowane treścią),
- `SHA256SUMS` — sumy kontrolne obu plików,
- `manifest.json` — data, projekt, wersja PostgreSQL, rozmiary.

Zmienne: `KNOWLI_PROJECT` (domyślnie `knowli`), `KNOWLI_ENV_FILE`
(domyślnie `.env`), `KNOWLI_DB` (domyślnie `knowli`).

Sugerowany harmonogram: codziennie (cron/systemowy scheduler), np.:

```
15 23 * * *  cd /sciezka/do/knowli && deploy/backup.sh >> backups/backup.log 2>&1
```

Katalog `backups/` jest w `.gitignore` — kopie trzymaj poza repo, najlepiej
na drugim nośniku.

## Odtwarzanie

```bash
# weryfikacja na osobnej, pustej instancji (projekt knowli-restore, port 24710):
deploy/restore.sh backups/knowli-20260101-231500

# awaryjny powrót na dane rodzinne (nadpisuje bieżące dane — wymaga --yes):
deploy/restore.sh backups/knowli-20260101-231500 -p knowli --yes
```

Skrypt: kontroluje sumy SHA256, stawia czystą bazę w projekcie docelowym,
`pg_restore --clean --if-exists`, rozpakowuje media do wolumenu, po czym
startuje aplikację (migracje na odtworzonym schemacie są no-op).

Weryfikacja odtworzonej instancji (PIN rodzica z backupowanego stacka):

```bash
node deploy/smoke.mjs inspect http://127.0.0.1:8080 <PIN>   # przed: źródło
node deploy/smoke.mjs inspect http://127.0.0.1:24710 <PIN>  # po: restore
diff przed.json po.json
```

`inspect` wypisuje profile dzieci z przypisanymi zestawami, opublikowane
wersje z liczbą elementów, sumy SHA256 trzech pierwszych audio oraz postęp
każdego dziecka w każdym zestawie — identyczność obu zrzutów oznacza pełny
powrót danych (profile, wersje, historia, media).

## Wynik weryfikacji z zadania 11

Próba przeprowadzona 2026-10-08 na tym repozytorium (Docker 29.7.2,
Compose v5.4.0, dane fake providerów — produkcyjne dane rodziny powstaną
dopiero po wdrożeniu):

1. Stack źródłowy `knowli-backup-check` (fake providerzy): pełny obieg
   smoke (profil dziecka, generacja, publikacja, przypisanie, sesja
   19 zadań) — PASS.
2. `deploy/backup.sh` → `db.dump` 106 kB + `media.tgz` 1,7 kB +
   sumy SHA256 + manifest — PASS (bez zatrzymywania aplikacji).
3. `deploy/restore.sh` do pustego projektu `knowli-restore` (port 24710):
   kontrola sum, pg_restore, media, migracje jako no-op, healthchecki
   web i worker healthy — PASS.
4. `smoke.mjs inspect` przed i po: **identyczne profile dziecka,
   opublikowana wersja zestawu, postęp (historia prób w projekcji)
   i sumy SHA256 mediów** — PASS. (Kolejność w liście mediów nie jest
   umową — `inspect` sortuje, żeby diff był powtarzalny.)

Do pozostania poza próbą: odtworzenie na innym hoście (ta sama procedura —
skrypty są host-agnostyczne) oraz restore do projektu `knowli` z `--yes`
(utrudnienie celowe, żeby nie nadpisać danych rodzinnych przypadkiem).
