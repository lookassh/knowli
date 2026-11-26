# Wdrożenie prywatne — Docker Compose i Coolify

Wersja bazowa: zadanie 11 planu implementacji. Stack rodzinny Knowli/Umiem!
składa się z czterech serwisów compose (definicja: `deploy/compose.yaml`):

| Serwis | Obraz | rola | dostęp |
| --- | --- | --- | --- |
| `db` | `postgres:17.11-alpine` | jedyna baza aplikacji i kolejki | prywatny, bez portów hosta |
| `migrate` | `deploy/Dockerfile` target `worker` | jednorazowe migracje Drizzle przy starcie | jeden shot, `restart: no` |
| `web` | `deploy/Dockerfile` target `web` | panel rodzica + Kid UI (Next.js standalone) | jedyny port hosta (`WEB_PORT`, domyślnie 8080) |
| `worker` | `deploy/Dockerfile` target `worker` | pętla generacji materiałów (tsx) | prywatny; healthcheck na `127.0.0.1:9301/health` |

Healthchecki: web wystawia publiczny `GET /api/v1/health` (sprawdza też bazę),
worker odpowiada na `/health` tylko z wnętrza kontenera. `web` i `worker`
startują dopiero po `service_completed_successfully` serwisu `migrate`.

Wolumeny: `knowli-db` (baza) i `knowli-media` (trwałe audio/obrazy, wspólny
dla web i worker). Wersje obrazów bazowych są przypięte w plikach
(`deploy/Dockerfile`, `deploy/compose.yaml`) — podnoszenie celowe, nie przy
każdym deploju.

## Pierwsze uruchomienie (lokalnie / na serwerze w domu)

1. Przygotuj `.env` z korzenia repo na podstawie `.env.example`:
   - `POSTGRES_PASSWORD` — wymagane (baza w kontenerze),
   - `OPENAI_API_KEY` (worker i web: obrazy), `OPENROUTER_API_KEY` (worker:
     generator materiału i nagrania lektora, web: grader odpowiedzi lekcji —
     modele, głos i ton są w domyślnej konfiguracji
     `packages/server/src/config-defaults.ts`),
     `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` (web: próby ustne dziecka),
   - **lekcje wymagają klucza OpenRouter** (`OPENROUTER_API_KEY`,
     `UMIEM_LESSON_AGENT_API_KEY` albo `UMIEM_LLM_API_KEY` przy `UMIEM_LLM_BASE_URL`
     na https OpenRouter) w web i w worker — przebieg bazowy w workerze jest jedynym
     generatorem lekcji (sekcja „Generowanie lekcji” niżej),
   - `OPENAI_API_KEY` trafia wyłącznie do `https://api.openai.com`, a wspólny
     klucz wyłącznie po https na openrouter.ai; klucz w złym miejscu kończy start
     błędem z nazwą zmiennej (szczegóły: `docs/provider-config.md`),
   - `UMIEM_SETUP_TOKEN` — wymagane do pierwszego ustawienia PIN-u rodzica
     (#307, decyzja właściciela z 2026-11-06): długi losowy kod, np.
     `openssl rand -hex 16`. Bez niego ekran „Pierwsze uruchomienie” odrzuca
     ustawienie PIN-u, więc świeżej instancji nie przejmie pierwszy odwiedzający,
   - opcjonalnie `WEB_PORT`.
2. Zbuduj i uruchom stack:

   ```bash
   docker compose --env-file .env -f deploy/compose.yaml up -d --build
   ```

3. Otwórz `http://<host>:8080/parent` i zakończ pierwsze uruchomienie: wpisz
   nowy PIN rodzica i jako „Kod konfiguracji” wartość `UMIEM_SETUP_TOKEN`
   (jednorazowy setup znika po zapisaniu). Potem możesz usunąć zmienną z `.env`.
   PIN zmienisz w panelu („Zmień PIN”, wymaga obecnego PIN-u); zmiana wylogowuje
   wszystkie urządzenia. Zapomniany PIN: usuń wiersz
   `learning_app.parent_credentials` w bazie, ustaw `UMIEM_SETUP_TOKEN`
   i uruchom web ponownie.

## Aktualizacja: najpierw backup (#381)

**Twarda reguła: żadnego `up -d --build` ani deployu w Coolify bez świeżej,
kompletnej kopii.** Migracje odpalają się automatycznie przed startem
web/worker na jedynej bazie rodziny; nie ma migracji w dół, więc jedyną drogą
powrotu po złej migracji jest kopia sprzed deployu.

1. `deploy/backup.sh` — sprawdź, że w nowym katalogu `backups/knowli-<data>/`
   jest `SHA256SUMS` (znacznik kompletnej kopii). Zapisz bieżący commit:
   `git rev-parse HEAD` (wersja do powrotu).
2. `git pull`
3. `docker compose --env-file .env -f deploy/compose.yaml up -d --build`
4. `docker compose --env-file .env -f deploy/compose.yaml ps` — `migrate`
   zakończony kodem 0, `web` i `worker` healthy; otwórz panel rodzica.

**Coolify:** wyłącz automatyczny deploy po pushu (Auto Deploy) — deploy jest
ręcznym krokiem po backupie. Na hoście uruchom backup z kopii repo, wskazując
projekt compose nadany przez Coolify (`docker compose ls`):
`KNOWLI_PROJECT=<projekt> KNOWLI_ENV_FILE=<plik z POSTGRES_PASSWORD> deploy/backup.sh`.
Dopiero potem „Deploy” w Coolify. (Wywołanie skryptów na stacku Coolify nie
zostało jeszcze sprawdzone — przy pierwszym użyciu porównaj nazwę wolumenu
mediów z `docker volume ls`; skrypt oczekuje `<projekt>_knowli-media`.)
**Nie uruchamiaj `deploy/restore.sh -p <projekt Coolify>`**: dla każdego
projektu innego niż `knowli` skrypt robi `compose down -v`, czyli kasuje
wolumeny rodziny. Odtworzenie na stacku Coolify nie ma jeszcze sprawdzonej
procedury — runbook B niżej dotyczy stacka compose `knowli`.

### Runbook: nieudana migracja

Wszystkie oczekujące migracje Drizzle wykonują się w **jednej transakcji**
(`migrateDatabase`, `packages/server/src/db/client.ts`); dopiero po niej,
osobno, idempotentne `ensureLearningPolicy`. Obecne migracje nie mają
poleceń działających poza transakcją (np. `CREATE INDEX CONCURRENTLY`);
migracja z takim poleceniem wymaga własnego planu powrotu w swoim PR.

**A. `migrate` padł** (`ps` pokazuje `migrate` z kodem ≠ 0, web/worker nie
wstają):

1. Przyczyna: `docker compose --env-file .env -f deploy/compose.yaml logs migrate`.
2. Transakcja została wycofana — schemat i dane są w stanie sprzed deployu,
   restore nie jest potrzebny.
3. Powrót kodu: `git checkout <zapisany commit>` i ponownie
   `up -d --build`; migracje starej wersji są już zastosowane, więc `migrate`
   jest no-op i stara wersja wstaje na niezmienionej bazie.
4. Poprawka trafia nowym PR-em; po jego scaleniu wróć na `main` i powtórz
   procedurę aktualizacji od backupu.

(Wyjątek: jeśli w logu błąd dotyczy `ensureLearningPolicy`, migracje schematu
już przeszły — postępuj jak w B.)

**B. Migracja przeszła, ale wersja jest zła** (błędy aplikacji, utrata
funkcji, podejrzane dane): sam powrót kodu nie wystarcza — stara wersja
działałaby na nowszym schemacie. Wracasz do kopii sprzed deployu; dane
zapisane po deployu (próby dzieci, nowe materiały) przepadają.

1. `git checkout <zapisany commit>` i zbuduj obrazy starej wersji:
   `docker compose --env-file .env -f deploy/compose.yaml build`
   (`restore.sh` startuje istniejące obrazy, nie buduje ich).
2. **Przed czyszczeniem bazy** (`restore.sh` sprawdza sumy dopiero po nim):
   - zrób kopię bieżącego, złego stanu — `deploy/backup.sh` — żeby dane
     zapisane po deployu dało się później ręcznie odzyskać; ta kopia jest
     nowsza, więc w kroku 4 podaj jawnie katalog kopii sprzed deployu,
   - sprawdź kopię sprzed deployu:
     `(cd backups/knowli-<data> && sha256sum --check SHA256SUMS)`;
     opcjonalnie odtwórz ją na osobnej instancji:
     `deploy/restore.sh backups/knowli-<data>` (projekt `knowli-restore`).
3. `pg_restore --clean` usuwa tylko obiekty obecne w kopii, a tabele dodane
   przez złą migrację by zostały — dlatego wyczyść bazę rodziny przed
   odtworzeniem:

   ```bash
   c="docker compose --env-file .env -f deploy/compose.yaml"
   $c stop web worker
   $c exec -T db dropdb -U postgres --force knowli
   $c exec -T db createdb -U postgres knowli
   ```

4. `deploy/restore.sh backups/knowli-<data> -p knowli --yes` — kontrola sum,
   `pg_restore`, media, start starej wersji (migracje no-op).
5. Zweryfikuj panel rodzica (`node deploy/smoke.mjs inspect … <PIN>`) i opisz
   w issue, które dane po deployu przepadły.

## Generowanie lekcji (przebieg bazowy)

Lekcje wszystkich przedmiotów generuje przebieg bazowy w workerze (paczki
zagadnienie × typ i kontrola zadań zamkniętych przez OpenRouter; od etapu 5c,
#362, bez dawnego agenta puli; opis i zmienne: `docs/provider-config.md`, sekcja
„Generator puli lekcji”). Co to znaczy przy wdrożeniu:

- **Klucz.** `OPENROUTER_API_KEY` (albo `UMIEM_LESSON_AGENT_API_KEY`; trzecia
  rezerwa to `UMIEM_LLM_API_KEY`, gdy `UMIEM_LLM_BASE_URL` wskazuje https
  OpenRouter — kolejność w `docs/provider-config.md`) musi być w web **i** w worker. Używaj w obu serwisach tego samego klucza i tych samych
  `UMIEM_LESSON_AGENT_MODEL` / `UMIEM_LESSON_AGENT_CHECKER_MODEL`: etykiety usług
  w panelu rodzica pochodzą z web, a lekcje liczy worker. Po dodaniu albo zmianie
  klucza zrestartuj oba serwisy.
- **Bez klucza** panel rodzica pokazuje „Generowanie lekcji wymaga klucza
  OpenRouter w konfiguracji serwera. Po dodaniu klucza ponów generowanie.” i
  wyłącza tworzenie i dogenerowanie lekcji (zestawy słówek działają), a worker
  kończy runy lekcji kodem `lesson_agent_unavailable` bez wywołań modeli. Worker
  wstaje bez klucza tylko wtedy, gdy LLM i TTS są skonfigurowane na OpenAI-direct
  (log startu: `[config] lesson-agent=unavailable reason=no_openrouter_key`);
  przy domyślnych adresach OpenRouter brak klucza nadal zatrzymuje start
  (`UMIEM_LLM_BASE_URL`, `UMIEM_TTS_BASE_URL`). Po dodaniu klucza i restarcie
  rodzic ponawia generowanie przyciskiem „Ponów”.
- **Walidacja.** Zmienne `UMIEM_LESSON_AGENT_*` worker sprawdza przy każdym
  starcie; zła wartość (liczba, wysiłek rozumowania, routing, ta sama rodzina
  modeli generatora i checkera, klucz w kształcie OpenAI) zatrzymuje start z nazwą
  zmiennej. Web ich nie waliduje.
- **Usunięte ustawienia.** `UMIEM_LESSON_AGENT_SUBJECTS`,
  `UMIEM_LESSON_AGENT_MAX_STEPS` i `UMIEM_LESSON_AGENT_OBJECTIVE_TIMEOUT_MS` już
  nie istnieją; pozostawione w `.env` są ignorowane, ale warto je usunąć. Worker
  nie woła już modelu oceniającego (`UMIEM_GRADER_*` jest potrzebne w web).
- **Koszt.** Sondy etapu 5 (2026-11-08): rozdział ok. 0,3, szkoła ok. 0,4 USD na
  lekcję z kontrolą zadań zamkniętych; domyślny budżet runu to 1,00 USD (`UMIEM_LESSON_AGENT_RUN_BUDGET_USD`).
  Koszty widać w sekcji „Koszty” panelu rodzica.
- **Zmiana niezgodna dla OpenAI-direct.** Instancja bez klucza OpenRouter (LLM i
  TTS na `api.openai.com`) traci generowanie lekcji; słówka, TTS i ilustracje
  działają jak dotąd.
- **Wycofanie.** Zmiana nie ma migracji bazy: `git revert` PR etapu 3 PR 2 i
  ponowne wdrożenie przywracają dawny potok. Runy zakończone już kodem
  `lesson_agent_unavailable` pokażą po wycofaniu ogólny komunikat błędu (dawny
  katalog komunikatów nie zna tego kodu) — wystarczy je ponowić; szkice i punkty
  kontrolne agenta pozostają czytelne.

## Test dymny wdrożenia

```bash
deploy/smoke.sh
```

Skrypt stawia osobny projekt `knowli-smoke` (fake providerzy, własne
wolumeny, port `127.0.0.1:24700`), prowadzi pełny obieg przez publiczne API
(generacja → publikacja → przypisanie → sesja dziecka), restartuje kontenery
`web` i `worker`, a potem weryfikuje, że profile, postęp i bajty mediów są
identyczne. Po próbie projekt smoke jest usuwany (`down -v`). Nie dotyka
danych rodzinnych ani kluczy.

## Coolify (docelowy sposób uruchomienia w domu)

Stack uruchamiaj jako zasób typu **Docker Compose** — Coolify buduje obrazy z
repozytorium (`deploy/compose.yaml`; `build.context` wskazuje korzeń repo).

- **Środowisko**: te same zmienne co w `.env` (sekcja Compose w
  `.env.example`); Coolify wstrzykuje je do kontenerów. Ustaw
  `UMIEM_SETUP_TOKEN` (jako sekret, przy usłudze `web`) **przed** pierwszym
  deployem — Coolify wystawia web pod adresem z domeną od razu, a bez kodu
  ustawienie PIN-u jest wyłączone.
- **Trwałe dane**: wolumeny `knowli-db` i `knowli-media` mapuj na persistent
  storage Coolify — to jedyne dwa miejsca z danymi rodziny.
- **HTTPS**: Coolify wystawia web przez własny reverse proxy z certyfikatem;
  sam compose wystawia tylko HTTP. Mikrofon dziecka (getUserMedia) wymaga
  HTTPS — na tablecie korzystaj z adresu przez proxy Coolify, nie z
  gołego `http://ip:8080`.
- **Publiczne wystawienie poza dom** wymaga wcześniejszej, osobnej decyzji o
  bramie dostępu (plan, bramka 4); MVP działa prywatnie w sieci domowej.

## Bezpieczeństwo wdrożenia

- Tylko `web` ma port hosta; `db` i `worker` są w prywatnej sieci compose.
- Pierwsze ustawienie PIN-u rodzica wymaga kodu `UMIEM_SETUP_TOKEN` (bez
  wartości domyślnej; brak = setup wyłączony). Błędne kody liczą się do limitu
  prób logowania (5 w 15 min). Kod nie zastępuje bramy dostępu: Kid API
  pozostaje zaufanym API sieci domowej.
- Sekrety (`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, ewentualne `UMIEM_*_API_KEY`, `AZURE_SPEECH_*`, `POSTGRES_PASSWORD`) żyją
  wyłącznie w środowisku kontenerów (Coolify secrets / `.env` poza repo);
  web i worker dostają je z jednego pliku, żeby ustawienia medialne
  (fingerprinty) zawsze były identyczne — patrz `docs/provider-config.md`.
- Nagrania ustne dziecka nie są utrwalane nigdzie — nie trafiają ani do bazy,
  ani do wolumenu mediów, ani tym samym do backupów (patrz
  `docs/backup-restore.md`).
