# Ignorowanie wielkości liter w rozpoznawaniu mowy i ocenie wymowy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zagwarantowanie spójności wielkości liter w rozpoznanym tekście mowy (`heardText` / `recognizedText`) oraz case-insensitive ewaluacji wymowy, aby uniknąć mylącego komunikatu sugerującego błąd wielkości liter przy wypowiadaniu słów (np. Purple vs purple).

**Architecture:** W `packages/server/src/modules/speech.ts` dopasowujemy wielkość liter `recognizedText` do zatwierdzonego wariantu (`match.matchedVariant`), gdy treść wypowiedzi jest zgodna, a dla nierozpoznanych słów przy oczekiwanych wyrazach pisanych małą literą redukujemy początkową wielką literę ze zdaniowego formatowania STT. Porównania `key.target`, `match.matchedVariant` oraz `p.expectedText` zabezpieczamy porównaniem ignorującym wielkość liter.

**Tech Stack:** TypeScript strict, Vitest, Node.js.

**Spec:** `docs/superpowers/specs/2026-10-16-ignore-pronunciation-case-design.md`

## Global Constraints

- Brak zmian w publicznych kontraktach `@learning/contracts` i schematach bazy danych.
- Brak logowania nagrań, transkrypcji ani danych osobowych dzieci.
- Zgodność z istniejącymi regułami oceny mowy i ekspozycji z `SPEC.md` §23 oraz `architecture.md` §11.

## Review Focus

- Rozpoznanie słowa z małej litery (`purple`) przy kapitalizacji ze STT (`Purple.`) nie może pokazywać wielkiej litery w `heardText`.
- Nazwy własne (`Thursday`, `Monday`) muszą zachować swoją prawidłową wielką literę.
- Różnica wielkości liter między `p.expectedText` a `match.matchedVariant` nie może powodować stanu `unevaluated` oceny wymowy.
- Słowo rozbieżne (`different`) przy celu z małej litery (`purple` vs `turtle`) nie powinno krzyczeć wielką literą STT (`turtle` zamiast `Turtle`).
- Pełna zgodność testów integracyjnych `tests/integration/speech.test.ts`.

---

### Task 1: Case-insensitive rozpoznawanie mowy i normalizacja recognizedText

**Files:**
- Modify: `packages/server/src/modules/speech.ts:76-88,146-193`
- Test: `packages/server/src/modules/speech.test.ts`

**Interfaces:**
- Consumes: `matchSpokenAnswer`, `normalizeSpokenAnswerText`, `assessSpeechEvidence`, `analyzeSpeech`
- Produces: `Grade.recognizedText` zgodne z wielkością liter `match.matchedVariant` i bezpieczna ocena wymowy

- [ ] **Step 1: Write the failing tests**

W `packages/server/src/modules/speech.test.ts` dodać testy sprawdzające:
1. `Purple.` ze STT dla celu `purple` daje `grade.recognizedText === "purple"`.
2. Słowo spoza wariantów dla celu z małej litery (`Turtle.` dla `purple`) daje `grade.recognizedText === "turtle"`, a dla nazwy własnej (`Tuesday.` dla `Thursday`) zachowuje `"Tuesday"`.
3. Ocena wymowy jest poprawna (`correct`), nawet gdy `expectedText` i `matchedVariant` różnią się wielkością liter (`Purple` vs `purple`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm vitest run packages/server/src/modules/speech.test.ts`
Expected: FAIL (asercje `recognizedText` oraz `outcome: "unevaluated"`).

- [ ] **Step 3: Implement case-insensitive logic in `packages/server/src/modules/speech.ts`**

1. W `analyzeSpeech` sprawdzić zgodność wariantu z celem case-insensitively: `match.ci && match.matchedVariant && match.matchedVariant.toLowerCase() === key.target.toLowerCase()`.
2. W `assessSpeechEvidence` wyliczyć `recognizedText` z uwzględnieniem `match.matchedVariant` (gdy `match.ci`) lub małej litery, gdy `key.target` zaczyna się małą literą.
3. W `pronunciationStatus` oraz walidacji `p` porównywać `key.target`, `match.matchedVariant` i `p.expectedText` przy użyciu `.toLowerCase()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm vitest run packages/server/src/modules/speech.test.ts`
Expected: PASS (wszystkie testy zielone).

- [ ] **Step 5: Run full speech unit & integration test suites and typecheck**

Run: `corepack pnpm vitest run packages/server/src/modules/speech.test.ts packages/server/src/domain/feedback.test.ts packages/kid-ui/src/screens/speech-feedback-view.test.ts packages/contracts/src/speech-feedback.test.ts packages/server/src/providers/azure/pronunciation.test.ts packages/server/src/providers/azure/stt.test.ts`
Run: `corepack pnpm vitest run --config vitest.integration.config.ts tests/integration/speech.test.ts`
Run: `corepack pnpm typecheck`
Expected: ALL PASS.

- [ ] **Step 6: Commit changes**

```bash
git add packages/server/src/modules/speech.ts packages/server/src/modules/speech.test.ts docs/superpowers/specs/2026-10-16-ignore-pronunciation-case-design.md docs/superpowers/plans/2026-10-16-ignore-pronunciation-case.md
git commit -m "fix(server): ignore letter case in speech recognition and pronunciation assessment"
```
