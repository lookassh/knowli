---
title: 'Losowanie zestawu obrazkowego niezależnie od flagi czytania'
type: bugfix
created: '2026-10-15'
status: done
baseline_revision: a3ff68c24f9824bfd4c178c274c484dada2eb051
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/AGENTS.md']
warnings: [oversized]
deferred:
  - summary: >-
      Zachowanie poprawki na urządzeniu i działającej instancji wymaga weryfikacji po wdrożeniu.
    evidence: |-
      Odczytano rzeczywistą konfigurację i stan wdrożenia, a testy odtwarzają przypadek serwerowo na PostgreSQL. Nie zmieniano instancji ani nie obserwowano renderowanych kart po nowej poprawce. Krótkie sekwencje mogą się przypadkowo powtarzać.
    severity: low
---

<intent-contract>

## Intent

**Problem:** Po scaleniu PR #73 właściciel nadal obserwuje liczby „prezentacja 5 → pytanie 4 → prezentacja 6 → pytanie 5”. Potwierdzono dokładny wzorzec przez rzeczywisty selectTask i projectProgress dla 21 elementów picture przy canRead=true. Odczyt Kid API instancji pokazał zestaw „Liczby” w formacie picture przypisany profilowi z canRead=true. Poprzedni helper jest wywoływany tylko przy canRead=false i dlatego nie obsługuje tego przypadku.

**Approach:** Bezpieczne losowanie poznanych celów i przeplatania prezentacji obowiązuje każdy zestaw picture. Flaga czytania nadal określa dostępne ćwiczenia i umiejętności, ale nie decyduje o odporności kolejności pytań na odgadywanie. Zachować dotychczasowe możliwości profilu czytającego.

## Boundaries & Constraints

**Always:** Zachować poprawki i limit trzech oczekujących słów z PR #73, losowanie jedynie poznanych i wykonalnych celów, okno minimum+1, budżet, rezerwacje, przerwę po wsparciu i wyższe priorytety. Profil czytający zachowuje listening, reading w obu kierunkach, recall/pisownię oraz pronunciation zgodnie z mikrofonem; nie sprowadzać go do samego słuchania. Każda sesja nadal używa przypiętej flagi i formatu. Issued jest niezmienne przy ponowieniu i współbieżnym odczycie.

**Never:** Wymuszać zmiany flagi dziecka jako obejścia, edytować profilu lub sesji produkcyjnej, zmieniać historii, kontraktów API/DTO, MCP, schematu bazy i zakresu dozwolonych liczb. Nie zmieniać algorytmu zestawów standard ani wyższych priorytetów w tym zadaniu. Nie gwarantować, że losowa krótka sekwencja nigdy się przypadkiem nie powtórzy. Bez wdrożenia i merge.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Zgłoszone liczby | 21 elementów 0–20, picture, canRead=true, nowa sesja | Różne dopuszczalne cele i prezentacje dla tych samych poznanych słów przy różnych seedach; brak wymuszonego FIFO 5→4,6→5 | Zero jako image, bo number.count obecnie zaczyna się od 1; bez zmiany walidacji |
| Profil nieczytający | picture, canRead=false, mikrofon on/off | Zachowanie PR #73 i bez tekstowych ćwiczeń | Brak regresji |
| Czytanie po rozpoznawaniu | picture, canRead=true, poznany materiał | Zachowana rotacja słuchania i obu kierunków reading, mastery uwzględnia właściwe skills | Nie zastępuje wszystkiego listening |
| Wyższe priorytety i granice | Należne sprawdzenie, wsparcie/retry, rezerwacja, singleton/brak opcji, budżet 0 | Dotychczasowe reguły przed losowaniem lub bezpieczny fallback/null | Bez ujawnienia rezerwacji i fikcyjnego sukcesu |
| Standard i wznowienie | Standard reader albo istniejące issued picture | Standard bez zmiany; issued ma identyczny prompt i klucz | Flaga sesji nie jest przepisywana |

</intent-contract>

## Code Map

- `packages/server/src/domain/scheduler.ts` — nonReaderPicturePlan i warunek picture&&canRead=false około 804. Helper zawsze wybiera listening i mastery według canRead=false; samo poszerzenie if byłoby regresją reading. Uogólnić nazwę i użyć capabilities bieżącego input.
- `packages/server/src/domain/scheduler.ts` — recognitionPlan, chooseReadingDirection, recognitionTaskPlan: reużyć dotychczasowy wybór kierunku dla czytającego; new-practice zaczyna od słuchu, filler/extra zachowują miks. Priorytety przed helperem pozostają bez zmian.
- `packages/server/src/domain/scheduler-sequence.test.ts` — istniejący test równości czytającego przy seedach wymaga zawężenia do standard; dodać jawne nowe zachowanie picture przy obu flagach. Poprzednie regresje zachować.
- `packages/server/src/domain/progress.ts` — projectProgress jako autorytatywna projekcja odpowiedzi w symulacji liczb; nie wpisywać stale sztucznego nextReviewAt=null bez związku z historią.
- `tests/integration/picture-vocabulary.test.ts` — kontrolowana entropia, fake generation/media, publikacja, nextTask i próby na PostgreSQL; rozszerzyć na picture z canRead=true, liczby 0–20 i obie flagi. Pozostawić UUID nienaruszone w mocku crypto.
- `packages/server/src/modules/sessions.ts` — produkcyjna entropia jest już przekazywana. Ustawienia canRead i vocabularyFormat są snapshotem sesji. Nie wymagają zmian ani ręcznych operacji produkcyjnych.
- `docs/SPEC.md` §13 oraz `docs/architecture.md` §9.3 — zastąpić ograniczenie losowania do nieczytającego regułą dla wszystkich picture; wyjaśnić niezależną rolę flagi czytania.

## Tasks & Acceptance

**Execution:**
- `packages/server/src/domain/scheduler-sequence.test.ts` lub nowy plik obok — rzeczywisty RED dla canRead=true,picture i liczb 0–20. Symulować zakończone prezentacje, użycia, kierunki, ocenę i projekcję oraz ograniczony budżet. Dla kilku kontrolowanych strumieni seeda wykazać brak stałego FIFO. Zachować test standard-reader bez zmiany.
- `packages/server/src/domain/scheduler.ts` — uogólnić helper na picture obu profili, zachowując capabilities, mastery, reading/listening mix i wszystkie ochrony PR #73.
- `tests/integration/picture-vocabulary.test.ts` — przez rzeczywisty nextTask i PostgreSQL potwierdzić różne decyzje dla picture+canRead=true oraz rozpoznawanie liczb na skończonym przebiegu. Potwierdzić niezmienność issued i brak potrzeby przestawienia profilu.
- `docs/SPEC.md`, `docs/architecture.md` — aktualna reguła dla wszystkich picture i bez zmiany kontraktu API/MCP.

**Acceptance Criteria:**
- Given picture i canRead=true, when produkcyjny serwer planuje naukę liczb przy różnej kontrolowanej entropii, then nie omija losowania i nie wymusza pytania o przedostatnią prezentację.
- Given czytający profil i poznany materiał picture, when następują kolejne ćwiczenia, then nadal dostępne są słuch, oba kierunki czytania i późniejsze etapy zgodnie z polityką.
- Given poprzednie regresje nieczytającego i standard-reader, when uruchomiono weryfikację, then pozostają zgodne; issued i historia zachowane.

## Spec Change Log

## Review Triage Log

### 2026-10-15 — Review pass

- verdicts: 9 findings — high 0, medium 0, low 3, false 6, maybe-false 0
- Edge-case i verification-gap: po 0 ustaleń. Blind: 7 uwag. Intent: interpretacja oraz ograniczenie dowodu.
- findings:
  - `[false]` `[reject]` Blind: null lastExposureAt w symulacji błędnie tworzy samodzielne listening/reading — rzeczywiste attempts.ts ustawia lastExposureAt wyłącznie dla RECALL_LIKE, a dla rozpoznawania null; symulacja odtwarza tę samą kwalifikację. Nie zmieniać oceny testu na sprzeczną z runtime.
  - `[false]` `[reject]` Blind: introducedSkills=true w izolowanej symulacji pomija zachowanie etapów — ten test celowo bada długi miks czytania; osobne nowe parametryzowane testy sprawdzają recall+spelling i speech, a integracja fresh-reader dochodzi do recall. Wymagane zachowanie ma niezależne pokrycie.
  - `[low]` `[patch]` Blind: wczesne zerwanie FIFO nie zabezpiecza późniejszych przejść 5→4/6→5 — porównano pełne ślady kilku seedów i ich dalszą część; dodano późną migawkę liczb, w której seedy wybierają 4/5/6 i starsze ćwiczone cele. Zielone.
  - `[low]` `[patch]` Blind: integracja czytającego nie materializowała obu kierunków reading — dodano dwie rzeczywiste sesje i started-material przebieg reading/reverse_recognition z weryfikacją publicznego promptu, zapisanego kierunku oraz oceny. Zielone na PostgreSQL.
  - `[false]` `[reject]` Blind: brak ochrony rezerwacji i odstępu w nowej gałęzi czytającego — filtry known/feasible i rezerwacje działają przed wyborem typu ćwiczenia, ich kod nie został usunięty. Istniejące testy schedulera pokrywają reading i reverse options oraz support; nowy warunek nie obchodzi tych filtrów.
  - `[false]` `[reject]` Blind: mastery powinno wykluczać pronunciation bez mikrofonu — getVocabularyCapabilities dla czytającego zwraca READER ze wszystkimi pięcioma skills, tak samo jak poprzedni ranking. Wymaganie zachowania capabilities nie uprawnia do zmiany tej reguły. Istniejący test picture mixed mastery obejmuje historyczne reading/spelling czytającego.
  - `[false]` `[reject]` Blind: sprawdzenie niezmienionej flagi profilu nie dowodzi snapshotu sesji — nowy test dowodzi braku wymaganego obejścia przez zmianę profilu; snapshot nie jest zmieniany w tym diffie. Dotychczasowe testy sessions/contextOf/start-resume osobno potwierdzają przypięcie canRead i zachowanie aktywnej sesji po zmianie profilu.
  - `[false]` `[reject]` Intent: możliwe oczekiwanie pytania zawsze o ostatnie słowo — wcześniejszy bezpośredni opis właściciela wskazuje odgadywanie schematu i odrzuca stałą kolejność. Kontynuacja ma usuwać przewidywalność, nie tworzyć nowy schemat ostatniego słowa.
  - `[low]` `[defer]` Intent: testy serwera nie dowodzą zmiany widocznej na urządzeniu — ograniczenie jawnie zapisano; nie wykonano wdrożenia ani fizycznej próby po poprawce.

## Verification

- `corepack pnpm test:unit packages/server/src/domain/scheduler.test.ts packages/server/src/domain/scheduler-sequence.test.ts packages/server/src/domain/picture-recognition-options.test.ts packages/server/src/modules/sessions.test.ts` oraz nowe pliki — GREEN po zaobserwowanym RED.
- `corepack pnpm test:integration tests/integration/picture-vocabulary.test.ts tests/integration/sessions.test.ts` — prawdziwy PostgreSQL, bez równoległych niezależnych uruchomień global setup.
- `corepack pnpm typecheck` i `git diff --check` — exit 0.

## Design Notes

Odczyt Coolify: ostatnie wdrożenie dla lookassh/knowli jest finished, commit a3ff68c24f9824bfd4c178c274c484dada2eb051, zakończone 2026-10-15 17:55:51 UTC. Odczyt publicznego Kid API potwierdził format picture i canRead=true profilu z zestawem Liczby. Nie pobierano odpowiedzi, nagrań ani danych logowania; nie zmieniano nic na instancji. Do raportu nie zapisywać imion i identyfikatorów dzieci.

API → MCP → skill pozostają bez zmian: wewnętrzna kolejność istniejących zadań, bez zmiany pól, znaczenia ocen/raportów, prywatności, parametrów lub autoryzacji. Wdrożenie przyszłej poprawki wymaga osobnej autoryzacji. Nie deklarować gotowej poprawki na instancji na podstawie lokalnych testów.

## Auto Run Result

Status: done.

- Potwierdzona przyczyna: PR #73 uruchamiał losowanie tylko dla picture+canRead=false. Rzeczywista konfiguracja zestawu Liczby używa picture+canRead=true; odczyt wykonano bez zmieniania profilu, sesji i materiału.
- Poprawka: helper picturePracticePlan i jego wywołanie obejmują wszystkie picture; capabilities i miks recognitionPlan zachowują dotychczasowe ćwiczenia czytającego. Standard, wcześniejsze priorytety, rezerwacje, wsparcie, budżet i niezmienność issued zachowane.
- Pliki: `packages/server/src/domain/scheduler.ts` (warunek/helper/capabilities/miks), `scheduler-picture-reader.test.ts` (nowa regresja 0–20 i pełne ślady), `scheduler-sequence.test.ts` (niezmienność standard), `tests/integration/picture-vocabulary.test.ts` (obie flagi, liczby, started-material), `tests/integration/sessions.test.ts` (dopuszczalna trzecia prezentacja), `docs/SPEC.md`, `docs/architecture.md` oraz ten raport.
- RED: nowy plik początkowo 4 błędy na 5 testów — trzy seedy dawały rev-0 oraz trzy przebiegi liczb odtwarzały FIFO. Po poprawce 117/117 jednostkowych, a po wzmocnieniu porównań ślady seedów połączono w jedną wspólną asercję: końcowe 116/116 w pięciu plikach.
- Integracja: końcowe 51/51 w dwóch plikach na prawdziwym PostgreSQL. Test started-material zapisuje historię przez nextTask/completePresentation/submitAttempt, następnie w drugiej sesji osiąga oba kierunki reading i potwierdza prompt, kierunek i ocenę.
- Agent główny uruchomił pełen wskazany zakres po poprawkach review: 116/116 unit, 51/51 integration, pełny typecheck exit 0, diff check exit 0. Matrix audit: wszystkie pięć wierszy ma wykonane zielone pokrycie.
- Review: cztery niezależne perspektywy, dziewięć zapisanych ustaleń; zastosowano dwie poprawki testów low, sześć uwag odrzucono na podstawie wskazanego kodu/runtime, jedno ograniczenie wdrożenia/urządzenia deferred. Brak high/medium; followup_review_recommended=false.
- Początkowy baseline test ujawnił brak dowiązania sharp dodanego w świeżym main. Pakiet 0.35.5 był już poprawnie obecny w store pnpm; odtworzono wyłącznie brakujące lokalne dowiązanie, bez instalacji i zmiany manifestu/lockfile. Baseline po naprawie 106/106.
- API → MCP → skill bez zmian jak wyżej; wdrożenie wymaga aktualizacji procesu web, bez migracji i zmian po stronie konsumenta. Istniejące issued pozostają niezmienne; nowe zadania picture korzystają z poprawki również w trwających sesjach.
- Bez E2E, fizycznej próby i wdrożenia po poprawce. Dowód z działającej instancji dotyczy rozpoznania przyczyny, a nie potwierdzenia wdrożenia tej nowej zmiany.
