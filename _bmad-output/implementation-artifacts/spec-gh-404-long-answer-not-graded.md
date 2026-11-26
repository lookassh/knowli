---
title: 'gh-404: odpowiedź dłuższa niż limit gradera jest nieoceniona zamiast oceniania ucinanego prefiksu'
type: 'bugfix'
created: '2026-11-25'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Kontrakt próby przyjmuje tekst do 600 znaków (`MAX_TEXT_ATTEMPT_LENGTH`), ale dla lekcji spoza szkoły i rozsypanki `lessonGraderInput` wysyła do gradera tylko pierwsze 200 znaków, bez znacznika ucięcia. Model ocenia więc sam prefiks jak całą odpowiedź: poprawka dopisana po 200. znaku przepada, a werdykt prefiksu trafia do cache pod kluczem pełnej odpowiedzi.

**Approach:** Limit 200 znaków zostaje, bo jest udokumentowaną granicą prywatności (SPEC §726, `docs/agents/providers-privacy.md`). Odpowiedź dłuższa niż limit ścieżki gradera nie trafia do modelu ani do cache werdyktów. Jest finalizowana jak przy braku gradera: `not_assessed`, zadanie wraca do ponowienia, bez kary i bez zużycia budżetu `graderCalls`. Zwykłe dopasowanie deterministyczne do klucza działa dalej, bo działa przed ścieżką modelu.

</frozen-after-approval>

## Implementation Notes

- Zmiana w `submitLessonAttempt` (`packages/server/src/modules/learning/lessons/lesson-attempts.ts`). Odpowiedź jest „za długa”, gdy `earlyInput.childAnswer` jest krótszy od pełnej odpowiedzi, czyli limit wynika z jednego miejsca (`lessonGraderInput`), bez nowej stałej ani eksportu. Sprawdzenie stoi przed odczytem cache i przed rezerwacją wywołania.
- Bez gradera ścieżka już daje `not_assessed` (cache nie jest czytany, bo brak `promptVersion`), więc warunek dotyczy tylko konfiguracji z graderem.
- Test integracyjny w `tests/integration/lesson-grader.test.ts`: transform z odpowiedzią > 200 znaków → `not_assessed`, zadanie `issued`, `callCount` 0, brak wiersza cache, `graderCalls` 0.
- Dokumentacja: dopisek o nieocenianiu dłuższej odpowiedzi w SPEC §726 i `docs/agents/providers-privacy.md`.
- Po recenzji: `details.reason = "answer_too_long"` w ocenie (odróżnia od awarii gradera), komentarz przy ucinaniu w `lesson-grader-input.ts`, asercja oceny `unassessed` w teście. Test bez poprawki pada (sprawdzone).

## Review Triage Log

- Pętla „Spróbuj jeszcze raz” (pole dziecka pozwala na 600 znaków) — medium, prawdziwe; poprawka wymaga zmiany Kid DTO/UI, właściciel: odłożyć (deferred-work).
- Dyktowanie w gramatyce — false: `spokenAnswers` ma tylko przedmiot `school` (limit 600 = kontrakt).
- Rodzic nie odróżni „za długie” od awarii — low, poprawione (`reason: "answer_too_long"`).
- Wykrywanie oparte na ucinaniu bez komentarza — low, poprawione komentarzem.
- Rozsypanka >600 znaków — low/odrzucone: klocki to tekst ćwiczenia; zdanie rozsypanki mieści się w limitach walidacji puli.
- Brak testów granicy 200 — low, odrzucone: warunek porównuje długość z wynikiem tego samego `slice`.
- Białe znaki na końcu — low, odrzucone: rzadkie, a skutkiem jest tylko nieocenienie.
- Stare werdykty prefiksu w cache — maybe-false/medium, odłożone (deferred-work).
- Test nie dowodzi braku kary — low, poprawione asercją oceny `unassessed`.
- Spec nieśledzony / in-progress — poprawione (status done, commit).
