# Sondy i benchmark modeli lekcji

Sondy (`*.probe.test.ts`) wołają prawdziwe modele przez OpenRouter. Uruchamia się je ręcznie, nigdy w CI. Benchmark (`pnpm bench`, katalog `bench/`) składa je w jeden powtarzalny bieg:

1. generowanie lekcji na stałym zestawie materiałów;
2. kontrola zadań zamkniętych na ćwiczeniach wzorcowych;
3. ślepy arkusz;
4. sędzia;
5. punktacja wg rubryki `blind/rubric-stage5.md`.

Wynik to mały rekord w `results/`, a [`results/README.md`](results/README.md) zestawia rekordy w tabelę.

## Kiedy używać

- **Ocena innego modelu generatora albo kontroli:** pełny zestaw, porównanie z rekordem obecnego modelu.
- **Strojenie promptu paczki:** wybrane zadania (`--tasks`) na niezacommitowanej zmianie (rekord zapisuje `dirty` i hash diffu), porównanie z rekordem bazowym pod tym samym sędzią.
- **Nowy sędzia:** ten sam katalog biegu z innym `--judge` daje nowy rekord bez płacenia za generowanie.

## Szybki start

```bash
pnpm bench run --out ~/knowli-probes/bench/<label> --label <label> --cap-usd 7
```

| Parametr | Domyślnie | Znaczenie |
|---|---|---|
| `--out` | — | Katalog biegu w katalogu domowym, poza repozytorium: surowe zrzuty, arkusze, werdykty, logi, rejestr kosztów |
| `--label` | — | Nazwa rekordu (`[a-z0-9-]`), np. `flash-2026-11-20`, `sonnet-tune-cards` |
| `--judge` | `muse:` | `muse:` albo `muse:<model>` — lokalne CLI Muse Code, bez kosztu; inny id to model OpenRouter (płatny) |
| `--cap-usd` | — | Limit rejestru kosztów biegu; wymagany, gdy w planie jest płatny krok |
| `--reps` | 2 | Powtórzenia zadań generowania |
| `--tasks` | cały zestaw | Lista id zadań po przecinku |
| `--note` | — | Krótka nota do rekordu (bez treści ćwiczeń) |

Bez `--cap-usd` benchmark wypisuje plan i szacunek z poprzednich rekordów, po czym kończy się, zanim cokolwiek wywoła. Każdy krok pomija gotowe pliki, więc przerwany bieg wznawia się tym samym poleceniem. Powtórzenie z plikiem wyników nieudanego runu też liczy się jako gotowe, żeby nie płacić za nie drugi raz. Jeden katalog biegu to jedna konfiguracja: `bench.json` pilnuje commitu, stanu roboczego, routingu dostawców i liczby powtórzeń.

Po zakończeniu powstaje `results/<label>.<sędzia>.json`, a tabela przelicza się sama (`pnpm bench table` robi tylko tabelę).

## Konfiguracja modeli

Benchmark ocenia konfigurację z `.env` i środowiska, tak jak worker (`packages/server/src/config-defaults.ts`):

- generator paczek: `UMIEM_LESSON_AGENT_MODEL` (+ `_REASONING`);
- etap zagadnień rozdziału i szkoły: `UMIEM_LLM_MODEL` (+ `_REASONING`);
- kontrola zadań zamkniętych: `UMIEM_LESSON_AGENT_CHECKER_MODEL`, także w kontroli wzorcowej.

Przykład oceny innego generatora (PowerShell):

```powershell
$env:UMIEM_LESSON_AGENT_MODEL='vendor/model'; $env:UMIEM_LLM_MODEL='vendor/model'
pnpm bench run --out ~/knowli-probes/bench/model-x --label model-x --cap-usd 7
```

Kredyt dostawcy na własnym kluczu (BYOK, np. Anthropic) wymaga przypięcia dostawcy: `UMIEM_LLM_PROVIDER_ORDER=anthropic` i `UMIEM_LLM_PROVIDER_ALLOW_FALLBACKS=false`. Bez tego OpenRouter kieruje część wywołań do innych dostawców i płaci z kredytów OpenRouter. Kontrola dziedziczy `UMIEM_LLM_PROVIDER_*`, więc zostaw jej `UMIEM_LESSON_AGENT_CHECKER_PROVIDER_ALLOW_FALLBACKS=true`. Rekord zapisuje te zmienne w `routing`.

## Zestaw zadań

`bench/suite.ts`: 8 lekcji i 2 zestawy wzorcowe. Materiały w `fixtures/` to teksty własne albo fikcyjne. Ich sha256 zgadzają się ze zrzutami etapów 4–5, więc nowe biegi da się porównać z rekordami z tych etapów.

| Zadanie | Co sprawdza |
|---|---|
| `school-plant-parts`, `school-baptism-poland` | Szkoła (Przyroda, Historia): pytania otwarte, pojęcia kluczowe, cytaty z materiału |
| `chapter-clothes-weather`, `chapter-home-rooms`, `chapter-food-likes` | Rozdział podręcznika angielskiego z „+3” |
| `grammar-to-be`, `grammar-present-simple`, `grammar-present-continuous` | Gramatyka z „+3” (dwa ostatnie na wspólnym materiale z oboma czasami) |
| `gold-chapter`, `gold-school` | Kontrola zadań zamkniętych: zły klucz, druga poprawna odpowiedź, fałszywe alarmy |

Nowe zadanie to wpis w `SUITE` i plik w `fixtures/` (bez danych dzieci i bez cudzego tekstu chronionego prawem autorskim). Test `bench.test.ts` sprawdza fixtures.

## Koszty

Według rejestrów etapu 5, przy obecnym generatorze:

| Zadanie | Koszt |
|---|---|
| Szkoła | ok. 0,4 USD za lekcję |
| Rozdział | 0,26–0,33 USD |
| Gramatyka | ok. 0,2 USD |
| Kontrola wzorcowa | ok. 0,05 USD |
| Pełny zestaw, 2 powtórzenia | ok. 4,5 USD |
| Pełny zestaw, `--reps 1` | ok. 2,3 USD |

- **Zapas w limicie.** Sonda generowania rezerwuje przed każdym powtórzeniem cały budżet runu (`UMIEM_LESSON_AGENT_RUN_BUDGET_USD`, ×2 z „+N”, czyli 2 USD), więc `--cap-usd` potrzebuje zapasu ≥ 2 USD ponad spodziewany koszt.
- **Limit przy wznowieniu.** Rejestr `<out>/costs.json` trzyma limit z pierwszego biegu. Wznowienie z innym `--cap-usd` kończy się błędem.
- **BYOK.** Przy kluczu właściciela OpenRouter raportuje koszt 0, więc limit tego wydatku nie zatrzyma. Koszt policz z tokenów (`tokens` w rekordzie, ceny dostawcy).
- **Sędzia `muse:`** nic nie kosztuje (subskrypcja CLI). Sędzia z OpenRouter rezerwuje 2 USD na arkusz i kosztuje ok. 0,8 USD.

## Sędziowie i interpretacja

- Wyniki różnych sędziów są nieporównywalne. Tabela ma osobną sekcję na każdego. Przy Sonnecie sędzia GPT pokazał przewagę, której Muse i Opus nie potwierdzili (spec etapu 5, wpis v2.6).
- Nowego sędziego najpierw porównaj z Muse na wspólnym arkuszu: `node tests/probes/blind/score.cjs --agree <key.json> <A.csv> <B.csv>`. Zgodność Muse z innymi sędziami w etapie 5 wynosiła 92–100% wierszy.
- „Wady” w tabeli to odsetek wierszy z dowolną klasą W1–W9. Klasy są w rekordzie (`defects`), a ich opis w `blind/rubric-stage5.md`. Przy 60–150 wierszach przedziały Wilsona mają szerokość kilku punktów: różnica 3,5% wobec 5,7% to szum. Ten sam zrzut `grammar-to-be` oceniony przez Muse drugi raz (inaczej przetasowany arkusz) dał 5,9% zamiast 4,4%.
- Publikowalność: `publishLessonDraft` po „+N” przechodzi. `coverageGapsBeforeAdd` liczy braki pokrycia przed „+N”.
- Benchmark nie mierzy oceny odpowiedzi dziecka (`probe:grading`). Ta sonda nie zapisuje wyniku strukturalnie, więc nie ma rekordu.

## Prywatność i dane

- Do repozytorium trafia tylko rekord: liczby, kody, id zadań i modeli, sha256 materiału. Zrzuty, arkusze, werdykty z notatkami sędziego i logi zostają w `--out`, bo sondy odrzucają ścieżki w checkoucie.
- Klucz OpenRouter idzie wyłącznie po https do OpenRouter. CLI Muse dostaje tylko zmienne systemu (`childEnv` w `probe-helpers.ts`), bez kluczy i URL-i bazy.
- Do generatora, kontroli i sędziego nie trafiają dane dziecka: materiały są z `fixtures/`.

## Pojedyncze sondy

| Polecenie | Co robi |
|---|---|
| `pnpm probe:chapter` | Jedna lekcja (`UMIEM_PROBE_MATERIAL`, `UMIEM_PROBE_SUBJECT`, …; opis w nagłówku pliku) |
| `pnpm probe:gold` | Kontrola wzorcowa (`UMIEM_PROBE_GOLD=1`, `UMIEM_PROBE_GOLD_FIXTURE`, `UMIEM_PROBE_AGENT_SOLVER_MODEL`) |
| `pnpm probe:judge` | Sędzia jednego arkusza (`UMIEM_PROBE_JUDGE_DIR`, `_MODEL`, `_OUT`, `UMIEM_PROBE_COSTS`) |
| `pnpm probe:grading` | Ocena odpowiedzi (`UMIEM_PROBE_GRADING=1`) |
| `node tests/probes/blind/gen-blind-sheet.cjs`, `score.cjs`, `coverage.cjs` | Arkusz, punktacja, pokrycie materiału (opis w nagłówkach) |
