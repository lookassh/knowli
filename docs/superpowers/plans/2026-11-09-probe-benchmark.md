# Benchmark modeli lekcji (`pnpm bench`) — plan

> Decyzja właściciela z 2026-11-09: z sond etapów 2–5 zrobić benchmark, który pozwoli łatwo ocenić inny model albo stroić prompt. W repo ma być kod benchmarka, zadania i aktualne wyniki modeli. Bez osobnego pakietu pnpm: zostaje w `tests/probes`, bo tylko tam wolno używać SDK `ai` (`tests/ai-sdk-scope.test.ts`), a sondy korzystają z wnętrza `@learning/server`.
>
> Wersja 2: po przeglądzie trzech krytyków (wykonalność względem kodu sond, dane i koszty, prostota).

**Cel:** jedno polecenie przechodzi zestaw zadań dla bieżącej konfiguracji modeli: generowanie, kontrola wzorcowa, arkusz, sędzia, punktacja. Zapisuje mały rekord wyników, a tabela w repo porównuje rekordy pod tym samym sędzią.

**Bez zmian:** `probe:chapter`, `probe:gold`, rubryka `rubric-stage5.md`, `score.cjs` (`scoreStage2`, `wilson`, `parseCsv`), `gen-blind-sheet.cjs`, rejestry kosztów i ochrona ścieżek. Jedna poprawka istniejącego kodu: środowisko Muse CLI w `probe:judge` (pkt „Prywatność”).

## Ograniczenia

- **Surowe wyjście poza repo.** Zrzuty, arkusze, werdykty i logi leżą wyłącznie w `--out` (katalog domowy, `probePath`; konwencja `~/knowli-probes/bench/<label>`). Rekord w repo budujemy z listy dozwolonych pól. Trafiają tam liczby, kody, id zadań z `SUITE`, id modeli, SHA commita i sha256 materiału. Nie trafia treść ćwiczeń, materiał, tytuły i człony id zagadnień (`family`, `coverage[].objective`), notatki sędziego ani ścieżki.
- **Koszty.**
  - Każdy krok, który uruchamia płatną sondę (generowanie, kontrola wzorcowa, sędzia spoza `muse:`), wymaga `--cap-usd`. Bez limitu benchmark wypisuje plan kroków i szacunek z poprzedniego rekordu, po czym kończy się, nic nie uruchamiając.
  - Rejestr kosztów `<out>/costs.json` zakłada wyłącznie benchmark (INIT z jawnym limitem). Istniejący rejestr z innym `capUsd` niż `--cap-usd` daje błąd, bo `initCostLedger` zwraca istniejący plik bez zmian.
  - Sonda generowania rezerwuje przed każdym powtórzeniem cały budżet runu (×2 z „+N”). Limit musi więc mieć zapas co najmniej 2 USD ponad spodziewany koszt; README i komunikat błędu to podają.
  - Koszt przy kredycie Anthropic (BYOK) sonda i rejestr raportują jako ok. 0. Rekord zapisuje więc tokeny per model, a README ostrzega, że limit nie zatrzyma takiego wydatku.
- **Środowisko podprocesów.** Z dziedziczonego `process.env` benchmark usuwa wszystkie `UMIEM_PROBE_*`, potem dokłada env zadania. Uruchamia `process.execPath` ze ścieżką do CLI Vitesta i skryptów `.cjs` (`shell: false`), bez `pnpm` i `cmd.exe`. `.env` wczytuje wyłącznie wejście CLI, nie moduły importowane przez testy.
- **Sędzia.** Rekord zapisuje sędziego (`--judge`, np. `muse:` albo `muse:<model>`) i przy Muse wersję CLI (`muse --version` → `judgeVersion`), bo samo `muse:` nie mówi, który model domyślny oceniał. Tabela nie miesza sędziów w jednej sekcji, bo wyniki różnych sędziów są nieporównywalne (artefakt sędziego GPT przy Sonnecie, spec etapu 5 v2.6).
- Identyfikatory modeli występują w rekordach i tabeli jako dane benchmarka. W commitach i opisie PR ich nie podajemy.
- Bez danych dziecka: materiały to fikcyjne lub własne teksty z `tests/probes/fixtures`.

## Pliki

| Plik | Rola |
|---|---|
| `.gitattributes` | `tests/probes/fixtures/** text eol=lf`, `tests/probes/results/** text eol=lf` (sha256 materiału i test aktualności tabeli niezależne od `core.autocrlf`) |
| `tests/probes/fixtures/grammar-{to-be,present-simple,present-continuous}.txt` | Materiały gramatyki. `to-be` i `present-simple` z `~/knowli-probes/stage4/materials`; `present-continuous` nowy (tamten plik był bajt w bajt kopią `present-simple`) |
| `tests/probes/bench/suite.ts` | `SUITE`: zadania generowania i kontroli wzorcowej |
| `tests/probes/bench/record.ts` | `buildRecord(input)` (czyste, lista dozwolonych pól), `readRun(out, judge)` (odczyt `--out`) |
| `tests/probes/bench/table.ts` | `renderTable(records)` → `tests/probes/results/README.md` |
| `tests/probes/bench/bench.ts` | CLI `run` i `table`; planowanie kroków jako czyste funkcje (`planSteps`) |
| `tests/probes/bench/bench.test.ts` | Testy jednostkowe (wpis w `vitest.unit.config.ts`) |
| `tests/probes/probe-helpers.ts` | `childEnv(env)` dla Muse (lista dozwolonych) — wspólne z `auto-judge.probe.test.ts` |
| `tests/probes/results/<label>.<judge>.json` | Rekordy; `<judge>` jako slug (`muse`, `muse-<model>`, `anthropic-claude-…`) |
| `tests/probes/results/README.md` | Tabela wygenerowana z rekordów (test pilnuje aktualności) |
| `tests/probes/README.md` | Instrukcja |
| `package.json` | `"bench": "node apps/worker/node_modules/tsx/dist/cli.mjs tests/probes/bench/bench.ts"` (jak `eval:*`) |

## Zestaw zadań (`SUITE`)

Generowanie (`probe:chapter`), domyślnie 2 powtórzenia:

| id | przedmiot | env sondy | „+N” |
|---|---|---|---|
| `school-plant-parts` | school | `UMIEM_PROBE_SCHOOL_SUBJECT=Przyroda`, `UMIEM_PROBE_TOPIC=Części rośliny i ich zadania` | — |
| `school-baptism-poland` | school | `Historia`, `Chrzest Polski` | — |
| `chapter-clothes-weather`, `chapter-home-rooms`, `chapter-food-likes` | chapter | — | 3 |
| `grammar-to-be`, `grammar-present-simple`, `grammar-present-continuous` | grammar | `UMIEM_PROBE_GRAMMAR_TOPIC=to_be` / `present_simple` / `present_continuous` | 3 |

Kontrola wzorcowa (`probe:gold`): `gold-chapter` (`closed-check-gold-stage5.json`), `gold-school` (`closed-check-gold-school.json`). Env: `UMIEM_PROBE_GOLD=1`, `UMIEM_PROBE_GOLD_FIXTURE`, `UMIEM_PROBE_AGENT_SOLVER_MODEL` z `withConfigDefaults(process.env).UMIEM_LESSON_AGENT_CHECKER_MODEL`. Sonda zapisuje zrzut przed asercjami progów, więc kod wyjścia ≠ 0 przy istniejącym zrzucie to wynik, nie awaria.

Koszt (rejestry etapu 5, obecny generator): szkoła ok. 0,4 USD na lekcję, rozdział 0,25–0,33, gramatyka ok. 0,2, kontrola wzorcowa ok. 0,05. Pełny zestaw przy 2 powtórzeniach to ok. 4,5 USD (limit ≥ 6,5), przy `--reps 1` ok. 2,3 USD (limit ≥ 4,3). `--tasks` uruchamia część zestawu.

## Przebieg `pnpm bench run`

`pnpm bench run --out <dir> --label <slug> [--judge muse:] [--cap-usd N] [--reps N] [--tasks a,b]`

- `--label`: `^[a-z0-9][a-z0-9-]{0,40}$`.
- `--out`: przez `probePath`.

Kroki, każdy pomija gotowe:
1. **meta**: `<out>/bench.json`:
   - zawartość: `label`, `commit` (`git rev-parse --short HEAD`), `dirty` (niepusty `git status --porcelain`) z `diffSha256` (`git diff HEAD -- packages tests/probes`), `reps`, `tasks`, routing dostawców z env (`UMIEM_LLM_PROVIDER_ORDER`, `UMIEM_LLM_PROVIDER_ALLOW_FALLBACKS`, `UMIEM_LESSON_AGENT_*_PROVIDER_*`);
   - przy istniejącym pliku inny commit, `dirty`, `diffSha256` albo routing daje błąd (jeden rekord = jedna konfiguracja).
2. **generate**: per zadanie i powtórzenie:
   - materiał kopiowany do `<out>/materials/` (sondy odrzucają ścieżki w repo);
   - ścieżki sondy: `UMIEM_PROBE_OUT_DIR=<out>/<task>/out/rN`, `UMIEM_PROBE_POOL_DUMP_OUT=<out>/<task>/baseline-rN/dump.json`, `UMIEM_PROBE_COSTS=<out>/costs.json`, log `<out>/<task>/logs/rN.log`;
   - powtórzenie jest gotowe, gdy w `out/rN` jest plik wyników, także nieudanego runu, więc wznowienie nie płaci ponownie;
   - po uruchomieniu brak pliku wyników daje błąd (pominięta sonda to nie sukces).
3. **gold**: `<out>/gold/<task>.json` (`UMIEM_PROBE_GOLD_DUMP`). Po uruchomieniu brak zrzutu daje błąd.
4. **sheet**: per zadanie generowania `gen-blind-sheet.cjs <out>/<task> <task> <task> <out>/judge/<task> rubric-stage5.md`, gdy brak `blind/key.json`.
5. **judge**:
   - `probe:judge` per zadanie z `UMIEM_PROBE_JUDGE_DIR=<out>/judge/<task>` i `UMIEM_PROBE_JUDGE_OUT=<out>/judge/<task>.<judge-slug>.csv` (rejestr jak wyżej);
   - plik werdyktów jest gotowy, gdy liczba wierszy równa się liczbie wierszy arkusza;
   - niepełny plik dostaje nazwę `*.partial-<czas>.csv` i krok startuje od nowa;
   - po uruchomieniu niepełny plik daje błąd.
6. **record**: `buildRecord` → `tests/probes/results/<label>.<judge-slug>.json` (istniejący daje błąd), potem `table`.

Ponowna ocena innym sędzią: `run` na tym samym `--out` z innym `--judge` (kroki 1–4 gotowe), więc nowy rekord, ta sama generacja.

`pnpm bench table`: przepisuje `results/README.md` ze wszystkich rekordów.

## Rekord (`probe-bench-record/v1`)

```jsonc
{
  "schema": "probe-bench-record/v1",
  "label": "flash-stage5", "date": "2026-11-09",
  "commit": "746223f4", "dirty": false, "diffSha256": null,
  "note": "…",                                   // opcjonalnie; backfill opisuje źródła
  "models": { "generator": "…", "objectives": "…", "checker": "…", "grader": "…", "objectivesReasoning": "low" },
  "routing": { "UMIEM_LLM_PROVIDER_ORDER": "anthropic", … },   // tylko ustawione
  "judge": "muse:", "judgeVersion": "Muse Code 1.4.14", "rubric": "rubric-stage5.md",
  "generation": {
    "<task>": {
      "materialSha256": "…",
      "runs": 2, "succeeded": 2, "publishable": 1,
      "costUsd": { "min": 0.23, "max": 0.30 },
      "tokens": { "<model>": { "in": 0, "out": 0 } },      // suma powtórzeń
      "durationS": { "min": 96, "max": 112 },
      "coverageGapsBeforeAdd": 0,
      "rows": 150,
      "anyDefect": { "defects": 5, "n": 150, "rate": 0.033, "low": 0.014, "high": 0.076 },
      "defects": { "W5": { "defects": 3, "n": 150 }, … }    // tylko klasy z n > 0
    }
  },
  "gold": { "<task>": { "fixture": "…", "model": "…", "reps": 3, "correctRejected": [0,0,0], "correctTotal": 18, "wrongKeyDetected": [16,16,16], "wrongKeyTotal": 16, "secondCorrectDetected": [4,8,4], "secondCorrectTotal": 9 } }
}
```

`buildRecord`:
- **Wiersze:** bierze z klucza tylko wiersze `baseline-rN` i `baseline-add-rN`. Te drugie zmapuje na `baseline-rN`, bo to ten sam przebieg i „+N” liczy się do lekcji. Werdykty filtruje do tych `rowId` i liczy przez `scoreStage2` (zakres wariantu `baseline`).
- **`anyDefect`:** wiersz z wadą w dowolnej klasie, przedział `wilson`.
- **Brak werdyktu:** wiersz bez werdyktu daje błąd.
- **Pozostałe pola:** z plików wyników sondy (`state`, prefiks „TAK” w `publishable`, `costUsd.total`, `tokens.byModel`, `durationMs`, `draft.coverage` z `actual < required`).
- **Modele:** z plików wyników. Różne modele w jednym zadaniu dają błąd.
- **Materiał:** `materialSha256` ze zrzutu.
- **Ujawnienia:** `exposureLeaks > 0` w głównym zrzucie daje błąd (to błąd ścieżki zapisu, nie miara jakości).
- **Wynik:** nowy obiekt z listy pól, nigdy kopia wejścia.

## Tabela (`results/README.md`)

Nagłówek „generowane przez `pnpm bench table`, nie edytuj”. Sekcja na sędziego, wiersz to zadanie, kolumna to rekord.

Komórka: `pub 2/2 · wady 3,3% [1,4–7,6] · 0,23–0,30 USD`. Gdy `materialSha256` różni się od bieżącego fixture zadania, komórka dostaje znacznik `*` z przypisem. Zadanie bez wyniku daje „—”.

Pod tabelą lista rekordów: commit (z `dirty`), modele, routing, nota. Osobna tabela kontroli wzorcowej. Na końcu przypomnienie, że przy n = 60–150 różnice kilku punktów procentowych mieszczą się w przedziałach.

## Prywatność: Muse CLI

`museVerdicts` w `auto-judge.probe.test.ts` filtrował tylko `OPENROUTER_*` i `UMIEM_*`, więc `OPENAI_API_KEY`, `AZURE_SPEECH_KEY`, `DATABASE_URL` i inne z `.env` trafiały do CLI. Zastępujemy to listą dozwolonych (`childEnv`):
- `PATH`, `PATHEXT`, `SystemRoot`, `SYSTEMROOT`, `COMSPEC`, `windir`;
- `USERPROFILE`, `HOME`, `HOMEDRIVE`, `HOMEPATH`, `APPDATA`, `LOCALAPPDATA`;
- `TEMP`, `TMP`, `USERNAME`, `LANG`;
- oraz zmienne `MUSE_*` (konfiguracja samego CLI).

## Zadania

### Zadanie 1: zestaw, materiały, `.gitattributes`, środowisko Muse
- Fixtures gramatyki; `present-continuous` jako własny krótki tekst w czasie Present Continuous.
- `.gitattributes`, renormalizacja fixtures.
- `suite.ts`: `SUITE`, `taskById`.
- `childEnv` w `probe-helpers.ts` i użycie w `museVerdicts`.
- Testy:
  - id są unikalne, a każdy fixture istnieje;
  - sha256 materiałów zadań generowania są parami różne;
  - fixtures kontroli wzorcowej istnieją;
  - `childEnv` przepuszcza `PATH` i `MUSE_X`, a odrzuca `OPENAI_API_KEY`, `DATABASE_URL`, `OPENROUTER_API_KEY` i `UMIEM_GRADER_API_KEY`.

### Zadanie 2: rekord
- `buildRecord`, `readRun`.
- Testy na syntetycznych danych:
  - publikowalność, koszty i tokeny;
  - mapowanie `baseline-add` na przebieg;
  - wiersze `agent-rN` są pominięte;
  - brakujący werdykt daje błąd, tak samo `exposureLeaks > 0` i różne modele w zadaniu;
  - prywatność: znaczniki w treści ćwiczenia, materiale, notatce sędziego, członie zagadnienia, `family` i `coverage[].objective` nie występują w `JSON.stringify(record)`;
  - klasy z `n = 0` są pominięte;
  - kontrola wzorcowa zachowuje liczby per powtórzenie.

### Zadanie 3: tabela
- `renderTable` jest deterministyczne.
- Testy:
  - różni sędziowie trafiają do osobnych sekcji;
  - zadanie bez wyniku daje „—”;
  - inny sha materiału daje `*`;
  - `results/README.md` jest aktualny.

### Zadanie 4: CLI
- `planSteps({ suite, out, reps, tasks, judge, existing })` zwraca kroki z env i oczekiwanym plikiem wyjścia. `existing` to funkcja sprawdzająca pliki, więc test nie dotyka dysku.
- `assertPaidAllowed`, `checkMeta`, `verdictsComplete`.
- Testy:
  - plan pomija gotowe powtórzenia, także nieudane z plikiem wyników;
  - env zadania: `UMIEM_PROBE_*` z rodzica usunięte; materiał w `--out`; „+N” tylko w zadaniach z „+N”; kontrola wzorcowa z `UMIEM_PROBE_GOLD=1`;
  - płatny krok bez `--cap-usd` daje błąd przed uruchomieniem, a Muse jako sędzia limitu nie wymaga;
  - rejestr z innym `capUsd` daje błąd;
  - niezgodny `bench.json` daje błąd;
  - `--label` z `../` daje błąd;
  - niepełne werdykty nie są gotowe.

### Zadanie 5: rekordy z istniejących zrzutów (backfill)
Jednorazowy skrypt w scratchpadzie składa wejście `buildRecord` z katalogów etapu 5. Zadanie mapuje po katalogu, nie po prefiksie `rowId`. Do repo trafiają tylko rekordy, sędzia Muse:
- **`flash-stage5`** (obecny generator):
  - rozdział z biegu potwierdzającego: `chapter/confirm/*`, commit 09e9835f, `judge/c-*-muse.csv`;
  - szkoła ze strojenia 2: `school/r2/*`, commit 0ca0e205, `judge/s2-*-muse.csv`;
  - kontrola wzorcowa: `chapter/gold-t1` (4f513128) i `school/gold` (414370e3);
  - gramatyka: zrzuty etapu 4 (`stage4/{to-be,present-simple,present-continuous}`, ocena Muse za darmo; nota o starszym kodzie), o ile przechodzą `gen-blind-sheet`; inaczej „—”.
  - Nota: różne commity zadań.
- **`sonnet-stage5`**: bieg potwierdzający `sonnet/confirm/*` (a78e981c), `judge/sf-*-muse.csv`. Routing `anthropic` bez fallbacku. Nota: koszt BYOK z tokenów; `present-continuous` na materiale `present-simple`.
- Sprawdzenie zgodności z notami biegów: Sonnet publikowalne w szkole 0/4, w rozdziale 4/6, w gramatyce 3/3; W5 dla clothes-weather pod Muse 13,1% u Sonneta wobec 3,5% u Flasha.

### Zadanie 6: instrukcja
- **`tests/probes/README.md`:**
  - ocena nowego modelu: zmienne `UMIEM_LESSON_AGENT_MODEL` i `UMIEM_LLM_MODEL`, przypięcie dostawcy przy BYOK;
  - strojenie: podzbiór `--tasks`, porównanie z rekordem bazowym pod tym samym sędzią, `dirty`;
  - koszty i zapas limitu, ostrzeżenie o BYOK;
  - sędziowie: sprawdzenie nowego sędziego przez `score.cjs --agree` na wspólnym arkuszu, zanim mu zaufamy;
  - ponowna ocena, prywatność, dodanie zadania;
  - czego benchmark nie mierzy: oceny odpowiedzi (`probe:grading`) w v1.
- **`AGENTS.md`:** jedna linia w „Running and verifying”.

## Poza zakresem (v1)

- rekord `probe:grading`;
- automatyczne progi bramki;
- wielu sędziów w jednym rekordzie;
- równoległe zadania.

## Weryfikacja

`pnpm check` (unit z `bench.test.ts`). `pnpm bench run --tasks grammar-to-be --reps 1` bez `--cap-usd` ma wypisać plan i zakończyć się przed wywołaniem. Do tego backfill: rekordy i `table` z istniejących zrzutów oraz ocena Muse gramatyki etapu 4. Płatnego biegu nie robimy.
