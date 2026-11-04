# Agent generujący pulę lekcji — etap 1: domena, porty i kierownik — design

Data: 2026-11-04. Issue: [#237](https://github.com/lookassh/knowli/issues/237)
(cel, wyniki próby z 2026-11-03, etapy 1–4). Ten dokument obejmuje **etap 1**.

Decyzje właściciela (czat 2026-11-04):

- etap 1 obejmuje poprawki szkoły z issue „Do rozwiązania” pkt 1 w części
  **deterministycznej** (liczba ćwiczeń per przedmiot, bramka podpowiedzi,
  ślepe rozwiązanie i sędzia wariantów dla luk szkolnych, teksty odrzuceń per
  przedmiot); kontrole modelem w szkole (sędzia podpowiedzi, sprawdzenie
  otwartych odpowiedzi graderem) dostają w etapie 1 tylko miejsce w porcie,
  wywołania od etapu 2;
- zdania angielskie wpisane w treść kart są źródłem ujawnień **wspólnie** dla
  agenta i dzisiejszego potoku (issue pkt 5);
- planer rozdziału dopuszcza **3–6** zagadnień (issue pkt 6); reguła promptu
  dzisiejszego potoku (3–5) bez zmian;
- podejście **A**: „kierownik” (równoległość, limity, budżet, rundy naprawcze,
  później zapis) i wszystkie reguły żyją w naszym kodzie; AI SDK tylko
  prowadzi rozmowę z modelem; ślepe rozwiązanie i sędzia wariantów to osobny
  port.

## 1. Problem i zakres

Pulę ćwiczeń lekcji ma budować agent: model pisze ćwiczenia, kod sprawdza każde
przy zapisie i oddaje nazwany powód odrzucenia, model poprawia w tej samej
pętli. PoC na gałęzi `probe/lesson-pool-agent` pokazał przewagę w rozdziale
(brak ujawnień, pełne pokrycie materiału) i gramatyce, a w szkole wynik gorszy,
głównie przez konfigurację próby (issue „Do rozwiązania” pkt 1). Kod PoC żyje
w jednym pliku testu próby, z regułami ustawionymi na oko i pulą w pamięci.

Etap 1 przenosi reguły PoC do domeny, definiuje porty i składa kierownika, tak
żeby etap 2 dodał już tylko adapter AI SDK i integrację z
`executeLessonGeneration`.

**W zakresie (jeden PR):**

1. Rdzeń domenowy agenta `packages/server/src/domain/lessons/agent/` (§3).
2. Polityka agenta per przedmiot: opcjonalne pole `agentPolicy` w
   `SubjectModule`, ustawione dla `english_chapter`, `english_grammar` i
   `school` (§4).
3. Zdania kart jako źródło ujawnień we wszystkich regułach ujawnień potoku
   (zmiana produkcyjna, §5).
4. Porty `LessonPoolAgentProvider` i `LessonExerciseCheckerProvider` oraz ich
   fake'i (§6).
5. Kierownik `runLessonPoolAgent` w `modules/materials/lessons/` — w pamięci,
   bez bazy i bez podpięcia do `executeLessonGeneration` (§7).
6. Próba `pnpm probe:agent` przepięta na rdzeń i kierownika, narzędzia ślepej
   oceny i rejestr kosztów (§8).
7. Dokumentacja (§10).

**Poza zakresem:** produkcyjny adapter AI SDK, flaga `UMIEM_LESSON_GENERATOR`,
konfiguracja env agenta, integracja z `executeLessonGeneration`, zapis per
zagadnienie i wznawianie, `UsageRecorder` i `PAID_ADAPTERS` (etap 2); pomiar
odbiorczy (etap 3); usunięcie krytyka (etap 4); `sentenceCount` liczący
wielokropek ramy (issue pkt 4) i warianty szyku tłumaczeń (pkt 3) — osobne
zadania; zmiany w krytyku lekcji.

**Moduł i zależności.** Wszystko w obszarze `materials` (autorstwo materiału);
rdzeń w `src/domain/lessons/agent/`, przedmioty w `src/domain/lessons/subjects/`,
kierownik w `modules/materials/lessons/`. Brak nowych zależności między
obszarami. Granica transakcji: etap 1 nie zapisuje do bazy poza istniejącymi
ścieżkami potoku (zmiana reguły ujawnień nie zmienia transakcji).

## 2. Słownik

- **Zagadnienie** — cel lekcji (`LessonObjective`) z kartami i przykładami.
- **Podagent** — pętla modelu dla jednego zagadnienia z narzędziami
  `submit_exercises` i `remove_exercise`.
- **Kierownik** — przypadek użycia, który uruchamia podagentów, składa ich
  narzędzia z funkcji domeny i portu checkera, pilnuje limitów i rund
  naprawczych.
- **Checker** — drugi model: ślepe rozwiązanie (rozwiązujący) i ocena wariantów
  odpowiedzi (sędzia). Inna rodzina modeli niż generator.
- **Ujawnienie twarde** — rozwiązanie ćwiczenia samodzielnego widziane wcześniej
  (przykład karty, zdanie karty, ćwiczenie niesamodzielne); jak dziś
  `findExposureLeaks`.

## 3. Rdzeń domenowy (`domain/lessons/agent/`)

Czyste funkcje nad jawnie przekazanymi danymi: bez SDK, bazy, zegara,
losowości i konfiguracji środowiska. Identyfikatory ćwiczeń w puli nadaje stan
(`ex1`, `ex2`…), deterministycznie.

### 3.1. Stan

```ts
interface AgentObjective {
  readonly id: string;
  readonly titlePl: string;
  readonly descriptionEn: string;
  readonly kind?: "words" | "frame";
  readonly cards: readonly { readonly title: string; readonly body: string }[];
  readonly examples: readonly string[];
}
interface AgentPoolEntry { readonly id: string; readonly draft: LessonExerciseDraft }
interface LessonAgentState {
  readonly topic: LessonTopic;
  readonly objectives: readonly AgentObjective[];       // kolejność lekcji
  readonly pools: ReadonlyMap<string, readonly AgentPoolEntry[]>;
  /** Ćwiczenia szkicu (dogenerowanie): nietykalne, liczą się do ujawnień i duplikatów. */
  readonly fixed: readonly LessonExerciseDraft[];
  readonly nextId: number;
}
```

`createLessonAgentState(input)` buduje stan; każda operacja zwraca nowy stan
(wejście nie jest mutowane). Kolejność lekcji: ćwiczenia `fixed`, potem
zagadnienia w kolejności planu, w zagadnieniu po etapach (`intro`, `guided`,
`productive`, `independent`; poza ścieżką etapów na końcu zagadnienia), jak
`LessonState.ordered()` w PoC.

### 3.2. Kontekst kontroli

```ts
interface AgentCheckContext {
  readonly subject: SubjectModule;          // z agentPolicy
  readonly material: string;
  readonly limits: ReadonlyMap<string, ObjectiveAgentLimits>; // per zagadnienie, §3.5
}
```

### 3.3. Przyjmowanie paczki

`precheckBatch(state, objectiveId, drafts, ctx)` — wyłącznie kontrole
deterministyczne (kroki 1–2 niżej) na bieżącym stanie; zwraca dla każdego
indeksu `pass` albo `rejected`. Kierownik woła checker **tylko** dla ćwiczeń z
`pass`.

`admitBatch(state, objectiveId, candidates, checks, ctx)` przyjmuje paczkę **po
kolei** (pula rośnie w trakcie, więc duplikat w tej samej paczce odpada). Dla
każdego kandydata, w tej kolejności — pierwszy niespełniony krok rozstrzyga:

1. **limit**: pula zagadnienia osiągnęła `maxExercises`;
2. **reguły deterministyczne**:
   `subject.refineGeneratedPool` → `validateLessonExercise` →
   `validatePool([...pula zagadnienia, kandydat])` (z `fixed` tego zagadnienia)
   → `subject.validatePoolExtra` → `agentPolicy.exerciseGate`;
3. **ujawnienia** (na kolejności lekcji z kandydatem wstawionym na końcu swojego
   zagadnienia, źródła wg §5): kandydat jest ofiarą twardego ujawnienia, albo
   staje się źródłem twardego ujawnienia dla ćwiczenia przyjętego wcześniej,
   które przed wstawieniem ujawnienia nie miało;
4. **ślepe rozwiązanie**: wynik checkera jest dostępny i `blindMatches` zwraca
   `false`;
5. **warianty**: sędzia uznał któryś wariant `acceptedAnswers` za
   nierównoważny.

Krok 2 powtarza `precheckBatch`, bo między nimi inne zagadnienie mogło dodać
ćwiczenie. Typ spoza `blindSolveTypes` / `variantCheckTypes` (albo brak
wariantów) nie ma odpowiedniej kontroli i przechodzi krok bez znacznika. Brak
wyniku checkera dla typu z listy (błąd, timeout) = kontrola pominięta;
ćwiczenie przechodzi kroki 4–5, a wynik niesie znacznik `unchecked` (liczony w
statystykach jako `checkUnavailable`).

Wynik `admitBatch`: nowy stan oraz per indeks wejścia
`{ accepted: id, sanitized?: string[] }` albo
`{ rejected: { kind: "shape" | "rule" | "leak" | "blind" | "variant" | "limit", reasons: string[] } }`.
Powody są po angielsku (dla modelu); teksty ujawnień biorą szablony z
`agentPolicy.rejectionTexts`. `sanitized` opisuje usunięte pola (np. `hint`,
§4.4). Rodzaj `shape` nadaje kierownik przy parsowaniu (§7.2).

`removeExercise(state, objectiveId, id)` usuwa wyłącznie ćwiczenie z puli tego
zagadnienia (nie `fixed`, nie cudze); zwraca `{ state, removed: boolean }`.

### 3.4. Status zagadnienia

`objectiveStatus(state, objectiveId, ctx)` →
`{ counts: { guided, productive, independent, listening, total }, missing: string[], complete: boolean }`:

- **etapy**: liczba ćwiczeń etapu ≥ minimum przedmiotu (`lessonPoolMinimums`),
  dla etapu samodzielnego + `agentPolicy.independentReserve` (zapas pod
  końcową kontrolę ujawnień); `lesson_listen_choice` i inne typy poza ścieżką
  etapów liczą się do `listening`, nie do etapów;
- **wymagane typy**: każda grupa alternatyw z
  `agentPolicy.requiredTypes?.(objective)` ma co najmniej jedno ćwiczenie;
- **braki przedmiotu**: `agentPolicy.objectiveGaps?.(pool, objective, ctx)`;
- `complete` = brak braków. Ćwiczenia `fixed` zagadnienia liczą się do etapów
  i typów.

### 3.5. Limity zagadnienia

`objectiveAgentLimits(subject, topic, objectiveId, batchCount, listenAllowance)`
→ `{ targetCount, maxExercises }`: `targetCount` = `batchCount` z
`objectiveBatchCounts(poolSize, …)` (ta sama liczba co partia dzisiejszego
potoku, zależna od `poolSize` rodzica); `maxExercises = targetCount +
listenAllowance + agentPolicy.slack`. To zastępuje stałe PoC
(`POOL_COUNT_PER_OBJECTIVE = 10`, `MAX_PER_OBJECTIVE = 14`) i jest poprawką
„za duża paczka” dla szkoły. `batchCount` i `listenAllowance` liczy kierownik
istniejącymi funkcjami `objectiveBatchCounts` i `listenChoiceAllowance` z
`lesson-drafts.ts` (ten sam obszar); funkcja domenowa dostaje je jako dane.

### 3.6. Ujawnienia na całej lekcji

`lessonHardLeaks(state, subject)` → ofiary twardych ujawnień w kolejności
lekcji (`{ objectiveId, id }[]`), wyłącznie spośród ćwiczeń pul (nie `fixed`).

### 3.7. Ślepe rozwiązanie

- `solverView(draft)` — widok dziecka: polecenie, pytanie/bodziec, tekst z
  lukami, opcje, bloki `lesson_order` posortowane, bank słów luk posortowany,
  lewe strony par w kolejności i prawe posortowane (z `extraRight`), grupy i
  elementy w kolejności. Bez `answer`, `acceptedAnswers`, `focus`,
  `correctOption`, `gapAnswers`, `explanationPl`, `hint` (podpowiedź nie jest
  częścią pierwszego widoku), `requiredElements` i pozostałych pól klucza.
- `expectedAnswerCount(draft)` — luki w tekście: liczba luk; pary: liczba par;
  grupy: liczba elementów; inaczej 1.
- `blindMatches(draft, answers, normalizer)`:
  - luki w tekście: ta sama liczba odpowiedzi, każda równoważna (`answersEquivalent`)
    odpowiedzi luki na tej pozycji;
  - pary: odpowiedź i to prawa strona dla i-tej lewej (tolerancja zapisu
    „lewa => prawa”: bierzemy część po ostatnim „=>”), porównanie po
    `plainKey` (małe litery, prosty apostrof, jedna spacja);
  - grupy: etykieta grupy dla i-tego elementu, jak pary;
  - pozostałe typy: pierwsza odpowiedź równoważna `answer` albo któremuś
    wariantowi.

### 3.8. Plan zagadnień (rozdział)

`validateAgentPlan(rawPlan, subject, material)` → `{ objectives } | { errors }`:
kształt (Zod), slugi ASCII snake_case i unikalne, **3–6** zagadnień, 2–4 karty,
≤ 3 przykłady, następnie `agentPolicy.planGate?.(plan, material)`. Udany plan
składa `DynamicTopicData` i `LessonTopic` przez `subject.buildDynamicTopic` i
`validateDynamicTopicData` (ta sama ścieżka co dziś), z identyfikatorami
`${subject.id}.${slug}` zgodnymi z `buildDynamicTopicData`.

## 4. Polityka agenta per przedmiot (`SubjectModule.agentPolicy`)

```ts
interface SubjectAgentPolicy {
  /** Typy rozwiązywane na ślepo przez checker. */
  readonly blindSolveTypes: readonly LessonExerciseType[];
  /** Typy, których `acceptedAnswers` ocenia sędzia. */
  readonly variantCheckTypes: readonly LessonExerciseType[];
  /** Czy checker dostaje materiał lekcji (przedmiot, w którym rozwiązanie wymaga materiału). */
  readonly checkerNeedsMaterial: boolean;
  readonly independentReserve: number;
  readonly slack: number;
  readonly rejectionTexts: { readonly leakVictim: string; readonly leakSource: string };
  requiredTypes?(objective: AgentObjective): readonly (readonly LessonExerciseType[])[];
  exerciseGate?(draft: LessonExerciseDraft, objective: AgentObjective, ctx: { material: string }): string[];
  /** Czyszczenie świeżego ćwiczenia przed kontrolami (np. usunięcie niedozwolonego pola). */
  sanitize?(draft: LessonExerciseDraft): { draft: LessonExerciseDraft; removed: string[] };
  objectiveGaps?(pool: readonly LessonExerciseDraft[], objective: AgentObjective, ctx: { material: string }): string[];
  planGate?(plan: readonly AgentObjective[], material: string): string[];
}
```

Przedmiot bez `agentPolicy` nie może być generowany agentem (kierownik rzuca
błąd walidacji przed jakimkolwiek wywołaniem modelu). Silnik i kierownik nie
zawierają nazw przedmiotów ani reguł dziedzinowych (test architektury, §9.4).
`sanitize` działa w `admitBatch` i `precheckBatch` przed krokiem 2.

### 4.1. Wartości wspólne

`independentReserve: 1`, `slack: 2` dla wszystkich trzech przedmiotów
(wartości z PoC; strojenie w etapie 3).

### 4.2. `english_chapter`

- `blindSolveTypes` / `variantCheckTypes`: jak `BLIND_TYPES` /
  `VARIANT_CHECK_TYPES` PoC dla rozdziału (przecięte z typami przedmiotu);
  `checkerNeedsMaterial: false`.
- `requiredTypes`: `words` — `lesson_match`; `lesson_listen_choice`;
  `lesson_cloze` lub `lesson_group`. `frame` — `lesson_order`;
  `lesson_listen_choice`; `lesson_cloze` (PoC `REQUIRED_TYPES`). Grupa z typem
  spoza listy typów zagadnienia jest pomijana (np. przedmiot bez nagrań zdań).
- `exerciseGate`:
  - zagadnienie `words`: sprawdzana część ćwiczenia (luki, opcja poprawna,
    tłumaczenie, lewe strony par, elementy grup) zawiera słowo z kart **tego**
    zagadnienia; pary i grupy — co najmniej dwa (PoC `cardWordErrors`);
  - zagadnienie `frame` (**nowe**, issue pkt 2): rozwiązanie ćwiczenia
    (odpowiedź, poprawne zdanie `lesson_order`, zdanie luki po wstawieniu)
    zawiera stałą część jednej z ram z kart **tego** zagadnienia
    (`frameKey`); ćwiczenia słuchowe i pary/grupy z bramki wyłączone.
- `objectiveGaps`: `words` — każde słowo materiału z kart zagadnienia użyte w
  którymś ćwiczeniu (PoC `uncoveredWords`).
- `planGate`: każde słowo z list „en — pl” materiału i każda rama z sekcji
  zwrotów/ram trafia na kartę któregoś zagadnienia (PoC `propose_objectives`).
- Parser materiału (`parseMaterialLexicon`: słowa „en — pl” bez pytań i zdań,
  ramy z sekcji „zwroty/ramy”), `frameKey`, `plainText`, `mentions` — nowy plik
  `english-chapter/material-lexicon.ts`, obok istniejącego `lexicon.ts`
  (słownik dozwolonych słów, inna odpowiedzialność).
- `rejectionTexts.leakVictim`: tekst PoC („… change the room, object or
  place.”).

### 4.3. `english_grammar`

- `blindSolveTypes` / `variantCheckTypes`: jak PoC (wartości nie-szkolne,
  przecięte z typami przedmiotu); `checkerNeedsMaterial: false`.
- Bez `requiredTypes`, `exerciseGate`, `objectiveGaps`, `planGate` (zagadnienia
  z katalogu).
- `hint` bez zmian (w gramatyce to forma podstawowa, np. „go” przy „goes”).
- `rejectionTexts.leakVictim`: „… use a different subject, verb or object.”

### 4.4. `school`

- `blindSolveTypes`: `lesson_choice`, `lesson_match`, `lesson_group`,
  `lesson_cloze`, **`lesson_gap`**; `variantCheckTypes`: **`lesson_gap`**;
  `checkerNeedsMaterial: true`. `lesson_open_answer` nie jest rozwiązywane na
  ślepo — sprawdzenie graderem od etapu 2 (issue pkt 1).
- `sanitize`: `hint` przy typie innym niż `lesson_open_answer` jest **usuwany**
  (nie odrzucany); wynik narzędzia mówi modelowi o usunięciu. Rodzic może
  dopisać podpowiedź w edytorze (edycja nie przechodzi przez `sanitize`).
- `exerciseGate` — **bramka podpowiedzi** dla `hint` przy
  `lesson_open_answer`. Po normalizacji (`subject.normalizer`, małe litery,
  bez interpunkcji) podpowiedź nie zawiera:
  - odpowiedzi ani żadnego wariantu `acceptedAnswers`;
  - tekstu żadnego elementu `requiredElements`;
  - (dla kompletności przy przyszłych typach) tekstu poprawnej opcji ani słowa z
    banku luk.

  Zawieranie: fraza wielowyrazowa — każde jej słowo treściowe (≥ 4 litery)
  występuje w podpowiedzi w tej samej lub odmienionej formie; słowo — wspólny
  rdzeń: równe, gdy któreś ma < 6 liter, inaczej wspólny prefiks ≥ 5 liter i ≥
  długość krótszego − 3. Brak lematyzatora w repo, więc reguła jest
  przybliżeniem; testy (§9.1) pilnują przykładów z próby („Przykładem jest
  Mierzeja Wiślana”, „Użyj słów: zmniejszony, uproszczony”) i krótkich słów bez
  fałszywych trafień.
- `rejectionTexts.leakVictim`: „… ask about a different fact of the material or
  phrase the question differently.” Teksty rozdziału nie trafiają do szkoły.

## 5. Zdania kart jako źródło ujawnień (zmiana produkcyjna)

Nowy opcjonalny hak `SubjectModule.cardExposureTexts?(cards)` → teksty z kart,
które dziecko widzi jako gotowe rozwiązania. Rozdział i gramatyka implementują
go regułą PoC `cardSentences` (części linii rozdzielone „ — ” albo „ / ”, z
samych liter ASCII i interpunkcji, zakończone `.?!` albo mające ≥ 3 słowa,
bez wielokropka ramy; linia słówek „living room — salon” nie jest zdaniem).
Szkoła haka nie ma (materiał po polsku; dzisiejsze zachowanie).

Nowa funkcja domenowa `lessonExposureExamples(subject, topic, examples)` →
`examples` każdego zagadnienia rozszerzone o `cardExposureTexts` jego kart
(bez duplikatów). Używają jej **wszystkie** miejsca, które dziś przekazują
`examples` do reguł ujawnień:

- generowanie: `resolveGenerationLeaks` i `avoidSentencesFor` w
  `executeLessonGeneration` i `stageTopUpRound`;
- edytor rodzica: lista ujawnień (`lesson-api.ts`) i pokrycie
  (`lessonCoverageGaps`);
- publikacja: pokrycie publikacyjne;
- raport ujawnień (`lesson-exposure-report.ts`);
- agent (§3.3, §3.6).

Wyjątek: krytyk lekcji (`lesson-review.ts`) — bez zmian, usuwany w etapie 4.
Zapisane `lesson_context.examples` się nie zmieniają (zdania kart dochodzą przy
odczycie), więc nie ma migracji; wersje opublikowane są niezmienne i reguła
ich nie dotyka.

**Skutek:** ćwiczenie samodzielne, którego rozwiązanie jest zdaniem z karty,
odpada przy generowaniu i nie liczy się do pokrycia publikacji. Istniejące
szkice mogą stracić pokrycie — przed PR uruchamiam raport ujawnień
(`blockedBefore`/`blockedAfter`) na lokalnej bazie i podaję liczby w opisie
PR; gdy szkiców zablokowanych przybywa, decyzję o wdrożeniu podejmuje
właściciel.

## 6. Porty i fake'i

### 6.1. `ports/ai.ts`

```ts
interface LessonObjectiveAgentInput {
  /** Te same pola co partia dzisiejszego potoku dla jednego zagadnienia (produkcyjny prompt). */
  readonly pool: LessonPoolInput;
  readonly objective: { readonly id: string; readonly title: string; readonly kind?: "words" | "frame" };
  readonly otherObjectives: readonly { readonly title: string; readonly cards: string }[];
  /** Przykłady i zdania kart zagadnienia (do unikania jako odpowiedzi samodzielnych). */
  readonly cardSentences: readonly string[];
  readonly targets: {
    readonly guided: number; readonly productive: number; readonly independent: number;
    readonly requiredTypes: readonly string[];   // „lesson_match”, „lesson_cloze or lesson_group”
    readonly targetCount: number; readonly maxExercises: number;
  };
  readonly maxSteps: number;
  /** Runda naprawcza: ćwiczenia usunięte przez kontrolę całej lekcji. */
  readonly repair?: { readonly removed: readonly { readonly id: string; readonly reason: string }[] };
}

/** Skrót wyniku dla modelu (bez pełnych szkiców). */
interface LessonAgentToolOutcome {
  readonly results: readonly ({ readonly index: number; readonly accepted: string; readonly note?: string }
    | { readonly index: number; readonly errors: readonly string[] })[];
  readonly counts: { readonly guided: number; readonly productive: number; readonly independent: number; readonly listening: number; readonly total: number };
  readonly missing: readonly string[];
  readonly complete: boolean;
}

interface LessonObjectiveAgentTools {
  submit(raw: readonly unknown[]): Promise<LessonAgentToolOutcome>;
  remove(id: string): Promise<LessonAgentToolOutcome & { readonly removed: boolean }>;
  /** complete, budżet, termin albo anulowanie. */
  shouldStop(): boolean;
  /** Koszt jednego żądania HTTP adaptera w USD; null = nieznany. */
  reportCost(usd: number | null): void;
}

interface LessonAgentPlanInput {
  readonly subjectTitle: string;
  readonly topicTitle: string;
  readonly material: string;
  readonly instruction?: string;
  readonly generationRole: string;
  readonly objectivesRules?: string;
  /** Słowa i ramy materiału do pokrycia (z planGate przedmiotu) — tylko jako lista dla modelu. */
  readonly coverage?: { readonly words: readonly string[]; readonly frames: readonly string[] };
  readonly maxSteps: number;
}

interface LessonPoolAgentProvider {
  readonly name: string;
  readonly model: string;
  runObjective(input: LessonObjectiveAgentInput, tools: LessonObjectiveAgentTools, signal: AbortSignal):
    Promise<{ readonly steps: number; readonly stopReason: "stopped" | "max_steps" | "model_finished" }>;
  planObjectives(
    input: LessonAgentPlanInput,
    tools: {
      propose(raw: unknown): Promise<{ readonly ok: boolean; readonly errors: readonly string[] }>;
      shouldStop(): boolean;
      reportCost(usd: number | null): void;
    },
    signal: AbortSignal,
  ): Promise<{ readonly steps: number }>;
}

interface LessonExerciseCheckerProvider {
  readonly name: string;
  readonly model: string;
  solve(input: { readonly view: string; readonly expectedAnswers: number; readonly material?: string }, signal: AbortSignal):
    Promise<{ readonly answers: readonly string[]; readonly costUsd: number | null }>;
  judgeVariants(
    input: { readonly view: string; readonly answer: string; readonly variants: readonly string[]; readonly material?: string },
    signal: AbortSignal,
  ): Promise<{ readonly equivalent: readonly boolean[]; readonly costUsd: number | null }>;
}
```

Zasady dla adapterów (etap 2, tu jako kontrakt):

- adapter materializuje surowe rekordy jak dziś `generateLessonPool`
  (`materializeGeneratedCalculations`, `…Keywords`, `…Assignments`) przed
  `submit`; nie waliduje treści;
- pętla kończy się, gdy `shouldStop()` zwraca `true`, po `maxSteps` krokach
  albo po zakończeniu przez model; adapter zgłasza koszt **każdego** żądania
  HTTP przez `reportCost` (`providerMetadata.openrouter.usage.cost`);
- przerwanie `signal` kończy pętlę wyjątkiem przerwania;
- do checkera trafia wyłącznie widok ćwiczenia, a przy
  `checkerNeedsMaterial` także materiał; nigdy dane dziecka.

Miejsce na kontrole modelem w szkole (sędzia podpowiedzi, sprawdzenie
otwartych odpowiedzi graderem) dodaje etap 2 jako kolejne metody
`LessonExerciseCheckerProvider` albo użycie `AnswerGraderProvider`; etap 1 nie
definiuje ich sygnatur (YAGNI), zostawia tylko krok w `admitBatch` otwarty na
dodatkowe `checks`.

### 6.2. Fake'i (`providers/fake-lesson-agent.ts`)

- `FakeLessonPoolAgent`: scenariusz per zagadnienie — lista kroków
  (`{ submit: unknown[] } | { remove: string } | { throw: Error } | { hang: true }`)
  i kosztów kroków; wykonuje kolejne kroki, dopóki `shouldStop()` nie zwróci
  `true` albo nie skończy się scenariusz lub `maxSteps`; zapamiętuje wejścia i
  wyniki narzędzi (asercje testów). Plan: lista propozycji `propose`.
- `FakeExerciseChecker`: funkcja `view → answers` (domyślnie pusta lista =
  rozjazd), funkcja werdyktów wariantów (domyślnie wszystkie `true`), tryby
  `throw`/`hang`, koszt per wywołanie, licznik wywołań i maksymalna
  zaobserwowana równoległość.

## 7. Kierownik (`modules/materials/lessons/lesson-pool-agent.ts`)

```ts
runLessonPoolAgent(
  deps: { agent: LessonPoolAgentProvider; checker: LessonExerciseCheckerProvider; policy: LessonAgentPolicy },
  input: LessonPoolAgentRunInput,   // przedmiot, temat lub dane do planu, materiał, polecenie, tematy zdań,
                                    // poolSize, graderAvailable, fixed (szkic), przykłady szkicu
  signal: AbortSignal,
): Promise<LessonPoolAgentResult>
```

`LessonAgentPolicy` (wartości domyślne w kodzie; env od etapu 2):
`maxStepsPerObjective` 8, `planMaxSteps` 8, `objectiveTimeoutMs` 300 000,
`runTimeoutMs` 900 000, `runBudgetUsd` 1,00, `concurrency` 4,
`checkerConcurrency` 8, `repairRounds` 2.

### 7.1. Przebieg

1. **Walidacja wejścia**: przedmiot ma `agentPolicy`; inaczej `AppError("validation")`
   bez wywołań modelu.
2. **Plan**: przedmiot z `planGate` i bez zagadnień na wejściu →
   `planObjectives`; `propose` woła `validateAgentPlan` i zwraca błędy modelowi.
   Brak przyjętego planu po `planMaxSteps` → wynik `plan_failed` (bez dalszych
   wywołań). Pozostałe przedmioty: zagadnienia z tematu (gramatyka) albo z
   wejścia (szkoła — `generateLessonObjectives` woła wołający, jak dziś).
3. **Podagenci**: każde zagadnienie dostaje `runObjective` z `AbortSignal`
   łączącym sygnał runu, termin zagadnienia i termin runu; najwyżej
   `concurrency` naraz, w kolejności lekcji.
4. **Narzędzie `submit`** (dla jednego zagadnienia; wywołania tego samego
   podagenta są sekwencyjne):
   1. parsowanie każdego rekordu: `isWellShapedRawExercise`, `objectiveId`
      równe zagadnieniu, `toExerciseDraft`, sanityzacja `voiceTone` i
      `explanationPl` jak w potoku (`withoutVoiceToneUnlessAllowed`,
      `withoutInvalidExplanation`), `scopeFamiliesToRun` przy dogenerowaniu;
      błąd = `rejected: shape`;
   2. `precheckBatch` na bieżącym stanie;
   3. checker dla przyjętych przez `precheck` i z typem z polityki: `solve`
      (gdy typ w `blindSolveTypes`), `judgeVariants` (gdy typ w
      `variantCheckTypes` i są warianty) — równolegle, przez wspólny semafor
      `checkerConcurrency`, z kosztem doliczanym do budżetu; błąd =
      brak wyniku;
   4. `admitBatch` na **bieżącym** stanie (nie na stanie z kroku 2) i
      podmiana stanu kierownika;
   5. zwrot `LessonAgentToolOutcome` (skrót; pełne powody i szkice zostają u
      kierownika w dzienniku odrzuceń).
   Po przekroczeniu budżetu lub terminu `submit` nie przyjmuje paczki (wynik z
   błędem „budget exhausted”), a `shouldStop()` zwraca `true`.
5. **Kontrola całej lekcji**: po zakończeniu wszystkich podagentów
   `lessonHardLeaks`; ofiary wypadają z pul, a ich zagadnienia (te, które nie
   są `failed`) dostają rundę naprawczą (`repair.removed`), najwyżej
   `repairRounds` razy; ofiary pozostałe po ostatniej rundzie wypadają bez
   naprawy.
6. **Wynik** `LessonPoolAgentResult`:
   - `objectives`: per zagadnienie `status` (`complete` | `incomplete` z
     `missing` | `failed` z kodem błędu klasyfikowanym jak
     `classifyLessonGenerationFailure`), przyjęte szkice w kolejności lekcji,
     kroki;
   - `topic` / `dynamicTopic` (gdy był plan);
   - `stats`: zgłoszone, przyjęte, odrzucone per rodzaj, `checkUnavailable`,
     wywołania checkera, usunięte w kontroli lekcji, rundy;
   - `rejections`: `{ objectiveId, exerciseType, kind, reason }[]` (powody
     angielskie, bez treści ćwiczeń — do logów i pomiaru);
   - `costUsd` (suma znanych kosztów) i `costUnknownCalls`.

### 7.2. Błędy i przerwanie

- Wyjątek dostawcy w `runObjective` → zagadnienie `failed`; pozostałe działają
  dalej. Wyjątek w `planObjectives` → wynik `plan_failed` z kodem błędu.
- Błąd checkera → brak wyniku kontroli (§3.3), bez porażki.
- Przerwanie sygnału runu → kierownik czeka na zakończenie trwających wywołań
  (sygnał je przerywa) i rzuca błąd przerwania; nie zwraca częściowego wyniku.
- Termin zagadnienia → `incomplete`; termin runu → wszystkie trwające
  zagadnienia `incomplete`, bez rund naprawczych (kontrola ujawnień całej
  lekcji nadal usuwa ofiary).
- Statusy runu w bazie, `needs_review`, ponowienia i zapis — etap 2.

### 7.3. Logi

`[lesson-agent]` z identyfikatorem runu (przekazanym w wejściu), slugiem
zagadnienia, licznikami, statusem, krokami i kosztem; bez treści ćwiczeń,
materiału, tematów zdań i powodów zawierających treść (powody ślepego
rozwiązania z odpowiedziami trafiają tylko do `rejections` wyniku, nie do
logów).

## 8. Próba i narzędzia oceny (`tests/probes/`)

- `agent-generation.probe.test.ts` (`pnpm probe:agent`) zastępuje
  `agent-generation-v2` PoC i **nie ma własnych reguł**: woła
  `runLessonPoolAgent`. W pliku próby zostaje tymczasowa implementacja obu
  portów na AI SDK (`ToolLoopAgent`, `generateText`, OpenRouter), przeniesiona
  do adaptera w etapie 2. Prompt podagenta: `lessonSystemPrompt` +
  `lessonUserMaterial` + dopisek przepływu narzędzi z PoC; tryb `probe`
  (uproszczony schemat) usunięty.
- Zmienne: `UMIEM_PROBE_AGENT_SUBJECT` (`chapter` | `grammar` | `school`),
  `_MATERIAL`, `_OBJECTIVES_DUMP`, `_MODEL`, `_REASONING`, `_SOLVER_MODEL`,
  `_DUMP`, `_TIMEOUT_MS`, `_BUDGET_USD`, `_POOL_SIZE`, `UMIEM_PROBE_COSTS`.
  Ścieżki wejścia i wyjścia wyłącznie poza repozytorium
  (`resolveOutsideRepoPath`).
- Zrzut `dump.json` w formacie czytanym przez `blind/gen-blind-sheet.cjs`
  (źródło `agent`), z `rejections`, statystykami, krokami, kosztem i statusami
  zagadnień.
- Z gałęzi `probe/lesson-pool-agent`: `blind/gen-blind-sheet.cjs`,
  `blind/score.cjs`, `blind/rubric-generation.md`, `blind/rubric-criteria.md`
  bez zmian (rubryki zamrożone).
- Z lokalnej gałęzi `feat/lesson-review-probe` — **same pliki**, bez historii i
  bez wypychania gałęzi:
  - `probe-helpers.ts` (`loadDotEnv`, `resolveOutsideRepoPath`, `runDirsOf`) z
    testem;
  - nowy `probe-costs.ts` z rejestru `probe-results.ts`: `CostEntry`,
    `CostLedger`, `readCostLedger`, `initCostLedger`, `appendCostEntry`,
    `appendProvisionalCostEntry`, `settleCostEntry`, `assertWithinCostCap`,
    `ledgerCost`, `probeEndpointHost`, z testami; bez etykiet, arkuszy i
    punktacji krytyka;
  - rozszerzenia `chapter-generation.probe.test.ts`:
    `UMIEM_PROBE_REVIEW_DUMP_OUT`, `_POOL_SIZE`, `_COSTS`, `_OUT_DIR`,
    `_ALLOW_HOST`; bez strojenia krytyka.
- **Higiena**: przed commitem przegląd przenoszonych plików pod kątem imion,
  identyfikatorów, ścieżek lokalnych i fragmentów materiałów; dzienniki próby
  bez materiału.
- Zależności: `ai@7.0.162` i `@openrouter/ai-sdk-provider@3.1.0` jako
  **devDependencies roota**, przypięte dokładnie, z `pnpm-lock.yaml`. Nie
  trafiają do `packages/*` (test §9.4).

## 9. Testy i weryfikacja

### 9.1. Domena (jednostkowe, fikcyjne dane)

- `admitBatch`: kolejność kroków (który powód wygrywa); duplikat w tej samej
  paczce; ujawnienie — kandydat ofiarą oraz kandydat źródłem dla przyjętego;
  `fixed` nietykalne i liczone; limit; brak wyniku checkera = przyjęcie z
  `unchecked`; odrzucenie wariantów; `sanitize` (usunięte pole w wyniku);
  stan wejściowy niezmieniony.
- `precheckBatch` daje te same decyzje kroków 1–2 co `admitBatch` na tym samym
  stanie.
- `removeExercise`: tylko własna pula.
- `objectiveStatus`: minima + rezerwa, `listening` poza etapami, wymagane
  typy, `objectiveGaps`, `fixed`, `complete`.
- `objectiveAgentLimits` (`targetCount`, `maxExercises` z dodatkiem słuchowym
  i `slack`).
- `blindMatches` dla każdego typu, w tym pary, grupy, luki w tekście; warianty;
  normalizator; inna liczba odpowiedzi; „=>”; wielkość liter, apostrofy.
- `solverView`: test własności — żadne pole klucza (§3.7) nie występuje w
  widoku dla przykładowego ćwiczenia każdego typu; bloki i prawe strony
  posortowane.
- `lessonHardLeaks`, `lessonExposureExamples` i `cardExposureTexts` (zdania
  tak, słówka „en — pl” nie, ramy z wielokropkiem nie).
- `validateAgentPlan`: 3 i 6 zagadnień przechodzą, 2 i 7 nie; slugi; karty;
  identyfikatory zgodne z `buildDynamicTopicData`.
- Rozdział: parser słów i ram; `planGate`; bramka słów kart; bramka ramy;
  `objectiveGaps`; `requiredTypes` z pominięciem typu spoza zagadnienia.
- Szkoła: bramka podpowiedzi (odpowiedź, wariant, element wymagany, forma
  odmieniona, przykłady z próby, krótkie słowa bez fałszywych trafień);
  `sanitize` usuwa `hint` przy typach innych niż otwarta odpowiedź;
  `checkerNeedsMaterial`.
- Gramatyka: `hint` nietknięty.

### 9.2. Kierownik (z fake'ami, bez bazy)

- przebieg do `complete` w kilku krokach (odrzucenie → poprawka → przyjęcie);
- limit kroków → `incomplete` z brakami;
- budżet: `shouldStop`, odmowa `submit`, pozostałe zagadnienia kończą;
- termin zagadnienia i termin runu;
- awaria dostawcy w jednym zagadnieniu → `failed`, pozostałe `complete`;
- awaria checkera → przyjęcie z `checkUnavailable`;
- rozjazd ślepego rozwiązania → odrzucenie z powodem; druga paczka przechodzi;
- checker wołany wyłącznie dla ćwiczeń po `precheck` i typów z polityki;
  materiał tylko przy `checkerNeedsMaterial`;
- równoległość: nigdy ponad `concurrency` podagentów i `checkerConcurrency`
  wywołań checkera;
- ujawnienie między zagadnieniami → ofiara wypada, runda naprawcza z
  `repair.removed`; po `repairRounds` koniec;
- plan: odrzucony plan → poprawiony → przyjęty; brak planu → `plan_failed`;
- przedmiot bez `agentPolicy` → błąd walidacji bez wywołań;
- przerwanie sygnału → błąd przerwania;
- model dostaje skrót (`LessonAgentToolOutcome`), nie pełne szkice;
- dogenerowanie: `fixed` w wejściu, zagadnienie startuje z ich licznikami.

### 9.3. Zdania kart w potoku

- jednostkowe: każde miejsce z §5 używa `lessonExposureExamples` (testy
  `avoid-sentences`, `lesson-coverage`, `lesson-drafts`);
- integracyjne (`lesson-generation`, `lesson-chapter`,
  `lesson-exposure-report`, istniejące pliki): ćwiczenie samodzielne z
  odpowiedzią równą zdaniu karty odpada przy generowaniu i nie liczy się do
  pokrycia publikacji; szkoła bez zmian.

### 9.4. Architektura

- `domain/lessons/agent/` nie importuje `ai`, `@openrouter/*`, Drizzle,
  `modules/`, `providers/`, `ports/` ani konfiguracji (rozszerzenie
  `domain/lessons/architecture.test.ts`), i nie zawiera identyfikatorów
  przedmiotów (`english_chapter`, `english_grammar`, `school`);
- nowy test: `ai` i `@openrouter/*` nie występują w `packages/**` ani w
  `apps/**` (etap 2 dopuści jeden plik adaptera);
- kierownik nie zawiera identyfikatorów przedmiotów;
  `module-boundaries.architecture.test.ts` przechodzi.

### 9.5. Próba

Testy `probe-costs` i `probe-helpers`; typecheck pliku próby; jeden płatny
przebieg kontrolny na rozdziale (ok. 0,15 USD, z rejestrem kosztów), żeby
potwierdzić działanie próby na kodzie domenowym. Pełny pomiar — etap 3.

### 9.6. Przed PR

`pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm build`;
raport ujawnień na lokalnej bazie (§5). E2E tylko, jeśli zmiana reguły
ujawnień dotknie `parent-lesson-editor-layout.spec.ts` (uruchomić ten spec).

## 10. Dokumentacja

- `docs/architecture.md` §19: nowy podrozdział „Agent generujący pulę” (rdzeń,
  `agentPolicy`, porty, kierownik, status: za flagą od etapu 2) i nota w
  regule ujawnień o zdaniach kart (`cardExposureTexts`,
  `lessonExposureExamples`).
- `AGENTS.md`: zdanie o `agentPolicy` w `SubjectModule` i o tym, że SDK agenta
  (`ai`, `@openrouter/*`) jest dozwolone wyłącznie w adapterze (od etapu 2) i w
  `tests/probes`.
- Nagłówek pliku próby: uruchomienie, zmienne, koszty.
- API → MCP → `SKILL.md`: bez wpływu (generowanie nie jest wystawione);
  uzasadnienie w opisie PR.

## 11. Prywatność

Bez zmian względem dzisiejszego generatora: do modeli trafia materiał rodzica,
tematy zdań (gramatyka, ogrodzony blok danych, jak dziś w `lessonUserMaterial`)
i zdania do unikania; do checkera wyłącznie widok ćwiczenia, a w szkole także
materiał. Nigdy imię, rok urodzenia, identyfikatory ani odpowiedzi dziecka.
Logi bez treści ćwiczeń i materiału (§7.3). Informacja dla rodzica o usłudze
checkera — etap 2 (razem z konfiguracją).

## 12. Ryzyka

- **Zdania kart zablokują istniejące szkice** — mierzone raportem ujawnień
  przed PR (§5).
- **Bramka podpowiedzi to przybliżenie bez lematyzatora** — fałszywe trafienia
  odrzucają dobre podpowiedzi, a model je poprawia; mierzone w etapie 3
  (`rejections` z powodem bramki).
- **Pominięta kontrola przy awarii checkera** obniża jakość bez sygnału dla
  rodzica — licznik `checkUnavailable` w wyniku i pomiarze; decyzja o progu w
  etapie 3.
- **Zależności dev o wysokim numerze wersji (`ai@7.0.162`)** — przypięte
  dokładnie; aktualizacja tylko świadomie.
