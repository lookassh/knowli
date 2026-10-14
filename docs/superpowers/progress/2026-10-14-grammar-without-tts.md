# Wyłączenie TTS w lekcjach gramatyki

Zakres zatwierdzony w rozmowie 2026-10-14: bez głośnika w zadaniach gramatyki, bez generowania audio odpowiedzi i bez wymogu audio przy publikacji. Słówka zachowują TTS. Istniejące pliki, opublikowana treść i historia prób pozostają zachowane.

Baza: `e079c6cdcb309b61d078e03a35f80cf165c7abbe`, zgodna ze świeżym `origin/main`. Worktree `de40/knowli`, gałąź `feature/grammar-without-tts`. Lokalny raport wcześniejszego audytu pozostaje poza zakresem commita.

Workflow: bounded według `brainstorming` — istniejąca opcja `SubjectModule.ttsForAnswers`, bez nowego DTO, modelu danych ani protokołu. Projekt w poprzedniej odpowiedzi został zaakceptowany poleceniem właściciela. Nie powstaje osobny plan i nie jest wykonywany wcześniejszy plan; bramka `executing-plans` nie jest wyzwolona. Implementacja bieżącego agenta, TDD i jeden niezależny review całego zakresu na końcu.

- [x] Kontekst i izolacja; `using-superpowers`, `brainstorming`, `using-git-worktrees`, `test-driven-development`.
- [x] Baseline unit: 97 plików, 976 testów PASS.
- [x] Baseline integracji audio/generacji/API lekcji: 3 pliki, 44 testy PASS.
- [x] RED: 5 oczekiwanych porażek (20 zasobów audio, wymóg audio publikacji, audio w nowych i wznowionych zadaniach, dozwolony disclosure). Dodatkowe RED: stare audio w panelu rodzica i 20 niepotrzebnych wywołań TTS.
- [x] GREEN: 7 nowych regresji + opcjonalna ścieżka audio + generacja słówek: 3 pliki, 19 testów PASS. Fixture wznowienia wydaje zadanie przez przedmiot z TTS włączonym, zamiast zmieniać niezmienny snapshot SQL.
- [x] Regresja słówek i wspieranego przez inny przedmiot audio; E2E parent/kid/real-flow 15/15 PASS, w tym brak głośnika po wznowieniu.
- [x] Dokumentacja SPEC, architektury, providerów i specyfikacji gramatyki oraz wpływ API → MCP → skill.
- [x] Niezależne review całego zakresu oraz obsługa Important: 0 pozostałych Critical/Important/Minor; zapis w `docs/superpowers/reviews/2026-10-14-grammar-without-tts.md`.
- [ ] Końcowe sprawdzenia i PR do main; scala właściciel przez squash.

Logi sprawdzeń: `C:/Users/looka/AppData/Local/Temp/knowli-grammar-without-tts/`.

API/MCP: istniejące opcjonalne audio pozostaje w kontrakcie dla przedmiotów z TTS. Gramatyka nie udostępnia odsłuchu; aktualizujemy opis zachowania. Raport MCP `learning-overview` i skill Hermesa wykluczają lekcje — brak zmiany ich schematu i instrukcji.

Powiązane zlecenia sprzed wdrożenia: worker pomija TTS używane wyłącznie przez przedmioty z wyłączonym audio, zachowuje współdzielone zasoby słówek i gotowe pliki. Zasób pending oznacza failed, run superseded; przyszłe wymaganie audio może utworzyć nową generację. Żądań już wysłanych przed wdrożeniem nie można cofnąć. Osierocone zasoby bez powiązań nie są klasyfikowane jako audio gramatyki i zachowują dotychczasowy lifecycle.

Weryfikacja przed review: pełne unit 976/976; pełna integracja PostgreSQL 351/351 w 37 plikach; typecheck PASS; build PASS; E2E parent/kid/real-flow 15/15 PASS.

Review `gpt-6.1-sol`, xhigh: Important — dwa workery z początkową migawką pending mogą po anulowaniu ponownie przejąć failed, bo CAS lease dopuszczał każdy stan poza ready. Przyjęte po technicznej weryfikacji. Deterministyczny RED na prawdziwym PostgreSQL: dwie zakończone początkowe selekcje pending, potem równoległa praca → 1 niepożądana synteza. Minimalna poprawka: lease wymaga state=pending. GREEN: 0 syntez, asset=failed, run=superseded; grammar+generation 16/16 PASS, aktualny typecheck PASS. Końcowy werdykt recenzenta po poprawce: bez pozostałych uwag.

Końcowa weryfikacja po poprawce review: pełne unit 976/976; pełna integracja PostgreSQL 352/352 (37 plików); typecheck PASS; build PASS; powtórzony rzeczywisty E2E parent→publish→kid→reload→support→parent PASS (1/1). Szerszy zestaw E2E lekcji przed poprawką przejęcia lease: 15/15 PASS. Brak zmian kodu po tych sprawdzeniach. Testy HTTP/MCP/learning-overview zawarte w pełnej integracji pozostają zielone; schemaVersion i skill niezmienione, lekcje nadal wykluczone.
