# Lekcje pisane przez agenta (MCP, token `lessons:write`)

Agent (Claude w claude.ai, Claude Code albo Claude Desktop) może napisać lekcję tematu z katalogu (np. angielska gramatyka) i zapisać ją jako szkic bez generatora, a istniejącą lekcję — także szkolną albo rozdział, złożoną z materiału rodzica — odczytać, zwalidować, poprawić i uzupełnić o nowe zadania po `deckId`. Publikację zawsze robi rodzic w panelu. Architektura: `docs/architecture.md` §13 (dostęp do `/api/mcp`) i §19.18.

## Narzędzia

Ten sam endpoint `POST /api/mcp` co raport Hermesa. Token z zakresem `lessons:write` widzi w `tools/list` tylko sześć narzędzi:

| Narzędzie | Działanie |
| --- | --- |
| `lesson_catalog` | Zasady pisania: zagadnienia, karty, typy, księga reguł generatora, profil promptu przedmiotu, etapy, kolejność, limity. Temat katalogowy (`subjectId` + `topicId`) albo istniejąca lekcja (`deckId`, także z materiału rodzica); `objectiveIds` zawęża odpowiedź (księga reguł ma ok. 26 KB na zagadnienie szkolne) |
| `lesson_validate` | Walidacja na sucho (nowa lekcja albo z `deckId`): błędy zadań per indeks i pole, historyjka, pokrycie, ujawnienia razem ze zdaniami kart; z `append: true` nowe zadania sprawdzane razem z zapisaną pulą (`firstNewIndex`); bez zapisu i nagrań |
| `lesson_draft_create` | Szkic bez generatora w stanie `review`, `deckId = clientRequestId` (powtórka zwraca ten sam zestaw), nagrania TTS zlecone w tej samej transakcji |
| `lesson_draft_get` | Stan szkicu, a bez szkicu wersji opublikowanej: zagadnienia (`id`, nazwa, karty, dozwolone typy), materiał lekcji (źródło cytatów `sourceRefs`), nazwa przedmiotu rodzica i pełne zadania (klucz, warianty, kryteria, źródła) z `id` do poprawek |
| `lesson_draft_replace` | Pełna lista zadań; zadanie z `id` zachowuje historię dziecka, bez `id` jest nowe; zestaw opublikowany dostaje szkic i edycję w jednej transakcji |
| `lesson_draft_append` | Nowe zadania (bez `id`) na koniec puli bez odsyłania reszty; zapisane zadania zachowują `id` i historię, walidowana jest cała pula po dopisaniu, wynik niesie `exerciseIds`; zestaw opublikowany dostaje szkic w tej samej transakcji |

Żadne narzędzie nie publikuje, nie archiwizuje, nie przypisuje dziecku i nie uruchamia generowania. Wyjścia nie zawierają profili dzieci, postępów, listy tematów zdań (`interests`), przypisań, kosztów, kodów runów ani modelu oceniającego. Zakres tokenu jest jednak szeroki: token czyta i nadpisuje każdą lekcję rodziny, której `deckId` zna (także wygenerowaną przez rodzica i opublikowaną), razem z materiałem wklejonym przez rodzica; zdania takich lekcji mogą odzwierciedlać zainteresowania dziecka podane przy generowaniu. Lekcji z materiału rodzica nie da się utworzyć od zera (`lesson_draft_create` i walidacja bez `deckId` przyjmują tylko przedmioty katalogowe), a zagadnień i kart takiej lekcji narzędzia nie zmieniają. Cytat `sourceRefs` musi występować w materiale lekcji; flagę `parentAdded` (własne źródło rodzica, bez sprawdzenia w materiale) agent może tylko zachować na zapisanym cytacie, który już ją ma, w zadaniu o tym samym typie, zagadnieniu i odpowiedzi — inaczej `validation` z `details.parentAdded`. Traktuj go jak dostęp do treści lekcji rodziny. Run generowania puli ćwiczeń rodzica w toku daje `conflict` (narzędzie go nie przerywa); run historyjki nie blokuje edycji ćwiczeń i zostaje w kolejce, a poprawka z polem `story` go unieważnia. Skill dla agenta: `integrations/umiem-mcp/skills/umiem-lesson-authoring/SKILL.md` (poza archiwum pakietu konsumenta Hermesa).

Limity tokenu `lessons:write`: żądanie do 512 KB, najwyżej 150 zadań, 10 zapisów (`create`/`replace`/`append`) na godzinę na token (każdy zapis zleca płatne nagrania TTS) i wspólny limit 60 żądań na minutę. Limity są per proces web, jak limit raportu.

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

## Dostęp z zewnątrz

Decyzja właściciela 2026-11-09 (wariant B, `docs/architecture.md` §13): `/api/mcp` jest osiągalne z internetu i chronione tokenem Bearer, bo connector claude.ai nie przejdzie przez VPN ani bramę rodzinną.

Stan produkcji (sprawdzony 2026-11-09): cała aplikacja jest publiczna — DNS przez Cloudflare, router Traefik w Coolify `Host(umiem.devforce.pl) && PathPrefix(/)` bez filtra IP. Narzędzia działają więc od razu po wdrożeniu, bez zmian w proxy. Sprawdzenie po wdrożeniu:

- `curl -i -X POST https://<domena>/api/mcp` bez nagłówka → 401 z `WWW-Authenticate: Bearer`;
- connector claude.ai z tokenem `lessons:write` widzi sześć narzędzi.

Opcjonalne utwardzenie (nie jest warunkiem działania):

- **Limit żądań przed uwierzytelnieniem.** Aplikacja liczy limity dopiero po sprawdzeniu tokenu, a zły token kosztuje jedno zapytanie do bazy po kluczu. Limit przed tokenem ustaw jako regułę Rate Limiting w Cloudflare dla ścieżki `/api/mcp` (np. kilkadziesiąt żądań na minutę na adres). Limit `rateLimit` w Traefik nie nadaje się za Cloudflare: Traefik widzi adresy Cloudflare, więc jeden licznik objąłby wszystkich klientów.
- **Zawężenie publicznej domeny.** Wystawienie publicznie tylko `/api/mcp` (np. regułą w Cloudflare albo osobnym routerem Traefik z ``Path(`/api/mcp`)``) zamknęłoby też panel i Kid API przed internetem. To osobna decyzja o dostępie rodzinnym (`docs/architecture.md` §13): dziś panel chroni PIN, a Kid API nie ma osobnej ochrony.

`UMIEM_MCP_ALLOWED_ORIGINS` zostaw pusty, chyba że klient przeglądarkowy wysyła `Origin` (wtedy dokładne originy HTTPS).

## Unieważnianie tokenu

```text
node apps/worker/node_modules/tsx/dist/cli.mjs apps/worker/src/integration-tokens.ts revoke --id <uuid>
```

Odwołanie działa od następnego żądania: granica HTTP sprawdza token przy każdym żądaniu, a zapisy i odczyty szkicu sprawdzają go ponownie w swojej transakcji. Przy podejrzeniu wycieku odwołaj token, wydaj nowy i podmień go w connectorach; szkice utworzone przez wyciekły token przejrzyj w panelu (żaden nie jest opublikowany bez rodzica).

## Kontrakt

Źródło schematów: `packages/contracts/src/lesson-authoring.ts` (`inputSchema` i `outputSchema` narzędzi). Klienci MCP pobierają je z `tools/list`, więc nie ma osobnego JSON Schema ani manifestu u konsumenta; pakiet konsumenta Hermesa i kontrakt `learning-overview` są bez zmian. Wersja serwera MCP: 0.4.0 (0.4.0: lekcje z materiału rodzica po `deckId`, `lesson_draft_append`, `lesson_catalog` z `deckId`/`objectiveIds`, `lesson_validate` z `append`, nowe pola `objectives`, `material`, `subjectTitlePl` w `lesson_draft_get`; zmiany addytywne, dotychczasowe wywołania działają bez zmian).
