# Code Review Brief: Profile Navigation Performance & Policy-Scoped Projections

> Brief historyczny, przygotowany przed poprawkami po review. Aktualny zakres,
> decyzje i wyniki opisuje [plan poprawek](2026-10-18-profile-navigation-review-fixes-plan.md),
> a ich ocenę [niezależne review](2026-10-18-profile-navigation-review-fixes-review.md).
> W szczególności raport rodzica wybiera ostatnią wiarygodną ocenę spośród
> polityk; opis filtra aktywnej polityki poniżej nie opisuje końcowej implementacji.

**PR:** [#93: perf: optymalizacja czasu wejścia w profil dziecka (listKidDecks)](https://github.com/lookassh/knowli/pull/93)  
**Branch:** `feature/profile-navigation-performance`  
**Base commit:** `5356529150a92bd782c6118ab52b49e4fcd905ae` (`origin/main`)  
**Head commit:** `cf7c6f696d54663eaacafa3f464c76be5df4093e`  
**Data:** 2026-10-18  
**Autor:** Antigravity / Umiem! Team  
**Status CI:** Wszystkie 8 checków na GitHub Actions: **PASSED (100% GREEN)**  

---

## 1. Cel biznesowy i kontekst produktu

**Umiem! (Knowli)** to prywatna, self-hostowana aplikacja rodzinna do nauki języka angielskiego (początkowo dla dzieci w wieku ~8 lat).
Ekran główny dziecka (`/kids/:childId/learn`) po kliknięciu profilu na liście profili (`/`) pobiera listę przypisanych zestawów słówek i lekcji przez `GET /api/v1/kid/decks?childId=...&microphoneEnabled=...`.

### Problem
Przejście ze strony profili do konkretnego profilu trwało **kilka sekund** (często 2–4 sekundy na środowiskach z nagromadzoną historią), powodując wrażenie zawieszenia aplikacji i irytację dziecka.

### Zdiagnozowane przyczyny źródłowe
1. **Skanowanie sekwencyjne historii ekspozycji audio (`readSkillHistories`):**
   - Zapytania do `learning_events` (dla zdarzeń `audio_issued` przed `received_at`) nie posiadały indeksu kompozytowego na `(task_id, occurred_at)`.
   - Każde żądanie budowało setki alternatyw `OR (task_id = ... AND occurred_at BETWEEN ... AND ...)` uniemożliwiających optymalizatorowi PostgreSQL użycie indeksu i zmuszających do kosztownej kompilacji JIT.
2. **Dynamiczne odtwarzanie historii w ścieżce odczytu:**
   - Serwer zamiast korzystać z trwałej, zmaterializowanej projekcji, przy każdym odświeżeniu listy zestawów odczytywał pełną historię ocen i ekspozycji z surowych zdarzeń i transkrypcji.
3. **Sekwencyjna materializacja lekcji:**
   - Dla każdej przypisanej lekcji silnik w pętli odczytywał stan modułu i wykonywał próbną materializację kartkówki (`hasSafeLessonMockPortion`), alokując media i zapytania do bazy.

---

## 2. Podsumowanie zmian technicznych

### Obszar A: Optymalizacja zapytań SQL i indeksy
- **Plik migracji:** `packages/server/drizzle/0018_learning_events_audio_task_idx.sql`
  - Utworzono indeks częściowy: `CREATE INDEX learning_events_audio_task_idx ON learning_app.learning_events (task_id, occurred_at) WHERE kind = 'audio_issued' AND sealed = true;`
- **Plik czytnika:** `packages/server/src/modules/skill-history.ts`
  - Przepisano czytnik historii na sparametryzowane trójki zakresów za pomocą `UNNEST($1::uuid[], $2::timestamptz[], $3::timestamptz[]) AS q(task_id, range_start, range_end)`.
  - Zagwarantowano stały rozmiar i sygnaturę zapytania SQL niezależnie od liczby badanych zadań, eliminując narzut kompilacji JIT.
  - Zabezpieczono warunek `occurred_at <= received_at` oraz `sealed = true`.

### Obszar B: Projekcje postępu scoped per polityka (`proj-3`)
- **Plik migracji:** `packages/server/drizzle/0019_policy_scoped_learning_projections.sql`
  - Zmieniono klucz główny tabeli `child_skill_progress` z `(child_id, skill_version_id)` na `(child_id, skill_version_id, policy_id)`.
  - Dodano kolumnę `learning_projection_version text DEFAULT 'proj-3'` do tabeli `child_profiles`.
  - Dodano indeksy wspomagające: `child_skill_policy_idx (child_id, policy_id, skill_version_id)` oraz `child_skill_due_idx (child_id, next_review_at)`.
- **Moduł snapshotu zestawu:** `packages/server/src/modules/deck-learning-overview.ts`
  - Wprowadzono dedykowaną funkcję `readDeckLearningOverview` odczytującą stan postępu zestawu bez narzutu planera sesji.
  - Całość odczytu `listKidDecks` w `packages/server/src/modules/kid.ts` została zamknięta w transakcji snapshotowej:
    ```ts
    services.db.transaction(tx => listKidDecksSnapshot(services, tx, childId, options, now), {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
    ```
- **Atomowy zapis projekcji:** `packages/server/src/modules/skill-projections.ts`
  - Zapewniono atomowość aktualizacji `first_issued_at`, `last_reviewed_at`, `independent_success_streak` oraz `has_qualifying_assessment` wewnątrz tej samej transakcji, która zapisuje ocenę i ekspozycję.
- **Procedura odbudowy:** `packages/server/src/modules/progress-rebuild.ts`
  - Zaktualizowano CLI `rebuildProgress` pod nowy klucz `(child_id, skill_version_id, policy_id)`.

### Obszar C: Batching i separacja lekcji
- **Moduł przeglądu lekcji:** `packages/server/src/modules/lessons/lesson-deck-overview.ts`
  - Utworzono funkcję `readLessonDeckOverviews`, która jednym zapytaniem SQL pobiera stan wszystkich przypisanych lekcji.
  - Liczba zapytań SQL jest stała $O(1)$ bez względu na to, czy dziecko ma 1, 10 czy 30 lekcji.
- **Oddzielenie oceny dostępności od mediów:** `packages/server/src/domain/lessons/mock-test-plan.ts`
  - Funkcja `hasLessonMockPortionAvailable` sprawdza dostępność kartkówki w oparciu o ukończone cele i postęp, bez kosztownej alokacji assetów audio/graficznych.

### Obszar D: Spójność danych i dostosowanie testów
- **Raport postępu dla rodzica:** `packages/server/src/modules/published-progress.ts`
  - Odczyt postępu powiązano ze scoped policy dziecka (`profile.policyId ?? 'learning-v2'`).
  - Usunięto błędny filtr `isNotNull(lastReviewedAt)`, dzięki czemu nowo wydane lub oczekujące na potwierdzenie słówka nie są oznaczane jako nieodbyte (`not_assessed`).
- **Aktualizacje testów:**
  - Zaktualizowano pomocniki testów E2E (`kid-flow.spec.ts`, `learning-algorithm.spec.ts`, `speech-recording-ux.spec.ts`, `spelling-diff-feedback.spec.ts`, `test-preparation.spec.ts`) do wstawiania klucza kompozytowego `(child_id, skill_version_id, policy_id)`.
  - W `tests/integration/reward-activity.test.ts` dodano obsługę przechwytywania zapytań z dedykowanych klientów transakcyjnych (`client.query` przez `pool.connect`).
  - W `tests/integration/reward-projection-migration.test.ts` zastosowano bezpieczny zapis SQL zgodny ze schematem bazy sprzed migracji 0019.

---

## 3. Zmierzone wyniki wydajności (syntetyczny benchmark)

Warunki testowe: 10 opublikowanych zestawów, 500 rewizji, 10 000 ocen, 50 000 zdarzeń audio.

| Metryka | Stan wyjściowy (Legacy) | Po optymalizacji | Poprawa | Wymóg budżetu |
|---|---|---|---|---|
| **`readSkillHistories` (Cold)** | ~1512 ms | **95.6 ms** | **~15.8x szybciej** | $\le 250\text{ ms}$ |
| **`readSkillHistories` (p95)** | > 1500 ms | **101.1 ms** | **~15x szybciej** | $\le 250\text{ ms}$ |
| **Pełne `listKidDecks` (Mediana)** | > 2500 ms | **159.6 ms** | **> 15x szybciej** | $\le 500\text{ ms}$ |
| **Pełne `listKidDecks` (p95)** | > 3000 ms | **165.2 ms** | **> 18x szybciej** | $\le 500\text{ ms}$ |

Szczegółowy raport z pomiarów znajduje się w pliku: `docs/diagnostics/profile-navigation-benchmark-results.md`.

---

## 4. Niezmienniki architektoniczne do zweryfikowania (Review Focus)

Recenzent powinien zwrócić szczególną uwagę na następujące reguły projektu:

1. **Źródło prawdy a projekcje (SPEC / architecture.md §12):**
   - Czy historia prób, ocen i zdarzeń pozostaje nienaruszona (brak zapytań modyfikujących `learning_events` czy `assessments` przy odczycie)?
   - Czy projekcje są traktowane wyłącznie jako cache odtwarzalny przez `rebuildProgress`?
2. **Izolacja postępu (Safety & Multitenancy per child):**
   - Czy żaden odczyt ani zapis nie miesza danych rodzeństwa (brak wycieków między `child_id`)?
   - Czy zmiana polityki nauki nie dziedziczy projekcji z innej polityki bez dowodów?
3. **Czystość transakcji odczytu (`listKidDecks`):**
   - Czy transakcja w `listKidDecks` jest jawnie oznaczona jako `read only` / `repeatable read`?
   - Czy nie są w niej wywoływane zewnętrzne usługi (LLM, TTS, Azure STT) ani blokujące operacje I/O?
4. **Zgodność z API / MCP / SKILL.md:**
   - Czy zachowano 100% kompatybilność kontraktu DTO `KidDeckDto`?
   - Czy zmiana nie wpłynęła negatywnie na integrację MCP pod `/api/mcp`?
5. **Obsługa błędów i stanów brzegowych:**
   - Co się dzieje, gdy dziecko nie ma żadnej historii (stan początkowy)?
   - Co się dzieje przy braku uprawnień mikrofonu (`microphoneEnabled = false`)?

---

## 5. Komendy do lokalnej weryfikacji

```bash
# 1. Sprawdzenie poprawności typów
corepack pnpm typecheck

# 2. Testy jednostkowe (136 plików, 1285 testów)
corepack pnpm test:unit

# 3. Testy integracyjne z bazą danych (52 pliki, 458 testów)
corepack pnpm test:integration

# 4. Kluczowe testy E2E Playwright
corepack pnpm test:e2e tests/e2e/kid-flow.spec.ts tests/e2e/learning-algorithm.spec.ts tests/e2e/speech-recording-ux.spec.ts tests/e2e/spelling-diff-feedback.spec.ts tests/e2e/test-preparation.spec.ts tests/e2e/navigation.spec.ts

# 5. Build produkcyjny Next.js
corepack pnpm build
```

---

## 6. Gotowy prompt dla Agenta Recenzenta (Code Reviewer Prompt)

Skopiuj poniższy blok i przekaż go agentowi AI wykonującemu review:

```markdown
Jesteś Senior Code Reviewerem oceniającym zmiany w projekcie Knowli / Umiem! (samodzielna aplikacja rodzinna Next.js/TypeScript/PostgreSQL/Drizzle).

Twoim zadaniem jest przeprowadzenie rzetelnego, technicznego Code Review zmian zawartych w PR #93 (gałąź `feature/profile-navigation-performance` względem `origin/main`).

Kontekst i brief zmian znajduje się w pliku:
`docs/code-review/2026-10-18-profile-navigation-performance-review-brief.md`

### Zakres do przejrzenia
Commit bazowy: `5356529150a92bd782c6118ab52b49e4fcd905ae`
Commit końcowy: `cf7c6f696d54663eaacafa3f464c76be5df4093e`

Sprawdź diff poleceniem:
git diff 5356529150a92bd782c6118ab52b49e4fcd905ae..cf7c6f696d54663eaacafa3f464c76be5df4093e

### Szczególne obszary uwagi (Review Focus):
1. **Poprawność i bezpieczeństwo SQL:**
   - Indeks w `packages/server/drizzle/0018_learning_events_audio_task_idx.sql`.
   - Zastosowanie `UNNEST` w `packages/server/src/modules/skill-history.ts` — typowanie, bezpieczeństwo przed SQL injection, obsługa pustych tablic.
2. **Model danych i migracja 0019:**
   - Spójność klucza `(child_id, skill_version_id, policy_id)` w `0019_policy_scoped_learning_projections.sql` i `schema.ts`.
   - Czy migracja poprawnie zachowuje istniejące dane w `child_skill_progress_legacy` i tworzy backfill dla aktywnej polityki dziecka?
3. **Izolacja transakcyjna i odczyt:**
   - Użycie transakcji `repeatable read read only` w `listKidDecks` (`packages/server/src/modules/kid.ts`).
   - Brak blokad zapisu i brak wywołań zewnętrznych providerów w trakcie transakcji.
4. **Logika dziedzinowa i brak regresji:**
   - Zgodność `readDeckLearningOverview` z regułami `deriveSkillWork` i `hasScheduledWork`.
   - Zachowanie terminów sprawdzianów i 24-godzinnej kwarantanny przed ujawnieniem.
   - Batching lekcji w `packages/server/src/modules/lessons/lesson-deck-overview.ts`.
5. **Jakość testów:**
   - Czy testy weryfikują rzeczywiste zachowanie w PostgreSQL (brak powierzchownych mocków)?
   - Czy syntetyczny benchmark w `tests/integration/profile-navigation-benchmark.test.ts` jest wiarygodny?

### Oczekiwany format raportu:
1. **Strengths (Mocne strony):** Co zostało zrobione szczególnie dobrze, czysto i zgodnie ze sztuką?
2. **Issues (Wykryte problemy z podziałem na kategorie):**
   - **Critical (Krytyczne):** Błędy uniemożliwiające działanie, ryzyko utraty danych, luki bezpieczeństwa, regresje domenowe.
   - **Important (Ważne):** Wady architektoniczne, wąskie gardła, brakujące przypadki brzegowe w testach.
   - **Minor (Drobne):** Styl kodu, nazewnictwo, drobna optymalizacja lub uwagi do dokumentacji.
   (Dla każdego problemu podaj: `plik:linia`, opis problemu, dlaczego ma znaczenie, proponowane rozwiązanie).
3. **Assessment (Ocena końcowa):**
   - Czy kod jest gotowy do scalenia do `main`? [TAK / NIE / Z POPRAWKAMI]
   - Uzasadnienie techniczne w 2–3 zdaniach.
```
