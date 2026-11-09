# Lekcje pisane przez agenta (MCP, token `lessons:write`)

Agent (Claude w claude.ai, Claude Code albo Claude Desktop) może napisać lekcję tematu z katalogu (np. angielska gramatyka) i zapisać ją jako szkic bez generatora. Publikację zawsze robi rodzic w panelu. Architektura: `docs/architecture.md` §13 (dostęp do `/api/mcp`) i §19.18.

## Narzędzia

Ten sam endpoint `POST /api/mcp` co raport Hermesa. Token z zakresem `lessons:write` widzi w `tools/list` tylko pięć narzędzi:

| Narzędzie | Działanie |
| --- | --- |
| `lesson_catalog` | Zasady pisania tematu z kodu: zagadnienia, karty, typy, księga reguł generatora, profil promptu przedmiotu, etapy, kolejność, limity |
| `lesson_validate` | Walidacja na sucho (nowa lekcja albo z `deckId`): błędy zadań per indeks, historyjka, pokrycie, ujawnienia razem ze zdaniami kart; bez zapisu i nagrań |
| `lesson_draft_create` | Szkic bez generatora w stanie `review`, `deckId = clientRequestId` (powtórka zwraca ten sam zestaw), nagrania TTS zlecone w tej samej transakcji |
| `lesson_draft_get` | Stan szkicu, a bez szkicu wersji opublikowanej; `id` zadań do poprawek |
| `lesson_draft_replace` | Pełna lista zadań; zadanie z `id` zachowuje historię dziecka, bez `id` jest nowe; zestaw opublikowany dostaje szkic i edycję w jednej transakcji |

Żadne narzędzie nie publikuje, nie archiwizuje, nie przypisuje dziecku i nie uruchamia generowania. Wyjścia nie zawierają profili dzieci, postępów, listy tematów zdań (`interests`), przypisań, kosztów, kodów runów ani modelu oceniającego. Zakres tokenu jest jednak szeroki: token czyta i nadpisuje każdą lekcję przedmiotu katalogowego rodziny, której `deckId` zna (także wygenerowaną przez rodzica i opublikowaną), a zdania takich lekcji mogą odzwierciedlać zainteresowania dziecka podane przy generowaniu. Traktuj go jak dostęp do treści lekcji rodziny. Run generowania rodzica w toku daje `conflict` (narzędzie go nie przerywa). Skill dla agenta: `integrations/umiem-mcp/skills/umiem-lesson-authoring/SKILL.md` (poza archiwum pakietu konsumenta Hermesa).

Limity tokenu `lessons:write`: żądanie do 512 KB, najwyżej 150 zadań, 10 zapisów (`create`/`replace`) na godzinę na token (każdy zapis zleca płatne nagrania TTS) i wspólny limit 60 żądań na minutę. Limity są per proces web, jak limit raportu.

## Wydanie tokenu

Token ma dokładnie jeden zakres (CLI i `CHECK` w bazie nie pozwalają łączyć `learning:read` z `lessons:write`). W chronionym środowisku workera:

```text
node apps/worker/node_modules/tsx/dist/cli.mjs apps/worker/src/integration-tokens.ts create --name claude-lessons --scope lessons:write --out /absolute/private/path/umiem-lessons-token
node apps/worker/node_modules/tsx/dist/cli.mjs apps/worker/src/integration-tokens.ts list
```

CLI zapisuje sekret tylko do nowego pliku o prywatnych uprawnieniach i wypisuje samo id. Token Hermesa (`learning:read`) zostaje wyłącznie w konfiguracji Hermesa i nigdy nie trafia do connectora claude.ai.

## Konfiguracja klientów

- **claude.ai (także telefon):** Settings → Connectors → Add custom connector; URL `https://<domena>/api/mcp`; w polu „Request headers” nagłówek `Authorization` o wartości `Bearer <token lessons:write>`. Connector nie używa OAuth.
- **Claude Code:** `claude mcp add --transport http umiem https://<domena>/api/mcp --header "Authorization: Bearer ${UMIEM_LESSONS_TOKEN}"` z tokenem w zmiennej środowiskowej, nie w repozytorium.
- **Claude Desktop:** zdalny serwer MCP z tym samym URL i nagłówkiem `Authorization` (pole nagłówków w ustawieniach connectora albo wpis `mcpServers` z `url` i `headers`).

Przed pierwszym użyciem w czacie: „Napisz lekcję Present Continuous dla mojego dziecka” — skill każe najpierw zapytać rodzica o wiek, poziom i znane słowa.

## Wystawienie `/api/mcp` w proxy Coolify (krok operacyjny)

Decyzja właściciela 2026-11-09 (wariant B, `docs/architecture.md` §13): z zewnątrz dostępna jest tylko ścieżka `/api/mcp`, chroniona tokenem Bearer. Panel rodzica, Kid API, media i logowanie PIN-em zostają za bramą rodzinną.

1. W Coolify dodaj osobną regułę routera (Traefik) dla publicznej domeny lub hosta z warunkiem ``Path(`/api/mcp`)`` (dokładnie ta ścieżka), kierującą do usługi web; nie wystawiaj reguły dla `/`.
2. Do tej reguły dołącz middleware Traefik `rateLimit` (aplikacja liczy limity dopiero po uwierzytelnieniu, więc przed sprawdzeniem tokenu chroni tylko proxy), np. w etykietach usługi:

   ```text
   traefik.http.middlewares.umiem-mcp-ratelimit.ratelimit.average=30
   traefik.http.middlewares.umiem-mcp-ratelimit.ratelimit.period=1m
   traefik.http.middlewares.umiem-mcp-ratelimit.ratelimit.burst=10
   traefik.http.routers.<router-mcp>.middlewares=umiem-mcp-ratelimit
   ```

   Limit jest per adres klienta; dobierz wartości tak, by nie blokowały pojedynczego agenta (60 żądań na minutę na token po stronie aplikacji).
3. Pozostałe ścieżki publicznej domeny mają odpowiadać 404/403 albo nie mieć routera.
4. Sprawdź z sieci spoza domu:
   - `curl -i https://<domena>/api/mcp` bez nagłówka → 401 z `WWW-Authenticate: Bearer`;
   - `curl -i` dla `https://<domena>/`, `https://<domena>/parent`, `https://<domena>/api/v1/parent/subjects` i dowolnej ścieżki `https://<domena>/api/v1/kid/…` → brak dostępu (nie 200);
   - connector claude.ai widzi pięć narzędzi;
   - seria szybkich żądań bez tokenu dostaje 429 od proxy.
5. `UMIEM_MCP_ALLOWED_ORIGINS` zostaw pusty, chyba że klient przeglądarkowy wysyła `Origin` (wtedy dokładne originy HTTPS).

## Unieważnianie tokenu

```text
node apps/worker/node_modules/tsx/dist/cli.mjs apps/worker/src/integration-tokens.ts revoke --id <uuid>
```

Odwołanie działa od następnego żądania: granica HTTP sprawdza token przy każdym żądaniu, a zapisy i odczyty szkicu sprawdzają go ponownie w swojej transakcji. Przy podejrzeniu wycieku odwołaj token, wydaj nowy i podmień go w connectorach; szkice utworzone przez wyciekły token przejrzyj w panelu (żaden nie jest opublikowany bez rodzica).

## Kontrakt

Źródło schematów: `packages/contracts/src/lesson-authoring.ts` (`inputSchema` i `outputSchema` narzędzi). Klienci MCP pobierają je z `tools/list`, więc nie ma osobnego JSON Schema ani manifestu u konsumenta; pakiet konsumenta Hermesa i kontrakt `learning-overview` są bez zmian. Wersja serwera MCP: 0.3.0.
