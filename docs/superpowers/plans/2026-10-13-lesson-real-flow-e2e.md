# Plan E2E: zatwierdzona lekcja → dziecko → wznowienie → raport

> REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review.

**Cel:** Zabezpieczyć jednym scenariuszem Playwright rzeczywisty obieg materiału, wznowienie sesji i zapis odpowiedzi ze wsparciem, bez zastępowania API aplikacji.

**Wymagania:** Scenariusz zaproponowany w czacie i zaakceptowany do przygotowania planu przez właściciela; `docs/SPEC.md` A23, A31, A43, A46–A49, A53; `docs/architecture.md` §19; `docs/folder-structure.md`; `docs/implementation-plan.md`. Zgoda na przygotowanie planu nie oznacza rozpoczęcia implementacji.

**Architektura:** Istniejący `tests/e2e/global-setup.ts` uruchamia PostgreSQL, web i worker z fake providerami. Dwa osobne konteksty przeglądarki: zalogowany rodzic oraz dziecko bez cookies rodzica. Akcje produktu przechodzą przez UI, odczyty kontrolne przez rzeczywiste API rodzica i SELECT w bazie testowej. Bez nowych endpointów, konfiguracji gradera ani zmian publicznych DTO.

**Stack:** Playwright, TypeScript, istniejące `@learning/contracts`, `createDatabase` i `readTestRunConfig`.

**Wykonanie:** Domyślnie bieżący agent w tym czacie, bez delegacji implementacji. Jeden końcowy niezależny review. Plan do zatwierdzenia przed `executing-plans`.

## Stan i granice

- Zweryfikowany punkt startowy: `64c4265`, gałąź `feature/grammar-module`, PR #51. Przy wykonaniu ponownie sprawdzić Git i status PR; nie zakładać, że PR nadal jest otwarty.
- Obecne E2E rodzica sprawdzają generację, edycję, publikację i przypisanie. E2E dziecka używają `installKidUiFixture`; przepływ serwerowy jest pokryty osobną integracją. Nowy test łączy przeglądarkę z prawdziwym obiegiem serwerowym.
- Nowy plik: `tests/e2e/lesson-real-flow.spec.ts`. Helpery lokalne w tym pliku; nie refaktoryzować istniejących speców ani globalnego setupu.
- Dziennik wykonania: `docs/superpowers/progress/2026-10-13-lesson-real-flow-e2e.md`, utworzyć dopiero przy rozpoczęciu wykonania.
- Nie dodawać `page.route`, `installKidUiFixture`, bezpośrednich wywołań domeny ani zapisów SQL dla przygotowania materiału, sesji lub postępu. Fake dotyczy wyłącznie zewnętrznych providerów już skonfigurowanych w global-setup.
- Rodzic i dziecko mają unikalne nazwy z UUID; lokalizować własną lekcję po tytule/deckId, nigdy `deck-row-0` ani pierwsze dziecko w całej bazie.
- Jeden cel `english_grammar.present_simple.third_person_s`, pula 20, poprawny materiał Present Simple, przykład `He plays football every day.`. Bez mikrofonu, viewport dziecka 390×844. Nie czekać 12 godzin i nie deklarować testu trwałego opanowania.
- Utrzymać timeout testu 240 s i istniejące 120 s na generację/media. Czekać na odpowiedzi lub stan UI, bez arbitralnych sleep. Test nie zostawia zaległej generacji/TTS.

## Review Focus i dowody

1. Przykład jest zatwierdzonym materiałem tej wersji, nie tekstem fixture — odczyt po zapisie/reloadzie oraz dokładna lista przykładów w Kid UI (zadanie 1).
2. Odświeżenie nie tworzy nowej sesji, próby ani kolejnego zadania — sessionId, deckVersionId, taskId i liczby wierszy przed/po (zadanie 2).
3. „Nie pamiętam” zapisuje trudność i rzeczywiste wsparcie — feedback, karta i następne łatwiejsze zadanie z prawdziwego schedulera (zadanie 2).
4. Poprawna odpowiedź ze wsparciem nie potwierdza samodzielności — assessment i projekcja, a nie sam napis „Świetnie!” (zadanie 2).
5. Raport dotyczy właściwego dziecka; dane pozostają po zakończeniu sesji — jawny wybór dziecka, rzeczywisty progress DTO i odczyt po reloadzie panelu (zadanie 2).

### Zadanie 1: Rzeczywisty materiał rodzica widoczny dziecku

**Plik:** utworzyć `tests/e2e/lesson-real-flow.spec.ts`.

**Interfejsy lokalne:** `prepareLesson(parent: Page): Promise<{ childId: string; deckId: string; deckVersionId: string; objectiveId: string; approvedExample: string }>`; `openKidLesson(kid: Page, childId: string, deckId: string): Promise<void>`. Wszystkie identyfikatory pochodzić mają z odpowiedzi rzeczywistych operacji, przechwyconych przez `waitForResponse`.

- [ ] Sprawdzić izolację przez `using-git-worktrees`, przeczytać ten plan i wymagania; zapisać BASE, zakres, checklistę i komendy w dzienniku. Użyć własnego `UMIEM_TEST_RUN_ID` i wolnego portu.
- [ ] Utworzyć test `approved lesson survives reload and support without duplicate or independent credit`, początkowo z częścią przygotowania i weryfikacji materiału. Utworzyć dziecko przez UI, następnie lekcję z jednym celem i pulą 20; poczekać na generację i wszystkie media.
- [ ] Zmienić przykład przez `example-line-<objectiveId>-0`, sprawdzić podgląd karty, zapisać. Ponownie otworzyć edytor po tytule i sprawdzić trwałość przykładu. Opublikować i przypisać właściwemu dziecku. Zapisać ID opublikowanej wersji z autoryzowanego odczytu `LessonDeckDtoSchema`.
- [ ] Utworzyć osobny kontekst dziecka bez `storageState` rodzica, z `locale: pl-PL`, viewport 390×844. Wejść na `/kids/<childId>/learn`, otworzyć kartę `[data-deck-id="<deckId>"]`, przejść przez karty do karty z przykładami. Sprawdzić dokładną listę `kid-lesson-card-examples` i nieobecność pierwotnego przykładu fake providera. Przechwycić `SessionDtoSchema` oraz `TaskDtoSchema` z rzeczywistych odpowiedzi.
- [ ] Uruchomić nowy test. Istniejąca poprawna aplikacja może od razu dać GREEN: jest to dodanie pokrycia, nie nowe zachowanie produktu. Nie tworzyć sztucznego RED przez brak helpera lub błędny selektor.
- [ ] Udowodnić czułość asercji: tymczasowo zmienić tylko `renderCard` w `packages/server/src/domain/lessons/card.ts`, aby zwracał `examples: []`. Nowy test ma dać RED na przykładzie widocznym dziecku. Przywrócić dokładnie plik, sprawdzić diff i ponowić GREEN; zapisać oba logi. Mutacja nie trafia do commita.
- [ ] Commit wyłącznie testu i dowodów w dzienniku: `test: cover approved lesson material in real kid flow`.

### Zadanie 2: Wznowienie, wsparcie i rzeczywisty raport

**Plik:** rozszerzyć ten sam test w `tests/e2e/lesson-real-flow.spec.ts`.

**Interfejsy lokalne:** `query<T>(sql: string, params: unknown[]): Promise<T[]>` czyta `readTestRunConfig(process.env).worldFile`, używa `createDatabase`, tylko SELECT, zamyka pool w `afterAll`. `answerGuided(kid: Page, task: TaskDto): Promise<void>` obsługuje rzeczywiście wydany notice/choice, z jawną porażką dla nieoczekiwanego typu. Poprawną opcję odczytać w procesie testu z `session_tasks.answer_key` dla przechwyconego taskId; nie przekazywać klucza w Kid API ani skryptem do aplikacji. Odpowiedź wysyła wyłącznie kliknięcie UI.

- [ ] Przejść przez intro i dwa poprawne zadania guided do pierwszego `lesson_gap`, z limitem najwyżej 12 kroków. Nie kończyć helpera sukcesem, jeśli wymagany etap nie został osiągnięty. Zapisać ID ukończonych prób i bieżącego niezakończonego zadania.
- [ ] Przed odpowiedzią na gap zapisać liczbę prób/ocen i zadań tej sesji. Odświeżyć stronę, wybrać tę samą lekcję zgodnie z rzeczywistym UI wznowienia. Wymagać `resumed=true`, tego samego sessionId/deckVersionId oraz wydania tego samego taskId. Sprawdzić niezmienioną liczbę prób, assessments i session_tasks; ukończone odpowiedzi nadal mają po jednym zapisie. Liczby odczytywać parametryzowanymi zapytaniami ograniczonymi do własnej sesji/prób.
- [ ] Kliknąć „Nie pamiętam — pokaż” (`kid-not-remember`), wymagać ujawnienia w `kid-reveal`, następnie potwierdzić przyciskiem `kid-next`. Dopiero potwierdzenie wysyła próbę: przechwycić zakończony AttemptDto z modality `dont_remember`, taskState `answered` i rzeczywistym feedbackiem trudności. Sprawdzić dokładnie jedną ocenę `incorrect` dla tej próby i brak zmyślonej kategorii pomyłki.
- [ ] Kliknąć dalej: wymagać prawdziwej karty wsparcia, następnie guided. Wybrać poprawną opcję; wymagać feedbacku `great`, ale w assessments tej próby `outcome=correct`, `independent=false`, `confirmation_eligible=false`. W `child_objective_progress` dla własnego dziecka/celu wymagać `streak=0`, `last_independent_at=null`, status różny od mastered. Nie wykonywać dalszych produktywnych odpowiedzi, które zmieniłyby te warunki.
- [ ] Zakończyć sesję przyciskiem `kid-end`; wymagać podsumowania z właściwym celem. Odczytać stan zakończenia i ponownie sprawdzić trwałość wcześniejszych prób. Nie wymagać sztywnego ogólnego licznika assessedTasksIssued — jego odłożony Minor nie jest zakresem tego testu.
- [ ] W kontekście rodzica otworzyć własną opublikowaną lekcję, wybrać childId w `supervision-child`. Przechwycić rzeczywisty `GET /api/v1/parent/lessons/<deckId>/progress` i walidować `ObjectiveProgressDtoSchema`: właściwy objectiveId, `lastIndependentAt=null`, status nieopanowany. Sprawdzić zgodny polski status w `progress-status-<objectiveId>` oraz trwałość po odświeżeniu i ponownym wybraniu dziecka. „Nie pamiętam” nie musi pojawiać się w topErrors, bo nie ma kategorii błędu.
- [ ] Uruchomić cały scenariusz GREEN. Potwierdzić drugie RED przez tymczasową mutację zapisu guided/support assessment w `lesson-attempts.ts` (`independent: true` zamiast wyliczonej kwalifikacji, w ścieżce używanej przez ten test). Oczekiwana porażka: asercja independent=false. Przywrócić plik, sprawdzić brak diffu produkcyjnego i ponowić GREEN. To dowód skuteczności testu, nie dostarczana poprawka aplikacji.
- [ ] Jeśli scenariusz ujawni prawdziwy błąd: `systematic-debugging`, odtworzenie i potwierdzone RED przed minimalną poprawką, potem GREEN i adekwatna regresja. Zmiana API/modelu/prywatności wymaga osobnej bramki; nie rozszerzać jej samodzielnie w tym planie.
- [ ] Commit: `test: verify lesson resume support and persisted progress`.

### Zadanie 3: Stabilność, niezależny review i integracja

- [ ] Uruchomić celowany scenariusz trzy razy (`--repeat-each=3`, bez retries); każde przejście wymaga własnych nazw/identyfikatorów. Nie zwiększać timeoutu, aby przykryć zaległą kolejkę lub błędny polling.
- [ ] Uruchomić wszystkie `tests/e2e/lesson*.spec.ts`, potem pełne E2E i typecheck. Ponieważ zakres jest testowy, unit/integration/build nie powtarzać automatycznie; uruchomić je adekwatnie, jeśli zmieniono kod produktu lub setup. `git diff --check BASE..HEAD` oraz lokalnego diffu muszą przejść.
- [ ] Przygotować cały diff od BASE, ten plan, dziennik, RED mutacji, GREEN i ograniczenia. `requesting-code-review`: dedykowany recenzent na najmocniejszym dostępnym modelu poza Astra (obecnie gpt-6.1-sol xhigh), bez delegowania implementacji. Review musi sprawdzić, czy test naprawdę używa backendu i nie odczytuje sukcesu z własnych fixture, czy zapytania są ograniczone do tego dziecka/sesji i czy mutacje zostały usunięte.
- [ ] `receiving-code-review`: rozwiązać Critical/Important i zapisać decyzje. `verification-before-completion`: odczytać aktualne wyniki, sprawdzić checklistę i czysty zakres produkcyjny.
- [ ] `finishing-a-development-branch`: po zatwierdzeniu wykonania oraz zakończeniu bramek zaktualizować PR #51, jeśli nadal otwarty; jeśli scalony, użyć nowej gałęzi/PR z aktualnego main. Opis zawiera zakres testu, dowody czułości, wyniki i brak wpływu API→MCP→skill (brak zmian kontraktu, lesson nadal poza learning-overview). Push dopiero po review; bez scalenia. Sprawdzić końcowe CI.

## Komendy wykonania

Z korzenia repo, z działającym Dockerem; najpierw sprawdzić dostępność `pnpm` i skrypty. Gdy wrapper ponownie próbuje przeinstalować zależności bez TTY, użyć istniejącego lokalnego CLI, bez reinstalacji:

```powershell
$env:UMIEM_TEST_RUN_ID = 'lesson-real-flow-targeted'
$env:UMIEM_E2E_PORT = '24661'
node node_modules/@playwright/test/cli.js test tests/e2e/lesson-real-flow.spec.ts
node node_modules/@playwright/test/cli.js test tests/e2e/lesson-real-flow.spec.ts --repeat-each=3
node node_modules/@playwright/test/cli.js test 'tests/e2e/lesson.*\.spec\.ts'
node node_modules/@playwright/test/cli.js test
pnpm typecheck
git diff --check
```

Każdy osobny przebieg otrzymuje nowy run ID; build i E2E nie mogą równocześnie pisać do `.next`. Logi/trace trzymać pod katalogiem tego zadania poza repo; używać wyłącznie syntetycznych danych. W razie niedostępnego pnpm typecheck odtworzyć sześć komend `tsc --noEmit -p` z package.json i zapisać adaptację.

## Kryteria ukończenia i self-review planu

- [ ] Jeden scenariusz przechodzi rzeczywisty obieg rodzic→dziecko→rodzic, z odświeżeniem i kontrolą trwałości.
- [ ] Dwa kontrolowane błędy dają oczekiwane RED; po ich usunięciu test jest GREEN. Żadna mutacja nie została w dostarczonym kodzie.
- [ ] Powtórzenia, pełne E2E i wymagane sprawdzenia są zielone; niezależny review bez blockerów.
- [ ] Wyniki i ograniczenia zapisane w dzienniku oraz PR; CI dla końcowego HEAD potwierdzone.

Self-review planu: pięć ryzyk ma konkretne asercje; interfejsy helperów i identyfikatory są wspólne dla obu etapów testu. Plan nie zmienia produktu ani kontraktu. Nie pokrywa awarii gradera, rzeczywistych providerów, fizycznego telefonu, offline ani opanowania po 12 godzinach; istniejące testy tych innych reguł nie są zastępowane. Czytanie SQL jest kontrolnym dowodem i nie przygotowuje oczekiwanego stanu.
