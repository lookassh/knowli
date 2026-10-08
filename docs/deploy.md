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
   - `OPENAI_API_KEY` (worker: LLM/TTS/obrazy), `AZURE_SPEECH_KEY` +
     `AZURE_SPEECH_REGION` (web: próby ustne dziecka),
   - opcjonalnie `WEB_PORT`.
2. Zbuduj i uruchom stack:

   ```bash
   docker compose --env-file .env -f deploy/compose.yaml up -d --build
   ```

3. Otwórz `http://<host>:8080` i zakończ pierwsze uruchomienie: ustawienie PIN-u
   rodzica (jednorazowy setup znika po zapisaniu).

Aktualizacja aplikacji: `git pull` + ponownie `up -d --build` — migracje
odpalają się automatycznie przed startem web/worker.

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
  `.env.example`); Coolify wstrzykuje je do kontenerów.
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
- Sekrety (`OPENAI_API_KEY`, `AZURE_SPEECH_*`, `POSTGRES_PASSWORD`) żyją
  wyłącznie w środowisku kontenerów (Coolify secrets / `.env` poza repo);
  web i worker dostają je z jednego pliku, żeby ustawienia medialne
  (fingerprinty) zawsze były identyczne — patrz `docs/provider-config.md`.
- Nagrania ustne dziecka nie są utrwalane nigdzie — nie trafiają ani do bazy,
  ani do wolumenu mediów, ani tym samym do backupów (patrz
  `docs/backup-restore.md`).
