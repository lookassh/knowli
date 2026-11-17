# MCP: lekcja z materiału rodzica tworzona przez agenta (`lesson_material_create`)

Data: 2026-11-16. Gałąź `feature/mcp-lesson-creation-b855fb`. Kontekst: `docs/integrations/lesson-authoring.md`, PR #452 (lekcje szkolne po `deckId`, `lesson_draft_append`). Spec po przeglądzie trzech krytyków (poprawność i bezpieczeństwo, kontrakt i dokumentacja, przepływ agenta i testy) — uwagi naniesione.

## Po co

Rodzic wkleja w claude.ai zdjęcie strony podręcznika (angielski albo inny przedmiot, np. przyroda). Claude odczytuje tekst ze zdjęcia i ma z niego założyć w Umiem! nową lekcję — zagadnienia, karty i pytania — jako szkic do przeglądu w panelu. Dziś MCP potrafi lekcję z materiału tylko odczytać i uzupełnić; utworzyć ją może wyłącznie panel, płatnym generowaniem modelem.

## Cele

- Agent z tokenem `lessons:write` (albo `materials:write`) zakłada lekcję przedmiotu z materiału (każdy przedmiot z `buildDynamicTopic`, dziś `school` i `english_chapter`) z materiałem, tytułem tematu, nazwą przedmiotu (gdy przedmiot jej wymaga) oraz zagadnieniami i kartami napisanymi przez agenta.
- Przed zapisem agent dostaje zasady pisania zagadnień i kart przedmiotu — te same, które dostaje generator panelu.
- Pytania dopisuje istniejąca ścieżka: `lesson_catalog(deckId)` → `lesson_validate(append)` → `lesson_draft_append`.

## Poza zakresem

- OCR w aplikacji — tekst ze zdjęcia odczytuje agent po swojej stronie; do serwera trafia tylko tekst.
- Generowanie modelem po stronie serwera — zero płatnych wywołań LLM; koszt to wyłącznie nagrania TTS (karty szkoły, potem pytania).
- Zapis materiału jako źródła (`source_materials`) i `decks.source_material_id`.
- Edycja zagadnień, kart i materiału po utworzeniu przez MCP (zostaje w panelu, jak dziś). Błąd odczytu zdjęcia poprawia się w panelu albo zakładając lekcję od nowa.
- Walidacja zagadnień na sucho — odrzucony zapis nie zjada limitu (limiter liczy tylko udane zapisy, `learning-mcp-route.ts:197-201`), więc `lesson_material_create` sam jest sprawdzeniem.
- Publikacja, przypisania — bez zmian.

## Anty-cele

- Druga ścieżka budowy tematu albo kopia jego walidacji: MCP woła te same `buildDynamicTopicData`, `validateDynamicTopicData`, `withSubjectObjectiveKinds` co etap zagadnień generowania; generowanie zachowuje swoje odrzucanie pojedynczych zagadnień i identyczny prompt.
- Ciche obcinanie albo gubienie danych agenta — wszystko, co rdzeń by przyciął lub pominął, jest odrzucane wcześniej przez schemat wejścia (`validation`).
- Agent nadający pełne id zagadnień albo omijający reguły przedmiotu (rozdział bez `kind`).
- Ujawnienie czegokolwiek o dzieciach, tematach zdań, kosztach.

## Podejścia (wybór właściciela: B)

- **A. Jeden zapis** — `lesson_draft_create` przyjmuje zagadnienia i pytania z lokalnymi kluczami zagadnień. Jeden zapis; ale nowa obsługa kluczy w walidacji i zapisie oraz reguły pytań dla zagadnień, które jeszcze nie istnieją.
- **B. Dwa kroki (wybrane)** — nowe narzędzie zakłada lekcję bez pytań; pytania dopisuje sprawdzona ścieżka `append`. Najmniej nowego kodu, te same reguły co lekcje z panelu. Koszt: szkic bez pytań widoczny w panelu między krokami (publikacja zablokowana przy zerze zadań, `LessonEditor.tsx:552`) i co najmniej dwa zapisy z limitu 10/h.
- **C. Zagadnienia z naszego modelu, pytania agenta** — odrzucone: płatne generowanie, którego właściciel nie wybrał.

## Projekt

### Zasady zagadnień w domenie (bez zmiany promptu)

Ogólne zasady dzielenia materiału (dziś literał w `providers/openai/llm.ts:303-311`: 2–8 zagadnień, 2–4 karty po polsku prostym językiem, treść karty do 600 znaków, nie dodawać faktów spoza materiału) przenosimy do stałej w domenie lekcji (np. obok `material-creation.ts`); `llm.ts` składa z niej identyczny prompt. Migawka/test promptu adaptera bez zmian dowodzi, że treść się nie zmieniła. Rozdział ma już `prompts.objectivesRules` i jego gałąź promptu zostaje.

### Nowe narzędzie tylko do odczytu `lesson_material_rules`

Osobne narzędzie zamiast rozszerzania `lesson_catalog`: `outputSchema` MCP musi być obiektem (`ToolDefinition.outputSchema: z.ZodObject`), unia odpada, a pola opcjonalne osłabiłyby wymagane dziś pola katalogu (`topicId`, `objectives[].rules`, …).

Wejście `{ subjectId? }`: bez `subjectId` — lista przedmiotów z materiału; z `subjectId` przedmiotu katalogowego → `validation`. Wyjście `{ subjects: [...] }`, dla każdego:

- `subjectId`, `subjectTitlePl`, `generationRole`;
- `subjectTitleRequired` (`materialSubjectTitle === "parent"`), `kindRequired` (`objectivesRules` obecne), `voiceTonesAllowed` (`ttsForPrompts === true`; to samo oznacza nagrania kart, opisane w polu i w skillu);
- `objectiveRules`: tekst zasad zagadnień i kart, który dostaje generator tego przedmiotu (gałąź ogólna albo gałąź z `prompts.objectivesRules` razem z jej zastrzeżeniami o kartach), złożony ze stałych domeny;
- `exerciseTypes`, `poolMinimums` (żeby agent zaplanował pytania; księgi reguł pytań przychodzą z `lesson_catalog(deckId)` po utworzeniu, z prawdziwymi id zagadnień).

Limity strukturalne agent widzi w `inputSchema` `lesson_material_create` z `tools/list`; nie powtarzamy ich w wyjściu.

### `lesson_material_create`

Wejście (`packages/contracts/src/lesson-authoring.ts`, `.strict()` na każdym poziomie):

```text
clientRequestId: uuid                      → deckId
subjectId: string
subjectTitlePl?: string (1..MAX_SCHOOL_SUBJECT_TITLE_LENGTH)   wymagany przy subjectTitleRequired, inaczej zabroniony
topicTitlePl: string (1..MAX_SCHOOL_TOPIC_TITLE_LENGTH)
material: string (1..MAX_SCHOOL_MATERIAL_LENGTH = 16000)        jak panel (pozostałe narzędzia autorskie mają 8000 — świadoma różnica: strona podręcznika)
title?: string (1..120)
objectives: 1..8 × {
  slug?: string (1..40, [a-z0-9_])        brak → slug z titlePl (sanitizeObjectiveSlug); duplikat → validation, nie cicha zmiana
  titlePl: 1..120
  descriptionEn: 1..400
  kind?: "words" | "frame"                 wymagany przy kindRequired, inaczej zabroniony
  cards: 2..4 × { title: 1..120, body: 1..600, voiceTone? }   voiceTone tylko przy voiceTonesAllowed; body nie może zawierać {{examples}}
}
```

Limity są równe progom obcinania w `buildDynamicTopicData` (`lesson-drafts.ts:720-736`) albo ostrzejsze (karta 600 jak w prompcie generatora), więc rdzeń nigdy nie obcina danych z MCP. Reguły zależne od przedmiotu (`subjectTitlePl`, `kind`, `voiceTone`) sprawdza serwer po rozpoznaniu przedmiotu. `{{examples}}` jest odrzucany, bo narzędzie nie przyjmuje `examples`, a karta z placeholderem bez przykładów blokuje każde późniejsze `append`/`validate` (`lesson-authoring.ts:131-137`).

Zachowanie:

1. Parsowanie; przedmiot z materiału (`materialCreationMode !== undefined`), inaczej `validation`; reguły przedmiotu z wejścia.
2. Budowa tematu: `buildDynamicTopicData(objectives, subject.id, deckId, topicTitlePl, walidator)` z walidatorem per zagadnienie opartym na tym samym `validateDynamicTopicData` (walidator dostaje indeks zagadnienia — drugi, opcjonalny argument, zgodny wstecz; `generateDynamicObjectives` bez zmian) i `allowVoiceTone = subject.ttsForPrompts === true`; jakikolwiek wpis w `errors` → `validation` (generowanie dalej odrzuca pojedynczo); jawny `slug` musi przetrwać budowę bez zmian (id kończy się na `.<slug>`), inaczej `validation`; potem `validateDynamicTopicData` całości i `withSubjectObjectiveKinds`.
3. Błąd `validation` ma `details: { objectives?: [{ index, errors: string[] }], topic?: string[] }` (komunikaty po polsku jak w rdzeniu); nic nie jest zapisane.
4. Jedna transakcja: `requireIntegrationScope`; `INSERT decks (id, title, kind: "lesson") ON CONFLICT DO NOTHING`; wersja 1, `editNumber` 1, stan `review`, `title`, `sourceLocale: subject.promptLocale`, `targetLocale: subject.answerLocale`; `lessonContext`:
   `subjectId`, `topicId: "dynamic"`, `topicVersion: 1`, `objectiveIds` (z tematu, w kolejności), `poolSize: 60` (domyślna panelu — dogenerowanie i ponowne generowanie w panelu czytają ją jako cel), `material`, `examples: {}`, `rejectedCount: 0`, `dynamicTopic`, `subjectTitlePl` tylko gdy podany (szkoła). Bez `generation_runs`. `reconcileDraftAssetsTx` zleca nagrania kart (tylko przedmioty z `ttsForPrompts`; rozdział nie ma nagrań kart, `media-reconciliation.ts:243-245`).
5. Domyślny tytuł jak w panelu: `` `${subjectTitlePl ?? subject.titlePl}: ${topicTitlePl}` `` obcięty do 120 znaków (`lesson-drafts.ts:343`), nie `lessonTitle(subject, topic)`.
6. Powtórka `clientRequestId`: zestaw istnieje → zwracamy go tylko gdy to lekcja przedmiotu z materiału o tym samym `subjectId` (z kontekstu bieżącej wersji); inaczej `conflict`. Treść żądania powtórki nie jest porównywana (jak `lesson_draft_create`).
7. Wynik: `LessonMaterialCreateResultSchema = LessonDraftWriteResultSchema.extend({ objectives: [{ id, titlePl, kind? }] })` — `deckId`, `draftId`, `editNumber`, `coverage`, `exposureLeaks`, `objectives`; powtórka odtwarza `objectives` z kontekstu.

Adnotacje narzędzia jak `lesson_draft_create` (`readOnly: false`, idempotentne po `clientRequestId`); zakresy `lessons:write` i `materials:write` (`scopes: LESSONS, write: true`), liczone do limitu 10 zapisów/h. `lesson_material_rules` w tych samych zakresach, bez `write`.

### Ścieżka dalej (bez zmian kodu, sprawdzona przez krytyka i testami)

`append` na wersji `review` bez runu przechodzi (`hasActiveLessonPoolRun` = false, `requireTopic` buduje temat z `dynamicTopic`); `poolSize` nie zmienia się przy `append` (`editLessonDraftTx`). Panel nie pokaże lekcji jako „generowanie”, bo wnioskuje to z `deck.generation` (`LessonEditor.tsx:85`). Do sprawdzenia testem: lista zestawów/„Wymaga Twojej uwagi” dla lekcji `review` bez zadań; jeśli źle — minimalna poprawka widoku.

### Prywatność

- Wyjścia bez danych dzieci, tematów zdań, przypisań, kosztów, runów.
- Materiał nie trafia do modelu po naszej stronie przy utworzeniu; trafi, jeśli rodzic później użyje w panelu dogenerowania (jak każda lekcja z materiału).
- `SKILL.md`: przy przepisywaniu zdjęcia pomiń dane osobowe (imię dziecka w zeszycie, nazwisko nauczyciela, nazwa szkoły).

### API → MCP → skill, dokumentacja, testy-listy

- Kontrakt `lesson-authoring.ts`: wejścia/wyjścia obu narzędzi, komentarz przy `LESSON_AUTHORING_WRITES_PER_HOUR` (`:16`). Serwer MCP 0.6.0.
- Adapter `lesson-authoring-mcp-tools.ts` (nowe klucze `ToolKey`), okablowanie `learning-mcp-route.ts:223`, atrapy w `learning-mcp-route.test.ts:18`, listy narzędzi w `learning-mcp-route.test.ts:141,155` i `tests/integration/lesson-authoring-mcp.test.ts:151,364,644`.
- `SKILL.md` (frontmatter, „six tools”, l. 10, l. 42 „cannot create such a lesson from scratch”): przepływ „zdjęcie → tekst → potwierdzenie odczytu z rodzicem → `lesson_material_rules` → `lesson_material_create` → `lesson_catalog(deckId)` → iteracje `lesson_validate(append)` → jedno duże `lesson_draft_append`”; scalanie wyrazów dzielonych na końcu linii przed zapisem; cytaty `sourceRefs` kopiowane z wysłanego `material`, nie ze zdjęcia; minimum zadań na zagadnienie z `poolMinimums` (szkoła 7, rozdział 8; szkoła także 2 różne odpowiedzi otwarte); pytania jedną porcją, bo limit 10 zapisów/h obejmuje poprawki; prywatność wyżej; brak `{{examples}}` w kartach.
- `docs/integrations/lesson-authoring.md` (l. 18, tabela zakresów, historia wersji 0.6.0, zdanie o braku tworzenia od zera), `docs/architecture.md` §19.18 i :330 (liczba narzędzi), :351 („dokładnie jeden zakres” — nieaktualne od 0.5.0, poprawić przy okazji).
- Hermes (`learning:read`) bez zmian.

## Testy

Integracja (`tests/integration/lesson-authoring-mcp.test.ts`, istniejący kosz) przez klienta MCP Streamable HTTP na fikcyjnych danych:

- szkoła: `lesson_material_rules` → `lesson_material_create` → `lesson_draft_get` (zagadnienia, materiał, locale `pl-PL`/`pl-PL`, tytuł) → `lesson_catalog(deckId)` z księgą reguł → `lesson_validate(append)` → `lesson_draft_append` do spełnienia `poolMinimums` → `coverage` pusty → publikacja rodzica (`publishLessonDraft`) przechodzi; nagrania kart: konkretne wiersze `media_assets` per karta;
- rozdział: to samo z `kind`; brak nagrań kart; `locale` `pl-PL`/`en-GB`; tytuł `"<titlePl przedmiotu>: <topicTitlePl>"`;
- publikacja lekcji z zerem zadań zablokowana;
- powtórka `clientRequestId` → ten sam zestaw i te same `objectives`; `clientRequestId` lekcji katalogowej albo zestawu słówek → `conflict`;
- błędy, każdy z liczbą wierszy `decks`, `deck_versions`, `media_assets` przed i po (styl `lesson-authoring-mcp.test.ts:549`): przedmiot katalogowy; rozdział bez `kind`; szkoła z `kind`; szkoła bez `subjectTitlePl`; rozdział z `subjectTitlePl`; `voiceTone` w rozdziale; `{{examples}}` w karcie; 1 karta; 5 kart; `descriptionEn` 401 znaków; 9 zagadnień; zdublowany `slug`; token `learning:read` (403);
- `outputSchema` obu nowych narzędzi w `tools/list` jak w teście `:146`.

Unit:

- wspólny walidator/budowa: generowanie nadal odrzuca pojedyncze zagadnienia i zwraca `droppedObjectiveCount`; ścieżka MCP odrzuca całość;
- `llm.ts`: prompt zagadnień identyczny przed i po przeniesieniu stałej (istniejące asercje/migawka bez zmian);
- `lesson_material_rules`: szkoła (stała ogólna, `subjectTitleRequired`), rozdział (`objectivesRules`, `kindRequired`), przedmiot katalogowy → `validation`.

Panel: test (integracyjny listy zestawów albo E2E w koszu `real`) lekcji `review` bez zadań i bez runu.

## Zostawione budowniczemu

Nazwa i miejsce stałej zasad zagadnień i wspólnego walidatora, kolejność zadań planu, ewentualna minimalna poprawka widoku panelu dla pustej puli.
