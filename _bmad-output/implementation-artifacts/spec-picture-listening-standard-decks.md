---
title: 'Wybór ilustracji ze słuchu w zwykłych zestawach słownictwa'
type: 'feature'
created: '2026-10-17'
status: 'done'
route: 'dispatch'
baseline_commit: 'ca86d632a831c7cd3d0835700b3eb6de6a168163'
review_loop_iteration: 0
context:
  - '{project-root}/docs/SPEC.md'
  - '{project-root}/docs/architecture.md'
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Czytające dziecko ma trudności z rozumieniem i zapamiętywaniem angielskich słów. Zwykłe zestawy pozwalają słuchać słowa i wybierać odpowiedź tekstową, lecz nie wiążą dźwięku z zatwierdzoną ilustracją.

**Approach:** Dodać w zwykłych zestawach słownictwa dla profilu czytającego ćwiczenie, w którym dziecko słyszy słowo i wybiera jego ilustrację. Dla danego słowa naprzemiennie używać wizualnych i dotychczasowych tekstowych wariantów listening, zaczynając od wizualnego, gdy jest wykonalny. Ćwiczenie wzbogaca istniejącą naukę bez zmiany celu umiejętności listening; trafienie w obraz nie zastępuje samodzielnego Recall ani spelling.

**Boundaries & Constraints**

**Always:** Używaj wyłącznie istniejących, zatwierdzonych i jednoznacznych wizualizacji pozycji. Zachowaj bezpieczne opcje, rezerwacje należnych sprawdzeń, zapis ujawnień przed odpowiedzią HTTP, niezmienność `issued`, budżet i długość sesji. Wznowiona sesja zachowuje ten sam prompt. Gdy obrazkowe opcje nie są wykonalne, zachowaj obecne tekstowe listening. Profil i format nadal są snapshotami sesji. Zgodność klienta musi być zachowana dla klientów nieobsługujących `picture_listening`.

**Never:** Nie zmieniaj scoringu recall/spelling ani historii prób, nie oznaczaj rozpoznania obrazka jako samodzielnego recall, nie generuj nowych obrazów w trakcie sesji, nie zmieniaj bazy ani zewnętrznego kontraktu. Nie zamieniaj standardowych zadań exposure, reading, reverse recognition, recall ani speech na prompty obrazkowe.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Zwykłe słuchanie i pełne opcje obrazkowe | Czytający profil, zatwierdzone wizualizacje celu i wystarczającej liczby bezpiecznych dystraktorów, klient obsługujący prompt | Wybrana odpowiedź jest `picture_listening` z opcjami wizualnymi | Zastosuj istniejące reguły deduplikacji i ekspozycji |
| Brak lub niejednoznaczne opcje | Brak wizualizacji, za mało bezpiecznych dystraktorów lub pojęcie abstrakcyjne | Obecny tekstowy prompt `listening` | Bez pustych, fikcyjnych lub przypadkowych opcji |
| Stary klient | Klient nie deklaruje obsługi promptów obrazkowych | Obecny tekstowy prompt `listening` | Brak nieobsługiwanego DTO |
| Należne Recall/pisownia | Cel jest zarezerwowany do samodzielnego sprawdzenia | Rezerwacja i dotychczasowa kolejność pozostają; cel/rezerwacja nie przecieka do opcji | Dobierz inne dystraktory lub tekstowy fallback |
| Pozostałe zadania | Zwykły zestaw ma wizualizacje | Exposure, reading, reverse recognition, recall, spelling i speech zachowują obecne prompty i ocenę | Brak niezamierzonej zmiany ścieżki |

</frozen-after-approval>

## Code Map

- `packages/server/src/domain/scheduler.ts` — `recognitionTaskPlan` wybiera kierunek listening i reużywa reguły bezpiecznych opcji. Obecnie `buildPictureRecognitionOptions` jest wołane wyłącznie dla `vocabularyFormat === "picture"`; nie zmieniaj dostępności kierunków czytania ani priorytetów schedulera.
- `packages/server/src/domain/picture-recognition-options.ts` — istniejący builder 2–4 unikalnych opcji `MeaningVisual`, usuwa opcje zarezerwowane i zwraca klucze ekspozycji. Rozszerzaj jego użycie, nie duplikuj selekcji.
- `packages/server/src/modules/sessions.ts` — `PlannedItem.meaningVisual` powstaje dziś wyłącznie dla `picture`; builder jest źródłem dla celu oraz peers. Rozdziel użycie do listening tak, by nie zmieniać exposure i speech.
- `packages/server/src/modules/sessions.ts` — `materializeTask` emituje `picture_listening` gdy wszystkie opcje są wizualne; wykorzystaj dotychczasowy kontrakt i identyfikację odpowiedzi.
- `packages/contracts/src/kid.ts`, `packages/kid-ui/src/exercises/PictureListeningView.tsx`, `packages/kid-ui/src/exercises/ExerciseView.tsx` — kontrakt i widok już obsługują prompt; sprawdź walidację 2–4 opcji i nie zmieniaj UI bez potrzeby.
- `packages/server/src/modules/sessions.ts` i `packages/contracts/src/kid.ts` — ochrona kompatybilności klienta jest obecnie wiązana z `supportsPictureVocabulary`. Potwierdź zachowanie klienta deklarującego false przed wydaniem promptu w zwykłym formacie.
- `packages/server/src/domain/scheduler-picture-reader.test.ts`, `packages/server/src/domain/picture-recognition-options.test.ts`, `packages/server/src/modules/sessions.test.ts`, `tests/integration/picture-vocabulary.test.ts` — wzorce testów schedulera, dystraktorów, materializacji promptu i PostgreSQL. Dodaj pokrycie zwykłego formatu oraz niezmienionych ścieżek.
- `docs/SPEC.md` §13/§24/§34 i `docs/architecture.md` §9.3 — dopisz regułę dostępności i ograniczenie interpretacji listening vs Recall; API/MCP raport `learning-overview` pomija promptowe szczegóły i oceny lesson, bez zmiany schematu.

## Tasks & Acceptance

**Execution:**
- [x] `packages/server/src/domain/scheduler.ts`, `picture-recognition-options.ts` — naprzemiennie planuj wizualny i tekstowy listening per słowo, zaczynając od wizualnego, jeśli wykonalny; zachowaj dotychczasowe filtry wykonalności, rezerwacji i fallback.
- [x] `packages/server/src/modules/sessions.ts`, `packages/server/src/modules/events.ts` — udostępnij zatwierdzone wizualizacje zwykłych pozycji dla listening; nie zmieniaj exposure/speech; zachowaj zgodność klienta i istniejącą materializację promptu.
- [x] Testy jednostkowe i integracyjne z Code Map — pokryj opcje 2–4, fallback bez ilustracji, rezerwacje, flagę klienta, ocenę wyłącznie listening, niezmieniony issued oraz pozostałe ćwiczenia.
- [x] `docs/SPEC.md`, `docs/architecture.md` — odnotuj zachowanie i znaczenie oceny; uzasadnij brak zmian API/MCP/skill.

**Acceptance Criteria:**
- Given zwykły zestaw czytającego profilu i wykonalne zatwierdzone ilustracje, when scheduler po raz pierwszy wybiera listening dla danego słowa, then Kid otrzymuje `picture_listening`; przy kolejnym listening tego słowa wraca wariant tekstowy, a potem wzorzec się powtarza.
- Given brak wymaganej liczby bezpiecznych wizualnych opcji, when scheduler wydaje listening, then zachowany jest dotychczasowy tekstowy wariant.
- Given odpowiedź poprawną na `picture_listening`, when serwer zapisuje assessment, then aktualizuje się listening, bez zaliczenia recall lub spelling.
- Given rezerwację celu, stary klient lub wznowienie sesji, when powstaje albo jest odczytywany prompt, then nie ujawnia celu z rezerwacji, nie wydaje nieobsługiwanego promptu i nie losuje ponownie `issued`.
- Given inne ćwiczenia zwykłego zestawu, when są planowane i wydawane, then ich typy, prompty, oceny i budżet pozostają zgodne z dotychczasowym zachowaniem.

## Implementation Notes

- Liczniki wariantów per słowo są odtwarzane z niezmiennych promptów zadań sesji. Capability `supportsPictureVocabulary` zostaje snapshotem sesji; starsze klienty dostają tekstowy listening.
- Wizualny `listening` w standardowym zestawie emituje istniejący prompt `picture_listening`, a assessment nadal zawiera wyłącznie skill `listening`. `meaningVisual` pozostaje ograniczony do formatu picture, więc nowe `listeningVisual` nie zmienia exposure/speech/recall.
- Testy: 4 celowane pliki unit (101/101), `tests/integration/picture-vocabulary.test.ts` (9/9, PostgreSQL), `corepack pnpm typecheck`, `git diff --check` — wszystkie przeszły.

## Spec Change Log

## Review Triage Log

- [medium][patch] Edge Case Hunter finding 1: a supported standard session could be resumed by a client declaring `supportsPictureVocabulary: false`, because the resume guard only inspected the deck format; the snapshot stored the capability and the guard failed to honor it. The implementation now rejects this resume with the existing `picture_client_update_required` error.
- [medium][patch] Edge Case Hunter finding 2: the same guard allowed a legacy client to resume a standard session whose stored snapshot allowed `picture_listening`, potentially returning an already-issued unsupported prompt or issuing another one. This is the same root cause as finding 1; the shared fix checks the snapshot capability for any format, and the integration regression confirms rejection.

## Design Notes

- Specjalna zgodność klienta jest istotna, bo wdrożony starszy Kid może deklarować `supportsPictureVocabulary: false` przy zestawie standard, a mimo to dostać nowy rodzaj promptu. Użyj istniejącego capability guard lub minimalnego istniejącego mechanizmu zgodności, bez nowego endpointu czy wersji API.

## Verification

**Commands:**
- `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/scheduler-picture-reader.test.ts packages/server/src/domain/scheduler.test.ts packages/server/src/domain/picture-recognition-options.test.ts packages/server/src/modules/sessions.test.ts` — passed, 101/101.
- `corepack pnpm exec vitest run --config vitest.integration.config.ts tests/integration/picture-vocabulary.test.ts` — passed, 9/9 on PostgreSQL.
- `corepack pnpm typecheck` — passed, exit 0.
- `git diff --check` — passed, exit 0.
