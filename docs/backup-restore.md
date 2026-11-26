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

Kopia jest **kompletna dopiero z `SHA256SUMS`** — plik powstaje atomowo
jako ostatni krok, więc katalog bez niego to przerwany lub trwający backup.
Skrypt ustawia `umask 077`: katalog kopii ma prawa 700, więc do środka
zagląda tylko jego właściciel i root (dane dzieci). `media.tgz` tworzy root
w kontenerze z prawami 644 — chroni go katalog, więc kopiując pliki poza
katalog, zachowaj prawa (`rsync --chmod` niżej). Kopie sprzed tej zmiany
zabezpiecz raz: `chmod -R go-rwx backups/`. Przed każdą aktualizacją backup jest obowiązkowy
(`docs/deploy.md`, „Aktualizacja: najpierw backup”).

### Rotacja

```bash
deploy/backup-rotate.sh <katalog_kopii> <N>     # np. deploy/backup-rotate.sh backups 14
```

Zostawia N najnowszych kompletnych kopii (`knowli-YYYYmmdd-HHMMSS` z
`SHA256SUMS`) i usuwa starsze katalogi kopii, także niekompletne.
Niekompletny katalog nowszy niż N-ta kompletna kopia (np. trwający backup)
zostaje i nie liczy się do N. Innych plików (`backup.log`) i katalogów nie
dotyka. N < 1, brak N albo brak katalogu kończą się błędem bez usuwania.

### Harmonogram i kopia poza host

Na hoście aplikacji (crontab użytkownika z dostępem do Dockera) — codzienny
backup, a po udanym backupie rotacja do 14 kopii:

```
15 23 * * *  cd /sciezka/do/knowli && mkdir -p backups && { deploy/backup.sh && deploy/backup-rotate.sh backups 14; } >> backups/backup.log 2>&1
```

Kopia poza host działa w trybie **pull**: drugi komputer (NAS, domowy PC)
sam pobiera kopie przez SSH, więc host aplikacji nie ma żadnych danych
dostępowych do miejsca kopii i jego przejęcie nie pozwala ich skasować. Na
drugiej maszynie (z kopią `deploy/backup-rotate.sh`, dłuższa retencja):

```
45 23 * * *  { rsync -a --delay-updates --chmod=D700,F600 --exclude backup.log host-knowli:/sciezka/do/knowli/backups/ /srv/knowli-backups/ && /srv/knowli-backup-rotate.sh /srv/knowli-backups 60; } >> /srv/knowli-backups/pull.log 2>&1
```

`--delay-updates` wstawia pobrane pliki na miejsce dopiero na końcu
transferu: przerwany pull nie zostawi `SHA256SUMS` bez archiwów (rsync
kopiuje w kolejności nazw, `SHA256SUMS` idzie przed `db.dump`), więc
rotacja nie policzy połowicznej kopii jako kompletnej. Kopia pobrana
w trakcie backupu nie ma jeszcze `SHA256SUMS` i uzupełni się przy
następnym pullu. Retencja poza hostem musi być **co najmniej taka jak na
hoście** (tu 60 ≥ 14) — inaczej pull bez `--delete` przywracałby kopie
usunięte przez rotację.

Bez `--delete`: rotacja na hoście nie kasuje kopii poza hostem — tam
retencję pilnuje własna rotacja. Klucz SSH drugiej maszyny ogranicz na hoście
do odczytu katalogu `backups/` (osobny użytkownik albo `rrsync -ro` w
`authorized_keys`). Z `rrsync -ro /sciezka/do/knowli/backups` ścieżka zdalna
jest względna wobec tego katalogu: w linii wyżej podaj `host-knowli:./`
zamiast pełnej ścieżki.

Nieudany backup nie wysyła alarmu (rotacja po prostu się nie wykona, stare
kopie zostają). Raz w tygodniu sprawdź na drugiej maszynie, że najnowsza
kopia ma najwyżej dobę i przechodzi kontrolę sum:
`ls -1d /srv/knowli-backups/knowli-* | tail -1` oraz
`(cd /srv/knowli-backups/knowli-<data> && sha256sum --check SHA256SUMS)`;
w razie problemu zajrzyj do `backups/backup.log` na hoście. Albo ustaw
`MAILTO` w crontabie, jeśli host wysyła pocztę.

Katalog `backups/` jest w `.gitignore` — kopie nie trafiają do repo.

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

## Raport osieroconych blobów mediów (dry-run, #386)

Przegrany CAS przy finalizacji zasobu może zostawić na wolumenie blob bez
wiersza w `media_assets`. Raport zestawia pliki o kształcie klucza z dysku
(`MEDIA_ROOT`) z kluczami osiągalnymi z bazy i wypisuje wyłącznie liczby:
ile blobów jest na dysku, ile z nich ma powiązanie, ile sierot jest po
okresie karencji (domyślnie 7 dni), ile jest młodszych oraz sumy bajtów.
Niczego nie usuwa ani nie modyfikuje; kasowanie to osobna decyzja na
podstawie kolejnych raportów.

```bash
pnpm media:orphan-report                      # karencja domyślna: 7 dni
pnpm media:orphan-report -- --min-age-days 30  # inna karencja
```

Wymaga `DATABASE_URL` i `MEDIA_ROOT` (domyślnie `./data/media`) w środowisku,
jak proces workera. Sierota młodsza niż karencja jest raportowana osobno:
zapis blobu wyprzedza transakcję zapisującą `storage_key`, więc młody plik
może jeszcze należeć do finalizującej się generacji.

## Test odtworzenia 2026-11-26 (#381)

Próbę powtarzaj co kwartał i po każdej zmianie `deploy/` lub wersji
PostgreSQL; dopisuj tu datę i wynik. Ostatnia: **2026-11-26**, lokalnie,
Docker 29.9.2, Compose v5.6.1, fake providerzy, projekty testowe
`knowli-backup-check` → `knowli-restore-check` (port 26910); dane rodziny
ani produkcja nie były dotykane.

1. Stack źródłowy z `deploy/compose.smoke.yaml`: obieg `smoke.mjs run`
   (profil, generacja, publikacja, przypisanie, sesja) — PASS.
2. `KNOWLI_PROJECT=knowli-backup-check deploy/backup.sh` → `db.dump`
   178 kB, `media.tgz` 3 kB, `SHA256SUMS`, manifest (PostgreSQL 17.11) —
   PASS, bez zatrzymywania aplikacji.
3. `deploy/restore.sh … -p knowli-restore-check`: kontrola sum,
   `pg_restore`, media, `migrate` no-op, web i worker healthy — PASS.
4. `smoke.mjs inspect` przed i po: identyczne profile, opublikowana wersja
   (7 elementów), postęp i sumy SHA256 trzech nagrań — PASS.

Pierwsze podejście pokazało różnicę w `inspect`, ale nie w danych:
skrypt wybierał „trzy pierwsze” nagrania w kolejności zwróconej przez bazę,
która po `pg_restore` jest inna. `inspect` sortuje teraz zasoby **przed**
wyborem; wspólne zasoby miały identyczne sumy, reszta zrzutu była zgodna.

Nadal niesprawdzone: odtworzenie na stacku Coolify i do projektu `knowli`
z `--yes` (runbook B w `docs/deploy.md`) oraz linie cron/rsync na
prawdziwych hostach.

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
