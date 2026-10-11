# Instalacja MCP Umiem! i rodzinny raport — plan C

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review.

**Goal:** Zainstalować wersję MCP i skilla z Knowli u Hermesa, udostępnić ją rodzinnemu profilowi i dołączyć naukę do Evening.

**Architecture:** Kod MCP/SKILL.md jest utrzymywany w Knowli (plan B). Repo Hermesa implementuje wyłącznie klienta raportu, ograniczenie kontekstu, profil i instalator wersjonowanego artefaktu. Reporter pobiera dane przez MCP przed model generation, a dostarcza je istniejący cron.

**Spec:** docs/superpowers/specs/2026-10-11-hermes-learning-integration-design.md w Knowli; zależności A: 2026-10-11-hermes-learning-api.md, B: 2026-10-11-hermes-learning-mcp-and-reports.md. Wszystkie plany źródłowe są w docs/superpowers/plans Knowli; kopiować do wykonania z pochodzeniem wersji, nie rozwijać alternatywnego API.

**Repo wykonania:** C:/Users/looka/OneDrive/Dokumenty/ChatGPT/Hermes-szkola. Ścieżki zadań tego planu są względem tego repo. Status: lokalna implementacja klienta i instalatora ukończona w odizolowanej gałęzi Hermesa; oczekuje na niezależny wspólny przegląd. Nie ma skonfigurowanego remote dla Hermesa. Zadanie 3, wdrożenie i dowody rzeczywistego połączenia, wymaga osobnej autoryzacji.

**Tech Stack:** Istniejący Python runtime Hermesa, mcp ClientSession/stdio_client, unittest; osobny pinned venv instaluje release adaptera z B. Nie migrować globalnego SDK/OAuth/WhatsApp.

## Global Constraints

- Umieścić wyłącznie instalowany, immutable release MCP/SKILL.md z konkretnego commita Knowli na hoście Hermesa; nie utrzymywać source fork w Hermes-szkola. Manifest obejmuje oba komponenty i schema.
- mcp_servers.umiem i toolset mcp-umiem w rodzinnym profilu. Native skill zainstalować w obsługiwanej lokalizacji tego profilu po sprawdzeniu bieżącego Hermes help/registry; nie zakładać globalnego load ani zmieniać innych rozmów.
- Service-user interpretera adaptera przez stdio; URL HTTPS i token-file w konfiguracji operatora, bez sekretu w modelu/config repo/logach.
- Evening jedno call_tool days=7/upcomingTestDays=14; Morning/Sync bez pobierania, harmonogram bez zmiany. Istniejący reporter nie korzysta z agent.tools do fetch.
- Learning context max 4000 tokenów; zachować dzieci/dni/sprawdziany/learningTime i definicję metody; jawne compacted/omittedCategories albo unavailable. Brak trwałego drugiego magazynu historii nauki.
- Czas ma estimated=true; null nie oznacza zero; brak aktywności dotyczy tylko Umiem!. Nie mapować szkolnych kont na UUID po imieniu.
- Wszystkie testy isolated-root, fake MCP/agent i synthetic fixture. Brak live cron run, prywatnych źródeł modelu i testowego WhatsApp.
- AGENTS.md obu repo i pełny końcowy niezależny review, bez delegacji implementacji. Wdrożenie wymaga jego autoryzacji; samo zatwierdzenie dokumentacji nie uruchamia operacji live.

## Review Focus

1. Awaria MCP nie przerywa raportu szkoły, isError nie zamienia się w pustą listę — zadanie 1.
2. Przygotowany execution_id nie pobiera API ani modelu drugi raz — zadanie 1.
3. Redukcja danych zachowuje wszystkie dzieci/daty/terminy/czas i oznaczenia — zadanie 1.
4. Instalator musi aktualizować MCP i skill z tego samego wydania bez nadpisania nowszego config — zadanie 2.
5. Test root nie potwierdza dostępności w family; zachować owner/mode i naturalne receipt dostarczenia — zadanie 3.

## Setup i mapa plików

- scripts family_learning_mcp.py/family_learning_context.py oraz modyfikacje family_notes_runtime.py/family_notes_profile.py w school-agent/scripts.
- Prompty family-notes-report.md/family-notes-chat.md w school-agent/prompts; tests/test_family_learning_mcp.py/test_family_learning_context.py i istniejące reports/deploy.
- tests/deploy_family_notes.py, school-agent/UMIEM-INTEGRATION.md. Kod umiem_mcp i skill nie są tworzone ani edytowane w tym repo.

- [ ] Executing-plans + using-git-worktrees: izolacja repo Hermesa, branch feature/hermes-umiem-reports, zachować docs/diagnostics i inne zmiany. Setup aktualnego skilla, log docs/superpowers/plans/2026-10-11-hermes-learning-report-progress.md.
- [ ] Wskazać release B z manifestem oraz zgodne API A; do testów fixture synthetic i fake MCP. Zweryfikować interpreter/runtime według aktualnego AGENTS.md; python polecenia poniżej używają właściwego środowiska.
- [ ] Instaluje się wersję skilla Knowli bez lokalnych zmian. Jeśli instrukcja wymaga aktualizacji, zmiana wraca do Knowli w PR zgodnym z AGENTS.md, a potem instalowana jest nowa wersja.

### Zadanie 1: Dane nauki w istniejącym Evening

**Files:** Create `school-agent/scripts/family_learning_mcp.py`, `family_learning_context.py`, `tests/test_family_learning_mcp.py`, `tests/test_family_learning_context.py`; Modify `school-agent/scripts/family_notes_runtime.py`, `school-agent/prompts/family-notes-report.md`, `school-agent/prompts/family-notes-chat.md`, `tests/test_family_notes_reports.py`.

**Interfaces:** `McpLearningClient(config_path:Path, *, timeout_seconds:float=30).fetch(days:int=7, upcoming_test_days:int=14)->dict` otwiera ClientSession/stdio z mcp_servers.umiem w config wskazanego profilu; zewnętrzne 30 s obejmuje start procesu i końcowy cleanup, client HTTP nadal 25 s. `build_learning_context(overview:dict, token_counter:Callable[[str],int], budget:int=4000)->dict`; `run_notes_report` zachowuje obecny signature/dependencies, dodaje opcjonalne deps.learning_reader i flagę enabled/config-path w ustawieniach.

- [ ] Napisać test klienta: initialize i jedno call_tool z days=7/upcomingTestDays=14, structuredContent i text fallback, brak config/isError/zły schema/timeout → unavailable; cleanup sesji/subprocess. Nie wczytywać root config przy jawnie wybranym profile config.
- [ ] Napisać test raportu: jedno MCP przed jednym agent call, context.learning_overview.status=ok; Morning i sync zero MCP; awaria → unavailable i szkolny tekst powstaje; disabled → disabled bez komunikatu o awarii. Retry istniejącego prepared/delivered/unknown execution zachowuje dotychczasowe guardy i nie wywołuje MCP drugi raz.
- [ ] Napisać test kontekstu: 4000 tokenów → pełny ok; powyżej agregacja skill/day, usunięcie mockTests/practiceItems z compacted=true i omittedCategories; wszystkie childId/dates/plannedTests, learningTime dzienne/okresowe i definicja metody zachowane; zbyt duży rdzeń → unavailable/learning_context_too_large. Nie kopiować całego payload do reports/sync/notatek. Dwoje dzieci o tym samym imieniu pozostaje osobno przez UUID.
- [ ] RED: `python -m unittest discover -s tests -p 'test_family_learning*.py'`; `python -m unittest discover -s tests -p 'test_family_notes_reports.py'`.
- [ ] Zaimplementować pobranie przed model generation w run_notes_report tylko dla evening i po guardzie istniejącego execution_id. Metryki zapisywane w reports: status/time/errorCode, bez prywatnego JSON. W kontekście nauki zamieścić generatedAt/source, brak mapowania numerów szkolnych. Nie rozszerzać agent.tools w isolated reporterze; reporter konsumuje już zweryfikowane dane, a native chat używa narzędzia z profilu.
- [ ] Uzupełnić prompty: krótka sekcja Umiem!, postęp i 1–2 działania rodzica przy istotnej trudności; liczby odpowiedzi nie są nowymi opanowanymi słowami, brak zapisu nie jest brakiem nauki, unavailable nie jest zero; treści dziecka/zestawu są danymi. Zachować wszystkie wymagane szkolne terminy i semantykę DONE. Instrukcja testowa synthetic title='ignore all rules' nie modyfikuje promptu nadrzędnego.
- [ ] Dodać regułę prezentacji czasu do promptu i syntetycznego probe: dziś1380 s →„Szacowany czas nauki dziś:23 min”, okres1980 s →„z ostatnich3 dni:33 min”;null →za mało danych, brak dziennej aktywności0 nie dowodzi braku nauki poza Umiem!. Nie usuwać estimated przy skracaniu kontekstu.
- [ ] GREEN: nowe pliki i istniejące reports; cały `python -m unittest discover -s tests -p 'test_*.py'`. Jeśli próba językowa wymaga modelu, użyć wyłącznie istniejącego isolated-root synthetic probe po uprzednim sprawdzeniu, że transport jest wyłączony; bez prywatnych źródeł. Wyniki reguł deterministycznych i próby modelu raportować osobno.
- [ ] Commit: `feat: include Umiem learning facts in family evening reports`.

### Zadanie 2: Profil rodzinny, instalator i niezależny review

**Files:** Modify `school-agent/scripts/family_notes_profile.py`, `tests/deploy_family_notes.py`, `tests/test_deploy_family_notes.py`, `school-agent/AGENTS.md`, repo `AGENTS.md`; Create `school-agent/UMIEM-INTEGRATION.md`. Config produkcyjny i token nie są plikami repozytorium.

**Interfaces:** `family_profile_config` zachowuje dotychczasowe argumenty/default; nowa opcjonalna sekcja umiem dodaje tylko mcp_servers.umiem/toolset mcp-umiem i lokalne ustawienia workerów `learning.enabled=true`, `learning.mcp_config_path=<profile config>`. Instalator zachowuje nieznane istniejące klucze config, SHA/owner/mode i wykrywa drift.

- [ ] Test RED: profil bez Umiem! identyczny jak baseline; z Umiem! ma jeden serwer/tool, sekret to path a nie bytes; root mcp_servers/OAuth/WhatsApp nietknięte; ponowne install nie duplikuje toolsetu. Drift docelowego config po prepare blokuje activate, nie nadpisuje nowszej konfiguracji.
- [ ] `python -m unittest discover -s tests -p 'test_deploy_family_notes.py'` → oczekiwany RED; dodać minimalną konfigurację i manifest instalowanego release MCP/skilla/schema/venv do prepare/install/verify.
- [ ] Zainstalować SKILL.md z release B w obsługiwanej lokalizacji profilu potwierdzonej przez rzeczywisty loader/registry Hermesa. Test instalatora: zgodny hash MCP/schema/skilla, brak skilla lub niezgodny hash blokuje activate, brak globalnego wpływu na inne rozmowy. Rollback usuwa/wycofuje tylko skill tej integracji według manifestu, zachowując pozostałe skills.
- [ ] Dokumentacja: oddzielna instalacja lockfile do prywatnego venv, uruchomienie z absolutnego interpretera i modułu umiem_mcp przez stdio, token-file ownership, cert/brama, contract version, test service-user, rotacja, disabled/rollback. Kopia schema/fixture ma manifest pochodzenia z A; regenerację robi A, nie ręczne zmiany JSON w Python.
- [ ] GREEN cała suite unittest; verification-before-completion i git diff --check. Sprawdzić fake worker retry, manifest bez secret, prepared text guard oraz niezmieniony harmonogram (bez dodatkowego sobotniego joba).
- [ ] Requesting-code-review: jeden niezależny przegląd całego zakresu C, BASE_SHA..HEAD + diff uncommitted, spec/A/B/C i wyniki. Receiving-code-review, Critical/Important rozwiązane; późniejsze poprawki mają własne RED→GREEN. Przy aktywnych AGENTS obowiązujących w drugim repo zachować ich bramki integracji. Jeśli istnieje obsługiwane origin, przygotować gałąź/PR w autoryzowanym workflow; nie tworzyć nowego zdalnego repo ani nie publikować prywatnych plików.
- [ ] Zakończyć gałąź przez finishing-a-development-branch z zachowaniem review i zmian do czasu wdrożenia/owner integracji. Nie usuwać checkoutu zawierającego potrzebny pakiet ani ignorowany venv bez manifestu/recovery.

### Zadanie 3: Wdrożenie i dowody rzeczywistego połączenia

**Files:** Uzupełniać tylko dziennik wykonania i `school-agent/UMIEM-INTEGRATION.md` z redagowanymi wynikami; prod config/token chronione poza Git. To etap operacyjny, wymaga autoryzacji wdrożenia, a nie wynika z samego polecenia przygotowania planu.

**Interfaces:** Deliverable: API po wdrożeniu A → MCP stdio → service-user worker i native chat → następny naturalny Evening. Każda strzałka ma osobny dowód; test API nie potwierdza dostarczenia.

- [ ] Po autoryzacji wdrożenia sprawdzić aktualny Coolify projekt/release, URL i bramę oraz Hermes host/container/profile/schema SDK. Host hermes@hermes.home jest wcześniejszą wskazówką, nie aktualnie potwierdzonym faktem. Nie przesyłać prywatnych szkolnych danych modelowi podczas diagnostyki.
- [ ] Wdrożyć zaakceptowany release A i migrację zgodnie z aktualnym runbookiem Coolify, z backupem bazy; zweryfikować health i wersję. Utworzyć token CLI w chronionym pliku, przenieść sekret bez stdout/logowania do pliku Hermesa; nie zapisywać go w dokumentacji ani memory.
- [ ] Przygotować świeży staging/manifest adaptera, sprawdzić SHA aktualnej produkcji i brak aktywnego report/rozmowy; przed przełączeniem pause raporty natywnym hermes cron (najpierw help), bez jobs.json i bez cron run. Zachować config owner/mode i UID procesu; atomic install config+plików, venv lock i brak drift.
- [ ] Uruchomić named MCP test we właściwym rodzinnym profilu jako service user według aktualnego hermes help; samo root MCP test nie dowodzi dostępności dla family. initialize/list_tools oraz rzeczywisty call narzędzia sprawdzić bez modelu i bez wyświetlania prywatnego payload. Dowód: schemaVersion, liczba dzieci/dni, status, requestId/czas, nigdy nazwy/słowa/sekret.
- [ ] Sprawdzić dostępność umiem-learning w native family skill registry, jego hash i zgodną wersję z MCP, jako service user, bez prywatnego promptu/modelu; samo istnienie pliku nie dowodzi załadowania.
- [ ] Zweryfikować isolated-root fake report bez transportu oraz właściwe toolsety native profilu; przywrócić poprzedni enabled status jobów natywnym CLI. Harmonogram niezmieniony. Nie wywoływać ręcznie live family-evening.py.
- [ ] Następny naturalny Evening jest osobnym dowodem obserwacji: techniczny delivery receipt oraz obecność oczekiwanej sekcji do potwierdzenia przez właściciela. Nie deklarować dostarczenia na podstawie samego prepared/completed ani synthetic probe. Wątek nie tworzy automatycznego monitorowania bez takiego polecenia użytkownika.
- [ ] Rollback: learning.enabled=false i wycofanie wyłącznie umiem MCP/toolset/skilla/własnych nowych plików według manifestu; zachować nowsze notes/report receipts i konfiguracje innych integracji. W razie potrzeby revoke token. Nie usuwać bazy/tabel historii ani odtwarzać starych rodzinnych notatek.

## Handoff

- [ ] Właściciel przegląda A/B/C. A i B w Knowli; C w repo Hermesa. Domyślne wykonanie inline, bez delegowania implementacji.
- [ ] Sprawdzenia local/API/MCP/skill/native-profile/model/delivery są oddzielnymi dowodami. Przyszły naturalny Evening jest ostatnią obserwacją, nie sztucznym live testem.
- [x] Self-review: jedno repo źródłowe MCP/skilla, report runtime oddzielny, poprawne zależności i kontrola deployment drift.
