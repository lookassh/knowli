# Fix Pronunciation & Picture Recall for Non-Reading Children Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable non-reading children (`canRead = false`) with microphone enabled to properly unlock and receive picture recall ("Jak jest po angielsku?" with image + microphone) and speech/pronunciation tasks.

**Architecture:** Fix the root cause in `packages/server/src/modules/skill-history.ts` where picture choice options (`{ id, labelPl, visual }`) lacked `text`, causing all options to evaluate to empty string `""` with `distinctChoiceCount = 1`, which disqualified attempts as non-independent singletons (`independent = false`) and kept `listening.streak` at 0. Add regression unit and integration tests confirming that non-readers with microphone enabled advance from recognition to picture recall and speech introduction.

**Tech Stack:** TypeScript, Node.js, Drizzle ORM, Vitest.

**Spec:** `docs/SPEC.md` §13-16, `docs/architecture.md` §9.3 & §12.

## Global Constraints

- Code, filenames, identifiers, and commit messages must be in English. User communication and documentation in Polish.
- Do not push directly to `main` and do not merge PR without explicit owner instructions.
- Preserve zero-leakage privacy rules: child speech recordings are processed transiently in memory, secrets stay on server.
- Keep tests fast and targeted; avoid running full Playwright or whole monorepo during routine checks.

## Review Focus

- `distinctChoiceCount` calculation for choices with mixed or missing `text`/`labelPl`: ensuring options map to non-empty normalized strings.
- Graceful handling of null/undefined `publicPrompt` or `options` in `skill-history.ts`.
- Non-reader scheduling flow: `exposure` -> `picture_listening` (streak >= 1) -> `picture_recall` (`assessmentSkills: ["recall", "pronunciation"]`) -> `speech`.
- No regression for standard reading children (`canRead = true`).
- No regression for children with microphone disabled (`microphoneEnabled = false`).

---

### Task 1: Fix `readSkillHistories` in `skill-history.ts` to support `labelPl` in prompt options

**Files:**
- Modify: `packages/server/src/modules/skill-history.ts:80-84`
- Test: `tests/integration/history.test.ts`

**Interfaces:**
- Consumes: `row.publicPrompt` containing `options?: { text?: string; labelPl?: string }[]`
- Produces: Correct `distinctChoiceCount` passed to `qualifyProjectionEvidence`

- [ ] **Step 1: Write the failing integration test**

In `tests/integration/history.test.ts`, add a test case verifying that `readSkillHistories` correctly treats picture choice exercises with `labelPl` options as independent (not singletons):

```typescript
it("kwalifikuje próbę picture_listening z opcjami labelPl jako niezależną", async () => {
  const services = buildTestServices().services;
  // Create child with canRead = false
  const child = await createChild(services, { displayName: "Ola", avatarKey: "fox" });
  await updateChild(services, child.id, { canRead: false });
  // Start session with supportsPictureVocabulary: true
  // Complete presentation and submit correct answer for picture_listening task
  // Verify that readSkillHistories returns history entry with independent = true
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run --config vitest.integration.config.ts tests/integration/history.test.ts -t "kwalifikuje próbę picture_listening"`
Expected: FAIL (or `independent` is false due to `distinctChoiceCount = 1`).

- [ ] **Step 3: Implement fix in `packages/server/src/modules/skill-history.ts`**

Update lines 80-83 in `packages/server/src/modules/skill-history.ts`:
```typescript
const prompt = row.publicPrompt as { options?: { text?: string; labelPl?: string }[] } | null;
const distinctChoiceCount = Array.isArray(prompt?.options)
  ? new Set(prompt.options.map((option) => (option.text ?? option.labelPl ?? "").normalize("NFC").trim().toLocaleLowerCase())).size
  : null;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run --config vitest.integration.config.ts tests/integration/history.test.ts -t "kwalifikuje próbę picture_listening"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/skill-history.ts tests/integration/history.test.ts
git commit -m "fix(server): support labelPl in skill-history distinct choice calculation"
```

---

### Task 2: Add scheduler test for non-reading child with microphone enabled

**Files:**
- Modify: `packages/server/src/domain/scheduler-picture-reader.test.ts`

**Interfaces:**
- Consumes: `selectTask` from `./scheduler`
- Produces: Verified task sequence for `canRead = false` and `microphoneEnabled = true`

- [ ] **Step 1: Write unit test in `scheduler-picture-reader.test.ts`**

Add a test case to `packages/server/src/domain/scheduler-picture-reader.test.ts`:

```typescript
it("nieczytający z włączonym mikrofonem po opanowaniu słuchania otrzymuje picture_recall i speech", () => {
  const candidates = numbers(2);
  for (const item of candidates) {
    item.ownPresentationCompleted = true;
    item.usedThisSession = item.presentationsThisSession = 1;
    item.progress.listening = { status: "learning", nextReviewAt: "2026-10-16T12:00:00Z", streak: 1 };
    item.introducedSkills = { recall: false, pronunciation: false };
  }
  const state = { ...input(candidates, false), microphoneEnabled: true, nextOrdinal: 3 };
  const recall = selectTask(state)!;
  expect(recall).toMatchObject({
    exerciseType: "recall",
    reason: "stage-introduction",
    pictureRecall: true,
    assessmentSkills: ["recall", "pronunciation"],
  });
  const target = candidates.find((item) => item.itemRevisionId === recall.itemRevisionId)!;
  target.introducedSkills.recall = true;
  const next = selectTask({ ...state, nextOrdinal: 5 });
  expect(next).toMatchObject({
    exerciseType: "speech",
    reason: "stage-introduction",
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `corepack pnpm test:unit packages/server/src/domain/scheduler-picture-reader.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/domain/scheduler-picture-reader.test.ts
git commit -m "test(server): add regression test for non-reader picture recall and speech scheduling"
```

---

### Task 3: Independent Code Review via Subagent

**Files:**
- Review all touched files: `packages/server/src/modules/skill-history.ts`, `tests/integration/history.test.ts`, `packages/server/src/domain/scheduler-picture-reader.test.ts`.

- [ ] **Step 1: Invoke code review subagent**

Dispatch independent review subagent checking:
1. Strict adherence to AGENTS.md rules.
2. Correct handling of all edge cases in `skill-history.ts`.
3. Test rigor and absence of regressions.

- [ ] **Step 2: Address any review findings**

Refine code or tests if the reviewer identifies any issues.

---

### Task 4: Full Verification and PR Preparation

**Files:**
- All changes in branch `fix_mic_pronunciation_tasks`

- [ ] **Step 1: Run typecheck and unit tests**

Run: `corepack pnpm typecheck && corepack pnpm test:unit`
Expected: PASS with 0 errors.

- [ ] **Step 2: Run targeted integration tests**

Run: `corepack pnpm vitest run --config vitest.integration.config.ts tests/integration/history.test.ts tests/integration/speech.test.ts`
Expected: PASS.

- [ ] **Step 3: Create Pull Request**

Using GitHub CLI (`gh`):
Create PR targeting the main repository branch with a comprehensive Polish description of the issue, root cause, changes, tests, and API/MCP impact analysis.
