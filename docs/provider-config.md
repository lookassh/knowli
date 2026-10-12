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

## Generowanie materiału (worker)

| Element | Wartość | Uwagi |
| --- | --- | --- |
| LLM | OpenAI `gpt-4o-mini` | domyślny adapter `createOpenAiLlmProvider` |
| TTS | OpenAI `gpt-4o-mini-tts`, format mp3 | głos `alloy` (decyzja po próbie: domyślny na start); zmiana np. na `fable` przez `UMIEM_TTS_VOICE` bez zmiany kodu |
| Ilustracje | OpenAI `gpt-image-1`, `1024x1024`, quality `low`, WebP | ~30 s na obraz — praca tła workera; prompt bez tekstu w obrazie. Domyślnie low+webp: high/png kosztowało ~0,17 USD/szt. (~5 USD za 31-elementowy zestaw 2026-10-08), low+webp to ~0,01–0,02 USD/szt. Budżetowa alternatywa przez env: `gpt-image-1-mini` (~0,005 USD/szt. w low) |
| Env | `OPENAI_API_KEY` (jeden klucz do trzech usług) | tylko worker; web nie zna tego klucza |

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
