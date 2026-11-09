---
title: 'Naprawa usterek nagród wykrytych w review'
type: 'bugfix'
created: '2026-10-16'
status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/specs/spec-nagrody-za-nauke/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-nagrody-za-nauke/activity-policy.md'
  - '{project-root}/_bmad-output/specs/spec-nagrody-za-nauke/daily-round.md'
  - '{project-root}/_bmad-output/specs/spec-nagrody-za-nauke/xbox-rewards.md'
---

<frozen-after-approval reason="zakres zatwierdzony przez właściciela w rozmowie">

## Intent

**Problem:** Review pełnego brancha nagród wykazał ścieżki pomijające rozliczenie pracy, błędy w ponawianiu/wyświetlaniu, fałszywe pauzy i możliwe deadlocki; obecne testy nie obejmują niektórych granic API i lifecycle przeglądarki.

**Approach:** Naprawić wszystkie ustalenia zakwalifikowane do poprawy w review brancha, zachowując reguły nagród i tryb ręcznego Xboxa. Dodać brakujące testy integracyjne i przeglądarkowe, a następnie wykonać nowe niezależne review.

**Always:** 1 pkt/min za rozliczoną pracę niezależnie od poprawności; cel i bloki liczone według rodzinnej strefy; pomiary wiązane z zadaniami; odpowiedzi bez podwójnego wysłania; Parent Work Card pokazuje tylko fakty dostępne w danych. Stosuj TDD RED–GREEN i niezależne review.

**Never:** Nie zmieniaj przelicznika, naliczania wstecz, reguł gwiazdek/mastery, zakresu materiału rundy ani nie dodawaj automatyzacji Microsoft/Xbox. Nie zapisuj tekstu klawiszy ani surowego audio w ledgerze nagród.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Lesson answer | Przyjęta odpowiedź na ćwiczenie lekcji | Aktywny czas jest rozliczony dokładnie raz jak dla innych zadań | Retry pozostaje idempotentny |
| Unevaluated answer | Tekstowa odpowiedź została zapisana, ale ocena jest technicznie niedostępna | Przyjęty czas jest rozliczony mimo braku wyniku mastery | `skip` nadal nie potwierdza pracy |
| Unevaluated audio | Cisza, niepewne STT lub awaria providera bez wiarygodnej oceny | Nie potwierdzaj czasu samym audio | Nie twórz błędu wiedzy |
| Lost lifecycle pause | Pauza po blur nie dociera, a karta wraca do fokusu | Klient ponawia tę samą pauzę; takeover nie dopisuje niezamkniętego ogona starego strumienia | Bez tła zaliczonego jako nauka; do 15 s może pozostać nierozliczone przy takeover |
| Long playback | Autoryzowany odtwarzacz przekracza 60 s od interakcji | Odcinek trwa do końca autoryzacji lub playbacku | Po limicie zasobu brak dalszego czasu |
| Lost signal response | Serwer przyjął sygnał, klient nie dostał odpowiedzi | Klient ponawia ten sam payload/sekwencję, nie gubi kolejnego zdarzenia | Timeout telemetryczny nie blokuje odpowiedzi dziecka |
| Daily round | Ostatnie kontakty nie są planowalne, wcześniejsze są bezpieczne | Wspólny preflight wybiera bezpieczną pulę przed limitem 3; dostępność zgadza się ze startem | Brak zadań zwraca jawne niedostępne |
| Parent card | Sesja rozpoczęta wczoraj ma zadanie wydane dziś; ocena jest częściowa | Karta obejmuje dzisiejszy krok, status mieszany i prawidłową liczbę pozostałych kroków | Domyślna data pochodzi z rodzinnej strefy |
| Concurrent work | Xbox request, session start i answer settlement nakładają się | Blokady mają spójną kolejność i nie tworzą cyklu | Konflikt zwraca kontrolowany błąd |

</frozen-after-approval>

## Code Map

- `packages/server/src/modules/lessons/lesson-attempts.ts`, `attempts.ts`, `reward-activity.ts`, `sessions.ts`, `daily-round.ts` — finalizacja prób, strumienie i blokady, selekcja rundy.
- `packages/server/src/modules/parent-work-card.ts`, `packages/contracts/src/parent-work-card.ts`, `apps/web/src/parent/parent-router.ts`, `packages/kid-ui/src/components/parent/WorkCardPanel.tsx` — dane i lokalna data karty rodzica.
- `packages/kid-ui/src/session/session-controller.ts`, `useLearningSession.ts`, ekrany wpisywania/układania — blokady submitu, sygnały interakcji, retry, timeout i lifecycle.
- `apps/web/src/kid/kid-router.ts`, `packages/kid-ui/src/api/client.ts`, `tests/integration/` — prawdziwa granica klient–router i zapis czasu.
- `packages/server/src/modules/events.ts`, `packages/server/src/modules/reward-activity.ts` — zachowanie puli dziennej w kontekście i jednolita kolejność blokad profilu/advisory.
- `packages/contracts/src/decks.ts`, `kid.ts`, `packages/kid-ui/src/visuals/` oraz edytory przypisań — ochrona kompatybilności z `origin/main` (wartość zero, cyfry, cofanie przypisania).
- `tests/e2e/helpers/kid-ui-fixture.ts`, `tests/e2e/` — zdarzenia widoczności i fokusu w zamontowanym Kid UI.

## Tasks & Acceptance

**Execution:**
- [x] Dodać testy RED i poprawić finalizację prób lekcji, ponawianie strumieni, timeouty/wyścigi klienta i aktywność wpisywania.
- [x] Ujednolicić blokady, eligibility rundy i jej dostępność/start; poprawić autoryzowany playback dłuższy niż 60 sekund oraz zachować pulę rundy przy zapisie kontekstu.
- [x] Naprawić Parent Work Card: mieszane wyniki, budżet kroków, zadania wydane w wybranym dniu i domyślna data rodzinna.
- [x] Dodać integrację prawdziwego Kid API client → router dla activity i playback oraz test lifecycle przez przeglądarkę.
- [ ] Zakończyć końcowe niezależne review względem świeżego `origin/main`.
- [x] Przywrócić równoległe funkcje z aktualnego `origin/main`: number zero/cyfry oraz cofanie przypisań zestawu.
- [x] Zachować pulę daily round w kontekście; obsłużyć anulowane/odrzucone playback_end i playback_start oraz nie autoryzować odtworzenia po zmianie lifecycle.
- [x] Wstrzymać nowy strumień po przejściu zadania w tło, obsłużyć powrót sieci ukrytej karty i czekać na takeover przed autoryzacją audio.
- [x] Przywrócić generowanie liczby 0, filtrować nieaktywne przypisania i pokazać odpowiedź rundy zapisanej po północy na właściwym dniu.
- [x] Zachować gwiazdki dla dzieci nieczytających, nie ujawniać terminu po odpięciu zestawu i nie oferować pakietu bez punktów.
- [x] Wstrzymać wznowienie przy widocznej, ale nieaktywnej karcie; serializować szybkie odtworzenia i blokować autoplay w tle.
- [x] Uporządkować szybki blur/focus, ponawiać utraconą pauzę przed takeoverem oraz odrzucać niezamknięty ogon poprzedniego strumienia.
- [x] Rozliczać zaakceptowaną odpowiedź tekstową także wtedy, gdy grading kończy się `unevaluated`; nie uzależniać czasu pracy od oceny mastery.
- [x] Nie rozliczać technicznie nieocenionego audio oraz ignorować ponowne wybranie aktywnego dziecka, aby nie unieważniać ładowania karty rodzica.

**Acceptance Criteria:**
- Given przyjęte zadanie lekcji lub zwykłe zadanie, when kończy się krok, then czas jest rozliczony atomowo i retry go nie dubluje.
- Given wielokrotne kliknięcie, opóźnienie/utrata odpowiedzi API, pisanie przez ponad minutę albo długi autoryzowany playback, when działają sygnały, then odpowiedź nie jest podwajana, aktywna praca nie jest bezpodstawnie odrzucana ani naliczana w tle.
- Given równoległy Xbox/session/attempt lub nieplanowalne kontakty, when system blokuje/wybiera pracę, then nie występuje deadlock, a dostępność rundy odpowiada temu, co można rozpocząć.
- Given dzisiejszy krok w sesji rozpoczętej poprzedniego dnia albo częściowa ocena, when rodzic otwiera kartę, then widzi właściwy dzień, wynik i pozostałe kroki według rodzinnej strefy.
- Given rzeczywisty Kid UI i API, when testy przechodzą, then transport nagród i pauzowanie lifecycle są zweryfikowane przez swoje publiczne granice.

## Implementation Notes

Bez zmian w integracji MCP: kontrakty nagród pozostają Kid/Parent API, a `learning-overview` nie zawiera tych danych. Współdzielone zmiany agentów mają być scalone tylko lokalnie w tym branchu; nie pushować ani nie merge'ować PR.
Aktualne `origin/main` zawiera też kontrakt Parent Work Card z opcjonalną datą wyłącznie dla Parent API; MCP `learning-overview` go nie używa. Zachowano bieżące funkcje cofania przypisań i wizualizację cyfr/zera.

## Verification

**Commands:**
- `corepack pnpm test:integration` — 45 files, 424 passed (before the final isolated regression additions).
- `corepack pnpm vitest run --config vitest.integration.config.ts tests/integration/reward-regressions.test.ts` — 13 passed, including daily-round cross-midnight response.
- `corepack pnpm vitest run --config vitest.integration.config.ts tests/integration/reward-regressions.test.ts tests/integration/reward-activity.test.ts tests/integration/lesson-mock-tests.test.ts tests/integration/attempts.test.ts` — 56 passed.
- `corepack pnpm vitest run --config vitest.unit.config.ts packages/kid-ui/src/session/session-controller.test.ts` — 86 passed.
- `corepack pnpm exec playwright test tests/e2e/kid-activity-lifecycle.spec.ts tests/e2e/parent-work-card.spec.ts` — 7 passed after updating lifecycle expectation to the new-stream takeover behavior.
- `corepack pnpm typecheck` — passed.
- `git diff --check` — passed before final independent review.
- `origin/main` zweryfikowano po fetchu: `d99b3d39ef070c99e4f4bab618a5668855be5521`.
- Dwa świeże review wykazały lifecycle, rozliczenie prób i ładowanie karty rodzica; ustalenia poprawiono i pokryto testami. Końcowe niezależne review finalnego diffu vs `origin/main` jest ponawiane sekwencyjnie, jednym agentem naraz, modelem GPT 6.1 Sol Medium.
