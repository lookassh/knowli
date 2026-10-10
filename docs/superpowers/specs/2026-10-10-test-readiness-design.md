# #30 — Przygotowanie do sprawdzianu: projekt i proponowany plan etapów

**Status:** projekt i plan etapów zaakceptowane przez właściciela 2026-10-10 z korektą: liczba zadań jest konfigurowalna. Szczegółowy plan wykonawczy: `../plans/2026-10-10-test-readiness.md`; czeka na review przed implementacją. Bez zmian implementacyjnych.

**Źródło:** https://github.com/lookassh/knowli/issues/30

**Stan odniesienia:** 2026-10-10, `e2db65104842e417e4d422dbc29a8044156a3f9b`; czysty worktree `e035/knowli`, detached HEAD. Zgłoszenie przypisano do `lookassh`. Przejrzano SPEC, architekturę, projekt SQL, granice katalogów, plan MVP i aktualne miejsca implementacji. Brak `node_modules` w tym worktree; nie uruchamiano testów aplikacji.

## 1. Cel i zakres

Rodzic określa dla dziecka cel i termin sprawdzianu. Dziecko wykonuje krótką, skończoną próbną kartkówkę z poznanego i zatwierdzonego materiału. Raport wskazuje wynik tej próby, materiał bez wiarygodnego sprawdzenia oraz osobno opanowanie potwierdzone po przerwie. Nie przewiduje szkolnej oceny.

Pierwsza wersja obejmuje cele `recall`, `spelling`, `listening`. Recall i pisownię sprawdza jedna odpowiedź pisemna na polskie znaczenie; słuchanie korzysta z istniejącego zadania audio → polskie znaczenie. Gdy wybrano tylko jeden cel pisemny, raport prezentuje wybrany cel; istniejące ocenianie może nadal zapisać oba dowody. Domyślny cel przy jego pierwszym włączeniu to Recall + pisownia.

Poza zakresem: nowe zadania zdań, dyktando, odpowiedzi nagrywane w kartkówce, wydruki, ogólny redesign raportów, konfigurator długości zwykłych sesji, CEFR, OCR, wykrywanie oszustw. Zgłoszenia #10, #13, #18, #27 i #29 nie blokują tej wersji.

## 2. Co już istnieje i co trzeba zmienić

- `assignments.testDate` jest osobny dla dziecka i zestawu; `upsertAssignment` zapisuje termin, ale nie ma celu sprawdzianu.
- `startSession` przypina wersję zestawu, politykę, termin, strefę i kontakt z poprzednich sesji. Obowiązuje jedna aktywna sesja na dziecko, budżet 12 zadań, limit 10 minut i okno wznowienia 30 minut.
- `test-preparation.ts` i `scheduler.ts` realizują trening w oknie 48 godzin. To nadal trening z feedbackiem i wsparciem.
- `evaluateWritten` zapisuje osobne wyniki Recall i pisowni; `Monday`/`monday` mogą mieć różną ocenę pisowni przy poprawnym Recall. Nie trzeba tworzyć nowego algorytmu oceniania.
- `finalizeAttemptRow`, `startAttempt`, `readAttempt` i ponowna finalizacja potrafią ujawniać feedback. Samo ukrycie okna w UI nie wystarczy.
- `contextOf` rekonstruuje wybrane pola kontekstu; dodanie nowych danych wymaga ich zachowania we wszystkich aktualizacjach.
- `session-summary.ts` liczy sukcesy i trudności, ale nie zna pełnego wymaganego zakresu, pominięć ani slotów, których nie wydano.

## 3. Warianty rozwiązania

1. **Rekomendowany: osobny tryb istniejącej sesji.** Wspólna historia, blokady, zadania i oceny; dedykowany plan kartkówki, polityka odpowiedzi i raport. Najmniejsza zmiana, która chroni wiarygodność wyników.
2. **Flaga w zwykłym schedulerze.** Mniej kodu początkowo, ale trening nadal dobiera wsparcie, łatwiejsze zadania i natychmiastowy feedback. Trudniej zagwarantować zamrożony zakres. Odrzucony.
3. **Osobny podsystem egzaminów z własnymi próbami.** Czytelna izolacja, lecz duplikuje historię, kwalifikację samodzielności i projekcje. Zbyt duży koszt dla tego zakresu.

## 4. Przebieg produktu — propozycja

### Rodzic

Przy przypisaniu zestawu wybiera cel, liczbę zadań oraz opcjonalny termin. Liczba jest osobna dla dziecka i zestawu. Data pozostaje lokalną datą rodziny, cel należy do przypisania. Brak terminu nie blokuje próbnej kartkówki. Przy starym przypisaniu cel pozostaje pusty do jego jawnego ustawienia; migracja nie uruchamia nowej funkcji automatycznie.

Raport kartkówki jest dostępny z istniejącego panelu postępów. Wybór dotyczy konkretnej próby, a jego nagłówek wskazuje wersję materiału, cele, datę próby i pełny wymagany zakres. Po publikacji nowej wersji stary wynik nadal opisuje starą wersję.

### Dziecko

Po wybraniu zestawu wybiera „Ćwicz” albo „Próbna kartkówka”, jeżeli rodzic ustawił cel. Przed startem widzi liczbę zadań i informację „Odpowiedzi omówimy na końcu”. Kartkówka pisemna działa bez mikrofonu.

Każdy slot przyjmuje jedną zatwierdzoną odpowiedź, „Nie pamiętam” albo „Pomiń”. Przed wysłaniem dziecko może poprawić tekst. Po zapisie widzi neutralne potwierdzenie „Zapisano odpowiedź”, bez informacji o poprawności. „Nie pamiętam” nie zawiera obietnicy „pokaż”; rozwiązanie będzie w omówieniu. Nie ma podpowiedzi, fragmentów, wsparcia, drugiej merytorycznej próby ani losowania dodatkowego zadania po błędzie.

Utrata sieci zachowuje ten sam identyfikator próby. Nieudany transport nie kończy slotu i nie staje się błędem wiedzy. Przy prawidłowo zapisanej, lecz nieocenionej odpowiedzi slot kończy się jako nieoceniony.

Wyjście z ekranu bez jawnego zakończenia pozwala wznowić tę samą próbę w istniejącym oknie 30 minut. „Zakończ teraz”, przekroczenie limitu 10 minut albo wygaśnięcie okna wznowienia zamykają ją jako niepełną. Dotychczasowe wyniki zostają, niewykonane sloty są niesprawdzone. Jawne zakończenie otwiera omówienie; zamkniętej próby nie da się wznowić.

## 5. Zakres i plan zadaniowy

**Korekta właściciela:** liczba zadań jest konfigurowalna. Rodzic ustawia `mockTestTaskCount` przy przypisaniu dziecka do zestawu. Przyjmujemy jako szczegół wykonawczy liczbę całkowitą **1–100**, domyślnie **10**; 100 umożliwia sprawdzenie obu rodzajów zadań dla maksymalnie 50 elementów zestawu. Nie ma stałego limitu porcji 10. Ustawienie dotyczy wszystkich rodzajów zadań łącznie; jedna odpowiedź oceniana dla Recall i pisowni zajmuje jeden slot.

Start kopiuje żądaną liczbę do niezmiennego planu. Faktyczny budżet wynosi minimum z tej liczby i dostępnych bezpiecznych slotów; dziecko widzi tę faktyczną liczbę. Zmiana ustawienia działa od następnej nowej kartkówki, bez wpływu na aktywną próbę lub wznowienie. Dotychczasowy limit czasu 10 minut pozostaje; większa porcja może zakończyć się niepełnym raportem, co formularz rodzica wyjaśnia. Nie przedłużamy czasu ani porcji automatycznie.

Pełny wymagany zakres to wszystkie elementy przypiętej opublikowanej wersji × wybrane umiejętności. Krótka porcja nie zmniejsza mianownika raportu.

Plan powstaje raz przy starcie. Kandydat musi mieć wcześniejszy zamknięty kontakt ujawniający cel dla tego dziecka. Nowa wersja zmieniająca znaczenie wymaga kontaktu z nowym znaczeniem; kontakt ze starym słowem nie wystarcza. Niepoznane elementy zostają niesprawdzone i nie są wprowadzane podczas kartkówki.

Najpierw wybieramy elementy bez wiarygodnego sprawdzenia danej umiejętności, potem wymagające ćwiczeń/ponownego potwierdzenia, potem pozostałe. Remisy rozstrzyga pozycja w talii i stabilny identyfikator. Z kilku celów tworzymy pulę rodzajów: pisemny i słuchowy. Dla ustawienia N i obu rodzajów przydzielamy początkowo do `ceil(N/2)` slotów pisemnych i do `floor(N/2)` słuchowych; niewykorzystane miejsca uzupełnia drugi rodzaj, bez przekroczenia N. Przy jednym rodzaju dostępnych jest do N slotów. W ramach rodzaju nie powtarzamy tego samego elementu. Przy N=1 i obu rodzajach powstaje zadanie pisemne, a słuchanie pozostaje niesprawdzone; raport tego nie ukrywa.

Wszystkie zadania pisemne wykonujemy przed słuchowymi. Odtworzenie angielskiego słowa w części słuchowej nie może podpowiedzieć późniejszej odpowiedzi pisemnej. Opcje słuchowe są po polsku, z zatwierdzonego poznanego materiału, bez identycznych znaczeń. Brak dwóch bezpiecznych różnych opcji lub gotowego zatwierdzonego audio wyklucza dany slot; nie zastępujemy słuchania pisownią. Brak jakichkolwiek kandydatów daje czytelny komunikat bez utworzenia pustej sesji.

Plan zamraża listę i kolejność slotów, rewizje, umiejętności, prompty, klucze odpowiedzi, warianty, identyfikatory audio i opcje. Wznowienie niczego nie przelicza i nie zwiększa porcji. Wydawanie tworzy po jednym zwykłym `session_tasks`, bo obecny indeks dopuszcza tylko jedno `issued` w sesji; nie wstawiamy całego planu jako aktywnych zadań.

## 6. Dane, API i integralność — proponowany kontrakt

- Rozszerzyć przypisanie o nullable `testGoals`, walidowane jako niepusty, unikalny zbiór `recall | spelling | listening` albo null. Dotychczasowy PUT tylko z datą zachowuje ustawione cele; jawne null je wyłącza.
- Rozszerzyć przypisanie o `mockTestTaskCount` (integer 1–100, NOT NULL DEFAULT 10) i CHECK w bazie. DTO rodzica zwraca liczbę; w PUT pole jest opcjonalne: brak zachowuje aktualną wartość, a przy nowym przypisaniu używa 10. Null, ułamek, 0 i 101 są odrzucane. Kid API nie przyjmuje własnego nadpisania liczby.
- Dodać do `learning_sessions` `mode: training | mock_test` z domyślnym `training` i prywatny nullable `mockTestPlan` JSONB. Typowany plan ma własną wersję formatu. CHECK wiąże tryb z obecnością planu; trigger blokuje późniejszą zmianę trybu i planu. Migracja w Drizzle zachowuje stare sesje; nie rozwijać niezależnie początkowego `schema.sql`.
- Migawka obejmuje `testGoals`, `testDate`, `requestedTaskCount`, wymagany zakres, sloty i zasady trybu; faktyczny `taskBudget` odpowiada długości slotów. Istniejące kolumny zachowują wersję zestawu i polityki, kontekst zachowuje timezone/previousContact.
- `SessionInput` dostaje opcjonalny `mode` z domyślnym `training`; `SessionDto` jawny tryb. Przy próbie startu innego trybu lub innego zestawu podczas aktywnej sesji zwrócić konflikt i pozwolić świadomie wrócić albo zakończyć bieżącą. Nie wznawiać treningu jako kartkówki i nie zamykać go automatycznie.
- Pozostawić istniejące trasy start/next/attempt/end. Dodać odrębne DTO omówienia oraz endpoint dziecka `GET /api/v1/kid/sessions/:id/mock-test-summary`, dostępny tylko po zamknięciu, i autoryzowane trasy rodzica `GET /api/v1/parent/mock-tests?childId=&deckId=` oraz `GET /api/v1/parent/mock-tests/:sessionId`.
- `AttemptDto` kartkówki pozostaje zakończony (`completed`) z `feedback: null`, `stepId: null` i terminalnym stanem zadania. Klient kieruje się trybem sesji; null nie oznacza oczekiwania na analizę. To samo obowiązuje odczyt i każdy retry, również po zakończeniu: rozwiązania są dostępne wyłącznie przez omówienie.
- Hint i wzorcowe audio odpowiedzi dla zadania pisemnego odrzuca serwer. Odsłuch promptu zadania słuchowego jest dozwolony i zawsze zapisuje ekspozycję przed odpowiedzią HTTP, także przy replay z cache.
- Wspólna blokada sesji serializuje start, next, answer, disclosure, finish i summary. Drugie merytoryczne podejście do zamkniętego slotu jest konfliktem. Retry tej samej treści i identyfikatora zwraca ten sam wynik; inna treść pod tym identyfikatorem daje 409.
- Oceny finalizują się w tej samej transakcji co próba, ale bez ujawnienia. Kwalifikacja nadal korzysta z rzeczywistych ekspozycji i `received_at`, także ekspozycji z innego zestawu. Nie zamrażamy samodzielności na starcie zamiast przy przyjęciu odpowiedzi.
- Wynik i statusy na zakończenie utrwalić pod blokadą w osobnym typowanym polu kontekstu. Automatyczne i jawne zakończenia korzystają z tej samej ścieżki; `contextOf` zachowuje nowe pola. Odczyt raportu nie przepisuje historycznych ocen.
- Odczyt omówienia dziecka zapisuje komplet ujawnianych celów przed HTTP, przy każdym odczycie. Odczyt raportu tylko przez rodzica nie jest ekspozycją dziecka. Następna sesja uwzględnia ujawnienia omówienia.
- Nowe DTO jawnie mapują pola, nie serializują `mockTestPlan` ani rekordów DB. Aktywne endpointy i błędy nie zwracają wariantów odpowiedzi, kluczy ani score'ów.

## 7. Raport i następny krok

Każdy element × wybrana umiejętność ma osobno:

1. Wynik próby: poprawny, błędny, pominięty, nieoceniony albo niewydany (poza porcją/przerwany/niepoznany/brak audio lub opcji).
2. Jakość dowodu: samodzielny lub niekwalifikujący, z przyczyną czytelną dla rodzica. Poprawność nie gwarantuje samodzielności.
3. Status opanowania na moment zakończenia próby, uzyskany z istniejącej historii/projekcji, a nie z liczby punktów kartkówki.

Pokrycie per umiejętność liczymy po unikalnych elementach, nie po liczbie ocen. Poprawne niezależne wyniki, trudności, poprawne niekwalifikujące i niesprawdzone tworzą rozłączne grupy pełnego zakresu. Pominięte i nieocenione są niesprawdzone, ale mają osobne liczniki. Błąd wspomaganej próby pozostaje trudnością, bez fikcyjnego przerwania niezależnej serii.

Przykład „6 z 10 zapisuje samodzielnie; 2 do ćwiczeń; 2 niesprawdzone” jest poprawny tylko przy takim rzeczywistym podziale. Przy poprawnej odpowiedzi po niedawnym wzorcu raport dodaje grupę „poprawnie po niedawnym ćwiczeniu” zamiast zaliczyć ją do samodzielnych albo ukryć. Dla samej wielkiej litery raport może pokazać sukces Recall i trudność pisowni.

Omówienie dziecka ma krótkie komunikaty bez procentów i technicznych ocen; rozwiązania i wzorcowe audio dotyczą wyłącznie wydanych slotów. Nie ujawniamy automatycznie całej nieprzetestowanej talii. Propozycja kolejnej krótkiej sesji korzysta ze zwykłego treningu w tym zestawie, który ma już nowe ekspozycje i historię trudności; nie tworzymy drugiego schedulera powtórek ani obietnicy natychmiastowego samodzielnego sprawdzenia.

## 8. Proponowany plan etapów po zatwierdzeniu projektu

Każdy etap implementacji wymaga znaczącego RED → minimalnej zmiany → GREEN, zapisu dowodów i osobnego commita. Konkretne sygnatury, testy i kroki trafią do planu wykonawczego po review tej propozycji.

| Etap | Rezultat i główne pliki | Dowód akceptacji |
| --- | --- | --- |
| 1. Cel i trwała migawka | `contracts/src/decks.ts`, `contracts/src/kid.ts`, nowy `contracts/src/mock-tests.ts`, eksporty; `server/src/db/schema.ts`, nowa migracja w `server/drizzle/`, `modules/decks.ts`, `modules/sessions.ts`, `modules/events.ts` | Cel i liczba osobne dla dwóch dzieci; legacy zachowuje zachowanie; DB odrzuca zmianę planu; zmiana daty/celu/liczby/polityki/materiału nie zmienia rozpoczętej próby. |
| 2. Dobór zamrożonej porcji | Nowy `server/src/domain/mock-test-plan.ts` i testy; dedykowany `modules/mock-tests.ts`, wydawanie przez `modules/sessions.ts` | 0/1/10/50 elementów; nieznany materiał; mieszane cele; limity 1/7/10/25/100; jeden wpis pisemny → dwie oceny; cała część pisemna przed audio; brak bezpiecznych opcji nie tworzy fikcyjnego dowodu. |
| 3. Odpowiedzi bez ujawnienia | `modules/attempts.ts`, `modules/events.ts`, trybowe przejścia stanów; `domain/evaluate.ts` tylko jeśli niezbędne; Kid router | Wszystkie odczyty i retry bez feedbacku przed końcem; jeden slot nie wraca po błędzie; odmowa hint/audio dla pisowni; idempotencja i wyścigi dwóch klientów; wcześniejsze ekspozycje nadal dyskwalifikują samodzielność. |
| 4. Zakończenie i raport | Nowy `domain/mock-test-report.ts` i testy, `modules/mock-tests.ts`, `modules/reporting.ts`, wspólna ścieżka zakończeń, Kid i Parent router | Pełny mianownik także dla niewydanych slotów; wszystkie wyniki i jakość dowodów; `monday` vs `Monday`; wynik niepełny po przerwaniu/wygaśnięciu; niezmienny ponowny odczyt; ekspozycje przed omówieniem; usunięcie profilu kasuje historię. |
| 5. Przepływ dziecka | `kid-ui/src/api/{KidApi,client}.ts`, `session/{session-controller,useLearningSession}.ts`, `screens/{DeckScreen,LearnScreen}.tsx`, nowy `MockTestSummaryScreen.tsx`, `contracts/src/messages.ts` | Bez mikrofonu; neutralny komunikat po odpowiedzi; prawdziwy stały licznik; reload w połowie; utrata odpowiedzi HTTP i retry; jawne wyjście; brak lokalnego fałszywego sukcesu. |
| 6. Ustawienia i raport rodzica | `web/src/parent/DeckEditor.tsx` przy przypisaniach, nowy `AssignmentTestGoalFields.tsx`, `ProgressPanel.tsx`, nowy `MockTestReportPanel.tsx`, `api.ts`, wspólne komunikaty | Dwa dzieci × jeden zestaw z różnymi celami, datami i liczbami zadań; walidacja liczby; raport konkretnej starej próby po nowej publikacji; poprawne grupy wyników; autoryzacja rodzica przy każdym odczycie/zapisie. |
| 7. Regresje i dostarczenie | Nowe `tests/integration/mock-tests.test.ts`, `mock-test-reporting.test.ts`, `tests/e2e/mock-test.spec.ts`; aktualizacja SPEC/architecture/folder-structure i dziennika planu | Pełna macierz poniżej, niezależne review całej gałęzi, rozwiązane Critical/Important, końcowa weryfikacja i PR do `main`; scala właściciel przez squash. |

Zależności: 1 → 2 → 3 → 4 → 5/6 → 7. Domyślnie wykonuje bieżący agent inline, przez `executing-plans`. Delegowanie implementacji wymaga osobnej zgody. Niezależny subagent-recenzent całej gałęzi przed PR jest wymagany przez AGENTS.md.

## 9. Sprawdzenia i najważniejsze ryzyka

**Domena:** kontrolowany zegar, próg 299/300 sekund, trzy kwalifikujące sukcesy i potwierdzenie innego dnia po minimum 12 godzinach; początkowy wynik sam nie ustawia opanowania. Warianty odpowiedzi i kapitalizacja pozostają zgodne z aktualnym evaluator-em.

**PostgreSQL:** trwała migawka, niezmienność kluczy i ocen, izolacja dzieci, usunięcie profilu, 2×next, 2×answer, answer vs finish, answer vs disclosure, utrata HTTP po commicie, ponowienie end/summary, automatyczne zakończenie starej próby przy starcie kolejnej. Faktyczne PostgreSQL przez istniejący runner Docker; PGlite nie zastępuje tych dowodów.

**UI/E2E:** pełna kartkówka bez mikrofonu, licznik, brak podpowiedzi i odpowiedzi także w JSON, wznowienie, dwie przeglądarki, niepełny raport po zakończeniu, odmowa raportu przed końcem, niedostępne audio słuchania bez fałszywej pomyłki, następna sesja po omówieniu. Ręcznie sprawdzić klawiaturę, autokorektę i odtwarzanie na docelowym telefonie/tablecie; nie deklarować tego na podstawie Playwright.

**Regresje:** bezpośrednio R01 (ujawnienia/received_at), R03 (historia/niezmienność/CASCADE), R05 (ochrona przyszłych celów). Zachować dotychczasowe R04 (exposure w treningu); R02/R06/R07 w istniejących testach mediów i mowy, bez rozszerzania funkcji.

Planowane komendy korzystają ze sprawdzonych skryptów `package.json`; poniżej nie ma deklaracji wykonania:

```text
pnpm test:unit
pnpm test:integration
pnpm test:e2e tests/e2e/mock-test.spec.ts tests/e2e/test-preparation.spec.ts tests/e2e/progress-panel.spec.ts tests/e2e/privacy.spec.ts
pnpm typecheck
pnpm build
git diff --check
```

Największe ryzyka do review: wyciek feedbacku przez retry/stary endpoint, zgubienie pól przez `contextOf`, niezakończona próba przy timeout/start innego trybu, błędny mianownik raportu, podpowiedź audio przed pisemnym Recall. Przegląd obejmuje także brak regresji istniejącego treningu 48h.

## 10. Checklista workflow i dalsza bramka

- [x] Odczyt `using-superpowers` i zasad dla Codex.
- [x] Zajęcie zgłoszenia przez przypisanie do `lookassh`.
- [x] Odczyt bieżącego Git, skryptów, dokumentacji i ścieżek funkcji.
- [x] `brainstorming`: klasyfikacja architectural, cel, warianty, propozycja projektu oraz etapów.
- [x] Własny przegląd propozycji: zakres, zgodność z #30, ryzyka, granice pakietów i testy.
- [x] Zatwierdzenie projektu i etapów przez właściciela, z korektą na konfigurowalną liczbę zadań.
- [x] Zatwierdzenie pisemnej specyfikacji jako podstawy `writing-plans`; korekta odwzorowana w tym dokumencie.
- [x] `writing-plans`: szczegółowy plan w `docs/superpowers/plans/2026-10-10-test-readiness.md`.
- [ ] Review nowego szczegółowego planu przez właściciela przed implementacją.
- [ ] Dopiero po poleceniu realizacji: `using-git-worktrees`, `executing-plans`, dziennik, RED/GREEN, niezależny `requesting-code-review`, obsługa uwag, `verification-before-completion`, `finishing-a-development-branch`, PR.

W nagłówku przyszłego planu musi znaleźć się: „REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review.”

Nie wykonano implementacji, niezależnego review implementacji, commita ani PR. Akceptacja projektu i etapów pozwala przygotować szczegółowy plan; jego zatwierdzenie i polecenie realizacji są kolejną bramką przed zmianą kodu.
