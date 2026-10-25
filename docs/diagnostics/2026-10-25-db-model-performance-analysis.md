# Analiza modelu danych i wydajności zapytań — Knowli / Umiem!

- Data: 2026-10-25
- Baza kodu: `main` == `origin/main` == `ee256f873eeceb637f868442c948e9594933ed19`
- Worktree: `feature/db-refactoring` (ten sam commit, drzewo czyste przed tym raportem)
- Zakres: wyłącznie research. Nie zmieniono kodu ani migracji. Niniejszy plik jest jedynym zapisem.
- Metoda: inwentarz schematu Drizzle i migracji, audyt ścieżek odczytu historii dziecka, raportów i silnika nauki, audyt kształtu zapytań, przegląd dowodów/testów oraz niezależna rewizja sceptyczna z opcjami.
- Zastrzeżenie pomiarowe: brak statystyk produkcyjnej bazy (`pg_stat_statements`, `EXPLAIN ANALYZE` na realnych danych, rozmiary tabel per dziecko). Wszystkie czasy poza przytoczonym benchmarkiem syntetycznym są **niezweryfikowane** i oznaczono je jako hipotezy. Asymtotyka (wzrost kosztu z wolumenem) jest faktem z kodu; odczuwalność przy obecnej skali rodzinnej nie jest udowodniona.

## 1. Werdykt

**Model danych nie jest głównym problemem.** Obecny układ — historia append-only jako źródło prawdy (`attempts`, `assessments`, `learning_events`, `event_exposures`) plus odtwarzalne projekcje (`child_skill_progress`, `child_objective_progress`, `child_target_exposures`) — jest kierunkowo poprawny i zgodny z zasadami z `AGENTS.md` (historia → projekcja, treść opublikowana niezmienna, kwalifikacja próby zamrażana przy `received_at`).

Chorują natomiast trzy rzeczy:

1. **Zapytania omijające projekcje.** Część odczytów (planowanie sesji słówek, część raportów, karta pracy rodzica) wraca do surowej historii i odtwarza ją w JS przy każdym żądaniu, mimo że projekcja już istnieje. Wzorzec poprawny już jest w kodzie: `readDeckLearningOverview` (`packages/server/src/modules/reporting/deck-learning-overview.ts:41-99`) wprost deklaruje „no attempts… replay” i czyta tylko projekcje.
2. **Brak 4–6 indeksów pod udokumentowane filtry.** Najbardziej bolący brak: `assessments` ma tylko PK `(attempt_id, skill)` i `assessments_skill_history_idx(skill_version_id, attempt_id)` (`packages/server/src/db/schema.ts:605,621`), podczas gdy raporty i historia filtrują po `child_id`. Zweryfikowano, że migracje `packages/server/drizzle/*.sql` nie dokładają ukrytych indeksów poza `schema.ts`.
3. **Zapytania bez zakresu (lifetime-load).** Dwa odczyty ładują całą historię życia dziecka, aby odpowiedzieć o jeden dzień albo okno ≤31 dni: `readParentWorkCard` i `mockRows` w `getLearningOverview`. To defekt granicy zapytania niezależnie od dzisiejszych czasów.

Przy skali jednej rodziny większość kosztów asymptotycznych jest dziś prawdopodobnie nieodczuwalna: jedyny zapisany benchmark (10 000 ocen / 50 000 zdarzeń / 2500 zakresów) daje historię p95 101,1 ms i `listKidDecks` p95 165,2 ms (`docs/diagnostics/profile-navigation-benchmark-results.md:40-52`). Wariant 10× (100 000 ocen) nigdy nie został zapisany z liczbami — to główna luka dowodowa. **Rekomendacja: krok 0 (pomiar), potem opcja A (indeksy + przepisanie zapytań, zero ryzyka domenowego). Opcja B (projekcja przyrostowa) tylko warunkowo. Opcja C (przebudowa modelu) odrzucona na dziś.**

## 2. Mapa obecnego modelu

### 2.1. Źródła

- Autorytatywny schemat TypeScript: `packages/server/src/db/schema.ts:26-32` (schemat `learning_app`, 27 tabel).
- Migracje: `packages/server/drizzle/0000-0021` (22 pliki, journal kompletny). Stan końcowy migracji = te same 27 tabel co TS (tabele `reward_*` z 0012/0015/0016 usunięto w `0021:48-56`).
- `docs/schema.sql:1-2` to projekt 1.2 — dokument historyczny, częściowo nieaktualny (brak m.in. `integration_tokens`, `lesson_verdicts`, `child_objective_progress`, `child_target_exposures`, kolumn `activity_*`, `reward_points`). Nie traktować jako kontraktu.
- Schemat Graphile Workera (kolejka w tej samej bazie) nie był audytowany — poza `schema.ts` i migracjami aplikacji.

### 2.2. Tabele rosnące bez ograniczeń (fakt ze schematu)

Historia nauki jest append-only; kasuje ją tylko kaskada usunięcia profilu (triggery strażnicze `guard_history_delete`, migracja `0001:179-189`):

| Tabela | Definicja | Wzrost |
| --- | --- | --- |
| `attempts` | `schema.ts:526` | 1 wiersz / próbę (+3 JSONB: `answer/context/feedback`) |
| `assessments` | `schema.ts:574` | N ocen / próbę (PK `attempt_id, skill`), bez kolumny czasu |
| `learning_events` | `schema.ts:625` | wiele / zadanie (8 kindów, `schema.ts:647`) |
| `event_exposures` | `schema.ts:663` | zdarzenie × `target_key` (też dystraktory) |
| `session_tasks` | `schema.ts:482` | budżet / sesję (+3 JSONB snapshotów na zawsze) |
| `learning_sessions` | `schema.ts:415` | 1 / sesję (do 5 JSONB) |
| `lesson_verdicts` | `schema.ts:769` | per unikalna odpowiedź × `prompt_version`, bez TTL |
| `generation_runs` | `schema.ts:375` | JSONB `input` zostaje po zakończeniu |
| `media_assets` | `schema.ts:318` | trigger blokuje DELETE `ready` (`0001:95`) — generacje narastają |
| `item_revisions` / `skill_versions` | `schema.ts:231,205` | per wersja zestawu; payload kopiowany fizycznie (`copyRevisionsSkillsAssets`, `decks.ts:274-333`) |

Nigdzie nie ma partycjonowania ani archiwizacji (0 trafień `PARTITION/GIN/BRIN`). Jedyna retencja czasowa: `activity_report` znika po 7 dniach (`session-activity.ts:42,673-684`, worker co 1 h). Przy skali jednordzinnej partycjonowanie byłoby przedwczesne — hipoteza, bez statystyk prod niezweryfikowana.

### 2.3. Historia vs projekcje

Rozdział jest poprawny:

- **Źródło:** `attempts`, `assessments`, `learning_events`, `event_exposures` (niezmienne, triggery strażnicze w `0001`).
- **Projekcje odtwarzalne:** `child_skill_progress` (`schema.ts:712`, PK `child, skillVersion, policy`), `child_objective_progress` (`schema.ts:808`), `child_target_exposures` (`schema.ts:746`, PK `child, targetKey`). Pełna odbudowa: `progress-rebuild.ts` (skan całej historii dziecka — operacja administracyjna/offline).
- **Brak projekcji raportowych.** Raport rodzica, aktywność 7 dni i raport Hermesa liczą się ad hoc z historii przy każdym żądaniu; brak tabeli agregatów dziennych i brak cache (odpowiedź Hermesa jest wręcz `no-store`, `apps/web/src/integrations/learning-overview-orpc.ts:121`).
- **Odstępstwo (nie-wydajnościowe):** po migracji `0021` saldo punktów dziecka to tylko kolumny `child_profiles.reward_points/reward_remainder_ms` (`schema.ts:101-102`). Ledger usunięto, więc saldo nie jest odtwarzalne z osobnej historii (jedyny ślad: `activity_review` JSONB per sesja). Decyzja właściciela — zob. §7.

### 2.4. JSONB i denormalizacja

- 20 kolumn JSONB (m.in. `item_revisions.payload` `schema.ts:242`, `assessments.details` `:593`, `session_tasks.public_prompt/answer_key/context` `:494-496`, 5× w `learning_sessions` `:431-451`). Brak indeksów GIN/wyrażeniowych; zapytania wchodzą w JSONB operatorami (`details->'confusion'`, `details ? 'confusion'`, `payload->>'source'`, `reporting.ts:212-265`).
- Denormalizacja świadoma (kompozytowe FK, snapshoty zadania): `child_id` duplikowany w zadaniach/próbach/ocenach/zdarzeniach, `public_prompt`/`answer_key` jako niezmienne snapshoty per zadanie, `target_key` tekstowy zamiast FK ekspozycji. To jest kontrakt domenowy, nie defekt.
- Redundancje indeksów (kandydaci do usunięcia po weryfikacji `pg_stat_user_indexes`): `lesson_verdicts_revision_idx` jest prefiksem unika cache (`schema.ts:797-798`); `child_target_exposures_target_idx(target, child)` odwraca PK, a zapytania filtrują `child + target IN` (`learning-snapshot.ts:190-191`).
- Drift narzędziowy: `meta/` ma tylko 14 snapshotów na 22 migracje (brak 0002, 0011, 0012, 0015, 0018-0021), więc następne `drizzle-kit generate` policzy diff od snapshotu 0017 — ryzyko konfliktu z ręcznymi migracjami 0018-0021. Triggery i self-FK `skill_versions` istnieją tylko w SQL (`schema.ts:225-227`).

## 3. Potwierdzone problemy (kształt z kodu; wzrost z wolumenem)

Kolejność: najpierw ścieżki gorące (dziecko w sesji), potem zimne (rodzic/Hermes), potem administracyjne. „Potwierdzone” = kształt zapytania przeczytany w ciele kodu na `ee256f8`. Czasy w ms nie były mierzone (poza §4).

### 3.1. [Gorąca próba] Replay historii umiejętności przy każdej ocenionej próbie

`finalizeAttemptRow` (`packages/server/src/modules/learning/attempts.ts:331-335`) per ocenianą umiejętność woła `readSkillHistory` + `persistSkillProjection`. `readSkillHistories` (`skill-history.ts:28-72`) pobiera **bez LIMIT** wszystkie `assessments` zakresu `(child, skillVersion, skill)` z joinami `attempts` + `session_tasks` (w tym JSONB `public_prompt` każdego historycznego zadania, potrzebny tylko do policzenia odrębnych opcji — `skill-history.ts:42,95-98`), a `projectProgress`/`projectSeries` (`domain/progress.ts:28-47`, `domain/series-projection.ts:60-98`) odtwarzają serię od zera w JS. Koszt zapisu jednej próby rośnie liniowo z historią tej umiejętności, w transakcji trzymającej blokadę sesji (`lockSession`/`lockTaskWithSession`, `sessions.ts:111-122`).

Zastrzeżenie sceptyka: replay dotyczy 1 zakresu na umiejętność (zwykle 1–2 na próbę), nie całego dziecka; po opanowaniu słówka jest rzadko wybierane (samoograniczenie). **Proste okno „ostatnich N” nie jest dowodnie równoważne**: projekcja potrzebuje m.in. `masteredEver`, składu kierunków reading w oknie (`domain/progress.ts:65-82`) i wpisów bieżącej polityki, a kwalifikacja wpisu jest liczona przy odczycie, nie zapisana przy próbie. Poprawna naprawa to projekcja przyrostowa (opcja B), nie sam `LIMIT`.

W lekcjach gorzej: `objectiveHistory` (`lessons/lesson-attempts.ts:457-504`) przy każdej próbie pobiera wszystkie oceny `skill='objective'` dziecka (wszystkie cele/przedmioty) i filtruje `details->objectiveId` w JS, bo `objective_id` nie jest kolumną `assessments` (`db/schema.ts:574-623`), tylko JSONB. Kandydat: kolumna `objective_id` (+ `subject_id`) albo indeks wyrażeniowy — do decyzji po pomiarze skali lekcji.

### 3.2. [Gorący start sesji] Planowanie słówek ładuje historie bez LIMIT, w pętli slotów

`readLearningSnapshot` (`learning-snapshot.ts:43,55,78-95,133-152`) ładuje: pełne historie wszystkich umiejętności zestawu, wszystkie historyczne zadania recall/speech/letter/exposure dla wersji umiejętności (bez okna czasu — tylko po to, by wyliczyć `firstIssued/introduced`, mimo że `firstIssuedAt` już jest w `child_skill_progress`), oraz wszystkie oceny rozpoznawania dla rewizji (ranking pomyłek). Równolegle `loadHistoricalSupport` (`sessions.ts:858-904`) ładuje wszystkie zadania + próby + oceny dla rewizji zestawu. `createTrainingSessionPlan` (`sessions.ts:921-948`) woła `planNextTask` w pętli do `taskBudget*2+32` slotów, a każde wywołanie ponawia ~9 zapytań (cache tylko polityki i snapshotu, `sessions.ts:587-592`) — oszacowanie z kodu rzędu 200–300 zapytań na start typowej sesji, w jednej transakcji trzymającej blokadę profilu (`sessions.ts:249-251`). **Liczby zapytań nie zmierzono** (`capturePoolQueries` istnieje w testach, ale nie użyto go do tej ścieżki).

Wzorzec naprawy już istnieje: lekcje robią jeden `loadLessonPlanningSnapshot` + pętlę w pamięci (`lesson-sessions.ts:330-419,499-545`). Ścieżka legacy bez zapisanego `training_plan` płaci pełny koszt przy **każdym** zadaniu (`sessions.ts:1107`) — nie wiadomo, czy takie sesje jeszcze istnieją w produkcji.

### 3.3. [Gorące odczyty] Ekspozycje czytane z historii zamiast z gotowego agregatu

Istnieje utrzymywany przyrostowo `child_target_exposures` (PK `child, targetKey`; zapis `events.ts:120-130`), ale gorące ścieżki nadal joinują `event_exposures` + `learning_events`: kwalifikacja 300 s (`attempts.ts:110-117`), `answerPreviouslyExposed` lekcji pobierający wszystkie wiersze klucza i robiący `.some` w JS (`lesson-attempts.ts:124-133`), zbiory historycznie ujawnionych kluczy bez `DISTINCT` (`sessions.ts:683-694`, w słówkach powtarzane per slot). Przełączenie na lookup po PK usuwa wzrost liniowy z liczbą zdarzeń — bez zmiany modelu.

### 3.4. [Brakujące indeksy — fakt schematu]

Postgres nie indeksuje FK automatycznie. Zweryfikowano w `schema.ts` i we wszystkich `CREATE INDEX` w `drizzle/*.sql` (bez dodatków):

- `assessments`: brak indeksu z `child_id` i z `item_revision_id`; filtry raportów/historii: `reporting.ts:217,241,273`, `learning-snapshot.ts:144-151`, `skill-history.ts:48-56`, `progress-rebuild.ts:117`. Jest tylko `(skill_version_id, attempt_id)` (`schema.ts:621`) — `child`/`skill` są filtrem, nie prefiksem.
- `attempts`: brak `(child_id, received_at)` i `(item_revision_id)`; jest tylko częściowy `attempts_stale_idx` dla `processing` (`schema.ts:565-570`). Dotyczy `ORDER BY received_at DESC LIMIT 30` i `count(*)` aktywności (`reporting.ts:175-189`).
- `session_tasks`: brak `(item_revision_id, issued_at)` i `(child_id, issued_at)`; jest tylko `(session_id, ordinal)` (`schema.ts:519-522`). Dotyczy `learning-snapshot.ts:78-95`, `sessions.ts:864-877`, `parent-work-card.ts:57-58`.
- `learning_events`: brak `(child_id, occurred_at DESC)`; `(child, item, occurred)` (`schema.ts:656`) ma `item_id` w środku, więc zakres czasu bez `item_id` nie jest ciągły. Brak też ogólnego `(task_id, kind, occurred_at)` poza częściowym audio (`:657`).
- `event_exposures`: brak `(child_id, target_key)`; jest PK `(event_id, target_key)` i `(target_key, event_id)` (`schema.ts:673-679`). Dotyczy `progress-rebuild.ts:207-209` i lekcyjnego `lessonObjectiveProgress` (`lesson-supervision.ts:201`).
- `item_revision_skills`: brak indeksu na `skill_version_id` (PK zaczyna się od `item_revision_id`, `schema.ts:275`).
- `generation_runs`: brak indeksu na `deck_version_id` przy filtrze `(kind, deck_version_id, state)` (`generation-runs.ts:98-104`).

Czy planer wybiera dziś seq scan, zależy od rozmiarów — niezweryfikowane bez `EXPLAIN`.

### 3.5. [Zimny, ale lifetime] Karta pracy rodzica ładuje całą historię dla jednego dnia

`readParentWorkCard` (`packages/server/src/modules/reporting/parent-work-card.ts:10,25-68`): pobiera **wszystkie** sesje dziecka bez filtra daty (z JSONB `context` + `activityReport`), **wszystkie** próby dziecka z pełnym wierszem `attempts` (JSONB `answer/feedback`), **wszystkie** `session_tasks` dziecka — a dzień filtruje dopiero w JS po strefie z `context` każdej sesji (`:35-64`). Do tego sekwencyjna pętla `resolveInterruptedSessionActivity` per kandydat (transakcja + zapis w ścieżce odczytu, `:18-23`) i filtry `tasks.filter` per sesja dające O(sesje × zadania). Koszt jest funkcją wieku konta, nie zapytania. To ścieżka zimna (otwierana ręcznie), ale kształt jest nieobronny docelowo.

### 3.6. [Zimny, Hermes/MCP] `getLearningOverview` — surowe wiersze, agregacja w JS, N+1 per zestaw

`getLearningOverview` (`reporting/learning-overview.ts:130`, jedna transakcja REPEATABLE READ, `statement_timeout` 8 s `:137-139`):

- 4 surowe zapytania okresu bez agregacji SQL i bez LIMIT (`:179-271`); `activityPoints` niemal duplikuje `attemptRows`/`eventRows` (różnica tylko −120 s), więc ten sam zakres jest skanowany 2×. Agregacja dzień/zestaw/umiejętność w JS, `Intl.DateTimeFormat` tworzony per wiersz (`:53-58`).
- `mockRows` (`:279-305`) **bez żadnego okna czasowego**: wszystkie zakończone kartkówki dzieci od początku, parsowanie JSONB `context.mockTestReport` i filtr dnia w JS.
- Pętla per aktywne przypisanie (`:308-327`): sekwencyjnie `readPublishedProgress` + `currentPracticeItems` dla każdego zestawu, wewnątrz długiej transakcji read-only.

`readPublishedProgress` (`published-progress.ts:45,84-92`) przy każdym wywołaniu pobiera **wszystkie** wiersze `child_skill_progress` dziecka (tylko `child_id` + `lastReviewedAt IS NOT NULL`, bez filtra `skillVersionId` zestawu) i deduplikuje w JS; `statusFor` chodzi po łańcuchu predecessorów w JS 2× per item×skill (`:103-126`). To najtańszy kandydat naprawy w całym audycie (jeden `inArray(skillVersionId)`), bez zmiany modelu. Kontrakt ogranicza okno do ≤31 dni (`packages/contracts/src/learning-overview.ts:5-6`), limiter dopuszcza 60/min/principal — bezpieczniki istnieją, ale `mockRows` i pętla przypisań okna nie mają.

### 3.7. [Zimny, panel rodzica] `getProgress` i dowody dziecka na wszystkich wersjach zestawu

`getProgress` (`reporting.ts:29`) to ~17 sekwencyjnych `await` bez `Promise.all`; `readActivitySummary` (7 dni) jest niezależne od zestawu, więc każda zmiana zestawu w `ProgressPanel` przelicza je od nowa. `readDeckRevisionIds` (`published-progress.ts:37-43`) zwraca rewizje ze **wszystkich wersji zestawu kiedykolwiek**; tablica trafia jako `=ANY(uuid[])` do trzech zapytań `readChildEvidence` (`reporting.ts:211-276`) na ekstrakcjach JSONB bez indeksu funkcyjnego: pomyłki (LIMIT 5, bez okna czasu), wymowa (`DISTINCT ON` po całej historii, bez LIMIT), historia (LIMIT 30 po `ORDER BY received_at DESC` po całej historii; UI pokazuje 10). Agregacje w SQL są — problemem jest zakres i brak indeksów, nie brak `GROUP BY`.

Uwaga: raport wymowy czyta score z `details->'pronunciation'` (`reporting.ts:233-236`), mimo że `assessments` ma kolumny `score/provider/score_scale` (`schema.ts:588-592`). Relacja kolumn vs JSONB wymaga sprawdzenia ścieżek zapisu (zob. §7).

### 3.8. [Start dziecka] Okładki ładują payloady wszystkich rewizji

`listKidDecks` czyta projekcje poprawnie (`deck-learning-overview.ts:41-99`), ale `coverRevisions` ładuje payload **wszystkich** `item_revisions` przypisanych wersji, choć okładka potrzebuje pierwszej pozycji, a liczniki tylko `count` (`kid.ts:107-127,264`). Koszt rośnie z materiałem (np. 500 rewizji), nie z historią, a zmierzony p95 165 ms już go zawiera — optymalizacja (`DISTINCT ON` + `count`), nie ratunek.

### 3.9. [Administracyjne — higiena, nie ból użytkownika]

- `progress-rebuild.ts:92-228`: pełna historia dziecka pod `FOR UPDATE` profilu, upserty per (zakres, polityka), `issuedRows` bez `min(issued_at) GROUP BY`. Z definicji offline z przerwą serwisową (`docs/architecture.md:236`).
- `decks.ts` `applyItems` (`:412-455`): zapis szkicu 30 słówek to ~200 zapytań wiersz-po-wierszu (ręczna akcja rodzica).
- Kartkówki: `createMockTestPlan` (`mock-tests.ts:105-119`) — surowy SQL z 3 skorelowanymi `EXISTS` per rewizja; `listMockTests` (`:95-103`) — LIMIT 20, potem osobna transakcja raportu per sesja.
- Drobiazgi stałe: `taskCounts` liczone przez pobranie zadań sesji w JS (`sessions.ts:129-138`), `lastActivityAt` jako 3 agregaty `MAX` z joinami (`sessions.ts:144-166`, kandydat na kolumnę `learning_sessions.last_activity_at`), szerokie `select()` po PK ciągnące wszystkie JSONB, pula pg bez jawnego `max`/`statement_timeout` (`db/client.ts:22`).

Poziom dowodów: wywołania providerów są **poza** transakcjami (grader lekcji `lesson-attempts.ts:839-923`, STT/wymowa `speech.ts:271`, ocena aktywności `session-activity.ts:402-549`) — zgłoszone problemy nie dotyczą trzymania blokad na sieci.

## 4. Hipotezy niezweryfikowane bez produkcyjnych statystyk

Poniższe nie mają dowodu pomiarowego na `ee256f8`. Podano je, aby raport nie udawał wiedzy, której nie ma.

### 4.1. Co właściwie zmierzono (jedyne liczby)

- Jedyny benchmark: `tests/integration/profile-navigation-benchmark.test.ts` (opt-in `UMIEM_NAV_BENCHMARK=1`), prawdziwy PostgreSQL 17 w Dockerze (PGlite w kodzie nie istnieje). Fixture `tests/fixtures/profile-navigation-world.ts`: 2 dzieci × 10 zestawów × 50 rewizji, baseline 10 000 ocen / 50 000 zdarzeń / 2500 zakresów; wariant 10× istnieje w kodzie, ale **bez zapisanych liczb**.
- Zapisane wyniki baseline (`docs/diagnostics/profile-navigation-benchmark-results.md:40-52`): legacy bez indeksu mediana 1511,9 ms; legacy z indeksem 115,9 ms; `currentReader` 95,6 ms (p95 101,1); `listKidDecks` 159,6 ms (p95 165,2). Liczb nie zweryfikowano w tym researchu.
- Jedyny dowód produkcyjny (`docs/diagnostics/2026-10-18-profile-navigation-latency.md`) dotyczy commitu `5356529` **sprzed** naprawy projekcji (historia 8,84–9,10 s przy ~2204 ocenach i ~18,5 tys. zdarzeń/profil). To kalibracja wolumenu, nie stan obecnej produkcji.
- W tym researchu uruchomiono tylko mały przebieg harnessu (`profile-navigation-benchmark.test.ts`: 4 passed, 2 skipped, 6,87 s) — bez czasów skali.
- Jedyny `EXPLAIN` w testach (`history.test.ts:707-725`) wymusza indeks przez `enable_seqscan=off`, więc nie dowodzi wyboru planu przy realnych statystykach.
- Jedyne budżety: §7 planu naprawy (`docs/diagnostics/2026-10-18-profile-navigation-repair-plan.md:323-352`): historia p95 ≤250 ms, `listKidDecks` p95 ≤500 ms, mediana 10× ≤1,5× baseline. `docs/SPEC.md` i `docs/architecture.md` budżetów zapytań nie zawierają. Brak progów dla `getProgress`, `readActivitySummary`, `getLearningOverview`, `rebuildProgress`.

Szacunek rzędu wielkości (arytmetyka, nie pomiar): 1 sesja/dzień × 20 zadań ≈ 7 tys. zadań i 7–15 tys. ocen/dziecko/rok — baseline benchmarku to mniej więcej rok intensywnej nauki jednego dziecka.

### 4.2. Hipotezy otwarte

1. Czy planer przy obecnych rozmiarach wchodzi w seq scan/sort w §3.4–3.7 — bez `EXPLAIN (ANALYZE, BUFFERS)` na kopii prod nie wiadomo.
2. Czy `statement_timeout` 8 s w `getLearningOverview` był kiedykolwiek trafiony i jak często Hermes/MCP woła raport (dzienny raport vs polling, `days`/`childId`).
3. Koszt TOAST dla `public_prompt`/`payload` — żaden prior nie zmierzył rozmiarów JSONB; krótkie opcje słówek najpewniej mieszczą się inline. Realny zarzut to zbędny transfer kolumny, nie dowód na TOAST.
4. GIN na `details` — operatory `?` działają po prefiltrach `child` + rewizje; GIN mógłby kosztować zapis więcej, niż daje zimnemu raportowi. Dopiero po `EXPLAIN`.
5. Triggery `to_jsonb(NEW/OLD)`, kompozytowe uniki, PK UUID — stały narzut zapisu; przy tempie kilku prób/minutę dziecka prawdopodobnie bez znaczenia, bez pomiaru zapisu nieudowodnione.
6. Skala historii lekcji (`skill='objective'`) — żaden fixture jej nie seeduje w wolumenie, więc potrzeba kolumny `objective_id` jest wnioskiem z kształtu, nie z bólu.
7. Czy istnieją wznawialne sesje legacy bez `training_plan` (§3.2) oraz czy strefa czasowa bywa różna między sesjami tego samego dziecka (warunkuje przeniesienie dnia `parent-work-card` do SQL).
8. Konfiguracja prod PG na Coolify (`shared_buffers`, `work_mem`, JIT, współbieżność web+worker+rebuild) i czy `pg_stat_statements` jest włączone.

## 5. Opcje A/B/C, rekomendacja i kolejność (małe PR-y)

### Opcja A — zachowawcza, bez zmiany modelu. REKOMENDOWANA (po kroku 0).

Zakres (migracja tylko-addytywna + przepisanie zapytań):

- Indeksy: `assessments(child_id, skill_version_id, skill)`, `attempts(child_id, received_at DESC)`, `attempts(item_revision_id)`, `session_tasks(item_revision_id, issued_at)` / `(child_id, issued_at)`, `learning_events(child_id, occurred_at DESC)` (ew. częściowy `WHERE sealed`), `event_exposures(child_id, target_key)`; rozważyć indeks wyrażeniowy `(details->>'objectiveId')` dla lekcji.
- Przepisania: `parent-work-card` na zakres UTC dnia ± bufor stref z wąskimi kolumnami; `mockRows` z filtrem `ended_at`; `readPublishedProgress` z filtrem `skillVersionId` zestawu (w overview: jeden przebieg batch dla wszystkich zestawów); `learning-overview` bez duplikatu `activityPoints` + agregacja `GROUP BY`/`date_trunc` w SQL, cache `Intl.DateTimeFormat`; odczyty ekspozycji z `child_target_exposures`; snapshot startu słówek wg wzorca lekcji (jeden odczyt + pętla w pamięci, agregaty `min(issued_at)`/`exists` zamiast wierszy); okładki kid przez `DISTINCT ON` + `count`; batch w `decks.applyItems`, planie/raportach kartkówek i `progress-rebuild`.
- Opcjonalnie w A: denormalizacja `received_at` do `assessments` (tania, zdejmuje join z każdej historii) oraz wstępnie policzona liczba odrębnych opcji zamiast pobierania `public_prompt`; kolumny zamiast `details.confusion` i ujednolicenie wymowy na istniejące kolumny `score/provider` (po rozstrzygnięciu §7 pkt 9).

Ryzyko dla reguł `AGENTS.md`: **zerowe semantycznie** — historia, kwalifikacja i odtwarzalność bez zmian; ryzyko to regresje kształtu wyników, łapalne 52 plikami testów integracyjnych i strażnikami liczby zapytań. Zysk: znikają wszystkie koszty „lifetime” i planer dostaje indeksy pod udokumentowane filtry. Nie znika asymptotyczny replay per próba — przy skali rodzinnej świadomie go przyjmujemy. Koszt: mały/średni, iteracyjny, bez przestoju.

### Opcja B — projekcje przyrostowe. WARUNKOWA.

Zakres: stan przyrostowy w `child_skill_progress` (okno sukcesów z kierunkiem, `masteredEver`, `lastQualifyingAt`/`lastSuccessAt`, kwalifikacja materializowana przy finalizacji próby), tak by finalizacja aktualizowała projekcję z jednego nowego wpisu, a pełny replay został wyłącznie w `progress-rebuild`; kolumna `objective_id` (+ `subject_id`) w `assessments` z backfillem z `details`; read-modele raportowe (podsumowanie sesji przy zamknięciu, agregat dziecko-dzień). Migracja: kolumny/tabele projekcyjne + jednorazowy backfill z historii + podbicie `projectionVersion`.

Ryzyko: **średnie** — drugie wyliczenie tego samego statusu (replay vs przyrost) musi być dowodnie równoważne przy zmianie polityki, zmianie wersji umiejętności i regułach reading/objective. Warunek wejścia: test równoważności (oracle: multizbiór replay vs incremental na fixture wolumenowym) oraz przekroczenie uzgodnionych budżetów na ścieżkach gorących po opcji A / przy fixture 10×. Bez tego testu opcja B narusza zasadę odtwarzalności.

### Opcja C — głębsza zmiana modelu. ODRZUCONA NA DZIŚ.

Czysty event-sourcing (model już jest historia + projekcje), partycjonowanie miesięczne, archiwum zimne, deduplikacja payloadów po hashu, rezygnacja z kompozytowych FK — rozwiązują problemy skali (miliony wierszy/dziecko, wielorodzinność), których żaden prior nie wykazał. Ryzyko najwyższe dla filarów: triggery niezmienności, kompozytowe FK, kaskadowe usuwanie profilu, regresje R01–R07. **Próg powrotu:** np. > kilkaset tysięcy ocen/dziecko albo przekroczenie p95 przy fixture 10×–40× po opcjach A/B, albo decyzja o wielorodzinności.

### Kolejność jako małe PR-y

1. **PR-0 (pomiar, bez migracji):** §6 — liczby z prod + benchmark 10× zapisany do `docs/diagnostics/`.
2. **PR-A1:** indeksy (§3.4) — jedna migracja addytywna; wcześniej rozstrzygnąć brakujące snapshoty Drizzle (§2.4), inaczej `generate` policzy diff od 0017.
3. **PR-A2:** `parent-work-card` (zakres dnia) + `mockRows` (filtr `ended_at`) + `readPublishedProgress` (filtr zestawu) — czyste przepisania odczytów.
4. **PR-A3:** `learning-overview` (jeden przebieg, agregacja SQL) + batch kartkówek; przy zmianie DTO/znaczenia sprawdź wpływ na MCP i `skills/umiem-learning/SKILL.md` zgodnie z `AGENTS.md` (samo przepisanie zapytania bez zmiany kontraktu MCP nie zmienia).
5. **PR-A4:** start sesji słówek wg wzorca lekcji + ekspozycje z `child_target_exposures` + okładki `DISTINCT ON/count`.
6. **PR-B (warunkowo):** projekcja przyrostowa z testem równoważności; osobno ewentualnie agregat dzienny.

Każdy PR: testy obszaru (`reporting`/`learning`) + testy architektoniczne modułów, wynik `EXPLAIN` przed/po na fixture wolumenowym w opisie PR; wpływ API → MCP → skill jawnie odnotowany.

## 6. Plan pomiarowy przed przebudową (krok 0)

Żadna decyzja poza opcją A nie powinna zapaść bez liczb. Minimum:

**A. Produkcja (read-only, na kopii/replice dla `EXPLAIN ANALYZE`):**

- `pg_stat_statements` top-20 (najpierw ustalić, czy rozszerzenie jest włączone na Coolify).
- `pg_total_relation_size` + `pg_stat_user_tables`/`pg_stat_user_indexes` dla tabel historii; `count(*)` per dziecko dla `attempts/assessments/learning_events/event_exposures/session_tasks` i tempo wzrostu.
- `SHOW` wybranych ustawień (`shared_buffers`, `work_mem`, JIT) i rozmiar wolumenu.
- `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` kandydatów z §3 na kopii bazy.

**B. Benchmark syntetyczny (istniejący harness, ten sam protokół: cold + 5 warm-up + 30 próbek, mediana/p95/max + liczba zapytań przez `capturePoolQueries`):**

- Tiery per dziecko przy stałym materiale widocznym (10 zestawów × 50 rewizji): S = 2,5 tys. ocen (≈ prod 2026-10-18), M = 10 tys. (obecny baseline), L = 50 tys., XL = 100 tys.; zdarzenia 5× ocen; osobno oś „rodzeństwo-szumu” (4 dzieci × L, mierzone 1) i oś lekcji (oceny `objective` — dziś żaden fixture ich nie seeduje w wolumenie).
- Po bulk-seed jawne `ANALYZE` (fixture go nie robi) + zapis rozmiarów tabel/indeksów; rozmiary JSONB zbliżone do realnych.
- Przypadki użycia: `readSkillHistories`, `listKidDecks` (z rozbiciem per zapytanie), `getProgress`, `readActivitySummary`, `getLearningOverview` (cała rodzina), `readDeckLearningOverview`, `readPublishedProgress`, `readParentWorkCard`, finalizacja próby, start sesji, `rebuildProgress` (czas + czas blokady profilu).
- Kryteria planu: brak seq scan na tabelach historii przy L, brak spill do temp, bufory odczytów projekcyjnych rosnące z liczbą zakresów, nie z historią; `EXPLAIN` bez `enable_seqscan=off`.
- Oracle poprawności przy zmianach odczytów: multizbiór wyników stary vs nowy (wzór z benchmarku).

**C. Progi (do zatwierdzenia przez właściciela — dziś kontraktem są tylko progi §7):**

- Utrzymać §7: historia p95 ≤250 ms @M; `listKidDecks` p95 ≤500 ms @M i @XL; mediana XL ≤1,5× M dla odczytów projekcyjnych.
- Propozycja uzupełnień: `getProgress` p95 ≤300 ms @L; `readActivitySummary` p95 ≤200 ms @L; `getLearningOverview` p95 ≤500 ms (rodzina @L); `rebuildProgress` ≤60 s @XL/dziecko; liczba zapytań każdego odczytu niezależna od wolumenu historii. Próg odrzucenia: odczyt rosnący >2× między M a XL przy stałym materiale = kandydat do projekcji/opcji B.
- W CI tylko deterministyczne strażniki (stała liczba zapytań vs historia i vs liczba zestawów/lekcji, zakaz correlated `EXISTS`/OR-scope); progi czasu wyłącznie w benchmarku opt-in na opisanej maszynie (zgodnie z §7 — bez kruchego progu w każdym CI).

**D. Czego lokalnie nie potwierdzimy:** rzeczywistych najwolniejszych zapytań, rozkładów (skew umiejętności, kardynalności `event_exposures`, rozmiarów JSONB), bloatu/autovacuum, I/O hosta, współbieżności web+worker oraz czasów HTTP/sieci — bez pomiaru na tej samej trasie produkcyjnej pozostają nieweryfikowane.

## 7. Pytania do właściciela

1. Który ekran/raport realnie boli dziś i przy jakim dziecku/historii: karta pracy rodzica, Hermes/`learning-overview`, start sesji dziecka czy finalizacja odpowiedzi? Bez tego priorytet A vs B oparty jest na asymptotce, nie na bólu użytkownika.
2. Czy można udostępnić read-only statystyki produkcji (§6A), w tym odpowiedź, czy `pg_stat_statements` jest włączone i jakie są parametry PG na Coolify?
3. Jak często Hermes/MCP woła `getLearningOverview` (raport dzienny czy polling), z jakim `days`/`childId`, jaki jest budżet latencji i czy dopuszczalna jest świeżość z agregatu dziennego zamiast zawsze-live przeliczania (`no-store`)?
4. Czy akceptowalne budżety to progi z §7 planu naprawy (historia p95 ≤250 ms, lista zestawów p95 ≤500 ms) i czy mają objąć też `getProgress`/`workCard`/`learning-overview` (propozycje w §6C)?
5. Czy dopuszczalna jest projekcja przyrostowa umiejętności (opcja B) jako drugie wyliczenie statusu obok replayu — pod warunkiem testów równoważności i zachowania rebuildu z historii jako źródła prawdy — oraz czy kwalifikacja wpisu (liczba opcji, audio, kierunek) może być materializowana przy zapisie próby?
6. Polityka retencji: czy historia prób/zdarzeń/ekspozycji ma zostać online bezterminowo (dziś kasuje ją tylko usunięcie profilu), czy w przyszłości dopuszczalne jest archiwum zimne? Wpływa wyłącznie na sens opcji C.
7. Czy strefa czasowa bywa różna między sesjami tego samego dziecka (podróże)? Jeśli nie, dzień `parent-work-card` da się przenieść do SQL wprost; jeśli tak, potrzebny jest zakres UTC ± bufor + filtr JS na wąskim zbiorze albo kolumna lokalnej daty przy zapisie.
8. Czy historia w `ProgressDto` ma pozostać LIMIT 30 bez paginacji/kursora (UI pokazuje 10), a raporty mają działać na rewizjach wszystkich wersji zestawu, czy tylko bieżącej opublikowanej?
9. Jaka jest relacja kolumn `assessments.score/provider/score_scale` do `details.pronunciation` czytanego przez raport — czy kolumny są martwe, czy zapisywane inną ścieżką? (Ustalenie techniczne, warunkuje ujednolicenie w opcji A.)
10. Czy saldo punktów dziecka po usunięciu ledgera w migracji `0021` ma być odtwarzalne/audytowalne (przywrócenie historii punktów), czy akceptowany jest sam licznik na profilu wsparty `activity_review` per sesja?
11. Czy ambicją pozostaje jedna rodzina self-host (wtedy opcja C jest bezprzedmiotowa), czy planowana jest wielorodzinność/publiczna instancja?
12. Techniczne do zweryfikowania przy wdrażaniu: czy w produkcji istnieją wznawialne sesje legacy bez `training_plan`; czy `drizzle-kit generate` na czystym drzewie daje pusty diff mimo brakujących snapshotów 0002, 0011, 0012, 0015, 0018-0021 (nie uruchamiano — zapis plików poza zakresem researchu); audyt schematu Graphile Workera (poza zakresem).

---

*Raport jest wyłącznie analizą. Nie zawiera commita ani pushu; decyzje wykonawcze wymagają akceptacji właściciela, zwłaszcza progów z §6C i pytań z §7.*




