# Postęp naprawy profile → zestawy (P0/A1)

Data: 2026-10-18. Zakres: P0 i A1 z `profile-navigation-A1-spec.md`.
Pozostałe etapy A2/B/C są poza tym przydziałem.

## Stan początkowy i mapa odczytu

- HEAD przed zmianami: `5356529150a92bd782c6118ab52b49e4fcd905ae`; worktree ma
  gałąź `feature/profile-navigation-performance`. Istniejące nieśledzone pliki
  diagnostyczne zachowano.
- `readSkillHistory` deleguje do `readSkillHistories`; ten czyta oceny w
  żądanych trójkach dziecko/skillVersion/skill, dołącza `session_tasks`, buduje
  wpisy i przekazuje je do niezmienionego `qualifyProjectionEvidence`.
- Przed zmianą każda ocena wykonywała skorelowane `EXISTS` w
  `learning_events`, ograniczone `task_id`, `audio_issued`, `sealed=true` oraz
  `occurred_at <= received_at`.
- `node_modules` i `.env` były obecne. Baseline:
  `corepack pnpm test:integration tests/integration/history.test.ts` — 9/9.

## RED → GREEN

Dodano integracyjną obserwację SQL przez pulę testową. RED zarejestrował, że
czytnik zwracał jedno zapytanie zawierające sprawdzanie audio skorelowane z
oceną, zamiast osobnego grupowego pobrania zakresu tasków. Nie zmieniano
kwalifikatora ani reguł domenowych.

GREEN: czytnik najpierw pobiera ocenione taski dla dokładnych żądanych zakresów,
a następnie wykonuje jedną agregację `min(occurred_at) GROUP BY task_id`, tylko
dla unikalnych task_id z tego wyniku. Pierwsze zapieczętowane audio kwalifikuje
się, gdy jego czas jest równy lub wcześniejszy od `received_at`; brak audio lub
audio wyłącznie późniejsze nie kwalifikuje się. Filtry DB wykluczają inne
rodzaje i niezapieczętowane zdarzenia. Grupowanie daje najwyżej jeden rekord na
zadanie i nie mnoży ocen. Pusty zakres omija oba odczyty; powtórzone zakresy
są deduplikowane.

Testy integracyjne potwierdzają reading z dwoma wydaniami audio: wcześniejszym
i dokładnie w `received_at` (wspierane, bez powielenia oceny). Osobny przypadek
wprowadza testowe zdarzenie niezapieczętowane przed odpowiedzią oraz zapieczętowane
po odpowiedzi; oba nie zmieniają kwalifikacji. Audio wydane na zadaniu innego
dziecka również nie wpływa na żądaną historię.

Dodano indeks częściowy `(task_id, occurred_at)` tylko dla `audio_issued` z
`sealed=true`, w schemacie Drizzle i migracji `0018_learning_events_audio_task_idx.sql`.
Test sprawdza, że zapytanie audio jest ograniczone listą task_id, nie zawiera
skorelowanego `EXISTS`, oraz że PostgreSQL może użyć nowego indeksu w planie
odczytu (EXPLAIN z wyłączonym `enable_seqscan` lokalnie w transakcji testowej).
To potwierdza dostępność indeksu dla zapytania; nie jest dowodem poprawy czasu.

## Weryfikacja

- Baseline: `corepack pnpm test:integration tests/integration/history.test.ts` —
  9/9 przed zmianami.
- RED: to samo polecenie — 1 regresja, oczekiwane dwa odczyty/zaobserwowano
  jeden odczyt historyczny bez osobnej agregacji audio.
- GREEN: `UMIEM_TEST_RUN_ID=nav-a1 corepack pnpm test:integration tests/integration/history.test.ts` — 10/10.
- `corepack pnpm test:unit packages/server/src/domain/projection-evidence.test.ts` — 2/2.
- `corepack pnpm exec tsc --noEmit -p packages/server/tsconfig.json` — OK.
- Plan indeksu w teście integracyjnym: wymaga zastosowania indeksu częściowego
  przez planner przy selektywnym task_id; lokalne `enable_seqscan=off` służy tylko
  temu sprawdzeniu i nie zmienia ustawień serwera ani aplikacji.

## Zakres i ograniczenia dowodów

Nie zmieniono publicznego API/DTO ani znaczenia wyniku; MCP i skill pozostają
bez zmian. Zbiorczy odczyt zachowuje zależność od transakcji wywołującej; lista
poza tym przydziałem ma używać snapshotu Repeatable Read. Nie wykonano
benchmarku A1 na dużym fixture ani pomiaru HTTP/produkcji, więc nie deklaruje
się osiągnięcia budżetu latencji. Izolację testuje przypadek audio innego
dziecka; nie ma osobnego przypadku wielu dzieci z identycznym skillVersion w
jednym żądaniu ani oddzielnego testu pustego zakresu. Dla tych zakresów nadal
obowiązują odczytane trójki i wczesny zwrot pustej mapy.
