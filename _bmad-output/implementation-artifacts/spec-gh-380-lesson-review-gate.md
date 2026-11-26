---
title: 'gh-380: edytor lekcji — pełny podgląd karty, licznik przejrzanych i ostrzeżenie przy publikacji'
type: 'feature'
created: '2026-11-26'
status: 'done'
baseline_revision: '39204eab9fa4d79ae1a1cfb95eb547216b2e3b2e'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** W edytorze lekcji opcje, podpowiedź i warianty widać dopiero po „Edytuj” każdej z 60–160 kart, a edytor nie śledzi przejrzenia ani nie ostrzega przy publikacji, więc bramka zatwierdzenia rodzica jest nominalna.

**Approach:** Zwinięta karta pokazuje opcje (z oznaczeniem poprawnej), podpowiedź i dodatkowe warianty; rodzic odhacza kartę „Przejrzane”; edytor pokazuje „Przejrzane X/N” i przycisk „Następna do przejrzenia” (najpierw karty oflagowane: ujawnione rozwiązanie albo nieudane nagranie); publikacja przy nieprzejrzanych kartach otwiera potwierdzenie z ich liczbą.

## Boundaries & Constraints

**Always:** stan przejrzenia tylko po stronie klienta (klucz `ex.id ?? clientKey`, zerowany przy zmianie wersji szkicu); edycja karty liczy się jako przejrzenie; ostrzeżenie nie blokuje publikacji (rodzic może potwierdzić); teksty z `messages.lessons`; cele dotykowe ≥ 44 px.

**Never:** zmiana kontraktu API/DTO/bazy, MCP lub skilla; zmiana kolejności kart na ekranie; trwały zapis przejrzenia (localStorage/baza).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Kolejka | karty A (bez flagi), B (wyciek), C (audio failed), nic nieprzejrzane | kolejka B, C, A | — |
| Wszystko przejrzane | 3/3 | publikacja bez potwierdzenia, „Następna” wyłączona | — |
| Nieprzejrzane | 1/3 przejrzana | „Publikuj” otwiera potwierdzenie „2 …”; Anuluj nie publikuje | — |

</intent-contract>

## Code Map

- `apps/web/src/parent/lessons/LessonExerciseCard.tsx` -- `exercisePreview` (l.28) i zwinięty podgląd (l.317); nowe propsy `reviewed`, `onReviewed`; `sameCardProps` porównuje propsy przez `Object.is` (nowe booleany/stabilna funkcja OK).
- `apps/web/src/parent/lessons/LessonEditor.tsx` -- `openCards`/`toggleCard` (l.163, 846) wzór stanu kart; `cardActionsRef`/`cardActions` (l.164) stabilne akcje; `mutateExercise` (l.392); `showSource`+`revealIndex` (l.873, 757) przewijanie do karty; `leakNotice` (l.887); `exerciseCard` (l.899) liczy audio; nagłówek ćwiczeń (l.1276); `publish` (l.551) i `EditorActionBar` (l.1508); `modals.openConfirmModal` (l.779) wzór potwierdzenia.
- `apps/web/src/parent/lessons/lesson-editor-state.ts` -- miejsce na czystą funkcję `reviewQueue`.
- `packages/contracts/src/messages.ts` -- `messages.lessons` (ok. l.1233) nowe teksty.
- `tests/e2e/lesson-*.spec.ts`, `parent-sources.spec.ts` -- kliknięcia `publish-lesson` muszą potwierdzić okno.

## Tasks & Acceptance

**Execution:**
- `apps/web/src/parent/lessons/lesson-editor-state.ts` -- `reviewQueue(exercises, flagged, reviewed)` → klucze nieprzejrzanych, oflagowane pierwsze, potem kolejność formularza -- testowalna reguła kolejki.
- `apps/web/src/parent/lessons/LessonExerciseCard.tsx` -- `exercisePreview` zwraca też `options`, `hint`, `variants`; podgląd je renderuje; checkbox „Przejrzane” (tylko edytowalny szkic).
- `apps/web/src/parent/lessons/LessonEditor.tsx` -- stan `reviewed`, licznik, „Następna do przejrzenia”, potwierdzenie publikacji.
- `packages/contracts/src/messages.ts` -- teksty.
- testy: `lesson-exercise-card.test.tsx`, `lesson-editor-state.test.ts`, E2E w `parent-lesson-editor-layout.spec.ts`; poprawki istniejących E2E publikacji.

**Acceptance Criteria:**
- Given zwinięta karta wyboru z podpowiedzią i wariantami, when rodzic ją ogląda, then widzi wszystkie opcje z oznaczoną poprawną, podpowiedź i warianty bez „Edytuj”.
- Given szkic z N kartami, when rodzic odhacza „Przejrzane”, then licznik pokazuje „Przejrzane X/N”.
- Given nieprzejrzane karty, when rodzic klika „Publikuj”, then okno ostrzega o ich liczbie i publikuje dopiero po potwierdzeniu.
- Given karta z ujawnionym rozwiązaniem, when rodzic klika „Następna do przejrzenia”, then najpierw trafia do niej.

## Spec Change Log

## Review Triage Log

### 2026-11-26 — Review pass
- verdicts: 27 findings — high 0, medium 4, low 6, false 9, maybe-false 0 (pozostałe 8 to opisowe ustalenia audytu intencji, bez werdyktu)
- findings:
  - `[medium]` `[patch]` Brak testu zerowania stanu przy nowej wersji szkicu (verification-gap) — dodano E2E: inna `draft.id` → „Przejrzane 0/6”.
  - `[medium]` `[patch]` Nieprzetestowane źródła flag: asset failed, explanation/sentence audio (verification-gap) — fixture 6 kart, każda flaga osobno, asercja kolejności.
  - `[low]` `[reject]` Nowa karta bez id traci znacznik po zapisie (verification-gap, edge-case, blind) — false w praktyce: edytor nie ma dodawania ćwiczeń, karty przychodzą z serwera z id.
  - `[low]` `[patch]` Duplikat reguły klucza `ex.id ?? clientKey` (verification-gap, blind) — `cardKeyOf` w karcie i edytorze.
  - `[false]` `[reject]` Pusta tablica opcji (edge-case) — opcje walidowane w kontrakcie (min. 2), stan nieosiągalny.
  - `[low]` `[reject]` Ćwiczenie poza grupą → „Następna” nic nie robi (edge-case) — każde ćwiczenie ma cel i etap (`stageOfExerciseType` jest totalna), grupy budowane z formularza.
  - `[low]` `[reject]` Wariant różny tylko wielkością liter (edge-case) — kosmetyka, nieuniknione dopisanie reguły porównań językowych.
  - `[medium]` `[patch]` „Następna” nie przechodzi dalej bez odhaczenia (blind) — ref ostatnio pokazanej, kolejna z zawinięciem; E2E 7 kliknięć.
  - `[medium]` `[patch]` Checkbox bez nazwy per karta, licznik bez ogłoszenia (blind) — `aria-label` „Ćwiczenie {n}: przejrzane”, `role="status"`.
  - `[low]` `[patch]` Drugi E2E edytował po publikacji tylko dzięki mockowi (blind) — mock przełącza szkic na nowe id przed potwierdzeniem.
  - `[false]` `[reject]` Brak flagowania kart z błędami walidacji (blind) — takie karty są wymuszone otwarte i przewijane (`forcedOpen`, efekt `exerciseErrors`).
  - `[low]` `[reject]` Kwadratowy koszt flag (blind) — 160×160 porównań na render, niezauważalne przy obciążeniu jednego rodzica.
  - `[false]` `[reject]` „Inne poprawne” na kartach wyboru mylące (blind) — podgląd odzwierciedla edytowalne pole wariantów, które edytor pokazuje dla tych typów.
  - `[false]` `[reject]` Brak ostrzeżenia, gdy żadna opcja nie jest poprawna (blind) — walidacja serwera odrzuca taki szkic przy zapisie.
  - `[false]` `[reject]` Nieaktualne domknięcie `publish` w modalu (blind) — modal blokuje edycję; zmiana `editNumber` w tle kończy się 409 i odświeżeniem, nie błędną publikacją.
  - `[low]` `[patch]` Brak zapisu decyzji w dokumentacji (blind) — punkt w `docs/SPEC.md` §29a.8.
  - `[false]` `[reject]` Puste logi spec/RED-GREEN (blind) — uzupełnione w tym wpisie i raporcie implementacji.
  - `[false]` `[reject]` Audyt intencji: odczyty A2/B3/C3/D2/D-b (trwały stan, bramka MCP, sortowanie, brak audio = pending) — świadomie poza zakresem wg spec; opisane w PR.
  - `[false]` `[reject]` Audyt: podpowiedź pokazywana dla typów, które jej nie serializują — podgląd pokazuje dane szkicu; `hint` niepusty tylko dla `lesson_gap`.
  - `[false]` `[reject]` Audyt: brak dowodu RED w diffie — RED zapisany w raporcie implementacji (5 unit + 2 E2E padały przed kodem).

## Design Notes

Tryb pracy: TDD RED-GREEN. Najpierw dopisz testy (unit `reviewQueue`, komponent karty, E2E), uruchom je i zachowaj wyjście z błędami (RED), dopiero potem kod (GREEN); w raporcie podaj oba wyniki. Nie uruchamiaj płatnych wywołań AI. Przeczytaj `docs/agents/testing.md` przed E2E. E2E pojedynczo z `--base-port=26800` (np. `UMIEM_E2E_WEB_MODE=dev`).

## Verification

**Commands:**
- `corepack pnpm vitest run apps/web/src/parent/lessons` -- zielone
- `pnpm check` -- zielone
- `pnpm test:e2e:shards --base-port=26800` -- zielone

## Auto Run Result

Status: done. Podgląd pełnej karty, „Przejrzane X/N”, „Następna do przejrzenia” (flagi pierwsze), ostrzeżenie przy publikacji. Poprawki z review: przejście kolejki dalej, a11y, `cardKeyOf`, testy flag i zerowania, dokumentacja. Weryfikacja: unit 208/208 (lessons), `pnpm check` PASS, E2E shards — zob. PR. Ryzyka: stan przejrzenia nie przeżywa przeładowania; publikacja przez MCP bez ostrzeżenia (poza zakresem).
