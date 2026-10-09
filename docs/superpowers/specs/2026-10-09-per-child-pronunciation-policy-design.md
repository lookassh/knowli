# Polityka wymowy per dziecko i podświetlanie fragmentów słowa — design

Data: 2026-10-09. Stan bazowy: main = `452a6c7`. Decyzje zatwierdzone przez właściciela
w rozmowie (brainstorming): zakres = tylko progi wymowy; domyślne pasma 70/50 aktywne od razu;
lista kalibracyjna prób w panelu rodzica; podświetlanie po fonemach zmapowanych na litery
z fallbackiem całego wyrazu; podejście przechowywania A (niezmienne wersje polityk per dziecko).

## 1. Cel i kontekst

Dwoje dzieci (Szymon, Krzyś) ma różne głosy i tempo — progi oceny wymowy muszą być
konfigurowalne per dziecko, a rodzic musi mieć dane do oceny, czy progi są dobrze ustawione.
Docelowo dziecko ma widzieć, którą część słowa wymówiło dobrze, a którą „prawie" — bez liczb
i symboli fonetycznych (SPEC §7: interfejs dziecka bez procentowych ocen i technicznych
wyników wymowy).

Dziś: polityka `learning-v1` jest globalna i ma puste `pronunciationBands`, więc wymowa jest
zawsze „nieoceniona", a zadanie wymowy domyka się na zgodnej treści (feedback
`content_matched`). Adapter Azure wysyła `Granularity: "Word"` i czyta wyłącznie
skalarny `NBest[0].AccuracyScore`.

## 2. Model danych i rozstrzyganie polityki

- Migracja (schemat Drizzle jako autorytatywny + przeglądany SQL, zgodnie z zasadami repo):
  `child_profiles.policy_id` — `text`, nullable, FK → `learning_policies(id)`,
  `ON DELETE RESTRICT` (polityki są niezmienne, usunięcie i tak blokuje trigger).
- Nowa wersja globalna **`learning-v2`**: konfiguracja identyczna z v1 plus
  `pronunciationBands: { "azure-pronunciation": {scaleMax: 100, correctMinScore: 70, partialMinScore: 50}, "fake-pron": {…te same wartości} }`.
  Seed przez registry (`ensureLearningPolicy` seeduje v1 i v2 idempotentnie);
  `CURRENT_POLICY_ID` wskazuje `learning-v2`.
- `startSession` przypina `policyId = child.policyId ?? CURRENT_POLICY_ID`. Sesje i próby
  już przypinają `policy_id` — zamrożenie reguł działa bez zmian, a aktywne sesje
  zakończone na v1 nie są dotykane.
- Dzieci bez własnej polityki (obecnie obaj) przechodzą na v2 od następnej sesji.

### Edycja progów = nowa wersja polityki

`PUT` progów dziecka wykonuje w JEDNEJ transakcji:

1. wczytuje obecną politykę efektywną dziecka (jego `policy_id`, a gdy null — v2),
2. tworzy konfigurację: kopia z `pronunciationBands[<aktywny provider>]` = nowe progi,
3. wstawia wiersz `learning_policies(id = "child-<childId>-<seq>")`, gdzie
   `seq = 1 + liczba wierszy o prefiksie "child-<childId>-"`,
4. ustawia `child_profiles.policy_id` na nowy identyfikator.

Poprzednie wiersze zostają jako audyt („jakie reguły obowiązywały przy próbie").
Nie przepisujemy zakończonych ocen — nowa polityka obowiązuje od następnej sesji.

## 3. API rodzica

Nowe trasy pod istniejącą autoryzacją Parent Mode (sesja + PIN), jak każda operacja
`/api/v1/parent/*`:

- `GET /api/v1/parent/children/:id/pronunciation` →
  `{ "pronunciationAvailable": boolean,
     "thresholds": { "correctMinScore": number, "partialMinScore": number } | null,
     "attempts": [ { "word": string, "score": number,
                     "band": "correct" | "partial" | "below" | null,
                     "attemptedAt": string } ] }`
  — `attempts`: do 20 ostatnich ocen wymowy dziecka z `assessments`
  (`skill = 'pronunciation'`, `details.pronunciation.score` niepusty; słowo z
  `session_tasks.answer_key->>'target'` próby; `band` z `details.pronunciation.band`).
  `thresholds` = pasma aktywnego providera z polityki efektywnej dziecka;
  `pronunciationAvailable: false`, gdy wymowa nie jest skonfigurowana (brak kluczy).
- `PUT /api/v1/parent/children/:id/pronunciation` body
  `{ "correctMinScore": number, "partialMinScore": number }` → 204.
  Walidacja Zod: liczby całkowite 0–100, `correctMinScore > partialMinScore`.
  Błędy: `not_found` (profil), `conflict` (wymowa niedostępna), `validation`
  (progi) — komunikaty po polsku z `messages.ts`.

Nazwy providerów nigdy nie pojawiają się w API ani UI rodzica; zapis trafia pod klucz
aktywnego providera (serwer wie, który jest spięty w kompozycji).

## 4. UI rodzica (zakładka „Dzieci")

Wiersz dziecka w `ChildEditor` rozwija sekcję „Ustawienia wymowy":

- dwa pola liczbowe (próg „dobrze", próg „prawie") + „Zapisz";
- lista kalibracyjna pod spodem: słowo, wynik 0–100, werdykt, data;
- gdy `pronunciationAvailable = false` — zamiast edytora polski komunikat o braku
  konfiguracji wymowy.

Nowe klucze w `messages.ts` (polskie), testidy i style zgodne z istniejącym panelu.

## 5. Ocena wymowy: poprawka pasm i fragmenty

### Poprawka semantyki pasm (ścieżka nigdy nieaktywna — puste pasma; moduł `speech.ts`)

Przy pasmach i treści zgodnej z kluczem:

- `correct` (≥ próg „dobrze") → outcome `correct` (seria kwalifikująca, feedback `great`),
- `partial` (≥ próg „prawie") → outcome `incorrect` z `details.pronunciation.band = "partial"`
  (trudność → wsparcie; feedback `almost` — istniejąca reguła),
- `below` (< próg „prawie") → **nieocenione** (techniczne, zero skutku dla postępu),
  feedback wraca do `content_matched` („Usłyszałem! Nie udało się ocenić wymowy").

Dziś `below` mapowałoby się na `incorrect` — sprzeniewierzałoby się zasadzie „wymowa nie jest
błędem wiedzy" i wnioskom z próby technicznej (`docs/speech-spike.md`).

### Adapter Azure

- `Granularity: "Phoneme"`; odpowiedź rozszerzona o `NBest[0].Words[]`:
  `{ Word, AccuracyScore?, ErrorType?, Phonemes: [{ Phoneme, AccuracyScore? }] }`
  — parsowane i walidowane Zodem po stronie serwera (zasada: structured output waliduje serwer).
- `PronunciationResult` (port `packages/server/src/ports/ai.ts`) += opcjonalne
  `words: Array<{ text, accuracyScore: number | null, errorType: string | null,
  phonemes: Array<{ phoneme: string, accuracyScore: number | null }> }>`.
  Semantyka `overallScore` bez zmian.
- `FakePronunciationProvider` zwraca deterministyczne `words` (2–3 fonemy, score'y ~95),
  żeby e2e i integracyjne miały stabilne fragmenty.

### Fragmenty — czysta funkcja domenowa

`buildPronunciationFragments(target, wordAssessment, bands)` → lista
`{ text, verdict: "good" | "almost" }` lub `null`:

- **Warunki fallbacku** (cały wyraz jednym werdyktem): brak danych fonemów, mniej niż
  2 fonemy, `ErrorType ≠ None`, Azure zwrócił inną liczbę słów niż 1 albo tekst słowa
  rozjeżdża się z dopasowanym wariantem, lub nieudane dopasowanie liter do fonemów.
- **Dopasowanie zachłanne** liter→fonemów: tabela digrafów angielskich
  (ch, sh, th, ph, wh, ck, ng, qu, ee, ea, oo, ou, ai, ay, oa, oi, oy, au, aw, er, ir, ur,
  ar, or, ie, ue, ui); tolerancje: litera samogłoskowa przyjmuje dowolny fonem samogłoskowy;
  końcowe „e" bez pasującego fonemu = nieme (konsumuje zero fonemów); maksymalnie jeden
  niedopasowany fonem na końcu (schwa/wstawienie). Sukces = wszystkie grupy mają fonemy
  albo są nieme, a strumień fonemów wyczerpany (z tolerancją).
- **Werdykt grupy**: średnia score'ów jej fonemów ≥ próg „dobrze" → `good`,
  w przeciwnym razie `almost` (nie ma koloru „źle"). Grupy nieme bez własnego werdyktu.
- **Scalanie** sąsiednich grup o tym samym werdykcie; maks. 6 grup.
- **Fallback całego wyrazu**: werdykt z bandu ogólnego (`correct` → `good`,
  `partial` → `almost`; przy `below` fragmentów brak — patrz wyżej).
- Fragmenty są **wyłącznie wizualne**: o outcome, serii i harmonogramie decyduje wyłącznie
  score całej wypowiedzi i bandy. Heurystyka nie może zafałszować postępu.

Fragmenty liczy ocenianie mowy (moduł `speech`) przy bandach `correct`/`partial`,
dokleja do `Grade` (nowe opcjonalne pole `speechFragments`), a `chooseFeedback`
przenosi je do feedbacku.

## 6. Kontrakt dziecka i kid-ui

- `FeedbackDtoSchema` += `fragments: z.array(z.object({ text: z.string().min(1),
  verdict: z.enum(["good", "almost"]) })).max(6).optional()`.
  Bez liczb, bez IPA, bez score'ów (SPEC §7, AGENTS: Kid DTO bez technicznych score'ów).
- kid-ui: w karcie feedbacku zadania wymowy słowo rysowane jako grupy liter;
  `good` — zieleń tonu `--correct`, `almost` — bursztyn tonu `--retry`, grupy nieme
  bez wyróżnienia. Nowe style `.kid-fragment` + testidy.
- Teksty feedbacku bez zmian („Świetnie!", „Prawie! Posłuchaj jeszcze raz",
  „Usłyszałem! Nie udało się ocenić wymowy").

## 7. Prywatność i bezpieczeństwo

- Nagranie dziecka nadal tylko w pamięci (baza, kolejka, logi, pliki — nietknięte).
- DTO dziecka nie zawiera liczb; liczby widzi wyłącznie rodzic w panelu (za PIN-em).
- Polityki pozostają niezmienne (trigger `learning_policies_immutable` nietknięty);
  zmiana parametrów wyłącznie jako nowa wersja — zasada AGENTS zachowana.

## 8. Testy i bramki

- **Jednostkowe**: rozstrzyganie polityki (v2 domyślnie, własna per dziecko); tworzenie
  nowej wersji przy PUT (sekwencja id, niezmienność poprzednich); `buildPronunciationFragments`
  (digrafy, tolerancje, fallbacki, scalanie, werdykty); pasma `below` → nieocenione;
  feedback z fragmentami i bez.
- **Integracyjne (PG)**: PUT tworzy nową wersję i przepina profil; aktywna sesja po edycji
  trzyma starą politykę, nowa dostaje nową; próby mowy fake providerem: score 95 → `correct`
  + zielone fragmenty, 55 → `partial` + „Prawie" + bursztynowe, 30 → nieocenione +
  `content_matched`; GET listy prób; walidacja i auth tras rodzica.
- **e2e (Playwright, fake providers)**: rodzic otwiera ustawienia wymowy dziecka, zapisuje
  progi, widzi listę prób; dziecko wykonuje zadanie wymowy — deterministycznie zielone
  fragmenty na karcie feedbacku.
- Bramki: `pnpm test:unit`, `test:integration`, `test:e2e`, `typecheck`, `build`;
  redeploy lokalny + żywa weryfikacja na :8080.

## 9. Dokumentacja do aktualizacji

- `docs/SPEC.md`: domyślne pasma wymowy 70/50, polityka per dziecko, ustawienia wymowy
  i lista prób w panelu rodzica, fragmenty w feedbacku dziecka (bez liczb).
- `docs/architecture.md`: rozstrzyganie polityki per dziecko (uzupełnienie o wersje
  `child-*`), semantyka pasm `below`, fragmenty w §11 (mowa).
- `docs/implementation-plan.md`: zadania dopisze plan implementacji (writing-plans).

## 10. Poza zakresem

Edycja pozostałych parametrów polityki (odstępy, budżet, wsparcie), przechowywanie nagrań,
IPA lub liczby w UI dziecka, wybór providera w UI, przełącznik języka, polityki globalne
edytowalne z panelu.
