# Próba mowy i mediów (zadanie 0)

Data próby: 2026-10-08 (macierz syntetyczna i próba na głosie człowieka).
Region Azure: `germanywestcentral`. Klucze podane przez właściciela w pliku
poza repozytorium; żadna wartość klucza nie jest zawarta w tym dokumencie
ani w repozytorium. Nagrania próby nie są nigdzie archiwizowane.

Stan dokumentu: **macierz syntetyczna i macierz na prawdziwym głosie wykonane;
pasma oceny ustalone** (do ewentualnej korekty po pierwszych realnych sesjach
z dzieckiem). Pozostało potwierdzenie MIME/kodeku z tabletu — patrz sekcja
„Urządzenie docelowe".

## Cel i zakres

Potwierdzenie techniczne drogi: nagranie → transkrypcja treści (STT) → ocena
wymowy → synteza TTS → ilustracje → zapis i ponowne odtworzenie z cache.
Wszystkie wywołania poszły przez **produkcyjne adaptery** (`packages/server`)
przez żywe usługi; skrypty próby żyją w `spike/` poza kodem produktu i są
usuwane po próbie.

## Konfiguracja użyta w próbie

| Cel | Usługa | Parametry |
| --- | --- | --- |
| STT treści | Azure Speech-to-text REST v1 | `language=en-GB`, `format=detailed`, audio WAV PCM mono |
| Ocena wymowy | Azure Pronunciation Assessment | nagłówek `Pronunciation-Assessment` (HundredMark, Word, Comprehensive), `ReferenceText=expectedText` |
| TTS | OpenAI `/audio/speech` | `gpt-4o-mini-tts`, głos `alloy` i `fable`, format mp3 (i wav do próbek próby) |
| Ilustracje | OpenAI `/images/generations` | `gpt-image-1`, `1024x1024`, b64_json |
| LLM (materiał) | OpenAI | `gpt-4o-mini` (adapter, niezmieniony w próbie) |

## Macierz syntetyczna — wyniki

Próbki: wzorce TTS głosu `fable`, cisza i biały szum syntetyczne (WAV PCM
16 kHz mono). Dwa pełne przebiegi (drugi po naprawie parsowania score);
wartości pojedynczych wierszy różnią się między przebiegami — patrz „Zmienność".

| Przypadek | STT treść | conf | Wymowa AccuracyScore |
| --- | --- | --- | --- |
| correct-wednesday | „Wednesday." | 0,65–0,82 | 88–100 |
| correct-thursday | „Thursday." (raz „First day." — zmienność) | 0,58–0,73 | 70–88 |
| correct-tuesday | „Tuesday." | 0,80 | 94 |
| correct-apple | „Apple." | 0,53–0,75 | 100 |
| correct-red | „Red." (raz puste — słowo < 0,5 s) | 0–0,73 | 100 |
| wrong-word (audio „friday", expected „wednesday") | „Friday." | 0,80–0,87 | 61 |
| distorted-spelled (TTS „wenzdee") | „Wednesday." | 0,71–0,82 | 94 |
| distorted-staccato (TTS „wed nes day") | „Wed Ness Day." | 0,12–0,36 | 58 |
| silence-2s | puste (Success z pustym DisplayText) | 0 | `no_speech` |
| noise-2s | puste | 0 | 51 (fałszywe „ok" z biasem do referencji) |

### Kluczowe wnioski

1. **Odrębność STT i wymowy jest konieczna i wystarcza** (SPEC §23).
   Ocena wymowy ma silny bias do `ReferenceText` — treść rozstrzyga WYŁĄCZNIE
   transkrypcja STT porównana z wariantami odpowiedzi, nigdy score wymowy.
   Architektura (osobne porty, osobne wyniki) została potwierdzona empiricznie,
   w macierzy syntetycznej i na głosie człowieka.
2. **Cisza potrafi wrócić jako `Success` z pustym `DisplayText`** (nie tylko
   `InitialSilenceTimeout`). Pusty tekst = brak odpowiedzi = wynik techniczny
   „nieocenione", nigdy pomyłka. Oba kształty są zablokowane testami
   adapterów (`stt.test.ts`).
3. **Kompresja to cicha porażka.** REST Azure przyjął MP3 (HTTP 200) i zwrócił
   pusty wynik zamiast błędu. Wniosek: **klient musi konwertować nagranie do
   WAV PCM 16 kHz mono w pamięci** (przeglądarka: `decodeAudioData` +
   `OfflineAudioContext` — potwierdzone end-to-end w próbie człowieka).
   WAV 24 kHz i content-type `audio/wav; codecs=audio/pcm; samplerate=16000`
   też przechodzą.
4. **Score wymowy z REST leży bezpośrednio na `NBest[0].AccuracyScore`**
   (zagnieżdżone `PronunciationAssessment` to kształt SDK). Adapter produktu
   został poprawiony i pokryty testami na kształt z żywej usługi (commit
   `fix: parse azure pronunciation score from live REST shape`).
5. **Zmienność.** Pojedyncze krótkie słowa bywają nietrwałe: „thursday" raz
   zostało rozpoznane jako „First day." (conf 0,58), „red" raz wypadło puste
   (słowo krótsze niż pół sekundy). Zasada „niepewne STT nie tworzy pomyłki
   między słowami" jest empirycznie uzasadniona.
6. **Syntetyczne „zniekształcenie wymowy" nie kalibruje pasm**: TTS „wenzdee"
   dostał 94. Realną separację zmierzono na prawdziwym głosie (niżej).

## Próba człowieka — wyniki

Głos dorosłego, przeglądarka desktop, kodek nagrania `audio/webm;codecs=opus`
przekonwertowany w przeglądarce do WAV PCM 16 kHz mono. Część wierszy nagrana
dwukrotnie (naturalne ponowienia).

| Przypadek | STT treść | conf | Wymowa | Uwagi |
| --- | --- | --- | --- | --- |
| correct-wednesday | „Wednesday." | 0,78 | **82** | |
| correct-thursday | „Thursday." | **0,21** | **82** | poprawna treść przy niskiej pewności |
| correct-tuesday (próba 1) | puste | 0 | `no_speech` | odpowiedź za późno/cicho → ponowienie |
| correct-tuesday (próba 2) | „Tuesday." | 0,94 | **82** | |
| correct-apple (próba 1) | **„April."** | 0,11 | 62 | niepewne rozpoznanie → nieocenione, nie pomyłka |
| correct-apple (próba 2) | „Apple." | 0,80 | **100** | retry podnosi wynik 62 → 100 |
| correct-red (próba 1) | puste | 0 | 64 | krótkie słowo |
| correct-red (próba 2) | „Red." | 0,31 | **67** | krótkie słowo: poprawna wymowa nisko punktowana |
| wrong-word (wypowiedziane „sunday", expected „wednesday") | **„Sunday."** | 0,74 | 61, DisplayText „Wednesday." | STT poprawnie rozstrzyga treść; score bezużyteczny |
| distorted | „When do we?" | 0,10 | 57 | śmieciowa transkrypcja → niepewne → nieocenione |
| silence | puste | 0 | **ok, score 100**, DisplayText „Wednesday." | cisza dostaje maksimum wymowy! |
| noise | puste | 0 | ok, 51 | |

### Wnioski z próby człowieka

1. **Cisza otrzymała ocenę wymowy 100/100.** To najsilniejszy dowód w całej
   próbie: `AccuracyScore` bez bramki treści jest bezwartościowy. Wymowa jest
   oceniana **wyłącznie gdy treść została dopasowana** przez STT.
2. **Poprawne słowa rozpiętość 62–100.** Krótkie słowa („red": 64–67) są
   systematycznie niżej punktowane niż dłuższe (82–100). Progi muszą być
   łagodne i traktować pasmo jako poziom wsparcia, nie eliminacji.
3. **Dopasowany tekst liczy się niezależnie od pewności** („Thursday." conf
   0,21; „Red." conf 0,31). Próg pewności dotyczy wyłącznie niedopasowań:
   „April." (0,11) i „When do we?" (0,10) to rozpoznania niepewne → przypadek
   nieoceniony, nigdy pomyłka.
4. **Powtórka realnie poprawia wynik** (apple 62 → 100) — pętla „Prawie!
   Posłuchaj jeszcze raz" ma sens pedagogiczny i techniczny.
5. **Czasy na realnym głosie**: STT 0,86–1,28 s, wymowa 0,31–0,79 s; pełne
   żądanie ~1,2–2,1 s. Kryterium 30 s spełnione z ogromnym zapasem.
6. Odmowa mikrofonu nie została ćwiczona w tej sesji (przeglądarka pamięta
   zgodę); ścieżka kliencka istnieje, a produkt z założenia nie blokuje sesji
   bez mikrofonu.

## Próba mediów — wyniki

| Operacja | Czas | Uwagi |
| --- | --- | --- |
| TTS pojedyncze słowo (mp3, alloy/fable) | 0,8–2,0 s | 17–27 kB na słowo |
| TTS zdanie (~6 słów) | 1,0 s | 46 kB |
| Obraz gpt-image-1 1024×1024 | 29,3 s / 32,1 s | 1,6–1,9 MB PNG; praca tła workera |
| Zapis `MediaStore.putImmutable` + ponowny put | idempotentny | ten sam klucz, brak błędu |
| Replay `MediaStore.get` (audio i obraz) | 0–1 ms | bajty i mime identyczne (sha256 równa), zero wywołań API |

Wniosek: generacja mieści się w pracy tła workera (obraz ~30 s), odtwarzanie
dla dziecka jest natychmiastowe z lokalnego wolumenu, cache działa zgodnie
z projektem (niezmienność, brak nadpisania).

## Kryterium 30 sekund

- Macierz syntetyczna: STT 250–980 ms, wymowa 165–475 ms.
- Próba człowieka: STT 0,86–1,28 s, wymowa 0,31–0,79 s; pełne żądanie < 2,1 s.
- Kontrolowany timeout: przerwany sygnał (`AbortSignal`) kończy się wynikiem
  technicznym `failed` w ~130 ms — brak wiszących żądań.
- **Kryterium spełnione**; wygodę tempa dla dziecka oceni rodzic w praktyce.

## Pasma i progi — decyzja po obu macierzach

- **Treść (poprawność odpowiedzi ustnej):**
  tekst po normalizacji (małe litery, bez spacji i interpunkcji —
  „Wed Ness Day." → „wednesday") dopasowany do wariantów odpowiedzi →
  **poprawna** (niezależnie od conf);
  tekst pusty/null → **brak odpowiedzi** (wynik techniczny);
  tekst niedopasowany i `conf ≥ 0,4` → **błędna treść** (pomyłka);
  tekst niedopasowany i `conf < 0,4` → **rozpoznanie niepewne → nieocenione**
  (obserwacje: śmieci 0,00–0,12; poprawne 0,21–0,94).
- **Wymowa — oceniana wyłącznie przy dopasowanej treści:**
  `AccuracyScore ≥ 70` → **dobrze** (sukces);
  `50–69` → **„prawie"** (feedback wsparcia, bez sukcesu);
  `< 50` lub `no_speech` → **nieocenione technicznie**, ponowna próba.
- Odmowa mikrofonu / cisza / hałas / awaria: nigdy pomyłka wiedzy.
- Rozważono `PronScore` zamiast `AccuracyScore` (wygładza w górę przez
  fluency/completeness zawsze 100 dla pojedynczych słów) — na tym etapie
  pozostajemy przy `AccuracyScore`; pierwsze realne sesje z dzieckiem
  (zadanie 11) mogą skorygować progi, a parametry polityki są wersjonowane.

## Urządzenie docelowe

Potwierdzone na desktop (Chromium): `audio/webm;codecs=opus` + konwersja do
WAV w przeglądarce działa end-to-end. MIME z tabletu (spodziewane
`audio/mp4` na Safari iOS) — do potwierdzenia przy pierwszych realnych
sesjach (zadanie 11); mechanizm konwersji jest kodekowo-agnostyczny
(`decodeAudioData` dekoduje każdy kodek przeglądarki).

## Retencja usług (warunki, zweryfikować ponownie przy wdrożeniu)

- Azure AI Speech: firma nie używa danych klienta do trenowania; audio
  żądań real-time (STT, ocena wymowy) nie jest utrwalane. Region
  `germanywestcentral` — przetwarzanie w UE.
- OpenAI API: dane nie trenują modeli; retencja do 30 dni wyłącznie do
  monitoringu nadużyć (standardowe API).
- W aplikacji: nagranie dziecka tylko w pamięci żądania (bez bazy, kolejki,
  plików, logów); logi próby zawierają wyłącznie statusy i czasy.

## Wniosek go/no-go

**GO.** STT treści, ocena wymowy (z bramką treści), TTS, ilustracje, cache
i replay, kontrolowany timeout oraz tempo odpowiedzi — wszystko potwierdzone
na żywych usługach w dwóch macierzach, z prawdziwym głosem włącznie. Progi
pasm ustalone jak wyżej; ewentualna korekta po pierwszych realnych sesjach
nie blokuje pracy. Prototyp i nagrania zostają usunięte po próbie; raport
zostaje (commit `docs: record speech and media feasibility`).
