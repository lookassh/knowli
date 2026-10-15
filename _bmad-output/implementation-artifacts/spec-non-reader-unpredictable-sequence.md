---
title: 'Nieprzewidywalna kolejność pytań obrazkowych'
type: bugfix
created: '2026-10-15'
status: done
baseline_revision: 4440234c587f8df59d78d85b4a33fbd5feb16ba2
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/AGENTS.md']
warnings: [oversized]
deferred:
  - summary: >-
      Brak obserwacji zachowania dzieci po zmianie i pełnego audytu wskazówek w interfejsie.
    evidence: |-
      Testy potwierdzają zmienny wybór zadania, rzeczywisty nextTask, historię, budżet i niezmienność issued. Odpowiedzi integracyjne korzystają z prywatnego klucza wyłącznie w teście. Nie stanowią dowodu, że dziecko rozpoznaje słowa ani że nie znajdzie innej wskazówki w UI. Nie przeprowadzono próby na urządzeniu dzieci.
    severity: low
---

<intent-contract>

## Intent

**Problem:** Dzieci właściciela po pierwszym podejściu nauczyły się schematu „pokazanie A → pokazanie B → pytanie A → pokazanie C → pytanie B” i odpowiadały według kolejności. Poprzedni commit 4440234 poprawia inne usterki, lecz nadal pozostawia tę kolejkę FIFO i deterministyczne rundy utrwalania.

**Approach:** Dla `picture` i `canRead=false` losować wybór wykonalnego pytania spośród już wprowadzonych słów oraz przeplatanie pytań z nowymi prezentacjami. Zachować małe porcje, uczciwą rotację i wyższe priorytety pedagogiczne. Dowodem ma być również wielokrokowy przebieg i rzeczywisty serwerowy nextTask, nie wyłącznie pojedynczy helper.

## Boundaries & Constraints

**Always:** Należne sprawdzenia, wsparcie, retry, należne powtórki i wprowadzanie etapów zachowują wyższe priorytety. Cel pytania musi mieć wcześniej zakończoną własną prezentację lub być materiałem już rozpoczętym. Rezerwacje i bezpieczne opcje obowiązują. Co najwyżej trzy nowe słowa oczekują pierwszego rozpoznawania; bootstrap dwóch słów, jeśli istnieją. Losowanie wyłącznie dopuszczalnych planów; żadnego null z powodu pierwszego niewykonalnego celu. Wydany prompt i klucz pozostają niezmienne przy retry, reload i drugim kliencie. Budżet ocenianych pytań pozostaje skończony.

**Never:** Stałe „zawsze ostatnie”, „zawsze przedostatnie”, wymuszone naprzemienne pytania przy dwóch słowach, losowanie całej talii przed poznaniem materiału, brak kontroli obciążenia. Bez zmian historii, DTO, endpointów, schematów bazy, MCP i skilla konsumenta. Nie zmieniać reguł dziecka czytającego ani standardowego zestawu. Bez push, merge i wdrożenia.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Dwa oczekujące słowa i dalszy materiał | Ta sama migawka, różna kontrolowana entropia | Możliwe pytanie o różne poznane słowa lub trzecia prezentacja | Nie odpytuje nieprzedstawionego celu |
| Trzy oczekujące słowa | Dalszy nieznany materiał istnieje | Pytanie, bez czwartej nowej prezentacji | Niewykonalne cele omija, zachowuje bezpieczny fallback |
| Starsze słowo i nowe prezentacje | Część słów ćwiczona, część po pierwszej prezentacji | Pula obejmuje ostatnie, przedostatnie i starsze poznane słowa w dopuszczalnym priorytecie/oknie użycia | Brak wymuszonego FIFO |
| Znany zestaw | Brak nowego materiału, różna entropia | Różne kolejności w obrębie priorytetu i ograniczonej różnicy użyć | Rezerwacje i mastery zachowane |
| Granice | Singleton, brak bezpiecznych opcji, budżet 0 | Dotychczasowy fallback lub null, bez fikcyjnego sukcesu i bez pętli | Czytelna istniejąca ścieżka końca |
| Wyższe priorytety i czytający | Należne zadanie/wsparcie lub canRead=true | Dotychczasowe pierwszeństwo i zachowanie | Losowanie go nie przesuwa |
| Rzeczywisty nextTask | Kontrolowana entropia, ukończone prezentacje i odpowiedzi w PostgreSQL | Różne dopuszczalne pytania; ponowny i współbieżny odczyt issued zwraca identyczne ID/prompt | Losowanie tylko przy tworzeniu nowego zadania |

</intent-contract>

## Code Map

- `packages/server/src/domain/scheduler.ts` — `selectTask` §4 bierze fresh[0]; `practicePool` porządkuje po użyciu i pozycji. Zachować poprawki z 4440234. Nowa ścieżka tylko picture+nieczytający po wyższych priorytetach.
- `packages/server/src/modules/sessions.ts` — `planNextTask` wywołuje selectTask około 749; `nextTask` wcześniej zwraca istniejące issued pod blokadą sesji. Tutaj dostarczyć prawdziwą entropię do planowania; prywatna opcja `selectionSeed?: number` w ScheduleInput pozwala zachować deterministyczną domenę i kontrolowane testy. Produkcyjny boundary musi zawsze dostarczyć świeżą entropię, np. node:crypto randomInt.
- `packages/server/src/domain/scheduler.test.ts` — helpery candidate/peer/input i istniejące regresje; osobny plik testów sekwencji dozwolony dla czytelności.
- `tests/integration/picture-vocabulary.test.ts` — fixture nieczytającego, katalog polskiego audio, fake generation, przygotowanie i publikacja zestawu, nextTask/completePresentation/submitAttempt. Przygotować deterministyczne sterowanie produkcyjnym źródłem entropii, np. częściowy mock node:crypto, pozostawiając UUID bez zmian.
- `packages/server/src/modules/sessions.test.ts` — poprzednie testy tasowania i klucza pozostają.
- `docs/SPEC.md` §13, `docs/architecture.md` §9.3 — wymagają zapisania wyjątku od deterministycznej kolejności: priorytety stałe, wybór w dopuszczalnej puli losowany.

## Tasks & Acceptance

**Execution:**
- `packages/server/src/domain/scheduler.test.ts` lub nowy test obok — obserwować RED dla opisanego FIFO; testować identyczny stan z różną entropią i wielokrokową symulację 6–8 słów, aktualizując zakończone prezentacje, użycia, mix i ordinal. Pokryć macierz, mikrofon on/off i poprzednie regresje.
- `packages/server/src/domain/scheduler.ts` — prywatna kontrolowana entropia, wybór wykonalnych planów, ograniczenie oczekujących prezentacji do trzech. Pula pytań obejmuje również wcześniej ćwiczone słowa. Randomizacja w pierwszym dostępnym priorytecie mastery i oknie liczby pytań (usedThisSession minus presentationsThisSession, minimum+1); dopuszczenie powtórzenia ostatniego słowa zapobiega wymuszonej alternacji. Liczyć minimum po odrzuceniu niewykonalnych planów. Singletony i niemożliwe rozpoznawanie zachowują bezpieczny fallback, bez dokładania nieznanego materiału ponad limit.
- `packages/server/src/modules/sessions.ts` — przekazać entropię z realnego źródła przy planowaniu; nie losować ponownie już wydanego zadania.
- `tests/integration/picture-vocabulary.test.ts` — kontrolowane przypadki przez prawdziwy nextTask, skończony przebieg z kilkoma poznanymi słowami, powtórny/współbieżny odczyt i budżet.
- `docs/SPEC.md`, `docs/architecture.md` — zwięźle opisać nową regułę bez gwarancji, że krótkie losowe sekwencje nigdy się nie powtórzą.

**Acceptance Criteria:**
- Given dwa lub więcej dopuszczalnych poznanych słów, when entropia się zmienia, then pytanie nie jest stale wyznaczane kolejnością prezentacji ani najstarszą pozycją.
- Given rozpoczęta nauka 6–8 słów, when symulacja wykonuje kilkanaście kolejnych kroków, then pytania dotyczą poznanych celów, nie tworzą stałego opóźnienia o jedno słowo i nie przekraczają trzech oczekujących prezentacji ani budżetu.
- Given issued task w rzeczywistym serwerze, when klient ponawia lub dwóch klientów czyta nextTask, then identyczne ID, prompt, opcje i klucz pozostają zachowane.

## Spec Change Log

## Review Triage Log

### 2026-10-15 — Review pass

- verdicts: 7 findings — high 0, medium 1, low 5, false 1, maybe-false 0
- Edge-case hunter: 0 findings. Verification-gap: 0 findings. Blind: 6 findings. Intent: 1 ograniczenie dowodu.
- findings:
  - `[medium]` `[patch]` Blind: losowanie może wybrać cel waiting tuż po prezentacji wsparcia — w nowej puli nie było warunku przerwy, a liczba pytań odejmuje prezentacje. Odtworzono RED dla runtime i legacy, dodano filtr odstępu; dwa testy potwierdzają przerwę i nadrzędny retry.
  - `[low]` `[patch]` Blind: symulacja z mikrofonem nie wprowadzała etapów — dodano udany kontrolowany przebieg z introducedSkills=false i przejściami recall/speech.
  - `[low]` `[patch]` Blind: współbieżność obejmowała tylko już issued — dodano równoległe pierwsze utworzenie zadania oraz asercję jednego zapisu i jednego pobrania entropii; PostgreSQL GREEN.
  - `[false]` `[reject]` Blind: sesja sześciu słów musi odpytać wszystkie sześć w dwunastu zadaniach — losowanie w ograniczonej sesji nie obiecuje pełnego pokrycia każdej talii; test rzeczywistego serwera uzupełnia osobną wielokrokową symulację 8 słów z pokryciem minimum 6. Żądana silniejsza gwarancja nie wynika z celu ani z kontraktu.
  - `[low]` `[patch]` Blind: brak różnych seedów dla wszystkich nadrzędnych reguł — dodano kontrolowane seedy dla due recall/listening/pronunciation, retry i rezerwacji przy mikrofonie; testy GREEN.
  - `[low]` `[patch]` Blind: brak bezpośredniej asercji starego opóźnienia — dodano trzy stałe strumienie entropii z historią prezentacji i pytań oraz jawny wybór ostatniego, przedostatniego i starszego ćwiczonego celu.
  - `[low]` `[defer]` Intent: serwerowe testy nie dowodzą rozpoznawania słów przez dziecko lub braku innych schematów UI — zapisano ograniczenie w deferred i końcowym raporcie; nie deklarujemy takiej walidacji.

## Verification

- `corepack pnpm test:unit packages/server/src/domain/scheduler.test.ts packages/server/src/domain/picture-recognition-options.test.ts packages/server/src/modules/sessions.test.ts` oraz każdy nowy plik sekwencji — zielone regresje i symulacja; baseline poprzedniej zmiany 86/86.
- `corepack pnpm test:integration tests/integration/picture-vocabulary.test.ts tests/integration/sessions.test.ts` — prawdziwy PostgreSQL; Docker jest dostępny (29.8.2).
- `corepack pnpm typecheck` — exit 0.
- `git diff --check` — exit 0.

## Design Notes

API → MCP → skill: bez zmiany publicznych parametrów, DTO, autoryzacji, raportów, ocen ani definicji samodzielności. Zmiana dotyczy wyłącznie wewnętrznej kolejności dopuszczalnych zadań. Testy nie zastępują obserwacji zachowania dzieci na urządzeniu. Nie obiecywać kryptograficznej nieodgadywalności ani braku przypadkowych powtórzeń.

## Auto Run Result

Status: done.

- Usunięto wymuszoną kolejkę FIFO dla picture+canRead=false: losowana jest jedna pozycja z wykonalnych pytań o poznane słowa i dopuszczalnej następnej prezentacji. Nie powstaje stałe powiązanie pytania z ostatnią lub przedostatnią prezentacją. Dopuszczalne są naturalne przypadkowe powtórzenia.
- Zachowano bootstrap dwóch słów, limit trzech oczekujących prezentacji, wyższe priorytety i rezerwacje, fair rotation minimum+1 oraz budżet. Losowanie nie omija przerwy po wsparciu. Przy trzech niewykonalnych celach i zużytych fallbackach planowanie kończy się bez dokładania czwartego słowa.
- Pliki: `packages/server/src/domain/scheduler.ts` (wewnętrzna pula i ograniczenia), `packages/server/src/modules/sessions.ts` (świeża entropia), `packages/server/src/domain/scheduler-sequence.test.ts` (nowe przebiegi i granice), `tests/integration/picture-vocabulary.test.ts` (rzeczywisty nextTask i współbieżność), `docs/SPEC.md` oraz `docs/architecture.md` (kontrakt pedagogiczny), ten dokument (plan/review/wynik).
- RED przed zmianą: identyczna migawka przy seedach 0/1/2 dawała zawsze rev-0 zamiast różnych pytań/prezentacji; cztery nowe testy nie przechodziły. Dodatkowy RED z review: runtime i legacy wybierały rev-0 przed wymaganym odstępem po wsparciu.
- Baseline 86/86. Pierwsza implementacja 95/95. Końcowe jednostkowe 106/106 w czterech plikach, integracyjne 49/49 w dwóch plikach na prawdziwym PostgreSQL. Oba zestawy uruchomił również agent główny po poprawkach review. Pełny typecheck exit 0, diff check exit 0.
- Review: cztery warstwy; siedem ustaleń, pięć poprawek (jedna medium, cztery low), jedno odrzucone (brak wymagania odpytywania całej talii w każdej losowej porcji), jedno deferred (walidacja na dzieciach/urządzeniu). Szczegóły i dowody zachowano w triage.
- Matrix audit: wszystkie siedem scenariuszy ma wykonane zielone pokrycie, w tym cel już pokazany, losowanie w tej samej migawce, stare i nowe słowa, limit, singleton/fallback, budżet, wyższe priorytety i realne tworzenie issued przez dwóch klientów.
- Follow-up review recommendation: false; poprawiono jedną grupę medium i cztery low, brak high. Brak dodatkowego niezweryfikowanego ryzyka wprowadzonych poprawek poza opisaną obserwacją zachowania dzieci.
- Nie wykonano E2E ani fizycznej próby na urządzeniu. Testy integracyjne weryfikują kontrakt serwera i celowo używają prywatnego klucza wyłącznie do fikcyjnych odpowiedzi; nie deklarują rozpoznawania słów przez dziecko.
- API → MCP → skill bez zmiany zgodnie z Design Notes. Nie wykonano push, merge ani wdrożenia.
