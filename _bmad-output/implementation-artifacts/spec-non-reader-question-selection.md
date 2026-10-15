---
title: 'Dobór wykonalnych pytań obrazkowych'
type: 'bugfix'
created: '2026-10-15'
status: 'done'
baseline_revision: ced8cf420e2919d67cd45b60f95a11cd1dfa20ed
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/AGENTS.md']
warnings: []
deferred:
  - summary: >-
      Łatwa przerwa może zostać pominięta, gdy pierwszy niezarezerwowany kandydat nie daje planu.
    evidence: |-
      Wcześniejsze gałęzie difficulty-break i test-preparation-break nadal używają find zamiast szukania pierwszego wykonalnego planu. Kod istniał przed baseline; aktualna poprawka dotyczy końcowego utrwalania. Potrzebna osobna regresja dwóch trudnych zadań i późniejszego wykonalnego celu przerwy.
    location: >-
      packages/server/src/domain/scheduler.ts:654-698
    severity: medium
  - summary: >-
      Brak potwierdzenia objawu na działającej instancji i pełnego przebiegu sesji dziecka.
    evidence: |-
      Testy izolują selectTask i materializeTask. Nie odtwarzają danych rzeczywistego dziecka ani nie mierzą rozkładu pytań w długiej sesji lub układu UI na urządzeniu. Raport ogranicza twierdzenia do potwierdzonych przypadków w kodzie.
    severity: low
  - summary: >-
      Nakładający się alias odpowiedzi może kolidować z rezerwacją innego celu.
    evidence: |-
      Eksperyment implementera: red jako niezarezerwowany cel ma acceptedAnswers blue/green, a blue jest zarezerwowane; kanoniczna kontrola celu nie blokuje aliasu w revealsTargetKeys. Luka poprzedza zmianę. Wymaga osobnej analizy semantyki aliasów i testu rezerwacji.
    location: >-
      packages/server/src/domain/picture-recognition-options.ts
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Właściciel zgłasza podejrzane losowanie pytań i odpowiedzi dla dziecka nieczytającego. Analiza potwierdziła przedwczesny brak zadania: pierwszy kandydat utrwalania nie ma bezpiecznych dystraktorów, ale kolejne karty mogą utworzyć prawidłowe zadanie.

**Approach:** Sprawdzić pozostałych kandydatów w dotychczasowej kolejności priorytetów, zanim scheduler uzna, że nie ma pracy. W trybie nieczytającym oceniać opanowanie dla priorytetu utrwalania tylko według umiejętności dostępnych w tej sesji, aby stare reading/spelling nie blokowały rotacji. Zweryfikować także tasowanie wizualnych odpowiedzi i zgodność klucza.

## Boundaries & Constraints

**Always:** Zachować priorytety, budżet, rezerwacje, deduplikację znaczeń i obrazków, pojedynczy fallback oraz niezmienność wydanego promptu. Dokumentacja architecture §9.3 wymaga deterministycznych priorytetów pytań; kolejność odpowiedzi losuje materializacja.

**Never:** Zmieniać historii, bazy, API/DTO, MCP, skilla konsumenta, zasad samodzielności ani wprowadzać losowego score pytań. Bez push i merge.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pierwsza karta niewykonalna | picture, canRead=false, mic=false; A koliduje z B i C, ale B i C są rozróżnialne; fallback A zużyty | Listening B z bezpiecznymi opcjami B,C zamiast null | Bez ujawnienia A |
| Brak wykonalnych kart | Wszystkie opcje kolidują i fallbacki zużyte | null | Bez pętli i fałszywego dowodu wiedzy |
| Rezerwacja | Pierwszy wykonalny kandydat jest zarezerwowany | Pominięcie zarezerwowanego celu | Ochrona celu również jako dystraktora |
| Tasowanie picture | Trzy różne opcje wizualne, kontrolowane wartości Math.random | Poprawna odpowiedź może zajmować każdą z trzech pozycji; klucz wskazuje właściwy obraz | Bez wycieku klucza w prompt |
| Stare reading/spelling | Nieczytający bez mikrofonu; A ma mastered listening i learning reading/spelling, B ma mastered listening; A już ćwiczono, B nie | Kolejne pytanie B; niedostępne umiejętności A nie dają mu stałego pierwszeństwa | Zachować historię i priorytet rzeczywiście nieopanowanego listening |
| Profil czytający | Te same historyczne trudności reading/spelling przy canRead=true | Zachować pierwszeństwo nieopanowanego materiału | Bez regresji dotychczasowego trybu |

</intent-contract>

## Code Map

- `packages/server/src/domain/scheduler.ts` — selectTask, końcowy practicePool/find/return recognitionPlan; priorytety wcześniejszych gałęzi pozostają bez zmian.
- `packages/server/src/domain/picture-recognition-options.ts` — deduplikacja etykiet, wizualizacji i zaakceptowanych odpowiedzi; może prawidłowo zwracać null dla jednej karty przy wykonalności innych.
- `packages/server/src/domain/scheduler.test.ts` — helpery candidate, peer, input; regresje picture.
- `packages/server/src/modules/sessions.ts` — materializeTask; Fisher–Yates i mapowanie correctOptionId.
- `packages/server/src/modules/sessions.test.ts` — testy materializacji, dodać deterministyczną kontrolę obrazkowych opcji.
- `docs/architecture.md` §9.3 oraz `docs/SPEC.md` §34 — istniejący kontrakt, bez potrzeby zmiany.

## Tasks & Acceptance

**Execution:**
- `packages/server/src/domain/scheduler.test.ts` — odtworzyć błąd rzeczywistym wywołaniem selectTask, zaobserwować RED, pokryć granice macierzy.
- `packages/server/src/domain/scheduler.ts` — wybierać pierwszy niepusty plan w uporządkowanej puli utrwalania, zachowując filtry rezerwacji i dotychczasowe powody zadań.
- `packages/server/src/domain/scheduler.ts` — w priorytecie mastery puli utrwalania nieczytającego filtrować snapshoty według getVocabularyCapabilities; przekazać kontekst do wszystkich wywołań practicePool. Zachować dotychczasowe zachowanie profilu czytającego.
- `docs/architecture.md` §9.3 — krótko doprecyzować priorytet mastery dla nieczytającego i wybór pierwszego wykonalnego planu.
- `packages/server/src/modules/sessions.test.ts` — sprawdzić każdą pozycję poprawnego obrazka i mapowanie odpowiedzi bez statystycznych asercji.

**Acceptance Criteria:**
- Given nieczytające dziecko z pozostałym budżetem i wykonalną kartą w puli, when pierwsza karta nie daje planu, then selectTask wydaje kolejne bezpieczne zadanie obrazkowe.
- Given dotychczasowe scenariusze schedulera i materializacji, when uruchomiono weryfikację, then zachowują zgodność z testami i typami.
- Given nieczytające dziecko i historyczne reading/spelling, when utrwala listening bez mikrofonu, then kolejność pytań nie jest stale zdominowana przez niedostępne umiejętności.

## Spec Change Log

## Review Triage Log

### 2026-10-15 — Review pass

- verdicts: 13 findings — high 0, medium 4, low 7, false 2, maybe-false 0
- findings:
  - `[medium]` `[defer]` Edge: difficulty-break nadal bierze pierwszy niewykonalny cel — gałąź find istniała przed baseline; potwierdzone odczytem kodu, zapisano osobno.
  - `[medium]` `[defer]` Blind: ten sam problem w difficulty-break i preparation-break — obie gałęzie poprzedzają zmianę; wspólny powód i wpis deferred.
  - `[false]` `[reject]` Blind: przekazanie capabilities do introductionPlan jest nieuzgodnioną zmianą — plan jawnie wymaga przekazania kontekstu do wszystkich wywołań practicePool; usunięcie wpływu niedostępnych skills jest spójne w tych ścieżkach, nie wskazano błędnego wyniku.
  - `[medium]` `[patch]` Blind: brak testu mastery z mikrofonem — dodać regresje recall/pronunciation oraz ignorowania reading/spelling; wspólna poprawka z verification-gap.
  - `[low]` `[patch]` Blind: test rezerwacji nie przechodzi przez nową pętlę po niewykonalnym celu — dodać połączony scenariusz wykluczenia celu i dystraktora.
  - `[low]` `[reject]` Blind: spec nie zawiera jeszcze końcowych wyników i ma nieprecyzyjną adnotację dokumentacji — workflow wymaga odrzucić finding naprawiany edycją spec; końcowe wyniki zostaną zapisane w wymaganym Auto Run Result.
  - `[medium]` `[patch]` Verification: brak regresji dla gałęzi z mikrofonem pozwala mutacji microphone=false przeżyć — dowód warstwy przyjęty; ta sama parametryzowana poprawka co Blind.
  - `[false]` `[reject]` Intent: diagnoza z implementacją jest defensywnym odczytaniem polecenia — samo polecenie Build auto obejmuje taką ścieżkę; audytor nie stwierdza niezgodności dwóch konkretnych poprawek.
  - `[low]` `[defer]` Intent: testy obserwują serwerowe funkcje zamiast pełnego doświadczenia dziecka — ograniczenie jawnie zapisane; nie deklarujemy walidacji instancji i urządzenia.
  - `[low]` `[defer]` Intent: pojedynczy wybór nie mierzy rozkładu całej sesji — prawda, obecne dowody dotyczą regresji priorytetu i niewykonalności, bez twierdzenia o pełnej statystyce sesji.
  - `[low]` `[defer]` Intent: kontrolowane Math.random nie dowodzi statystycznej dystrybucji i układu UI — test potwierdza pozycje i klucz, nie deklarujemy pomiaru dystrybucji ani testu urządzenia.
  - `[low]` `[defer]` Intent: początkowe przypadki bazują na kolorach i wyłączonym mikrofonie — brak testu nowej gałęzi mikrofonu uzupełniany osobną poprawką; pełny przegląd wszystkich mediów i wariantów pozostaje niezweryfikowany.
  - `[low]` `[defer]` Intent: brak powiązania z konkretną zgłoszoną sesją — nie pobierano danych działającej instancji; raport zachowuje to ograniczenie.

## Verification

**Commands:**
- `corepack pnpm test:unit packages/server/src/domain/scheduler.test.ts packages/server/src/domain/picture-recognition-options.test.ts packages/server/src/modules/sessions.test.ts` — wszystkie testy przechodzą; baseline 71/71.
- `corepack pnpm typecheck` — brak błędów typów.

## Design Notes

API → MCP → skill bez zmiany: wewnętrzny wybór istniejącego zadania, bez zmiany endpointów, DTO, domyślnych wartości i znaczenia raportów. Nie sprawdzono działającej instancji ani konkretnej sesji dziecka; poprawka dotyczy odtworzonego przypadku w kodzie.

## Auto Run Result

Status: done.

- Poprawiono przedwczesny brak zadania po niewykonalnym kandydacie oraz dominację historycznych reading/spelling w priorytecie utrwalania nieczytającego.
- Zmienione pliki: `packages/server/src/domain/scheduler.ts` (wyszukiwanie i capabilities), `packages/server/src/domain/scheduler.test.ts` (regresje i granice), `packages/server/src/modules/sessions.test.ts` (deterministyczne pozycje poprawnego obrazka), `docs/architecture.md` (doprecyzowanie zachowania), ten dokument (plan i wynik).
- Implementer zaobserwował rzeczywisty RED: null zamiast blue oraz red zamiast blue przy historycznym reading/spelling. Baseline 71/71; po poprawce 81/81; po poprawkach z review 86/86, uruchomione i potwierdzone również przez agenta głównego.
- Review: cztery warstwy, 13 zapisanych ustaleń. Zastosowano dwie grupy poprawek: medium (pokrycie mastery z mikrofonem) i low (połączenie niewykonalnego celu z rezerwacją). Odrzucono trzy ustalenia: zarzut nieuzgodnionego introductionPlan (plan wymaga wspólnego kontekstu), uwagę wymagającą edycji spec (reguła workflow), oraz opis defensywnego odczytania intencji (brak niezgodności).
- Dwa wcześniejsze problemy zachowano do osobnej analizy: pomijanie wykonalnej łatwej przerwy i alias kolidujący z rezerwacją. Nie są naprawione w tej zmianie. Osobny deferred zapisuje brak dowodu z instancji i urządzenia.
- Matrix audit: wszystkie sześć scenariuszy ma wykonane, zielone testy; dodatkowo sprawdzono fallback i aktywne skills z mikrofonem.
- Weryfikacja: trzy wskazane pliki 86/86, pełny `corepack pnpm typecheck` exit 0, `git diff --check` exit 0, poprawna lista deferred po parsowaniu YAML (3 elementy).
- `followup_review_recommended: false`: jedna grupa medium i jedna low; brak high. Żaden test urządzenia, E2E ani integracyjny PostgreSQL nie był uruchamiany. Nie potwierdzono, że odtworzone przypadki odpowiadają konkretnej obserwowanej sesji dziecka.
- Zakres bazuje na `ced8cf420e2919d67cd45b60f95a11cd1dfa20ed`; znane lokalne origin/main jest jeden commit dalej (`4a45714778b48d23eb1027afffa7fb5015e837e1`, zmiana siatki i limitu opcji picture), bez zmiany schedulera. Nie scalano tej zmiany w trakcie pracy.
- API/MCP/skill bez zmian; nie wykonano push, merge ani wdrożenia.
