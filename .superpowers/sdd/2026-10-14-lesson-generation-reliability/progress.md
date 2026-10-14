Plan: docs/superpowers/plans/2026-10-14-lesson-generation-reliability.md

# Dziennik wykonania

## Stan początkowy
- Worktree: `C:\Users\looka\.codex\worktrees\lesson-generation-reliability\knowli`
- Gałąź: `feature/lesson-generation-reliability`; baza `origin/main` = `0bb7ca4390e61d5af4404d3ac11a605957030037`; merge-base i HEAD są równe.
- PR #58 (`feature/grammar-without-tts`) pozostaje otwarty. Nowy worktree startuje z main, który nie ma jeszcze zmiany wyłączającej TTS; poprawka generatora nie zależy od tamtej zmiany.
- Skill `executing-plans` 6.4.2: skrypty `task-start` i `task-done` nie są dostępne. Używam `sdd-workspace`, `task-brief`, `review-package` i tego dziennika ręcznie.
- Zależności naprawiono przez `npx --yes pnpm@10.34.6 install --frozen-lockfile` w trybie CI. Pierwsza instalacja pnpm 11 zmieniła lockfile; zmianę wygenerowaną przez nią wycofałem przed poprawną instalacją. Lockfile jest czysty.

## Task 0 — zakończony
- Zrobione: sprawdzenie gałęzi/worktree/merge-base, statusu PR #58, instrukcji repozytorium, skryptów i wersji pnpm; zatwierdzone dokumenty są w worktree.
- Odstępstwo: `task-brief` wymaga nagłówków `Task N`; plan miał `Zadanie N`. Ujednoliciłem nagłówki do `Task N` bez zmiany treści.
- Baseline: `npx --yes pnpm@10.34.6 test:unit` — PASS, 98 plików / 979 testów; `... typecheck` — PASS; `... test:integration` z `UMIEM_TEST_RUN_ID=lesson-generation-baseline-20261014`, `UMIEM_E2E_PORT=24617` — nie wystartował, Docker API nieosiągalne (`dockerDesktopLinuxEngine` pipe brak).
- Baseline fake (Node 22.19.0, `FakeLlmProvider`, `englishGrammarSubject` + `presentSimpleV1`, materiał `play football school music pets`, 9 ćwiczeń/cel, mix 3/4/2): 1 cel = 1 call, 9/9 przyjętych, 0 odrzuconych, 4.45 ms; 3 cele = 3 calle, 27 surowych, 9 przyjętych/18 odrzuconych, tylko cel 1 ma pokrycie (2.33 ms); 7 celów = 7 calli, 63 surowe, 9 przyjętych/54 odrzucone, wyłącznie cel 1 (4.24 ms). To pomiar lokalnego fake + walidatora, nie czasu żywego LLM ani PostgreSQL.
- Baseline polecenia: `npx --yes pnpm@10.34.6 --version` → `10.34.6`; skrypty unit/integration/e2e/typecheck/build/test:mcp/contracts:export-learning-overview istnieją. Docker CLI odpowiada, daemon Linux nie działa.
- Wynik review dokumentów: API DTO/schemaVersion bez zmiany; `learning-overview` nie zawiera lekcji. SPEC §29a i architecture §19 opisują aktualny moduł; R01–R07 w implementation plan. TTS PR #58 otwarty i nieobecny na bazie main.
- Pozostało: ponowić integracje z PostgreSQL, jeśli Docker stanie się dostępny; ograniczenie dotyczy całego wykonania i jest eskalowane w końcowym raporcie.

## Task 1 — zakończony; commit pending
- RED: `pnpm test:unit` z nowymi regresjami: `keepsEightDifferentAuxiliaryGaps` → 4 zamiast 8; `rejectsRepeatedStimulusDespiteOptionIdsOrChangedAnswer` → oba bodźce przyjęte; nowy `exercise-identity.test.ts` → brak importowanego modułu. Był to oczekiwany RED.
- Zmiana: `SubjectModule.poolDeduplication` (default answer, grammar exercise), nowa tożsamość ćwiczenia (cel + typ + funkcjonalny, znormalizowany bodziec), walidator i provider promptu respektują politykę; top-up podaje bodźce bieżących zadań, a stare runy odbudowują je z zapisanej treści. `target_key` nie zmieniono. Dodałem test, że wspólny klucz odpowiedzi między celami nie daje `due_check` po ekspozycji.
- Dokumentacja: `.kiro/specs/grammar-module/design.md` i `docs/architecture.md` poprawiają dawną równoważność „niewidziane ćwiczenie = nieujawniona odpowiedź”.
- GREEN: fokus 4 pliki / 108 testów PASS; pełne `npx --yes pnpm@10.34.6 test:unit` 99 plików / 986 testów PASS; `typecheck` PASS; `git diff --check` PASS.
- Ograniczenie: integracje trzech test files nie wystartowały, bo Docker daemon jest niedostępny. Regressje integracyjne dodane/planowane wymagają ponowienia przy dostępnym PostgreSQL.
- Commit: `490a2a3` (`fix(lessons): deduplicate exercises instead of grammar auxiliaries`), zakres od `0bb7ca4390e61d5af4404d3ac11a605957030037`.

## Task 2 — zakończony; commit pending
- RED: validator nie odrzucał `prompt=answer`, a adapter nadal narzucał angielski każdemu `prompt`; `does not` i `doesn't` z `hint=do` były odrzucane mimo poprawnego „She ___ play tennis.”
- Zmiana: profil gramatyki opisuje PL→EN oraz odpowiedzi operatorowe; adapter zezwala na stimulus w `promptLocale` zgodnie z profilem subject, odpowiedzi i acceptedAnswers pozostawia w `answerLocale`; walidator blokuje prompt równy odpowiedzi/wariantowi i sprawdza operator, osobę i bazową formę w ukończonym zdaniu.
- GREEN: 3 pliki / 22 testy PASS; full unit 99/996 PASS; typecheck PASS; diffcheck PASS. Materializacja potwierdza polski prompt w Kid DTO i brak odpowiedzi w prompt.
- Integracje `lesson-generation.test.ts`, `lesson-parent-api.test.ts` uruchomione z `UMIEM_TEST_RUN_ID=lesson-generation-task2-20261014`, port 24618; nie wystartowały przez brak dockerDesktopLinuxEngine pipe.
- Commit: `827b83b` (`fix(grammar): align translation prompts and auxiliary gap validation`), zakres od `490a2a3`.

## Task 3 — zakończony z ograniczeniem weryfikacji integracyjnej
- RED: test schematu wykazał, że cel third_person_s dopuszczał dodatkowy `lesson_open_answer`; test multi-objective wykazał brak `anyOf` wiążącego typ ćwiczenia z jego celem. Zapis RED przed implementacją.
- Zmiana: generator schematu wydzielony do `lesson-pool-schema.ts`; schemat strict ogranicza enum typów do dozwolonych typów danej partii, `objectiveId` do właściwego celu, `transformId` do jego katalogu, a przykłady do identyfikatorów bieżącego żądania. Dla wielu celów stosuje pełne ścisłe gałęzie `anyOf`; pusty zbiór dozwolonych typów kończy się przed HTTP. Weryfikacja kształtu surowej odpowiedzi preceduje dereferencję; wadliwy element jest odrzucany.
- Regresje: test struktury schematu i dopuszczonych próbek; lokalny test `[valid, null]`; dodany test integracyjny, że null nie ponawia całej partii.
- GREEN: fokus `llm.test.ts`, `lesson-pool-schema.test.ts`, `lesson-drafts.test.ts` 21/21 PASS; pełny unit 100 plików / 1002 testy PASS; typecheck PASS; diffcheck PASS.
- Ograniczenie: integracja `tests/integration/lesson-generation.test.ts` nie wystartowała, bo Docker API jest niedostępne (`dockerDesktopLinuxEngine` pipe). Test integracyjny jest dodany, lecz wymaga uruchomienia z PostgreSQL.
- Dokumentacja: `docs/architecture.md` wyjaśnia ograniczony schemat; `anyOf` jest wspierane przez OpenAI Structured Outputs, przy wymaganiu obiektu jako root, ścisłych obiektów z pełnym `required` i `additionalProperties:false`. Brak live próby alternatywnego endpointu.
- Commit: `36423ba` (`fix(lessons): constrain generated batches and reject malformed items safely`), zakres od `827b83b`.

## Task 4 — kod zakończony; integracja/E2E wymagają uruchomienia Dockera
- RED: dodane regresje PostgreSQL dla nieaktualnego PATCH po top-upie, tylko jednego aktywnego top-upu (dwa równoległe klucze), idempotencji tego samego klucza i edycji rodzica unieważniającej queued run przed wywołaniem providera. Nie można odczytać RED/GREEN, bo runner nie startuje bez Docker Desktop.
- Zmiana: top-up rezerwuje wersję w transakcji `FOR UPDATE`, zwraca poprzedni run dla tego samego clientRequestId i odrzuca równoległe różne żądanie. Zapis rodzica zwiększa numer edycji i supersede'uje aktywne runy. Finalizacja workera zapisuje treść/kontekst/media/status i editNumber+1 atomowo pod wersja→run; stary run nie wywołuje providera jeśli już został unieważniony. Retry supersede'uje pozostałe runy. UI blokuje dogenerowanie podczas aktywnego runu i synchronicznie zabezpiecza przed double click.
- GREEN dostępne: pełny unit 100 plików / 1002 testy PASS; `typecheck` PASS; `git diff --check` PASS. Testy integracyjne przed i po zmianie nie wystartowały: usługa `com.docker.service` jest Stopped, pipe `dockerDesktopLinuxEngine` nie istnieje. E2E dwóch kontekstów nie zostało jeszcze dodane/uruchomione.
- Odstępstwo: zgodnie z bramką TDD próba RED była przygotowana, ale nie mogła dojść do testów przez brak PostgreSQL. Implementacja opiera się na obecnej transakcji/bloce wersji oraz regresjach oczekujących na wykonanie.
- Dokumentacja `docs/architecture.md` opisuje rezerwację, monotoniczny editNumber i odrzucenie późnego wyniku; plan jawnie zostawia DB/E2E jako niedomknięte weryfikacje.
- Commit: `2a19b29` (`fix(lessons): version worker writes and serialize draft generation`), zakres od `36423ba`.

## Task 5 — kod zakończony; weryfikacja PostgreSQL wymaga Dockera
- RED adaptera: przed implementacją testy wykazały brak klasyfikacji HTTP 400/429, brak Retry-After i akceptowanie treści po odmowie/ucięciu. Pełny targeted RED zapisany; 3 testy plus missing-module suite nie przechodziły.
- Zmiana adaptera: `GenerationProviderError` bez body; 400/401/403/404/422 terminalne configuration, zwykłe 429 rate_limit (Retry-After), 429 quota/billing terminalne; 408/5xx/network transient; refusal/content_filter, length i niepoprawna koperta mają kody terminalne. Provider body nie trafia do logów ani wyjątku.
- Retry: `classifyLessonGenerationFailure`, 1/2 s + 0–20% jitter, poprawny Retry-After jako minimum; `next_attempt_at` nullable, migracja Drizzle 0009, filtr pollera oraz warunkowy claim przez zegar; ręczny retry czyści odroczenie. Deck/media zachowują dotychczasową klasyfikację.
- Regresje PostgreSQL dodane dla błędu trwałego, braku kolejnego claimu przed terminem, manual retry i istniejący exhaustion; nie mogły się uruchomić (brak pipe Docker). Migracja 0009 i snapshot wygenerowane przez drizzle-kit z aktualnego schematu; kontrola SQL pokazuje addytywne nullable timestamp.
- GREEN: pełny unit 101 plików / 1019 testów PASS; typecheck PASS; targeted `llm.test.ts` i `lesson-generation-errors.test.ts` 21 testów PASS; diffcheck PASS.
- Dokumentacja: `.kiro/specs/grammar-module/requirements.md`, `docs/architecture.md` i `docs/provider-config.md`; komunikaty polskie w `packages/contracts/src/messages.ts`. DTO bez `nextAttemptAt`; MCP `learning-overview` bez zmian.
- Commit: `8333fe1` (`fix(lessons): classify provider failures and persist retry delays`), zakres od `2a19b29`.

## Task 6 — logika deadline i anulowania zakończona; DB testy zablokowane
- RED: przed implementacją nowy test `lesson-generation-control.test.ts` nie mógł zaimportować brakującego modułu. Unit kontrolera sprawdza timeout requestu, wspólny deadline wielu partii, ignorowanie późnego wyniku i abort po zmianie aktualności. Adapter testuje deadline także przy bezpośrednim wywołaniu bez caller signal.
- Zmiana: policy 90 s request / 10 min run / 1 s poll, walidacja env (dodatnia liczba całkowita; request ≤ run), AbortSignal.any i race z abortem, aktualność runu sprawdzana okresowo i przed/po requestcie. Provider ignorujący sygnał nie blokuje wykonania. Timeout kończy run jako provider_timeout bez auto-retry; shutdown (API options) oddaje aktualny run do queued, zachowując attempts; stale run pozostaje superseded.
- Integracyjne bariery edycji rodzica i shutdown dodane do `lesson-generation.test.ts`; testy nie mogą się uruchomić bez Docker. `runDueGenerationWork` nie przekazuje jeszcze sygnału shutdown — to część Task 7.
- GREEN: targeted 5 plików / 43 testy PASS; typecheck PASS; diffcheck PASS. Do testów nie użyto prawdziwego providera; wszystkie fake/sygnały lokalne.
- Dokumentacja/env: `.env.example`, `docs/provider-config.md`, `docs/architecture.md`. Po akceptacji planu właściciel potwierdził włączenie do tej gałęzi wyłączenia TTS dla lekcji gramatycznych.
- Commit: `a417297` (`fix(lessons): bound generation and cancel stale executions`), zakres od `8333fe1`.

## Task 7 — implementacja i lokalne testy zakończone
- Implementacja: worker przekazuje sygnał shutdown, ma dwa aktywne sloty, uzupełnia wolny slot także gdy poprzednia praca nadal trwa, filtruje seen/active przed LIMIT i ogranicza concurrency mediów. Długi postęp odświeża health. Test fake jest teraz unikalny, więc wspólne cele nie są sztucznie odrzucane przez identyczne bodźce.
- RED/GREEN: testy regresyjne kolejki, aktywnego zadania, nowej pracy w czasie oczekiwania, progresu health i fake→walidator przechodzą. Drugi review zgłosił też scope batcha, bezpieczne logi, identity krótkich odpowiedzi i błąd odmowy 429; poprawiono te punkty wraz z testami RED/GREEN zapisanymi w testach jednostkowych.
- Logowanie mediów wypisuje teraz kod klasyfikacji zamiast surowego komunikatu providera. Lesson validation loguje wyłącznie liczniki/kody reguł, bez przykładowej treści.
- Pomiar po poprawie fake+walidatora (Node 22.19.0, materiał i 3/4/2): 1 cel 1 call, 6 przyjętych/3 odrzucone; 3 cele 3 calle, 18/9; 7 celów 7 calli, 42/21; czas 0.96–4.31 ms. Pomiar sztucznego providera, nie prognoza czasu LLM.
- Ograniczenie: `tests/integration/generation.test.ts` nie wystartował bez Docker. Pełne testy E2E ponownie zatrzymały się przed Playwright na braku `dockerDesktopLinuxEngine`.

## Task 8 — lokalna akceptacja, niezależne review w toku
- Dodano E2E generacji trzech celów Present Simple (`question`, `negative`, `short_answers`), polskich poleceń, kompletności przykładów oraz braku zasobów audio. Istniejący real-flow pokrywa naukę bez mikrofonu/głośnika, reload i nadzór rodzica; istniejący parent E2E obejmuje konflikt wersji dwóch okien.
- Poprawiono integracyjne oczekiwania: kolejne partie gramatyczne przekazują bodźce do deduplikacji ćwiczeń, a test top-upu sprawdza tożsamości ćwiczeń, nie unikalność odpowiedzi. Fake kontynuuje indeks bodźców w top-upie. Jednostkowa regresja potwierdza wspólną poprawną odpowiedź `does` dla różnych celów.
- Drugi review znalazł ryzyko zagłodzenia retry po zakończeniu pierwszej próby w zajętym pass. Klucz `seen` obejmuje identyfikator i numer próby, a wolny slot po polling interval ponownie czyta stan DB i czyści lokalne seen keys. Dodano regresje dla retry po błędzie oraz ręcznego retry resetującego licznik podczas długiego zadania.
- Końcowa lokalna walidacja po tych zmianach: `test:unit` PASS 107 plików/1054 testy; `typecheck` PASS; `build` PASS; `test:mcp` PASS 8/8; `contracts:export-learning-overview --check` PASS; `git diff --check` PASS; lista Playwright wykrywa 10 scenariuszy w obu zmienionych plikach.
- `test:integration` oraz `test:e2e` próbowały uruchomić się 2026-10-14; oba zatrzymały się przed testami przy próbie połączenia z Docker Linux Engine (`//./pipe/dockerDesktopLinuxEngine` nie istnieje). Nie twierdzę, że testy PostgreSQL/Playwright przeszły.
- API → MCP → skill bez zmian kontraktu; MCP 8/8 i schemat `learning-overview` aktualny. Zmiana nadal wyłącza TTS dla lekcji gramatycznych; słownictwo zachowuje generowanie audio.
- Drugi niezależny przegląd całego zakresu `0bb7ca4..HEAD` wraz z bieżącym diffem roboczym wykonał reviewer `gpt-6.1-sol xhigh`. PR #58 niezmieniony; dla tej gałęzi PR tworzony jest dopiero po końcowej weryfikacji.
- Review znalazł jeszcze dwie uwagi Minor: walidacja `base_form_after_does` oraz wymóg unikalnego bodźca wewnątrz pierwszej odpowiedzi. Obie odtworzono jako RED, poprawiono i sprawdzono GREEN (testy walidatora/LLM 36/36).
- Końcowy werdykt niezależnego review `gpt-6.1-sol xhigh`: 0 Critical, 0 Important, 0 otwartych Minor. Reviewer uwzględnił pełny zakres i zmodyfikowane E2E; nie zmieniał repozytorium.
- Końcowa weryfikacja po review: `test:unit` PASS 107/1057, `typecheck` PASS, `build` PASS, `test:mcp` 8/8 PASS, schemat export `--check` PASS, `git diff --check` PASS. `test:integration` i `test:e2e` ponownie przerwane przed uruchomieniem testów przez brak pipe Docker Linux Engine.
- PR i push gałęzi są nadal kolejnym krokiem końcowym planu; PR #58 pozostaje nietknięty, merge nieautoryzowany.

## Dostarczenie
- Końcowy commit po poprawkach review: `4987623` (`fix(lessons): stabilize generation and worker retries`).
- Gałąź `feature/lesson-generation-reliability` wypchnięta do origin; PR #60 utworzony i dołączony do czatu: https://github.com/lookassh/knowli/pull/60.
- PR #60 jest otwarty do przeglądu/właścicielskiego Squash and merge. Nie wykonano merge ani wdrożenia. Poprzednie PR #58 pozostaje nietknięte.
