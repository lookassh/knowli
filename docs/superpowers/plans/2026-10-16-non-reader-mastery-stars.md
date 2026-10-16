# Naliczanie gwiazdek opanowania materiału dla dziecka nieczytającego — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Umożliwić dziecku nieczytającemu (`canRead: false`) zdobywanie gwiazdek opanowania materiału (do 6 gwiazdek) na kafelkach zestawów na podstawie opanowania ze słuchu (`listening: "mastered"`) lub głosu (`recall: "mastered"`).

**Architecture:** W `packages/server/src/modules/kid.ts` wyliczanie `independentlyRecalledCount` dla profilu `canRead: false` uwzględnia opanowanie kluczowych dla dziecka umiejętności (`listening` lub `recall`). Każda rewizja słowa jest liczona maksymalnie raz. Dla profilu czytającego (`canRead: true`) zachowujemy dotychczasowy warunek (`recall: "mastered"`). Kontrakt DTO `KidDeckDto`, interfejs UI oraz API konsumentów MCP pozostają niezmienne.

**Tech Stack:** TypeScript strict, PostgreSQL, Drizzle ORM, Vitest (`@learning/server`), React (`@learning/kid-ui`).

**Spec:** Ustalenia w czacie 2026-10-16 (bounded brainstorming, decyzja właściciela: opanowanie ze słuchu lub głosu); `docs/SPEC.md` §6; `docs/architecture.md` §19.

## Global Constraints

- Kontrakt `KidDeckDto` nie ulega zmianie (`independentlyRecalledCount` zachowuje nazwę i typ `number`).
- Interfejs `DeckCard` w `packages/kid-ui` konsumuje dane bez zmian; wzór gwiazdek `starsForFraction` pozostaje jedynym źródłem skali.
- Profil czytający (`canRead: true`) nie może ulec regresji — opanowanie nadal wymaga samodzielnego `recall: "mastered"`.
- Zmiana nie wymaga zmian w MCP ani w `SKILL.md` (wewnętrzna reguła projekcji wiersza kafelka dziecka).
- Testy integracyjne uruchamiane na docelowym PostgreSQL przez istniejący harness `testDatabase()`.

## Review Focus

1. **Dziecko nieczytające bez mikrofonu:** słowo z `listening: "mastered"` (bez ocenionego `recall`) zalicza się do `independentlyRecalledCount` i daje gwiazdki.
2. **Dziecko nieczytające z mikrofonem:** słowo z `recall: "mastered"` również zalicza się do `independentlyRecalledCount`.
3. **Brak podwójnego zliczania:** słowo z opanowanym zarówno `listening` jak i `recall` liczy się dokładnie jako 1 opanowane słowo (Set unikalnych `revisionId`).
4. **Brak regresji dla czytającego:** dziecko z `canRead: true` i opanowanym wyłącznie `listening` nadal ma `independentlyRecalledCount = 0` (musi opanować `recall`).
5. **Aktywna sesja:** licznik uwzględnia wersję przypiętą do aktywnej sesji (`versionId = active.deckVersionId`).

---

### Task 1: Naliczanie opanowania dla dziecka nieczytającego w `packages/server/src/modules/kid.ts`

**Files:**
- Modify: `packages/server/src/modules/kid.ts:125-165`
- Test: `tests/integration/picture-vocabulary.test.ts`

**Interfaces:**
- Consumes: `child.canRead`, `progressByRevision`, `snapshots` z `readLearningSnapshot`.
- Produces: `independentlyRecalledCount` w `KidDeckDto` uwzględniający `listening: "mastered"` lub `recall: "mastered"` dla `!child.canRead`.

- [x] **Step 1: Write the failing integration test**

W `tests/integration/picture-vocabulary.test.ts` dodaj test integracyjny:

```ts
it("dla dziecka nieczytającego liczy gwiazdki z opanowanego słuchania lub recall, a dla czytającego wyłącznie z recall", async () => {
  const nonReader = await createChild(services, { displayName: "Jaś", avatarKey: "fox", canRead: false });
  const reader = await createChild(services, { displayName: "Zosia", avatarKey: "bear", canRead: true });

  const draft = await createDraft(services, {
    title: "Zwierzęta", vocabularyFormat: "picture",
    items: [
      { source: "pies", target: "dog", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "image", visualData: { imagePrompt: "A friendly dog" } },
      { source: "kot", target: "cat", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "image", visualData: { imagePrompt: "A cute cat" } },
    ],
  });
  await reconcileDraftAssets(services, draft.id);
  for (let pass = 0; pass < 6; pass += 1) if ((await runDueGenerationWork(services)).processed === 0) break;
  await publishDraft(services, draft.id, 1);
  await upsertAssignment(services, nonReader.id, draft.deckId, null);
  await upsertAssignment(services, reader.id, draft.deckId, null);

  const revisions = (await pool.query<{ id: string }>(
    "select id from learning_app.item_revisions where deck_version_id = $1 order by position", [draft.id],
  )).rows;

  // Pobierz skill_version_id dla listening i recall obu słów
  const skillVersions = (await pool.query<{ item_revision_id: string; skill: string; skill_version_id: string }>(
    "select item_revision_id, skill, skill_version_id from learning_app.item_revision_skills where item_revision_id = any($1)",
    [[revisions[0]!.id, revisions[1]!.id]],
  )).rows;

  const dogListening = skillVersions.find((s) => s.item_revision_id === revisions[0]!.id && s.skill === "listening")!.skill_version_id;
  const catRecall = skillVersions.find((s) => s.item_revision_id === revisions[1]!.id && s.skill === "recall")!.skill_version_id;

  // Wpisz postępy w child_skill_progress:
  // Pies: listening = mastered
  // Kot: recall = mastered
  await pool.query(
    `insert into learning_app.child_skill_progress(child_id, skill_version_id, status, independent_success_streak)
     values ($1, $2, 'mastered', 3), ($1, $3, 'mastered', 3)`,
    [nonReader.id, dogListening, catRecall],
  );
  await pool.query(
    `insert into learning_app.child_skill_progress(child_id, skill_version_id, status, independent_success_streak)
     values ($1, $2, 'mastered', 3), ($1, $3, 'mastered', 3)`,
    [reader.id, dogListening, catRecall],
  );

  const [nonReaderDeck] = await listKidDecks(services, nonReader.id);
  const [readerDeck] = await listKidDecks(services, reader.id);

  // Nieczytający: oba słowa opanowane (pies ze słuchu, kot z recall) → 2 z 2 słów = komplet 6 gwiazdek
  expect(nonReaderDeck).toMatchObject({
    deckId: draft.deckId,
    itemCount: 2,
    independentlyRecalledCount: 2,
  });

  // Czytający: tylko kot opanowany przez recall (pies ma samo listening) → 1 z 2 słów
  expect(readerDeck).toMatchObject({
    deckId: draft.deckId,
    itemCount: 2,
    independentlyRecalledCount: 1,
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Uruchom:
`pnpm vitest run tests/integration/picture-vocabulary.test.ts`
Oczekiwany rezultat: FAIL — `nonReaderDeck.independentlyRecalledCount` wynosi `1` zamiast `2` (bo pies ma tylko `listening: "mastered"` i nie został zaliczony).

- [x] **Step 3: Implement non-reader mastery logic in `packages/server/src/modules/kid.ts`**

W `packages/server/src/modules/kid.ts` zaktualizuj wyliczanie `independentlyRecalledRevisions`:
Po pętli rekonstruującej `progressByRevision` ze snapshotów:

```ts
  const independentlyRecalledRevisions = new Set<string>();
  for (const [revisionId, skillSnapshots] of progressByRevision.entries()) {
    const isMastered = child.canRead
      ? skillSnapshots.some((s) => s.skill === "recall" && s.status === "mastered")
      : skillSnapshots.some((s) => (s.skill === "listening" || s.skill === "recall") && s.status === "mastered");
    if (isMastered) {
      independentlyRecalledRevisions.add(revisionId);
    }
  }
```

Usunąć wcześniejsze przedwczesne wypełnianie `independentlyRecalledRevisions` w linii 136–138.

- [x] **Step 4: Run test to verify it passes**

Uruchom:
`pnpm vitest run tests/integration/picture-vocabulary.test.ts`
Oczekiwany rezultat: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/server/src/modules/kid.ts tests/integration/picture-vocabulary.test.ts
git commit -m "fix: naliczanie gwiazdek opanowania materiału dla dziecka nieczytającego"
```

---

### Task 2: Weryfikacja regresji i aktualizacja dokumentacji

**Files:**
- Modify: `docs/SPEC.md:155`
- Modify: `docs/architecture.md:403`

- [x] **Step 1: Run regression test suite for sessions, picture vocabulary and kid decks**

Uruchom powiązane testy integracyjne i jednostkowe:
```bash
pnpm vitest run tests/integration/picture-vocabulary.test.ts tests/integration/sessions.test.ts apps/web/src/kid/deck-screen.test.ts
```
Oczekiwany rezultat: PASS.

- [x] **Step 2: Update documentation**

W `docs/SPEC.md` §6 dopisać wyjaśnienie:
> Dla dziecka nieczytającego (`canRead: false`) gwiazdki opanowania zestawu na kafelku odzwierciedlają słowa opanowane w dostępnych dla dziecka umiejętnościach (`listening: "mastered"` lub `recall: "mastered"`), dzięki czemu nauka ze słuchu bez użycia mikrofonu również pozwala osiągnąć pełne opanowanie (6 gwiazdek).

W `docs/architecture.md` w sekcji opisu `kid.ts` dopisać wzmiankę o rozróżnieniu kryterium opanowania w zależności od flagi `canRead`.

- [x] **Step 3: Run full typecheck and formatting checks**

```bash
pnpm typecheck
git diff --check
```
Oczekiwany rezultat: czyste wyjście (exit code 0).

- [x] **Step 4: Commit documentation updates**

```bash
git add docs/SPEC.md docs/architecture.md
git commit -m "docs: zasady naliczania gwiazdek opanowania dla profilu nieczytającego w SPEC i architekturze"
```
