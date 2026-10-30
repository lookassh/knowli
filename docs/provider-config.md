# Konfiguracja providerów (decyzje zadania 0)

Wersja: 1.0 (październik 2026). Uzupełnia `.env.example` (katalog zmiennych)
o decyzje potwierdzone próbą techniczną — patrz `docs/speech-spike.md`.

## Ścieżka mowy (web)

| Element | Wartość | Uzasadnienie |
| --- | --- | --- |
| STT treści | Azure Speech-to-text REST v1, `language` = targetLocale zestawu (`en-GB`), `format=detailed` | potwierdzone żywą usługą; treść rozstrzyga STT, nie score |
| Ocena wymowy | Azure Pronunciation Assessment REST, `ReferenceText=expectedText`, HundredMark/Word/Comprehensive | score = `NBest[0].AccuracyScore` (kształt REST, nie SDK) |
| Format wejścia | **WAV PCM 16 kHz mono** z konwersją w pamięci klienta (`decodeAudioData` + `OfflineAudioContext`) | MP3/webm zwracają pusty wynik zamiast błędu (cicha porażka) |
| Timeout | 30 s na całe żądanie (`AbortSignal`) | przerwane żądanie = wynik techniczny, nie zawieszenie |
| Env | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | region `germanywestcentral` (UE); brak kluczy = ścieżka ustnej odpowiedzi wyłączona, nauka bez mikrofonu pełnoprawna |

Progi oceny (decyzja po próbie syntetycznej i na głosie człowieka, patrz
`docs/speech-spike.md`): treść — dopasowany znormalizowany tekst = poprawna
(niezależnie od conf); pusty tekst = brak odpowiedzi; niedopasowany z
`conf ≥ 0,4` = błędna treść; niedopasowany z `conf < 0,4` = nieocenione.
Wymowa oceniana **wyłącznie przy dopasowanej treści** (cisza dostała w próbie
score 100): `≥ 70` dobrze (sukces), `50–69` „prawie", `< 50`/`no_speech`
→ nieocenione, ponowna próba. Kodek nagrania potwierdzony na desktop:
`audio/webm;codecs=opus` (tablet — `audio/mp4` na Safari — do potwierdzenia
w zadaniu 11); konwersja do WAV jest kodekowo-agnostyczna.

## Dyktowanie odpowiedzi lekcji (web)

Odpowiedzi otwarte zestawów szkolnych można podyktować (design przedmiotów
szkolnych §5). Ocena wymowy nie jest tu potrzebna, więc ścieżka nie używa
Azure; wybór providera po spike'u 2026-10-29 (design §5.1–5.2).

| Element | Wartość | Uzasadnienie |
| --- | --- | --- |
| Endpoint | `POST {UMIEM_LESSON_STT_BASE_URL}/audio/transcriptions`, JSON z `input_audio` (base64 WAV), `language: "pl"`, `temperature: 0`, `response_format: "verbose_json"` (przy 400 ponowienie z `json`) | format OpenAI, obsługiwany przez OpenRouter |
| Model | `UMIEM_LESSON_STT_MODEL`, domyślnie `elevenlabs/scribe-v2` | 150/150 pojęć na syntetycznym polskim głosie, nazwy i liczby bez sklejania, cisza bez halucynacji |
| Prywatność | dla OpenRouter zawsze `provider: { zdr: true, data_collection: "deny" }`; brak endpointu ZDR = `unavailable` | bez `user`, `session_id`, `keyterms` i treści materiału; nagranie tylko w pamięci żądania |
| Wynik | znaczniki zdarzeń `[…]` usuwane; tekst ≥ 0,5 confidence (gdy podana) trafia do pola odpowiedzi | dziecko widzi tekst przed oceną |
| Limity | nagranie ≤ 45 s, 40 dyktowań na sesję, deadline 30 s | stałe `DEFAULT_DICTATION_POLICY` |
| Env | `UMIEM_LESSON_STT_BASE_URL`, `UMIEM_LESSON_STT_API_KEY` (oba albo żaden), opcjonalnie `UMIEM_LESSON_STT_MODEL` | `https://` poza NODE_ENV test/development; brak = lekcje bez mikrofonu; może to być ten sam klucz OpenRouter co grader |

## Generowanie materiału (worker)

| Element | Wartość | Uwagi |
| --- | --- | --- |
| LLM | OpenAI `gpt-4o-mini` | domyślny adapter `createOpenAiLlmProvider`; zmiana modelu/endpointu przez `UMIEM_LLM_MODEL`/`UMIEM_LLM_BASE_URL` bez zmiany kodu (model trafia do logu `[lesson] generacja`, co umożliwia A/B po logach) |
| TTS | OpenAI `gpt-4o-mini-tts`, format mp3 | głos `alloy` (decyzja po próbie: domyślny na start); zmiana np. na `fable` przez `UMIEM_TTS_VOICE` bez zmiany kodu. Endpoint zgodny z OpenAI Audio Speech (np. OpenRouter `https://openrouter.ai/api/v1`, `UMIEM_TTS_PROVIDER=openrouter`, model np. `microsoft/mai-voice-2.1-flash` z głosem `pl-PL-Harper:MAI-Voice-2.1-Flash`; głos musi należeć do `supported_voices` modelu — `alloy` działa tylko z OpenAI) przez `UMIEM_TTS_BASE_URL`/`UMIEM_TTS_API_KEY`/`UMIEM_TTS_MODEL` (worker; własny `UMIEM_TTS_BASE_URL` wymaga własnego `UMIEM_TTS_API_KEY` — `OPENAI_API_KEY` nie jest wysyłany do innego hosta; od Etapu 8 adapter wysyła model z `UMIEM_TTS_MODEL`, wcześniej zawsze domyślny). Provider, model i głos wchodzą do fingerprintów: zmiana = nowe nagrania przy kolejnej edycji, katalog komunikatów interfejsu na nowo przy starcie workera. Worker wykonuje tylko zadania TTS zgodne z jego providerem i modelem; zlecone przy innej konfiguracji czekają w kolejce bez zmiany stanu (nowy endpoint nie zna starego modelu, stary worker w trakcie wdrożenia nie unieważnia nowych). Szkic z takim zasobem wymaga ponownego zapisu przed publikacją |
| Ilustracje | OpenAI `gpt-image-2.5-sunburst`, `1024x1024`, quality `low`, WebP | Praca tła workera; prompt bez tekstu w obrazie. Ustawienia low+webp dobrano do ilustracji wyświetlanych w kartach dziecka (~300 px). Model można nadpisać przez `UMIEM_IMAGE_MODEL`; zmiana modelu wpływa na fingerprint i nowe generacje mediów |
| Env | `OPENAI_API_KEY` (obrazy; domyślny klucz LLM i TTS) | tylko worker; web nie zna tego klucza. Opcjonalnie `UMIEM_LLM_MODEL`, `UMIEM_LLM_BASE_URL`, `UMIEM_LLM_API_KEY` nadpisują model, endpoint i klucz **samego LLM** (niezależne, z fallbackami: `gpt-4o-mini`, `https://api.openai.com/v1`, `OPENAI_API_KEY`); BASE_URL wymaga `https://` poza NODE_ENV test/development. Sam `UMIEM_LLM_BASE_URL` bez własnego klucza kieruje `OPENAI_API_KEY` na wskazany endpoint — tylko zaufane URL-e. Model LLM nie wchodzi do fingerprintów mediów — zmiana dotyczy tylko nowych generacji |

Runy lekcji klasyfikują błędy konfiguracji (w tym HTTP 400 i 429 quota) jako terminalne, bez automatycznego retry. Sieć, 408/5xx i zwykły limit 429 są ponawiane najwyżej do trzech prób; exponential backoff wynosi 1 s, potem 2 s, z jitterem 0–20%. `Retry-After` ma pierwszeństwo i jego termin pozostaje zapisany w `generation_runs.next_attempt_at` podczas restartu workera. Ręczne ponowienie może wyczyścić odroczenie. Refusal, ucięcie odpowiedzi i zły JSON kończą run czytelnym kodem. Adapter nie zapisuje ani nie loguje body błędu providera.

Timeouty lekcji dotyczą jednego requestu (domyślnie 90 s) oraz całego runu ze wszystkimi celami (10 min). `UMIEM_LESSON_GENERATION_REQUEST_TIMEOUT_MS` nie może przekraczać `UMIEM_LESSON_GENERATION_RUN_TIMEOUT_MS`; dodatni `UMIEM_LESSON_GENERATION_CANCEL_POLL_MS` (domyślnie 1 s) steruje sprawdzeniem, czy rodzic lub retry nie unieważnił runu. Timeout kończy run bez automatycznego retry. Zamknięcie workera oddaje aktualny run do kolejki, zachowując wykorzystaną próbę.

Worker wykonuje jeden przelot naraz. `WORKER_POLL_MS` (domyślnie 2000 ms) jest przerwą po zakończeniu przelotu, nie interwałem równoległych uruchomień. `WORKER_HEALTH_STALE_MS` (domyślnie 900000 ms) ustala wiek, po którym `/health` zwraca 503.

## Ocena odpowiedzi lekcji (web)

Model oceniający otwarte odpowiedzi lekcji (gramatyka itp.) jest zgodny z
OpenAI (`POST {baseUrl}/chat/completions`). Działa WYŁĄCZNIE w procesie web i
tylko dla odpowiedzi tekstowych, których nie rozstrzygnęło dopasowanie
deterministyczne (`no_match`). Worker gradera nie potrzebuje.

| Element | Wartość | Uwagi |
| --- | --- | --- |
| Endpoint | `POST {UMIEM_GRADER_BASE_URL}/chat/completions`, `temperature: 0`, `response_format: { type: "json_object" }` | kształt zgodny z OpenAI; adapter wyciąga JSON także z bloku markdown |
| Autoryzacja | `Authorization: Bearer {UMIEM_GRADER_API_KEY}` | sekret tylko w adapterze; nigdy w logach, DTO ani promptach |
| Model | `UMIEM_GRADER_MODEL` | tani model wystarcza (ocena jednej reguły, nie generacja) |
| Timeout | `UMIEM_GRADER_TIMEOUT_MS` (domyślnie 8000) | `AbortSignal.timeout`; przerwanie = „nieocenione", nie zawieszenie |
| Budżet | `UMIEM_GRADER_MAX_CALLS_PER_SESSION` (domyślnie 20) | księgowany w `learning_sessions.context.graderCalls`; po wyczerpaniu selektor przechodzi na typy zamknięte |
| Env | `UMIEM_GRADER_BASE_URL`, `UMIEM_GRADER_API_KEY`, `UMIEM_GRADER_MODEL` | wszystkie trzy albo żadna; `https://` wymagane poza `NODE_ENV` test/development; brak = ocena dowolnych odpowiedzi wyłączona |

Werdykt modelu (`{verdict, errorCategory, fragments, note}`) jest surowym JSON —
walidację robi domena (`validateVerdict`): kategoria musi należeć do celu lub być
`other`, każdy `fragment` jest dokładnym podciągiem odpowiedzi dziecka. Zwalidowany
werdykt zapisuje się do wspólnego cache `lesson_verdicts` z kluczem
`(item_revision_id, normalized_answer, prompt_version)`; ta sama (znormalizowana)
odpowiedź innego dziecka nie woła modelu ponownie. `parent_decision` (nadpisanie
rodzica) jest nadrzędny nad zapisanym werdyktem bez przeliczania historii.
Komentarz `note` modelu jest wyłącznie dla rodzica — nigdy nie trafia do Kid DTO.
Odpowiedź dziecka i warianty referencyjne są przekazywane modelowi jako DANE
(wiadomość `user`), nigdy jako polecenia; `prompt_version` to stała adaptera, a
jej zmiana unieważnia zapisane werdykty bez migracji.

Tryb E2E/smoke bez klucza: `UMIEM_FAKE_PROVIDERS=1` wstawia deterministyczny fake
grader (routing po słowach kluczowych w odpowiedzi: „almost" → almost, „wrong" →
incorrect, inaczej correct), tak jak fake providerzy mowy i generacji.

## Ocena aktywności sesji (web)

`SessionActivityReviewer` używa połączenia `UMIEM_GRADER_*`, ale ma osobny
limit `UMIEM_SESSION_ACTIVITY_TIMEOUT_MS` (domyślnie 60000 ms). Nie zmienia go
`UMIEM_GRADER_TIMEOUT_MS`. Ocena działa w tle; podsumowanie sesji pojawia się
od razu. Limit powinien pozostawiać zapas przed deadline finalizacji 120 s.
Zmiana zmiennej wymaga odtworzenia kontenera z nowym środowiskiem; sam zapis
w panelu Coolify nie potwierdza wartości używanej przez proces web.

Jedno wywołanie na sesję, bez automatycznych ponowień i bez przeliczania
zapisanych ocen. Błąd nie przyznaje punktów i nie zmienia postępu wiedzy.
Log `[session-activity] ocena nie powiodła się` zawiera identyfikator sesji,
kod błędu, liczbę zadań, czas wywołania, skonfigurowany timeout oraz kategorię
awarii. Dla HTTP dodaje status; dla walidacji tylko kody naruszeń Zod.
Kategorie rozróżniają timeout, HTTP, błędną odpowiedź JSON, brak treści,
niepoprawny JSON werdyktu, naruszenie schematu, nieznany lub powtórzony
numer zadania. Log nie zawiera body, komunikatu wyjątku providera, zadań,
odpowiedzi, uzasadnień modelu ani kluczy odrzuconych przez schemat.

Kod zapisanej awarii jest dostępny także w autoryzowanym
`GET /api/v1/parent/work-card?childId=…&date=…` (`sessions[].activity.errorCode`).
Nie wymaga dostępu do bazy ani zachowania szczegółowego raportu po 7 dniach.

API → MCP → skill: zmiana limitu i diagnostyki nie zmienia endpointów, DTO,
kodów błędów ani sposobu liczenia czasu/punktów. `learning-overview` i skill
Hermesa zachowują dotychczasowy kontrakt; konsument nie wymaga aktualizacji.

## Ustawienia medialne i fingerprinty

`UMIEM_TTS_PROVIDER/MODEL/VOICE` oraz `UMIEM_IMAGE_PROVIDER/MODEL/SIZE/QUALITY/FORMAT`
wchodzą do fingerprintów zasobów. Zasady potwierdzone próbą:

- web i worker muszą mieć **identyczne** wartości (fingerprint liczony w obu
  procesach);
- model, jakość i format obrazu płyną metadanymi zasobu aż do adaptera, więc
  `UMIEM_IMAGE_MODEL` faktycznie steruje wywołaniem API (także
  `gpt-image-1-mini`), a żądanie nie może się rozjechać z fingerprintem;
- zmiana po wygenerowaniu materiału = nowa generacja przy następnej edycji
  (zgodnie z projektem — nic nie nadpisuje gotowych zasobów);
- zapis `MediaStore.putImmutable` jest idempotentny i adresowany treścią;
  replay z lokalnego wolumenu trwa < 1 ms i nie woła API.

Decyzja po próbie: domyślny głos pozostaje `alloy`. Ewentualna zmiana w
`defaultMediaSettings` (np. `alloy` → `fable`) jest tania dopóki żaden realny
materiał nie został wygenerowany — zastosować ją RAZ przed pierwszym
produkcyjnym generowaniem.

## Bezpieczeństwo i retencja

- Klucze wyłącznie w środowisku procesów (`.env` poza repo / env shella /
  sekrety Compose w zadaniu 11). Nigdy: repo, czat, `NEXT_PUBLIC_*`, Kid DTO.
- Azure AI Speech: bez trenowania na danych klienta, audio real-time nie
  utrwalane; przetwarzanie w UE (`germanywestcentral`).
- OpenAI API: bez trenowania; retencja do 30 dni dla monitoringu nadużyć.
- Nagranie dziecka: tylko w pamięci żądania; logi bez transkrypcji
  (wzorem serwera próby: same statusy i czasy).

Linki do aktualnych oświadczeń usług sprawdzić ponownie przy wdrożeniu
(zadanie 11): Azure — „Data, privacy, and security for Azure AI Speech",
OpenAI — „Data controls" (platform.openai.com).
