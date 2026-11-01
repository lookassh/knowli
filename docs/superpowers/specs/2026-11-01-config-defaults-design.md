# Domyślna konfiguracja w repo, `.env` tylko nadpisuje — design

Data: 2026-11-01. Decyzja właściciela (czat 2026-11-01): jeden plik z domyślną
konfiguracją w repozytorium, `.env` nadpisuje ją; jeden wspólny
`OPENROUTER_API_KEY`; ton lektora (`UMIEM_TTS_STYLE=instructions`) domyślnie
włączony. Wersja po review trzech krytyków (bezpieczeństwo kluczy, mechanizm w
procesach, testy i regresje) — rozstrzygnięcia w §5.

## 1. Problem

Dziś kod ma własne wartości awaryjne (OpenAI: `gpt-4o-mini`, `gpt-4o-mini-tts`,
głos `alloy`, mp3, bez stylu), a wybrana konfiguracja (OpenRouter, Gemini 3.8
Flash, Gemini 3.8 Flash TTS, głos Kore, WAV, instrukcje wymowy, styl) żyje
wyłącznie w `.env.example` i w `.env` instancji. Właściciel musi pamiętać
kilkanaście zmiennych i ten sam klucz OpenRouter wpisuje trzy razy.

## 2. Rozwiązanie

### 2.1 Plik domyślnych

`packages/server/src/config-defaults.ts` — płaska, skomentowana lista
`NAZWA_ZMIENNEJ → wartość` (bez sekretów) oraz czysta funkcja
`withConfigDefaults(env)`: nowy obiekt, w którym każda domyślna zmienna ma
wartość z `env`, gdy jest niepusta, inaczej domyślną; pozostałe klucze bez
zmian. Pusta wartość w `.env` (`X=`) znaczy „nie ustawiono”. Bez mutacji
`process.env`.

Domyślne warunkowe (`when(env)`, liczone na `env` już po nałożeniu
bezwarunkowych domyślnych i nadpisań): `UMIEM_LLM_REASONING=low` i
`UMIEM_GRADER_REASONING=low` tylko wtedy, gdy efektywny `<P>_BASE_URL` to
OpenRouter — przy innym endpoincie `chatRequestExtrasFromEnv` odrzuca opcje
pośrednika błędem startu.

Zawartość (z `.env.example` i obecnego `.env` właściciela):

| Grupa | Zmienne |
| --- | --- |
| TTS | `UMIEM_TTS_PROVIDER=openrouter`, `UMIEM_TTS_MODEL=google/gemini-3.8-flash-tts`, `UMIEM_TTS_VOICE=Kore`, `UMIEM_TTS_FORMAT=wav`, `UMIEM_TTS_INSTRUCTIONS_PL_PL`, `UMIEM_TTS_INSTRUCTIONS_EN_GB`, `UMIEM_TTS_STYLE=instructions`, `UMIEM_TTS_BASE_URL=https://openrouter.ai/api/v1` |
| Generator materiału | `UMIEM_LLM_MODEL=google/gemini-3.8-flash`, `UMIEM_LLM_BASE_URL=https://openrouter.ai/api/v1`, `UMIEM_LLM_REASONING=low` (warunkowo) |
| Grader i ocena aktywności | `UMIEM_GRADER_BASE_URL=https://openrouter.ai/api/v1`, `UMIEM_GRADER_MODEL=google/gemini-3.8-flash`, `UMIEM_GRADER_REASONING=low` (warunkowo), `UMIEM_GRADER_TIMEOUT_MS=8000`, `UMIEM_GRADER_MAX_CALLS_PER_SESSION=20`, `UMIEM_SESSION_ACTIVITY_TIMEOUT_MS=60000` |
| Obrazy | `UMIEM_IMAGE_PROVIDER=openai`, `UMIEM_IMAGE_MODEL=gpt-image-2.5-sunburst`, `UMIEM_IMAGE_SIZE=1024x1024`, `UMIEM_IMAGE_QUALITY=low`, `UMIEM_IMAGE_FORMAT=webp` |
| Generacja lekcji | `UMIEM_LESSON_GENERATION_REQUEST_TIMEOUT_MS=90000`, `..._RUN_TIMEOUT_MS=600000`, `..._CANCEL_POLL_MS=1000` |
| Worker | `WORKER_POLL_MS=2000`, `WORKER_HEALTH_STALE_MS=900000` |

Poza plikiem: sekrety, `DATABASE_URL`, `MEDIA_ROOT`, Azure, dyktowanie
(`UMIEM_LESSON_STT_*` — domyślnie wyłączone, wymaga własnego klucza, bez
wspólnego), `UMIEM_GRADER_ENABLED` (brak = nie używaj wspólnego klucza),
`*_PROVIDER_DATA_COLLECTION` (nie sprawdzono, czy `deny` + ścisły
`json_schema` zostawia endpoint Gemini — zostaje zalecanym nadpisaniem),
`UMIEM_MCP_ALLOWED_ORIGINS`, tryb fake.

Wartości awaryjne w parserach (`defaultMediaSettings`, `DEFAULT_*`) zostają —
obowiązują wywołania bez `withConfigDefaults` (testy jednostkowe). Test pilnuje,
że liczbowe i obrazowe domyślne w pliku są równe tym stałym.

### 2.2 Wspólny klucz OpenRouter

`OPENROUTER_API_KEY` — zapas klucza dla LLM i TTS (oraz gradera po jawnym
włączeniu, §2.3), gdy efektywny `<P>_BASE_URL` jest bezpiecznym endpointem
OpenRouter: `https:`, host `openrouter.ai`/`eu.openrouter.ai`/`us.openrouter.ai`
(przez `new URL().hostname`, bez userinfo). Własny `<P>_API_KEY` ma
pierwszeństwo. Wspólny klucz nigdy nie trafia do innego hosta ani po `http://`.

Reguły dziś obowiązujące zostają: `OPENAI_API_KEY` tylko do api.openai.com i
nie może być kluczem OpenRouter; klucz OpenRouter bez BASE_URL OpenRouter to
błąd startu. Nowy strażnik odwrotny: klucz w kształcie OpenAI (`sk-…`, nie
`sk-or-…`) skierowany na endpoint OpenRouter (np. `UMIEM_TTS_API_KEY=sk-proj-…`
przy domyślnym BASE_URL) to błąd startu — inaczej domyślny BASE_URL wysłałby
klucz OpenAI do OpenRouter. Także `OPENROUTER_API_KEY` w kształcie OpenAI —
błąd. Błędy podają wyłącznie nazwy zmiennych.

Komunikat workera bez klucza wymienia `OPENAI_API_KEY` (obrazy) i
`OPENROUTER_API_KEY` (LLM, TTS).

### 2.3 Grader: zgoda na wysyłanie odpowiedzi dzieci

Grader (i ocena aktywności sesji) jest włączony, gdy:

- `UMIEM_GRADER_API_KEY` jest ustawiony (jak dziś: świadoma konfiguracja), albo
- `UMIEM_GRADER_ENABLED=true` i jest wspólny `OPENROUTER_API_KEY`.

`UMIEM_GRADER_ENABLED=false` wyłącza go zawsze. Brak flagi i brak własnego
klucza = wyłączony, nawet przy wspólnym kluczu: odpowiedzi dzieci nie wychodzą
z domu bez decyzji operatora. `ENABLED=true` bez żadnego klucza — błąd startu.
Flaga przyjmuje `true/false/1/0` bez względu na wielkość liter, inna wartość
— błąd startu. BASE_URL i MODEL zawsze uzupełniają domyślne, więc stary błąd
„all of BASE_URL, API_KEY and MODEL” dotyczy już tylko wywołań bez domyślnych
(testy, skrypty) i tam zostaje bez zmian.

Worker ustala „grader będzie dostępny” (preferencja typów przy generacji,
`lesson-drafts.ts`) tą samą funkcją co web, `graderConfigured(env)`; wynik
trafia do `GenerationDeps.graderAvailable` w kompozycji, a `lesson-drafts.ts`
przestaje czytać `process.env`.

W trybie `UMIEM_FAKE_PROVIDERS=1` fake grader ma pierwszeństwo przed
prawdziwym (dziś odwrotnie) — E2E i smoke nigdy nie wysyłają danych do sieci,
nawet z kluczem w powłoce.

### 2.4 Gdzie stosowane

`const env = withConfigDefaults(process.env)` i przekazanie `env` do parserów
w: kompozycji web (`apps/web/src/composition.ts`), kompozycji i pętli workera
(`apps/worker/src/composition.ts`, `main.ts`), CLI `regenerate-ui-audio.ts`,
skryptach `scripts/*.mts`, które budują providery ze zmiennych (po ich
własnym loaderze `.env`). Web i worker liczą te same wartości z tego samego
kodu, więc fingerprinty mediów się zgadzają.

Wyłączniki i powroty (nadpisania w `.env`): ton — `UMIEM_TTS_STYLE=none`;
grader — `UMIEM_GRADER_ENABLED=false`; TTS z powrotem na OpenAI —
`UMIEM_TTS_PROVIDER=openai`, `UMIEM_TTS_MODEL=gpt-4o-mini-tts`,
`UMIEM_TTS_VOICE=alloy`, `UMIEM_TTS_FORMAT=mp3`,
`UMIEM_TTS_BASE_URL=https://api.openai.com/v1`; LLM — analogicznie
`UMIEM_LLM_BASE_URL=https://api.openai.com/v1`, `UMIEM_LLM_MODEL=gpt-4o-mini`.
Pusta wartość przywraca domyślną, nie wyłącza.

### 2.5 `.env.example` i dokumentacja

`.env.example`: na górze to, co trzeba uzupełnić (`POSTGRES_PASSWORD`,
`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, opcjonalnie Azure i
`UMIEM_GRADER_ENABLED=true`), niżej „Nadpisania (opcjonalne)” z odwołaniem do
`config-defaults.ts`, jako zakomentowane przykłady. `docs/provider-config.md`
i AGENTS.md (nowa zmienna z wartością domyślną → plik domyślnych).

## 3. Skutki i migracja

- Pełny `.env` jak dziś (własne klucze LLM/TTS/gradera) — działa bez zmian;
  zmienia się tylko to, czego `.env` nie ustawia. U właściciela lokalnie:
  `UMIEM_TTS_STYLE` nieustawione → ton lektora włącza się (nowe nagrania przy
  zapisie, płatne).
- Instancja z samym `OPENAI_API_KEY` (na starych domyślnych OpenAI) po
  aktualizacji nie wystartuje workera, dopóki nie dostanie
  `OPENROUTER_API_KEY` albo nadpisań powrotu do OpenAI (§2.4). Generator
  przechodzi na Gemini; TTS na Gemini/Kore/WAV ze stylem (nowe nagrania przy
  następnym zapisie materiału; opublikowane lekcje grają stare).
- Web i worker muszą być wdrożone z tego samego commitu (stary worker ze
  starymi wartościami awaryjnymi pominie zlecenia TTS nowego web jako „obce”).
- CLI na hoście bez `.env` w środowisku liczy fingerprinty z samych domyślnych —
  uruchamiać w kontenerze workera (jak dziś zaleca dokumentacja).
- MCP/skill: bez zmian (konfiguracja procesu, nie API).

## 4. Testy

Jednostkowe:
- `withConfigDefaults`: puste = nieustawione, nadpisanie wygrywa, klucze spoza
  listy nietknięte, warunkowe opcje widzą nadpisany BASE_URL (OpenRouter →
  `low`, api.openai.com → brak opcji i brak błędu).
- Złożenie produkcyjne: `withConfigDefaults({OPENAI_API_KEY, OPENROUTER_API_KEY})`
  przez `createGenerationDepsFromEnv`, `mediaSettingsFromEnv`, `graderFromEnv`
  — provider/model/format/styl jak w pliku, LLM i TTS z wspólnym kluczem na
  OpenRouter, grader wyłączony; z `UMIEM_GRADER_ENABLED=true` włączony.
- Klucze: wspólny tylko dla https OpenRouter (odrzuca `http://`,
  `openrouter.ai.evil.example`, `https://openrouter.ai@evil.example`), własny
  wygrywa, klucz `sk-proj-…` na OpenRouter → błąd, samo `OPENAI_API_KEY` z
  domyślnymi → czytelny błąd z `OPENROUTER_API_KEY`.
- Grader: flaga true/false/1/0/zła wartość, `ENABLED=true` bez klucza → błąd,
  `graderConfigured` zgodne z `graderFromEnv`.
- Zgodność stałych liczbowych i obrazowych z parserami.

E2E i smoke: global setup i `compose.smoke.yaml` ustawiają jawnie
`UMIEM_TTS_FORMAT=mp3`, `UMIEM_TTS_STYLE=none`, `UMIEM_GRADER_ENABLED=false`
(zachowanie przebiegu jak dziś); kompozycja web w trybie fake bierze fake
gradera. Pełny `pnpm test:e2e:shards`, `pnpm test:integration`, typecheck, unit.

## 5. Rozstrzygnięcia po review

- Grader opt-in dla wspólnego klucza (dwóch krytyków: zmiana polityki
  prywatności z opt-in na opt-out) — §2.3.
- Bez mutacji `process.env`; jawne `withConfigDefaults` w kompozycjach (pułapki
  kolejności importów i loadera `.env` w skryptach) — §2.4.
- `graderAvailable` wstrzykiwane przez `GenerationDeps` zamiast `process.env`.
- Fake grader wygrywa w trybie fake; E2E/smoke jawnie bez stylu, mp3 i gradera.
- Strażnik odwrotny dla kluczy OpenAI na OpenRouter; jedna definicja hosta
  OpenRouter z wymaganiem `https:`.
- `DATA_COLLECTION=deny` nie jest domyślne (niezweryfikowane z Gemini);
  `REASONING=low` jest (obecna konfiguracja właściciela).
- Dyktowanie bez wspólnego klucza (głos dziecka tylko po świadomej konfiguracji).
