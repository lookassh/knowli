# Ton wypowiedzi w nagraniach TTS — projekt

Status: **zaakceptowany w rozmowie przez właściciela 2026-10-30** (sekcje A i B);
spec do przeglądu. Zależność: etap 1 — TTS `google/gemini-3.8-flash-tts`, głos
`Kore`, przez OpenRouter (PCM → WAV, instrukcja języka per locale
w fingerprincie). Implementacja startuje dopiero po scaleniu etapu 1 do `main`.

## 1. Cel i decyzje

Lektor ma brzmieć cieplej i żywiej dla dziecka tam, gdzie nie szkodzi to
nauce wymowy. Pomiar z 2026-10-30: Gemini 3.8 Flash TTS (Kore) wykonuje
instrukcje stylu (radośnie, łagodnie, z ciekawością, szeptem) i nie odczytuje
ich na głos; szept jest o ok. 6 dB cichszy.

Decyzje właściciela:

1. **Dwa etapy, osobne PR.** A — stały styl według roli nagrania. B — ton per
   ćwiczenie i per karta lekcji.
2. **Zakres A:** stałe komunikaty Kid UI (`messages.uiAudio`), „Posłuchaj
   pytania” i „Posłuchaj karty” w lekcjach. **Słówka i zdania przykładowe
   zestawów angielskich zostają neutralne** (wyraźna wymowa ważniejsza);
   odsłuch słówka po próbie mowy (`feedback-audio.ts`) to to samo nagranie
   słówka — też neutralne.
3. **Zakres B:** generator LLM wybiera ton z zamkniętej listy dla ćwiczeń
   i kart (w tym ciekawostek typu „Czy wiesz, że…”); rodzic widzi ton
   w edytorze i może go zmienić. Brak tonu = styl roli z etapu A.
4. **Lista tonów B:** radośnie (`cheerful`), z ciekawością (`curious`),
   łagodnie (`gentle`), tajemniczo/szeptem (`mysterious`).
5. **Niezależność od providera:** domena, dane, kontrakty i UI znają tylko
   semantyczny klucz stylu. Tłumaczenie na pola żądania konkretnego providera
   (dla Gemini: tekst `instructions`) żyje przy adapterze w „profilu stylu”.
   Zmiana providera = nowy profil, bez zmian w domenie, bazie i kontraktach.
6. Ton nie jest znacznikiem w tekście (`[excited]`) — tekst nagrania pozostaje
   identyczny z tekstem na ekranie.

## 2. Architektura (wspólna dla A i B)

### 2.1. Semantyczny styl — domena

Nowy plik `packages/server/src/domain/tts-style.ts` (czysty, bez importów
infrastruktury):

```ts
export type TtsRoleStyle =
  | "ui_praise" | "ui_gentle" | "ui_guidance" | "ui_closing"
  | "lesson_question" | "lesson_card";
export type TtsTone = "cheerful" | "curious" | "gentle" | "mysterious"; // etap B
export type TtsStyle = TtsRoleStyle | TtsTone;
```

Słówka nie mają stylu (`style` nieobecny) — nagranie wychodzi dokładnie jak po
etapie 1. `TtsTone` pochodzi z kontraktu (etap B, §4.1); w etapie A typ
istnieje tylko jako unia ról.

### 2.2. Profil stylu — przy adapterze

Nowy plik `packages/server/src/providers/tts-style-profile.ts` — czysta
funkcja:

```ts
ttsStyleRequest(tts: MediaSettings["tts"], locale: string, style?: TtsStyle)
  : { instructions?: string }
```

- Profil wybierany po `tts.provider`/`tts.model`. Profil instrukcyjny (modele
  TTS oparte na LLM: `google/gemini-*-tts`, `gpt-4o-mini-tts`) zwraca
  `instructions` = instrukcja języka z etapu 1 + zdanie stylu (§3.2, §4.3).
- Provider bez obsługi stylu dostaje profil bez instrukcji stylu (nagrania
  neutralne, aplikacja działa).
- Instrukcja języka z etapu 1 przenosi się do tego profilu, jeśli etap 1
  umieścił ją gdzie indziej — jedno miejsce składania pól żądania. Dokładne
  dopasowanie do kodu etapu 1 rozstrzyga plan implementacji po jego scaleniu.
- Moduły `materials/` importują profil bezpośrednio (precedens:
  `providers/audio/normalize`, `providers/audio/mp3-duration`).

### 2.3. Fingerprint, metadane, wykonanie

- `ttsFingerprint` obejmuje **wynik profilu** (`instructions`, pusty = brak
  pola), nie sam klucz stylu: fingerprint dalej opisuje pełne żądanie
  generacji (architecture.md §8). Poprawka brzmienia instrukcji albo zmiana
  providera daje nowe nagranie; gotowe zasoby pozostają niezmienne.
- Metadane zasobu TTS dostają `instructions` (gdy niepuste) i `style` (klucz,
  wyłącznie informacyjnie). Executor (`media-generation.ts`) przekazuje
  `instructions` z rekordu zasobu do `TtsProvider.synthesize`, tak jak dziś
  model — zmiana env między planowaniem a wykonaniem nie zmienia żądania.
- Port `TtsSynthesizeInput` dostaje opcjonalne `instructions?: string`
  (jeśli etap 1 go nie wprowadził). Adapter OpenAI-zgodny wysyła je w polu
  `instructions` `/audio/speech`; nie zna ról ani tonów.

## 3. Etap A — styl według roli

### 3.1. Mapowanie komunikatów Kid UI

Mapa `UI_AUDIO_STYLES: Record<UiAudioKey, TtsRoleStyle>` w
`domain/ui-audio-catalog.ts` (`satisfies` — nowy klucz bez stylu nie przejdzie
typecheck). Klient jej nie potrzebuje, więc nie trafia do kontraktów.

| Styl | Klucze (17 komunikatów) |
| --- | --- |
| `ui_praise` | `correct` |
| `ui_gentle` | `partial`, `incorrect`, `unevaluated`, `skip`, `dont_remember`, `retry`, `mic_unavailable`, `audio_unavailable` |
| `ui_guidance` | `profile_select`, `deck_select`, `exposure`, `listening`, `speech`, `recall` |
| `ui_closing` | `end`, `summary` |

### 3.2. Instrukcje stylu profilu instrukcyjnego (pl-PL)

Wstępne brzmienie; ostateczne po odsłuchu próbek przed scaleniem PR A.

| Styl | Zdanie stylu |
| --- | --- |
| `ui_praise` | Powiedz radośnie, z uśmiechem w głosie, jak do ośmiolatka. |
| `ui_gentle` | Powiedz łagodnie i ciepło, bez rozczarowania w głosie. |
| `ui_guidance` | Powiedz przyjaźnie i zachęcająco, wyraźnie. |
| `ui_closing` | Powiedz ciepło i z zadowoleniem. |
| `lesson_question` | Przeczytaj przyjaźnie, z lekką ciekawością, spokojnym tempem i wyraźnie. |
| `lesson_card` | Przeczytaj jak ciepły nauczyciel, który opowiada, spokojnym tempem. |

### 3.3. Miejsca zmian

- `modules/materials/ui-audio.ts` — `requestOf` przekazuje styl klucza do
  profilu; fingerprint i metadane z §2.3. `isUiAudioAssetMetadata` sprawdza
  dodatkowo zgodność `instructions` z bieżącym żądaniem — inaczej stare
  neutralne nagranie przeszłoby jako gotowe.
- `modules/materials/media-reconciliation.ts` — `ttsAsset` przyjmuje
  opcjonalny styl; `prompt_audio` pytań → `lesson_question`, kart →
  `lesson_card`; `target_audio`/`example_audio` bez stylu.
- `media-generation.ts`, port i adapter — §2.3.

### 3.4. Wdrożenie

- Fingerprinty 17 komunikatów się zmieniają: worker przy starcie
  (`prepareUiAudio`) zleca je od nowa (17 krótkich nagrań). Do ich gotowości
  `readUiAudio` zwraca `ready: false` — krótka przerwa w odsłuchu poleceń
  zaraz po wdrożeniu, jak przy każdej zmianie konfiguracji TTS.
- Pytania i karty lekcji dostają nowe nagrania przy następnej edycji lub
  publikacji — bez generowania wstecz (zasada z design szkoły §11.2, §12.2).
- Bez migracji, bez zmian Kid DTO i panelu rodzica.

## 4. Etap B — ton per ćwiczenie i karta

### 4.1. Kontrakty

`packages/contracts/src/lessons.ts`:

- `LessonVoiceToneSchema = z.enum(["cheerful", "curious", "gentle", "mysterious"])`.
- Opcjonalne `voiceTone` w `LessonExerciseInputSchema` (payload v3) oraz
  w obiekcie karty `DynamicObjectiveDtoSchema.cards[]` i odpowiednio
  w `DynamicObjectiveData.cards[]` (`domain/lessons/types.ts`,
  `lesson_context.dynamicTopic`).
- **Brak pola = styl roli z etapu A.** Enum nie ma wartości `default`; stare
  payloady i tematy są poprawne bez migracji i bez zmiany `payload_version`.
- Ton nie trafia do Kid DTO. Nie zawiera tekstu dla providera.

### 4.2. Generator

- Prompty generowania puli (`lessonSystemPrompt` + schemat ćwiczeń) i zagadnień (`lessonObjectivesSystemPrompt` + `lessonObjectivesJsonSchema`, `providers/openai/llm.ts`)
  przedmiotu z `ttsForPrompts` dostają
  regułę: „voiceTone: choose only when it clearly fits the content; usually
  omit (null). `mysterious` only for curiosities/riddles such as »Czy wiesz,
  że…«; `cheerful` for fun facts or playful examples; `gentle` for sensitive
  or difficult content; `curious` for questions inviting the child to think.”
  Generator nie dostaje polecenia tworzenia nowych kart-ciekawostek ani
  faktów spoza materiału (obowiązująca reguła kart bez zmian).
- Tryb `json_schema` strict wymaga pól wymaganych: `voiceTone` jako
  `["string","null"]` z enumem tonów i `null`; `null` → pole pominięte.
- Walidacja serwera (Zod): nieznana wartość tonu jest **usuwana** (styl
  domyślny), nie odrzuca ćwiczenia ani karty.
- Gramatyka (`ttsForPrompts: false`) nie dostaje pola w prompcie; jej
  walidacja puli je pomija.

### 4.3. Instrukcje tonów (profil instrukcyjny, pl-PL)

| Ton | Zdanie stylu |
| --- | --- |
| `cheerful` | Przeczytaj radośnie, z entuzjazmem i uśmiechem w głosie, wyraźnie. |
| `curious` | Przeczytaj z ciekawością, pytająco i zachęcająco, wyraźnie. |
| `gentle` | Przeczytaj łagodnie, spokojnie i ciepło. |
| `mysterious` | Pierwsze zdanie powiedz szeptem, jak sekret; resztę tajemniczo, ale wyraźnie i spokojnie. |

`mysterious` szepcze tylko pierwsze zdanie — szept w całości byłby dla
dziecka gorzej słyszalny.

### 4.4. Rekonsyliacja

- Pytanie: styl = `payload.voiceTone ?? "lesson_question"`.
- Karta: styl = `card.voiceTone ?? "lesson_card"`.
- Zmiana tonu to edycja szkicu: nowa rewizja / nowy `lesson_context`
  i uzgodnienie nagrania w tej samej transakcji co dziś zmiana tekstu.
  Opublikowana wersja i gotowe nagranie pozostają nietknięte.

### 4.5. Panel rodzica

- Pole „Ton lektora” (Mantine `Select`: Domyślny / Radośnie / Z ciekawością /
  Łagodnie / Tajemniczo) w edytorze ćwiczenia (`LessonExerciseCard`) i karty
  zagadnienia. „Domyślny” usuwa pole.
- Widoczne tylko gdy przedmiot ma `ttsForPrompts` i ćwiczenie ma tekst do
  odczytu (`questionReadText` ≠ null; np. `lesson_calculation` nie ma), a dla
  karty — gdy `cardReadText` ≠ null.
- Etykiety w katalogu komunikatów rodzica (`messages`), pl-PL.
- Rodzic nie odsłuchuje nagrania pytania/karty w panelu (dziś `prompt_audio`
  jest przed nim ukryte) — poza zakresem (§7).

## 5. Błędy i odporność

- Awaria TTS: bez zmian — zasób `failed`, brak przycisku odsłuchu, publikacja
  nie czeka (design szkoły §11.2).
- Provider/model bez profilu instrukcyjnego: nagrania bez instrukcji stylu.
- Nieprawidłowy ton od LLM: usuwany przy walidacji (§4.2).
- Odrzucenie pola `instructions` przez providera (HTTP 4xx) skutkuje błędem
  zasobu jak każda inna awaria — nie ma cichego ponowienia bez instrukcji
  (żądanie musi odpowiadać fingerprintowi).

## 6. Prywatność, koszty, integracje

- Do usługi TTS trafia tekst materiału zatwierdzonego przez rodzica i stała
  instrukcja stylu — bez danych dziecka.
- Koszt: instrukcja nie jest czytana, więc długość nagrania praktycznie się
  nie zmienia (Gemini ≈ $0,0002/s dźwięku). Jednorazowo 17 komunikatów; lekcje
  przy kolejnych edycjach.
- **API → MCP → skill: brak wpływu.** Jedyne narzędzie MCP to
  `umiem_get_learning_overview`, które nie obejmuje lekcji ani mediów;
  nie ma narzędzi tworzenia materiału. `SKILL.md` bez zmian.
- Panel rodzica w etapie B pokazuje ton; informacja o usłudze TTS bez zmian.

## 7. Poza zakresem

- Ton słówek i zdań przykładowych angielskich.
- Odsłuch nagrania pytania/karty w panelu rodzica.
- Ustawienie tonu per dziecko, wyłączenie stylu przez rodzica.
- Znaczniki w tekście, SSML i profile innych providerów (powstaną przy zmianie
  providera).
- Wsteczne generowanie nagrań opublikowanych lekcji.

## 8. Testy

Etap A:
- Jednostkowe profilu: każda rola daje oczekiwane `instructions`; brak stylu
  = sama instrukcja języka; provider spoza profilu instrukcyjnego = bez stylu.
- Jednostkowe fingerprintu: różne `instructions` → różne fingerprinty; brak
  instrukcji zgodny z etapem 1 dla słówek (słówka nie dostają nowych nagrań).
- `ui-audio-catalog`: każdy `UiAudioKey` ma styl (typ + test).
- Integracyjne (`media-reconciliation`, `ui-audio`): `prompt_audio` pytań
  i kart ma styl roli, `target_audio`/`example_audio` bez; stare neutralne
  nagranie komunikatu nie jest uznane za gotowe; executor wysyła
  `instructions` z metadanych zasobu (fake TTS rejestruje wejście).
- Adapter: `instructions` w ciele żądania tylko gdy podane.

Etap B:
- Kontrakty: `voiceTone` opcjonalne, nieznana wartość odrzucona przez schemat
  edycji rodzica; strict JSON schema generatora zawiera nullable enum.
- Walidacja puli/zagadnień: nieznany ton usunięty, `null` pominięty,
  gramatyka bez pola.
- Integracyjne: zmiana tonu w szkicu tworzy nowe żądanie nagrania i zachowuje
  stare gotowe zasoby; brak tonu = styl roli.
- Panel rodzica: test stanu edytora (pole widoczne/ukryte wg typu, „Domyślny”
  usuwa pole); E2E tylko jeśli edytor ma istniejący spec, do którego pasuje.
- Bez zmian geometrii Kid UI — brak nowych testów layoutu.
