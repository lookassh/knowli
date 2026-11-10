# Skracanie odpowiedzi bez ślepych zaułków — plan (story 4)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development albo superpowers:executing-plans. Kroki mają pola wyboru (`- [ ]`).

**Cel:** krok „Skróć odpowiedź” pojawia się tylko z widocznym zaznaczeniem (CAP-5), a gdy poprawka zgubi ważną informację, dziecko widzi obie swoje wersje (CAP-6).

**Spec:** `_bmad-output/specs/spec-dyktowana-odpowiedz-sciezka-dziecka/` — story 4 w `stories.yaml`, wiersze AC-14 i AC-17–22 w `acceptance-scenarios.md`, ograniczenia i założenia CAP-5/CAP-6 w `SPEC.md`. Przed kodem: `docs/agents/lessons.md`, `docs/agents/kid-ui.md`, `docs/agents/testing.md` (nowe asercje E2E).

**Moduły i granice:** reguła oferty zostaje czystą funkcją domeny (`domain/lessons/precision-trainer.ts`); wydanie zadania następczego i feedback poprawki w `modules/learning/lessons/lesson-shorten.ts`, w tej samej transakcji co ocena — bez zmiany granic. Kid DTO dostaje jedno opcjonalne pole feedbacku; Kid UI rozszerza wspólny komponent `LessonAnswerComparison`.

## Decyzje

1. **Oferta tylko z zaznaczeniem (CAP-5).** `shouldOfferShorten` traci gałąź `|| formOk === false` (AC-17, założenie CAP-5 w SPEC). `offerShortenFollowUp` buduje segmenty przed wydaniem zadania i zwraca `null` (zwykłe „Świetnie!”), gdy `buildAnswerSegments` zwróci `null` albo żaden segment nie jest zaznaczony (AC-18: werdykt z cache dla tej samej znormalizowanej odpowiedzi o innej interpunkcji). Zastępczy pojedynczy segment `plain` znika.
2. **Feedback utraty elementu (CAP-6).** `withRevisionComparison` zwraca `lesson_hint` z: `hintPl` = nowy tekst bez odsyłania do niewidocznej treści, `answerSegments` = oryginał jako jeden segment `plain` (wiersz „Twoja odpowiedź”), nowe pole `revisedAnswer` = tekst poprawki (wiersz „Krótsza wersja”). Bez `correctText`, bez ekspozycji, bez treści elementu (AC-21). Ocena, niesamodzielność i brak wpływu na serię bez zmian (AC-20).
3. **Kid DTO.** `FeedbackDtoSchema.revisedAnswer: z.string().min(1).max(MAX_TEXT_ATTEMPT_LENGTH).optional()`, dozwolone tylko z `lesson_hint` i tylko razem z `answerSegments`, nigdy z `correctText` (reguła w `superRefine`). To wyłącznie tekst dziecka, więc nie tworzy ekspozycji klucza.
4. **Teksty.** `lessonShortenLostElement`: „Krócej, ale zgubiła się ważna informacja. Zobacz obie wersje.”; nowa etykieta `lessonShortenRevised`: „Krótsza wersja”.
5. **Widok.** `lessonFeedbackView` przenosi `revisedAnswer`; `LessonAnswerComparison` dostaje opcjonalny `revisedAnswer` i rysuje trzeci wiersz tym samym wzorcem co pozostałe (etykieta + `AnswerLine`), bez nowych klas, kolorów i rozmiarów. Układ `inline` tylko gdy także ta wersja jest krótkim słowem.
6. **API → MCP → skill.** Zmienia się Kid DTO (`/api/v1/kid`), nie kontrakt integracji: MCP i `SKILL.md` nie niosą feedbacku dziecka — brak wpływu, do odnotowania w PR. Jeśli repo ma wygenerowany schemat/OpenAPI obejmujący `FeedbackDto`, zregenerować.

## Zadanie 1: reguła oferty (AC-14, AC-17, AC-19)

**Pliki:** `packages/server/src/domain/lessons/precision-trainer.ts`, `precision-trainer.test.ts`

- [ ] Test (czerwony): `shouldOfferShorten` z `knowledge: "correct"`, `precision: "verbose"`, pustymi listami i `formOk: false` → `false`; z jednym fragmentem zbędnym → `true`; z fragmentem i `remainingWithThisTask: 3` → `false`. Istniejący test oczekujący oferty przy samym `formOk === false` odwrócić.
- [ ] Implementacja: `return removableFragments(input.details).length > 0;` i poprawiony komentarz JSDoc. `formOk` zostaje w `SchoolAssessmentDetails` tylko jeśli ma innego czytelnika; inaczej usunąć pole z interfejsu.
- [ ] `corepack pnpm vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons/precision-trainer.test.ts`. Commit.

## Zadanie 2: wydanie zadania tylko z zaznaczeniem i feedback obu wersji (AC-18, AC-20, AC-21)

**Pliki:** `packages/contracts/src/kid.ts`, `packages/contracts/src/messages.ts`, `packages/server/src/modules/learning/lessons/lesson-shorten.ts`, `tests/integration/lesson-grader-school.test.ts`, test kontraktu feedbacku (plik istniejący przy `kid.ts`).

- [ ] Test kontraktu (czerwony): `FeedbackDtoSchema` przyjmuje `{ kind: "lesson_hint", hintPl, answerSegments: [{text, state: "plain"}], revisedAnswer }`; odrzuca `revisedAnswer` przy innym rodzaju, bez `answerSegments` i razem z `correctText`.
- [ ] Testy integracyjne (czerwone):
  - istniejący „wykrywa utratę elementu…”: feedback równy `{ kind: "lesson_hint", hintPl: messages.kid.lessonShortenLostElement, answerSegments: [{ text: <oryginał>, state: "plain" }], revisedAnswer: "Roślina wytwarza cukry." }` (dokładna równość dowodzi AC-21: żadnych innych pól), tekst podpowiedzi nie zawiera „poprzedni”; asercje oceny, niesamodzielności i serii zostają;
  - AC-18: pierwsza sesja — odpowiedź rozwlekła z fragmentem zapisuje werdykt do cache; kolejna sesja (zegar +48 h) — ta sama odpowiedź w zapisie, który normalizuje się do tego samego klucza cache, ale nie zawiera dosłownie fragmentu (inna interpunkcja wewnątrz fragmentu); oczekiwane: `great`, brak wywołania modelu, zero nowych zadań `followUpOf`. Jeśli normalizacja klucza nie zrównuje takich zapisów, test wstrzykuje wiersz `lesson_verdicts` z fragmentem spoza tekstu i odnotowuje to w raporcie;
  - AC-17: odpowiedź dwuzdaniowa na zadaniu `expectedForm: "one_sentence"`, werdykt `correct`/`verbose` bez fragmentów → `great`, zero `followUpOf`.
- [ ] Implementacja w `lesson-shorten.ts`:

```ts
const fragments = removableFragments(details);
const segments = buildAnswerSegments(args.childAnswer, fragments.redundant, fragments.offTopic);
// Bez widocznego zaznaczenia nie ma czego skracać: zwykłe „Świetnie!” (CAP-5).
if (segments === null || segments.every((segment) => segment.state === "plain")) return null;
```

(przed `tx.insert`; `shouldOfferShorten` zostaje pierwszym warunkiem) oraz w `withRevisionComparison`:

```ts
feedback: {
  kind: "lesson_hint",
  hintPl: messages.kid.lessonShortenLostElement,
  // Wyłącznie tekst dziecka: oryginał i poprawka, bez wzorca i elementów (CAP-6).
  answerSegments: [{ text: revisionOf.originalAnswer, state: "plain" }],
  revisedAnswer: childAnswer,
},
```

- [ ] `pnpm test:integration tests/integration/lesson-grader-school.test.ts` i test kontraktu zielone. Commit.

## Zadanie 3: widok obu wersji (AC-20, AC-22)

**Pliki:** `packages/kid-ui/src/screens/lesson-feedback-view.ts` (+ test), `packages/kid-ui/src/screens/AnswerFeedback.tsx`, `packages/kid-ui/src/components/AnswerSegments.tsx`, `LessonAnswerComparison.test.tsx`, `tests/e2e/lesson-precision-layout.spec.ts`.

- [ ] Testy jednostkowe (czerwone): `lessonFeedbackView` zwraca `revisedAnswer`; `LessonAnswerComparison` z `revisedAnswer` rysuje etykiety „Twoja odpowiedź” i „Krótsza wersja” z oboma tekstami, bez wiersza „Poprawnie”; bez `revisedAnswer` wynik jak dotąd.
- [ ] Implementacja: pole w `LessonFeedbackView`, prop w `LessonAnswerComparison` (`data-testid="kid-lesson-revised"`), przekazanie w `AnswerFeedback`.
- [ ] Test geometrii (AC-22) w `lesson-precision-layout.spec.ts` (projekt `mocked`, fixture z zadaniem `lesson_shorten` i odpowiedzią próby z feedbackiem z decyzji 2; oryginał 600 znaków, poprawka ok. 500): viewporty 390×844 i 768×1024 — brak przepełnienia poziomego dokumentu, oba wiersze osiągalne w przewijanej karcie, `kid-next` w całości w oknie i ≥ 48 px wysokości i szerokości.
- [ ] Testy jednostkowe Kid UI i spec E2E (`UMIEM_E2E_SKIP_BUILD=1` po buildzie) zielone. Commit.

## Zadanie 4: dokumentacja i całość

- [ ] `docs/architecture.md` §19 (trener precyzji): oferta tylko z odnalezionym fragmentem; feedback utraty elementu z obiema wersjami. `stories.yaml`: story 4 zrealizowane datą; wiersz AC-14 bez zastrzeżenia o story 4.
- [ ] `pnpm check`, `pnpm test:integration tests/integration/lesson-grader-school.test.ts tests/integration/lesson-dictation.test.ts`, pełne `pnpm test:e2e:shards`.
- [ ] Trzech krytyków gałęzi, `/ponytail:ponytail-review`, PR. Story ma `done_checkpoint: true`: po PR zatrzymać się na odbiór właściciela.

## Wiersz AC → test

| AC | Test |
| --- | --- |
| AC-14 | integracja ze story 3 („wszystkie fragmenty odpadły”) + AC-17 poniżej |
| AC-17 | `precision-trainer.test.ts` (forma bez fragmentów), integracja „dwuzdaniowa…” |
| AC-18 | integracja „trafienie w cache przy innej interpunkcji” |
| AC-19 | `precision-trainer.test.ts` (fragment → oferta; ostatnie trzy → brak), istniejąca integracja „proponuje skrócenie…” |
| AC-20 | integracja „wykrywa utratę elementu…”, `LessonAnswerComparison.test.tsx` |
| AC-21 | integracja — dokładna równość feedbacku; test kontraktu (zakaz `correctText`) |
| AC-22 | `lesson-precision-layout.spec.ts` (390×844, 768×1024, 600 znaków) |

## Poza zakresem

Usuwanie fragmentów dotknięciem; dodatkowa próba po utracie elementu (kosztowałaby wywołanie modelu); zaznaczanie różnic między wersjami; teksty mikrofonu (story 5).

## Poprawki po przeglądzie trzech krytyków (2026-11-10) — mają pierwszeństwo przed treścią wyżej

1. **CAP-6 w mniejszym wariancie (do odbioru właściciela).** W trakcie feedbacku po utracie elementu widok „Skróć odpowiedź” zostaje zamontowany pod panelem i pokazuje obie wersje dziecka: „Twoja odpowiedź” (oryginał z zaznaczeniami) i pole „Krótsza odpowiedź”. Powielenie obu tekstów w panelu dałoby dwa zagnieżdżone przewijania i ok. 1200 znaków w karcie o wysokości ok. 300 px. Dlatego: bez pola `revisedAnswer`, bez zmiany Kid DTO i bez zmian w `LessonAnswerComparison`; zmienia się tylko tekst podpowiedzi, który wskazuje na wersje widoczne nad panelem. Decyzje 2–6 i zadanie 3 w dawnym kształcie odpadają. To odczytanie AC-20 („Feedback pokazuje…”) jako „na ekranie z feedbackiem widać…”; wiersz AC-20 zostaje doprecyzowany w tym PR.
2. Tekst `lessonShortenLostElement`: „Zgubiła się ważna informacja. Porównaj krótszą odpowiedź z tą powyżej.” — bez „Krócej”, bo poprawka gubiąca element nie musi być krótsza.
3. Test geometrii (AC-20, AC-22) w `lesson-precision-layout.spec.ts`: zadanie `lesson_shorten` z oryginałem 600 znaków, poprawka 600 znaków, odpowiedź próby z `lesson_hint`; 390×844 i 768×1024: brak przepełnienia poziomego, `kid-next` w oknie i ≥ 54 px, pole z poprawką widoczne nad panelem, a „Twoja odpowiedź” osiągalna przewinięciem materiału (nie zasłonięta trwale).
4. Podpowiedź po ofercie skracania dobierana po faktycznie zaznaczonych segmentach (`segments.some(state === "offtopic")`), nie po liście fragmentów.
5. AC-17: seed `{ expectedForm: "one_sentence", secondObjective: true }`, inaczej test jest zielony przed zmianą (faza „Jeszcze 3”).
6. AC-18: para zapisów różniąca się przecinkami wewnątrz fragmentu (ten sam klucz cache); drugie podejście przez drugie dziecko przypisane do tej samej talii albo kolejną sesję — co okaże się wykonalne; liczba `followUpOf` liczona tylko dla drugiej sesji.
7. `SchoolAssessmentDetails.formOk` usunąć (brak czytelnika). Dokumenty: `docs/SPEC.md:762` i `docs/architecture.md:940` — oferta tylko z zaznaczonym fragmentem.
