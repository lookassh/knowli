# API postępów Umiem! dla Hermesa — plan implementacji A

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review.

**Goal:** Udostępnić rodzinne dane nauki przez jedno uwierzytelnione API tylko do odczytu: ostatnie dni, bieżący postęp i zaplanowane sprawdziany.

**Architecture:** Next.js jest cienką granicą HTTP; publiczne schematy są w contracts, odczyty i autoryzacja w server. Raport powstaje w jednej transakcji PostgreSQL REPEATABLE READ/READ ONLY. Osobny token ogranicza dostęp do learning:read; operator zarządza nim przez CLI workera. MCP i SKILL.md powstają w planie B w tym samym repo Knowli; plan C obejmuje instalację i raporty u Hermesa.

**Tech Stack:** Istniejące TypeScript strict, Zod 4, Drizzle/PostgreSQL, Next.js, pnpm 10.34.6, Vitest i Playwright. Bez nowego backendu, Redis i SDK MCP w web/worker/domenie; SDK jest wyłącznie w osobnym pakiecie integracji z planu B.

**Spec:** `docs/superpowers/specs/2026-10-11-hermes-learning-integration-design.md`, przykład `docs/superpowers/specs/2026-10-11-hermes-learning-overview.example.json`; reguły produktu: `docs/SPEC.md` §18–26, `docs/architecture.md` §9–13, `docs/folder-structure.md`, `docs/implementation-plan.md`. `docs/schema.sql` jest projektem historycznym; migracja poniżej aktualizuje autorytatywny Drizzle.

**Status:** Plan do przeglądu. Użytkownik zaakceptował przedstawiony przykład API i poprosił o writing-plans; nie polecił jeszcze wykonania planu ani wdrożenia. Szczegóły wykonawcze specyfikacji §7 są częścią tego przeglądu.

## Global Constraints

- GET `/api/v1/integrations/learning-overview`; days=7 (1–31), upcomingTestDays=14 (1–90), opcjonalny childId UUID. Bez klientowego timezone i dowolnych filtrów SQL.
- schemaVersion=1; rodzinne daty IANA, domyślnie Europe/Warsaw; dokładnie days wpisów per dziecko, chronologicznie, dziś isPartialDay=true.
- learningTime per dzień i łącznie per dziecko: seconds integer|null, estimated=true; learningTimeDefinition.method=activity_intervals_v1/maxGapSeconds=120. Przedziały dodatnie <=120 s w tej samej sesji, unia per dziecko, podział po lokalnych dniach; >120 s wykluczone. Brak heartbeat i nowej telemetrii. Null oznacza zbyt mało punktów; nie mylić z 0 s dnia bez aktywności.
- `assessmentCounts` liczy oceny, nie różne słowa; poprawne niesamodzielne nie awansują opanowania. `skip` jest rekordem attempts, ale nie jest submittedAttempts ani błędem wiedzy.
- Maksymalnie 5 practiceItems/zestaw, jawne practiceItemsTruncated. Pozostałych list nie obcinamy cicho. Brak przewidywanej oceny szkolnej i archiwalnej projekcji opanowania per dzień.
- Zaplanowane sprawdziany pochodzą wyłącznie z assignments Umiem!, source=umiem_assignment; nie z dziennika szkolnego.
- Wszystkie zapytania raportu i weryfikacji tokenu używają jednego Tx; statement_timeout=8 s. GET nie zmienia tabel, nie domyka sesji i nie finalizuje mowy.
- Token: co najmniej 32 losowe bajty, SHA-256 w bazie, scope learning:read, odwoływalny; bez Parent PIN/cookie, sekretów w output/logach oraz nowego ekranu administracji.
- Limit 60 żądań/minutę/token/proces; nie jest to globalny limit wielu replik. Cache-Control: no-store na sukcesach i błędach.
- Odczyt nie ujawnia answer_key, transkrypcji, nagrań ani score'ów providerów. Zod DTO, nigdy serializacja rekordów.
- TDD wymaga rzeczywistego RED przed zmianą zachowania. Testy PostgreSQL, kontrolowany zegar, fikcyjne dane/providers; żadnej wysyłki ani wywołania modelu.
- Brak zgody na delegowanie implementacji. Końcowy niezależny recenzent: najbardziej zaawansowany dostępny model poza całą rodziną GPT Astra, z jawnym modelem i reasoning_effort. Obecnie dostępny wybór to gpt-6.1-sol; ponownie sprawdzić dostępność przy wykonaniu.
- PR gałęzi roboczej do main po niezależnym review całego zakresu; właściciel scala squash. Plan nie upoważnia do push main, merge ani wdrożenia.

## Review Focus

1. Analiza mowy zatwierdzona podczas odczytu: odpowiedź jest jedną migawką; kolejne żądanie uzupełnia właściwy dzień received_at, bez częściowego połączenia stanów — zadanie 4.
2. Join dwóch ocen i wielu ekspozycji dla jednej odpowiedzi: jedna próba i jedna sesja, osobne oceny umiejętności; skip/presentation nie udają odpowiedzi — zadanie 3.
3. Zmiana opublikowanej wersji/polityki albo usunięcie przypisania: dzienna historia pozostaje historyczna; bieżący postęp i practiceItems dotyczą właściwych obecnych wersji — zadanie 3.
4. Token odwołany/bez scope i omyłkowo użyty w Parent API: żadnych uprawnień rodzica i brak sekretów w błędach; kolejny request respektuje revoke — zadania 2 i 4.
5. Północ i DST oraz nakładające się sesje: dni 23/25 godzin, poprawne zakresy sprawdzianów, szacowany czas bez przerw >120 s i bez podwójnego liczenia — zadania 1 i 3.

## Mapa plików i granic

| Plik | Odpowiedzialność |
| --- | --- |
| contracts/src/learning-overview.ts | Publiczne query/response Zod i typy |
| server/src/domain/report-period.ts | Lokalne dni i zakresy UTC, kontrolowany now |
| server/src/modules/integration-tokens.ts | Tworzenie/lista/revoke i read-only weryfikacja |
| worker/src/integration-tokens.ts | CLI operatora i bezpieczny plik tokenu |
| server/src/domain/learning-overview.ts | Agregacja dzienna i redukcja potwierdzonych trudności |
| server/src/domain/learning-time.ts | Szacowanie czasu z przedziałów aktywności i podział na dni |
| server/src/modules/learning-overview.ts | Jedna transakcja, czytniki ograniczone do dzieci |
| server/src/modules/published-progress.ts | Wspólny odczyt postępu dla parent/report, bez zmiany semantyki |
| web/src/integrations/learning-overview-route.ts | Testowalna granica request/response/limiter |
| web/src/app/api/v1/integrations/learning-overview/route.ts | Next.js GET, dynamic/no-store |
| scripts/export-learning-overview-schema.ts | Zod → przenośny JSON Schema dla planu B |

Wszystkie skrócone ścieżki contracts/server/worker/web oznaczają odpowiednio `packages/contracts`, `packages/server`, `apps/worker`, `apps/web`. Schemat wymiany powstaje w `docs/integrations/learning-overview.schema.json`; nie jest drugą ręcznie utrzymywaną definicją.

## Setup przed pierwszą zmianą implementacyjną

- [ ] Po akceptacji planów A/B/C uruchomić executing-plans oraz using-git-worktrees; sprawdzić list_artifacts i git, użyć jednego istniejącego odpowiedniego worktree albo utworzyć feature/hermes-learning-api.
- [ ] Przenieść do worktree wyłącznie te dokumenty. Nie dotykać istniejących `.zcodeignore` i `docs/superpowers/plans/2026-10-11-deck-mastery-stars.md` ani innych nowych zmian.
- [ ] Uruchomić workspace/task-start/task-done/review-package z bieżącego executing-plans; przy dostosowaniu do PowerShell zachować te same artefakty i dowody. Dziennik: `docs/superpowers/plans/2026-10-11-hermes-learning-api-progress.md`; zapisać BASE_SHA, branch, status bramek, RED/GREEN, odstępstwa.
- [ ] Przeczytać specyfikację i plany A/B/C. Zależności: 1 → 2 → 3 → 4 → 5; plan B może testować fake HTTP po zadaniu 1, ale smoke rzeczywistego API wymaga zadania 4. Bez delegacji.

### Zadanie 1: Publiczny kontrakt i daty rodzinne

**Files:** Create `packages/contracts/src/learning-overview{,.test}.ts`, `packages/server/src/domain/report-period{,.test}.ts`, `scripts/export-learning-overview-schema.ts`, `docs/integrations/learning-overview.schema.json`; Modify `packages/contracts/src/index.ts`, `package.json`. Przykład specyfikacji służy jako syntetyczny fixture; test kopiowania pól w JSON nie zastępuje przypadków granicznych.

**Interfaces:** Produces `LearningOverviewQuerySchema`, `LearningOverviewDtoSchema`, `LearningOverviewQuery`, `LearningOverviewDto`; `buildReportPeriod(now: string, timezone: string, days: number): ReportPeriod`, gdzie `ReportPeriod={from:string,to:string,days:number,dates:readonly string[],startUtc:string,endExclusiveUtc:string}`. Domyślne zakresy i pełne DTO zgodne ze specyfikacją §§2–3. HTTP parser konwertuje tylko całe wartości numeryczne; MCP query ma liczby, bez z.coerce dla booleans/null.

- [ ] Napisać testy kontraktu: default `{days:7,upcomingTestDays:14}`, odrzucenie 0/32/91, ułamków, null/true, złego UUID i nieznanych parametrów; przykład przechodzi; zły mianownik postępu, brak dnia, zdublowane skill/date i niedozwolone dodatkowe pola są odrzucane.
- [ ] Test kontraktu czasu: 1380 s i estimated=true przechodzi; ujemne/ułamkowe sekundy, estimated=false, brak learningTimeDefinition, próg inny niż120 odrzucone. Null dopuszczalny przy aktywności bez mierzalnego przedziału; pusty dzień musi mieć 0. Suma okresu równa sumie dni, a null w jednym dniu wymusza null w sumie.
- [ ] Napisać testy dat: dla now=`2026-10-11T17:00:00Z`, Warsaw i days=3 wynik from=2026-10-09/to=2026-10-11; zmiana lokalnego dnia przy `2026-10-11T22:00:00Z`; 2026-03-29 ma 23h, 2026-10-25 ma 25h; upcomingTestDays=14 kończy się 2026-10-24.

```ts
it("uses local calendar days across fall DST", () => {
  const p = buildReportPeriod("2026-10-25T22:00:00Z", "Europe/Warsaw", 1);
  expect(p.dates).toEqual(["2026-10-25"]);
  expect(Date.parse(p.endExclusiveUtc) - Date.parse(p.startUtc)).toBe(25 * 3_600_000);
});
```
- [ ] RED: `npx --yes pnpm@10.34.6 test:unit packages/contracts/src/learning-overview.test.ts packages/server/src/domain/report-period.test.ts`; zapisać oczekiwaną przyczynę porażki.
- [ ] Zaimplementować schematy i czyste wyznaczanie kalendarza przez Intl. Wykorzystać podejście localMidnight z `domain/test-preparation.ts`; nie zmieniać algorytmu 48h w schedulerze. Eksporter używa Zod 4 toJSONSchema; zapisany schema opisuje strukturę, a semantyczne sumy/dni waliduje kod.
- [ ] GREEN: powtórzyć polecenie; uruchomić `node apps/worker/node_modules/tsx/dist/cli.mjs scripts/export-learning-overview-schema.ts --check` (tryb check ma porównać wygenerowany schema z plikiem i zakończyć się 0). Zapisać root skrypt `contracts:export-learning-overview` wskazujący ten sam istniejący runtime tsx workera, z trybem zapisu/check; nie dodawać drugiej zależności tsx.
- [ ] Commit wyłącznie plików zadania: `feat: define read-only learning overview contract`.

### Zadanie 2: Token z zakresem odczytu i CLI

**Files:** Create `packages/server/src/modules/integration-tokens.ts`, `apps/worker/src/integration-tokens{,.test}.ts`, `tests/integration/integration-tokens.test.ts`; Modify `packages/server/src/db/schema.ts`, `packages/server/src/index.ts`, `apps/worker/package.json`, `tests/integration/helpers.ts`; Generate migration i metadane `packages/server/drizzle/<next>_integration_tokens.sql` (numer według aktualnego journal, obecnie następny 0006).

**Interfaces:** Produces `IntegrationPrincipal={id:string,scopes:readonly string[]}`; `requireLearningReadToken(exec: Executor, rawToken: string): Promise<IntegrationPrincipal>`; `issueIntegrationToken(services: Services, name: string, secret: string): Promise<{id:string}>`; `listIntegrationTokens(services): Promise<readonly IntegrationTokenMetadata[]>`; `revokeIntegrationToken(services, id:string): Promise<void>`. `IntegrationTokenMetadata={id,name,scopes,createdAt,revokedAt}` bez hasha/sekretu. CLI `create --name <name> --out <absolute-path>`, `list`, `revoke --id <uuid>`; CLI generuje token/pliki, moduł serwera zapisuje wyłącznie hash.

- [ ] Napisać test PostgreSQL: secret nie występuje w token_hash ani metadata; poprawny token/read scope daje principal; invalid/revoked → unauthorized, bez scope → forbidden; revoke idempotentny, po odwołaniu następny request odmawia; require nie zmienia tabeli. Migracja działa również na wcześniejszym schemacie i nie narusza profili/historii.
- [ ] Napisać test CLI w tymczasowym katalogu: istniejący plik nie jest nadpisany, nieudany zapis nie tworzy aktywnego tokenu, stdout/stderr bez sekretu, tryb Linux 0600 albo Windows ACL operatora; błąd zapisu bazy usuwa wyłącznie nowo utworzony plik z tej operacji. Sekret pozostaje przy wymuszonym prywatnym ACL i jest odczytywalny przez wskazanego operatora.
- [ ] RED: `npx --yes pnpm@10.34.6 test:integration tests/integration/integration-tokens.test.ts` i `npx --yes pnpm@10.34.6 test:unit apps/worker/src/integration-tokens.test.ts`.
- [ ] Zaimplementować table/hash/CSPRNG i CLI z atomicznym lifecycle. Read-only require nie wykonuje cleanup/update. Hash porównywać timingSafeEqual; nie reuse parent_sessions. Dodać test teardown do nowej tabeli. CLI startuje przez istniejący tsx w workerze; produkcyjnie czyta DATABASE_URL i ma dostęp operatora, nie dziecka.
- [ ] Sprawdzić zgodność identyfikatorów: CLI generuje publiczny UUID przed utworzeniem sekretu `umiem_<uuid>_<random>`; issueIntegrationToken parsuje i zapisuje ten sam UUID oraz hash całego sekretu. Request nie może wybierać innego id niż zawarte w podpisanym losowo sekrecie.
- [ ] GREEN: powtórzyć testy i `tests/integration/auth-profiles.test.ts`; wynik/DDL/odstępstwa zapisać w dzienniku. Przejrzeć wygenerowany SQL i snapshot, nie edytować równolegle docs/schema.sql.
- [ ] Commit: `feat: add revocable learning integration tokens`.

### Zadanie 3: Dzienne liczniki, postęp i sprawdziany

**Files:** Create `packages/server/src/domain/learning-overview{,.test}.ts`, `packages/server/src/domain/learning-time{,.test}.ts`, `packages/server/src/modules/learning-overview.ts`, `packages/server/src/modules/published-progress.ts`, `tests/integration/learning-overview.test.ts`, `tests/fixtures/learning-overview-world.ts`; Modify `packages/server/src/modules/reporting.ts`, `packages/server/src/index.ts`. Query helpers pozostają przy tym module; bez repozytorium per tabela.

**Interfaces:** Consumes query/DTO/ReportPeriod z 1 i token verifier z 2. Produces `getLearningOverview(services: Services, query: LearningOverviewQuery, rawToken: string, onAuthenticated?: (principal: IntegrationPrincipal) => void): Promise<LearningOverviewDto>`; callback jest wywoływany raz po read-only weryfikacji w tej samej transakcji, przed kosztownymi odczytami, i pozwala HTTP zużyć limit bez osobnego zapytania autoryzacji. Internal `readPublishedProgress(exec: Executor, childId:string, deckId:string): Promise<PublishedProgress>`, gdzie `PublishedProgress={deckId,deckVersionId,deckTitle,deckVersionNumber,totalItems,items:ProgressItemDto[],skills:SkillReportDto[]}`. `getProgress` rodzica współdzieli ten czytnik, zachowując dotychczasowy DTO; integration wrapper usuwa totalItems z poszczególnych skills zgodnie z nowym DTO. Agregacja przyjmuje minimalne fakty bez answer/transcript i zwraca DTO, nie modele tabel.

- [ ] Napisać kontrolowany fixture: dwoje dzieci, 3 dni, 8 odpowiedzi jednego dnia, jedna pisemna odpowiedź z ocenami recall+spelling, dwie ekspozycje tej samej sesji, skip i prezentacja bez odpowiedzi. Assertions: submittedAttempts=8, session dedupe=1, zero-day istnieje, skip bez incorrect, samodzielność tylko we właściwej kategorii.
- [ ] Czas: dodać `LearningTimeDto={seconds:number|null,estimated:true}` w contracts zadania 1; helper `estimateLearningTime(input:{points:readonly {sessionId:string,at:string}[],period:ReportPeriod,timezone:string,now:string,daysWithActivity:ReadonlySet<string>}):{byDate:ReadonlyMap<string,LearningTimeDto>,total:LearningTimeDto}` w learning-time.ts. Zasady i jednostki dokładnie ze specyfikacji sekcji Czas nauki, bez nowego DTO klienta dziecka.
- [ ] Testy czasu przed implementacją: punkty jednej sesji 12:00:00/12:01:00/12:03:00/12:10:00 →180 s; dokładnie120 s wchodzi,120.001 s nie; duplicate timestamps i overlapping sessions nie podwajają wyniku; jedna próbka lub same długie luki przy aktywności →null, brak aktywności →0. Nie dopisywać czasu do generatedAt/endedAt ani opóźnienia końca sesji.
- [ ] Testy czasu przez północ: Warsaw 2026-10-10T21:59:30Z do22:00:30Z →30 s w każdym dniu. Rozdzielić także prawidłowo oba DST, pierwszy punkt do120 s przed początkiem okresu i cutoff generatedAt. Agregować ms, następnie floor sekund dziennych i sumę okresu; test null jednego dnia →null total. PostgreSQL fixture: 600+0+1380=1980 s, przy dołączaniu ocen czas się nie mnoży.
- [ ] Napisać testy: zmiana wersji nie przepisuje deckVersionId/title historii; usunięte przypisanie pozostawia historię i usuwa currentProgress; 5 statusów sumuje się do totalItems i zgadza się z getProgress; scope childId nie ujawnia rodzeństwa. Brak profili → children=[], brak terminów → plannedTests=[].
- [ ] Napisać testy practiceItems: incorrect/„Nie pamiętam” tworzy trudność; późniejsze niezależne correct usuwa tylko tę umiejętność; supported/unassessed/skip nie usuwa; nowa skill_version lub policy nie dziedziczy starego błędu; sześć trudności → pięć + truncated=true. Użyć readSkillHistories i loadPolicy z policies/registry, bez ensureLearningPolicy w GET.
- [ ] Napisać testy: dwa sprawdziany tego samego dnia nie zlewają się; dzisiaj ma daysUntil=0, koniec zakresu inclusive, następny dzień wykluczony; aktywna kartkówka nie jest domykana, zakończona częściowa zachowuje complete=false, pełny mianownik 7 przy taskBudget=4. mockTests nie zwiększa drugi raz daily assessmentCounts.
- [ ] RED: `npx --yes pnpm@10.34.6 test:unit packages/server/src/domain/learning-overview.test.ts packages/server/src/domain/learning-time.test.ts`; `npx --yes pnpm@10.34.6 test:integration tests/integration/learning-overview.test.ts`.
- [ ] Zaimplementować ograniczone/batchowane odczyty w repeatable-read/read-only: childProfiles, familySettings, assignments/published version, próby, oceny, zamknięte zdarzenia whitelisted w spec §7, utrwalone mockTestReport. Nie stosować limit 30 historii z parent reporting. Przed joinami agregować/deduplikować osobne źródła. Wybrać statusy i predecessor-chain wspólnie z dotychczasowym getProgress, bez przebudowy cache'u.
- [ ] Dla helpera czasu czytać te same źródła aktywności z buforem120 s przed startUtc, bez bufora w dziennych licznikach. Zachować sessionId; intervals per sesja następnie union per dziecko i podział dni. Oba learningTime i definicję metody zweryfikować przez DTO. Dotychczasowe uczenie, tabela sesji i Kid API pozostają bez zmiany.
- [ ] GREEN: nowe pliki + `tests/integration/reporting.test.ts tests/integration/mock-test-reporting.test.ts tests/integration/progress-rebuild.test.ts`; kontrola EXPLAIN na syntetycznych danych okresu 31 dni i zestawów z nakładającymi się skill_version, brak query per próba. Zapisać wyniki, bez udawania pomiaru produkcyjnego.
- [ ] Commit: `feat: aggregate daily learning overview without side effects`.

### Zadanie 4: HTTP, awarie i współbieżna migawka

**Files:** Create `apps/web/src/integrations/learning-overview-route{,.test}.ts`, `apps/web/src/app/api/v1/integrations/learning-overview/route.ts`, `tests/integration/learning-overview-concurrency.test.ts`; Modify `packages/server/src/errors.ts`, `packages/contracts/src/messages.ts`; ewentualne nowe testy mapowania błędów są w pliku route.test.ts. Nie zmieniać globalnego logowania niezwiązanych tras.

**Interfaces:** `handleLearningOverviewRequest(request:Request, services:Services, limiter:IntegrationReadLimiter):Promise<Response>`; `IntegrationReadLimiter.consume(principal:IntegrationPrincipal):void` kontrolowany przez Clock, singleton procesu, klucz token id, 60/min; callback getLearningOverview wywołuje consume. Route GET → handler, dynamic force-dynamic, runtime nodejs. POST/PUT/PATCH/DELETE niedostępne.

- [ ] Napisać testy Request/Response: valid 200/schema/no-store, cookie rodzica bez Bearer 401, Bearer bez scope 403, błędne query 400, unknown child 404, request 61 →429 i Retry-After, odnowienie okna, brak SQL/Authorization/cause/secret w odpowiedzi i logach. Nieznane parametry i zdublowany parametr days są odrzucane; redirect nie powstaje. Odpowiedzi błędów również no-store.
- [ ] Napisać test dwóch połączeń PostgreSQL: odczyt na otwartej migawce, druga transakcja finalizuje mowę; w pierwszej odpowiedzi pending bez nowej oceny, w kolejnej completed z oceną przypisaną do pierwotnego received_at. Synchronizacja przez bariery testu, bez arbitralnych sleep. Drugi przypadek: deleteChild w konkurencyjnej transakcji daje pełny stan sprzed usunięcia albo brak po usunięciu, nigdy połączenie obu.
- [ ] Napisać test faktycznego READ ONLY: wewnętrzny test-reader próbuje INSERT i otrzymuje błąd PostgreSQL; raport zachowuje liczby i hashe tabel learning_sessions/attempts/assessments/learning_events/event_exposures/child_skill_progress/integration_tokens przed i po dwóch GET. Zapis innej transakcji rozliczać osobno.
- [ ] RED: `npx --yes pnpm@10.34.6 test:unit apps/web/src/integrations/learning-overview-route.test.ts`; `npx --yes pnpm@10.34.6 test:integration tests/integration/learning-overview-concurrency.test.ts`.
- [ ] Zaimplementować parsowanie Bearer/query, kontrolowany limiter, format ApiError i bezpieczną granicę wyjątków. DB timeout/połączenie → learning_summary_unavailable/503/retryable=true; inne internal nadal zredagowane 500. Używać jawnego allowlist błędu, bez wyrzucenia driver cause do globalnego withApi logowania. Dodać polski komunikat w messages.
- [ ] GREEN: powtórzyć nowe pliki + auth-profiles/reporting/history/speech integration. Test auth nie wywołuje realnego Azure/OpenAI.
- [ ] Commit: `feat: expose authenticated read-only learning overview endpoint`.

### Zadanie 5: Instrukcja uruchomienia, końcowe sprawdzenia i review

**Files:** Create `docs/integrations/hermes-learning.md`, `tests/e2e/learning-overview-api.spec.ts`; Modify `docs/SPEC.md`, `docs/architecture.md`, `docs/folder-structure.md`, `docs/implementation-plan.md`; update progress log. `.env.example` zmieniać tylko dla faktycznie dodanych zmiennych, nie wpisywać sekretu tokenu do web env, gdy korzystamy z tabeli.

**Interfaces:** Deliverable: branch API gotowa do review/PR i przenośny schema/fixture dla planu B. Instrukcja CLI używa `node apps/worker/node_modules/tsx/dist/cli.mjs apps/worker/src/integration-tokens.ts ...` wewnątrz obrazu worker; nie wystawia tokenu w shell history.

- [ ] E2E RED na fake-providerach: HTTP 200/schema i odmowa wejścia do Parent API z samym tokenem integracji, no-store, odwołany token 401. Nowy fixture wydaje token testowy w pamięci, nie w nagraniach/screenshotach/logach.
- [ ] Uzupełnić dokumenty: zakres informacji przekazywanych modelowi Hermesa, źródło dat, rotacja/revoke przez CLI, setup/prywatna brama/HTTPS, brak nowego portu, instrukcja eksportu schema i kopii zgodnej wersji dla B. E2E GREEN: `npx --yes pnpm@10.34.6 test:e2e tests/e2e/learning-overview-api.spec.ts`.
- [ ] Verification-before-completion: `npx --yes pnpm@10.34.6 test:unit`, `test:integration`, `test:e2e`, `typecheck`, `build` oraz `git diff --check`; wykonać faktycznie osobne komendy z prefiksem pnpm, zapisać wyniki. Bez testów prawdziwych dzieci. Regresje z tabeli MVP: R01 kwalifikacja według received_at, R03 niezmienność historii i CASCADE profilu, R04 prezentacja bez wyniku oraz idempotencja. R02/R06 dotyczą mediów, R05 chroni scheduler przed ujawnieniem dystraktorów, R07 dotyczy wariantów mowy; nowy odczyt nie zmienia tych ścieżek, chronią je istniejące pełne integration/E2E.
- [ ] Requesting-code-review: dedykowany niezależny recenzent całego BASE_SHA..HEAD + uncommitted diff, spec + plany A/B/C + Review Focus + log testów. Receiving-code-review dla uwag; Critical/Important naprawić i zweryfikować, Minor jawnie odłożyć. Zachować raport review w dzienniku.
- [ ] Finishing-a-development-branch: selectively commit dokumentację; push feature branch i PR do main z niezależnym review w opisie, attach_artifact. Bez merge. Do czasu PR/owner merge/konfiguracji nie nazywać API działającym na Coolify.

## Handoff i granica wdrożenia

- [ ] Właściciel przegląda spec §7 i plany A/B/C. Domyślne wykonanie inline przez bieżącego agenta (executing-plans), bez ponownego pytania o delegację.
- [ ] Plan B konsumuje schema i fixture tego repo z zatwierdzonego commita/PR; źródłowe pliki MCP/SKILL.md są w integrations/umiem-mcp. Oba artefakty mają tę samą schemaVersion=1.
- [ ] Wdrożenie Coolify i wydanie prywatnego tokenu są etapem planu C po akceptacji wykonania/wdrożenia i przejściu bramek. Ten etap planowania nie wywołuje Coolify, nie tworzy tokenów i nie wysyła danych modelowi.
- [x] Self-review planu: pokrycie spec, jednoznaczne kroki, zgodne interfejsy, pięć Review Focus z przypisanymi testami, proporcjonalność; wyniki sprawdzenia dokumentów zapisać w raporcie końcowym.
