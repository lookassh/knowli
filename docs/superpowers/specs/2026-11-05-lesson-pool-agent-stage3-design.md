# Agent puli lekcji — etap 3: płatny odbiór i przełączenie domyślne (#237)

Wersja 1, 2026-11-05. Etapy 1, 2a i 2b są scalone (#258, #275). Ten dokument
opisuje etap 3 z issue #237: odbiór na prawdziwych modelach z progami
zamrożonymi przed uruchomieniem i przełączenie domyślne per przedmiot.

## 1. Cel i decyzje właściciela

**Cel.** Rozstrzygnąć per przedmiot (rozdział, gramatyka, szkoła), czy lekcje
ma domyślnie generować agent puli, czy dzisiejszy potok. Rozstrzygnięcie
opiera się na pomiarze produkcyjnej ścieżki obu źródeł na tych samych
zasadach, a nie na próbie PoC z 2026-11-03.

**Decyzje (2026-11-05):**

| Pytanie | Decyzja |
|---|---|
| Reguła decyzji | agent „nie gorszy od potoku” (§4), z progami bezwzględnymi kosztu i czasu |
| Ślepa ocena | dwóch niezależnych oceniających na arkusz, rozbieżności rozstrzyga trzeci (§6) |
| Przegrany przedmiot | zostaje na potoku; poprawki to osobne zadanie z własnym pomiarem; progów nie zmieniamy po fakcie |
| Lekcje | te same trzy co 2026-11-03: Unit 3, Present Simple, geografia |
| Sonda | jedna produkcyjna sonda dla obu źródeł (podejście A, §5) |

**W zakresie (jeden PR):**

1. Sonda pomiarowa: źródło `pipeline|agent` w `probe:chapter`, ślad agenta (§5).
2. Skrypt przebiegów, arkusze, liczenie i decyzja (§5.4, §6, §7).
3. Płatne przebiegi i ślepa ocena — **dopiero po jawnej zgodzie właściciela**
   na konkretny plan i limit (§9).
4. Raport z wynikami w repozytorium, bez treści ćwiczeń i materiału (§8).
5. Przełączenie domyślne tylko dla zwycięzców i jego skutki (§10).

**Poza zakresem:** strojenie promptów, polityk przedmiotu i stałych
(`independentReserve`, `slack`, limity kroków) — przegrany przedmiot dostaje
osobne zadanie; drugi materiał na przedmiot; usunięcie krytyka (etap 4);
lematyzator; pokazywanie rodzicowi liczby niesprawdzonych ćwiczeń; punkty 2–7
z „Do rozwiązania” w issue (raport je opisuje, nie naprawia).

**Moduł i zależności.** Zmiany kodu produkcyjnego dotyczą wyłącznie
konfiguracji (`config-defaults.ts`, `config.ts`: rozwiązywanie listy
przedmiotów agenta, §10). Reszta to `tests/probes/**`. Bez migracji, bez
zmian kontraktów, bez nowych zależności.

## 2. Co sprawdzamy i co obiecały wcześniejsze etapy

Decyzję podejmuje reguła §4. Raport musi też odpowiedzieć na pytania, które
spece etapów 1 i 2b odłożyły do etapu 3 (metryki diagnostyczne, bez wpływu na
decyzję):

- fałszywe odrzucenia bramki podpowiedzi bez lematyzatora (`hint_reveals_answer`)
  i sędziego (`hint_unsupported`, `hint_language`, `hint_reveals_paraphrase`);
- fałszywe odrzucenia kontroli otwartej (`open_not_accepted`) oraz rozjazdów
  ślepego rozwiązania i wariantów;
- skala niesprawdzonych pozycji (`checkUnavailable`, `hintUnavailable`,
  `openUnavailable`, `graderErrors`, `graderInvalidVerdicts`);
- luzowanie kryteriów po `open_not_accepted`: średnia liczba
  `requiredElements` w szkole, agent kontra potok;
- długość pętli: kroki na zagadnienie, odrzucenia ujawnień miękkich;
- rzeczywisty koszt kontroli 2b (`check_hints`, `check_open`, `check_grade`)
  wobec szacunku +0,03–0,07 USD.

## 3. Protokół

**Przebiegi.** Na każdą lekcję 3 przebiegi potoku i 3 przebiegi agenta, razem
18. Wejściem są pliki `material.txt` z 2026-11-03 (katalog
`C:\Users\looka\knowli-probe-data\gen-compare`), kopiowane do katalogu
pomiaru poza repozytorium; raport podaje ich SHA-256.

| Lekcja | Przedmiot | Wejście |
|---|---|---|
| `unit3` | `english_chapter` | materiał Unit 3 |
| `grammar` | `english_grammar` | temat `present_simple` z katalogu i materiał rodzica |
| `school` | `school` (Geografia, temat „Mapa”) | materiał geografii (ok. 15,5 tys. znaków) |

**Konfiguracja.** Wartości z `config-defaults.ts` na commicie pomiaru, bez
nadpisań w `.env` poza kluczami (sonda sprawdza to w §5.2): agent — generator
`google/gemini-3.8-flash`, checker `deepseek/deepseek-v4.1-flash-1017`,
`low`/`low`, polityka domyślna (budżet runu 1,00 USD); potok — dzisiejszy
model generatora; grader `UMIEM_GRADER_*`; krytyk wyłączony; pula 60 (jak w
panelu). Raport zapisuje modele i hash commitu.

**Zagadnienia naturalnie.** Oba źródła idą ścieżką produkcyjną od utworzenia
lekcji: rozdział — zagadnienia potoku albo planista agenta; szkoła —
wywołanie zagadnień przy `createSchoolLesson` w każdym przebiegu; gramatyka —
katalog. Zmienność zagadnień dotyczy obu źródeł jednakowo, a mierzymy to, co
dostanie rodzic.

**Kolejność.** Najpierw wszystkie przebiegi, potem arkusze i ocena, na końcu
decyzja. Oceniający nie widzą wyników przebiegów (czasów, kosztów, odrzuceń).

**Zamrożenie.** Progi z §4 trafiają do `thresholds.json` w katalogu pomiaru
przed pierwszym płatnym wywołaniem; SHA-256 pliku wpisujemy do raportu i do
wiadomości z prośbą o zgodę (§9). `decide.cjs` odmawia liczenia przy innym
hashu. Po pierwszym płatnym wywołaniu progów, rubryk ani podziału na części
nie zmieniamy.

## 4. Metryki i reguła decyzji

Metryki liczymy per lekcja i źródło, łącząc 3 przebiegi (wiersze arkusza
`agent-r1…3` → `agent`).

| Metryka | Definicja |
|---|---|
| **W** | wiersze z wadą inną niż wyłącznie K5 / wszystkie wiersze źródła; werdykt końcowy (zgodny albo rozjemcy). Wiersz z K5 i innym kryterium liczy się do W |
| **K5** | liczba wierszy z kryterium K5 w werdykcie końcowym |
| **Kompletność** | liczba przebiegów, które zakończyły się `succeeded` i bez znaczników braków (`generationGaps` pusta) |
| **Porażki** | przebiegi zakończone `failed` albo wyjątkiem po powtórce technicznej (§5.4) |
| **Koszt** | średnia i maksimum kosztu przebiegu z rejestru (USD) |
| **Czas** | mediana i maksimum czasu zegarowego `executeLessonGeneration` (s) |

**Reguła decyzji.** Agent zostaje domyślnym źródłem przedmiotu, gdy spełnia
wszystkie warunki:

1. W(agent) ≤ W(potok) + 3 pkt proc.;
2. K5(agent) ≤ K5(potok);
3. kompletność agenta ≥ 2 z 3;
4. porażki agenta = 0;
5. średni koszt agenta ≤ 0,40 USD i żaden przebieg nie przekracza 1,00 USD;
6. mediana czasu agenta ≤ 300 s i żaden przebieg nie zakończył się terminem
   runu (`deadline` w podsumowaniu punktu kontrolnego).

Margines 3 pkt proc. to ok. 1,5 błędu standardowego różnicy dwóch odsetków
przy ok. 200 wierszach na źródło i odsetkach ok. 5%. Potok nie musi spełniać
warunków 3–6; to punkt odniesienia, nie kandydat.

**Brak danych.** Gdy źródło ma mniej niż 2 przebiegi z ćwiczeniami (np.
przekroczony limit wydatków, §9), warunek 1–2 dla lekcji ma wynik „brak
danych”, a przedmiot nie jest przełączany.

**Wysoki szum.** Gdy zgodność oceniających przed rozjemcą (§6.3) jest dla
lekcji niższa niż 80%, raport oznacza lekcję „wysoki szum”. Jeśli wtedy
|W(agent) − W(potok) − 3| ≤ 1 pkt proc., `decide.cjs` zwraca „decyzja
właściciela” zamiast werdyktu.

**`thresholds.json`** (wartości jak wyżej):

```json
{
  "schema": "lesson-agent-acceptance-thresholds/v1",
  "defectMarginPp": 3,
  "leaksNotAbovePipeline": true,
  "minCompleteRuns": 2,
  "maxFailedRuns": 0,
  "maxMeanCostUsd": 0.40,
  "maxRunCostUsd": 1.00,
  "maxMedianDurationS": 300,
  "noDeadlineRuns": true,
  "minAgreement": 0.80,
  "noiseBandPp": 1,
  "minRunsWithExercises": 2
}
```

## 5. Sonda pomiarowa

### 5.1. Źródło w `probe:chapter`

`tests/probes/chapter-generation.probe.test.ts` dostaje zmienną
`UMIEM_PROBE_GENERATOR=pipeline|agent` (domyślnie `pipeline`; inna wartość to
błąd przed wywołaniem). Przy `agent`:

- env sondy ustawia `UMIEM_LESSON_AGENT_SUBJECTS` na identyfikator badanego
  przedmiotu (wartość jawna, niezależna od §10);
- sonda składa `lessonAgent` tak jak `apps/worker/src/composition.ts`:
  `lessonAgentDepsFromEnv(env, subjects, usage, deps.llm)`, i przekazuje
  `{ ...deps, lessonAgent: owinięte(lessonAgent) }` do `createServices`;
- wynik `undefined` (brak klucza) albo — dla szkoły — brak `grader` to błąd
  sondy przed pierwszym płatnym wywołaniem („pomiar bez kontroli otwartej”).

Przy `pipeline` sonda działa jak dziś. Oba źródła przechodzą tę samą ścieżkę:
`createLesson*` → `executeLessonGeneration` → zapis do szkicu → końcowa
kontrola lekcji → `readLessonDeck`.

### 5.2. Strażnicy konfiguracji

Przed pierwszym wywołaniem sonda kończy się błędem, gdy:

- krytyk jest włączony (`UMIEM_REVIEWER_ENABLED` ≠ `false`);
- `.env` nadpisuje którąkolwiek zmienną `UMIEM_LESSON_AGENT_*` poza kluczem
  (porównanie z `CONFIG_DEFAULTS`); wyjątek: `UMIEM_LESSON_AGENT_SUBJECTS`
  ustawiane przez sondę;
- host generatora, checkera albo gradera nie jest https OpenRouter
  (`probeEndpointHost`, jak dziś; `UMIEM_PROBE_ALLOW_HOST` nie dotyczy
  pomiaru — skrypt przebiegów go nie przekazuje).

Nagłówek pliku wyników zapisuje modele generatora, checkera i gradera,
politykę agenta i hash commitu (`git rev-parse HEAD` przekazany przez skrypt
przebiegów w `UMIEM_PROBE_COMMIT`).

### 5.3. Ślad agenta

Zmienna `UMIEM_PROBE_AGENT_TRACE` (plik poza repozytorium, nie jest
nadpisywany). Sonda owija porty z `LessonAgentDeps` cienkimi dekoratorami w
`tests/probes/agent-trace.ts` (bez zmian w kodzie produkcyjnym):

- `agent.runObjective` — owija `tools.submit` i `tools.remove`:
  zapisuje zagadnienie (slug), wejście paczki, wynik per ćwiczenie (status,
  kod, rodzaj, `detail`) i braki zagadnienia; liczy kroki;
- `checker.solve`, `judgeVariants`, `judgeHints`, `solveOpen` — wejście i
  wyjście paczki (pozycje z indeksem paczki, żeby połączyć je z `submit`);
- `grader.provider.grade` — wejście bez zmian i werdykt (wymiary
  `knowledge`, `precision`, listy `wrong`/`missing`; bez `commentPl`).

Dekoratory nie zmieniają argumentów ani wyników i przekazują `signal` i
`cost`; błąd zapisu śladu nie przerywa przebiegu (ślad oznaczony
`incomplete: true`). Po przebiegu sonda dopisuje do śladu podsumowanie z
`generation_runs.agent_checkpoint` (statusy, histogram kodów,
`checkCounters`, `totalSpentUsd`, `attempts`).

### 5.4. Zrzut końcowego szkicu

`UMIEM_PROBE_POOL_DUMP_OUT` działa dla obu źródeł (format
`blind/gen-blind-sheet.cjs`, jak dziś) i dostaje pola: `source`
(`pipeline|agent`), `generationGaps`, `durationMs`, `costUsd` z podziałem na
operacje (`lesson_generation`, `agent_*`, `check_*`), `runState`
(`succeeded|failed|threw`), `deadline` (z podsumowania agenta) oraz liczby:
ćwiczenia, ćwiczenia z `hint`, średnia liczba `requiredElements` pytań
otwartych.

**Koszt w rejestrze.** Wpis tymczasowy agenta to budżet runu (1,00 USD), potoku
— dzisiejszy szacunek. Rozliczenie: suma `providerCostUsd` z `UsageRecorder`
plus szacunek polityki za zdarzenia bez kosztu (flaga `estimated`).

### 5.5. Skrypt przebiegów

`tests/probes/acceptance/run-acceptance.cjs <katalog pomiaru> [--only=<lekcja>/<źródło>-r<n>,...]`:

- czyta `plan.json` z katalogu pomiaru (lista 18 przebiegów: lekcja, źródło,
  numer) i `thresholds.json`;
- uruchamia `pnpm probe:chapter` z env przebiegu: przedmiot, materiał,
  `UMIEM_PROBE_GENERATOR`, ścieżki `<lekcja>/<źródło>-r<n>/{dump.json,trace.json}`,
  `UMIEM_PROBE_OUT_DIR`, wspólny `UMIEM_PROBE_COSTS`, `UMIEM_PROBE_COMMIT`,
  unikalne `UMIEM_TEST_RUN_ID`; wyjście do `run.log`;
- najwyżej 3 przebiegi naraz; przed startem każdego: wydane + 1,00 USD ×
  (przebiegi w locie + 1) ≤ limit rejestru, inaczej czeka albo kończy
  (żadnych nowych startów po przekroczeniu);
- przebieg z wyjątkiem technicznym (klasa błędu sieci, 5xx, `ECONNRESET`,
  błąd kontenera) powtarza raz; przebieg, który zakończył się `failed`, nie
  jest powtarzany (liczy się do porażek); katalog nieudanej próby dostaje
  przyrostek `-attempt1`;
- pomija przebieg z istniejącym `dump.json` (wznowienie po przerwaniu);
- na konsolę wypisuje wyłącznie lekcję, źródło, stan, czas i koszt.

## 6. Ślepa ocena

### 6.1. Arkusze lekcji

`gen-blind-sheet.cjs` (bez zmian w mieszaniu) dla katalogu lekcji z 6
źródłami. Nowa opcja `--chunk=80` dzieli wymieszany arkusz na części
`sheet-01.csv…` po najwyżej 80 wierszy (ostatnia może być krótsza); klucz
jest jeden. Seed: `acceptance-<lekcja>`.

### 6.2. Oceniający i rozjemca

Każdą część oceniają dwaj świeży subagenci (model Opus) niezależnie, każdy
do własnego `verdicts-a.csv` / `verdicts-b.csv` w formacie dzisiejszym
(`rowId`, `verdict`, `criterion`, `adjudicatorNote`). Dostają wyłącznie:
część arkusza, `rubric-generation.md`, `rubric-criteria.md` i `material.txt`
— bez klucza, śladów, zrzutów, wyników drugiego oceniającego i informacji o
liczbie źródeł.

**Rozbieżność:** różny `verdict` albo — przy obu `defect` — rozłączne zbiory
kryteriów. Rozbieżne wiersze `merge-verdicts.cjs` zbiera do
`disputes-<część>.csv` (wiersz arkusza + oba werdykty z notami, bez
oznaczenia A/B). Trzeci subagent (Opus) wydaje werdykt końcowy do
`verdicts-final-<część>.csv`; wiersze zgodne przechodzą bez zmian (przy obu
`defect` kryteria to suma obu zbiorów).

### 6.3. Liczenie

`score.cjs` dostaje tryb `--final <key.json> <verdicts-final…>` (dzisiejsze
wywołanie bez trybu działa jak dotąd) i liczy per źródło (z łączeniem
`-r<n>`) W, K5 i liczby wierszy; `merge-verdicts.cjs` zapisuje
`agreement.json`: odsetek zgodnych wierszy i κ Cohena (ok/wada) per lekcja.

### 6.4. Arkusz fałszywych odrzuceń

`gen-rejection-sheet.cjs <katalog lekcji> <seed>` czyta ślady agenta lekcji i
losuje (seed `acceptance-rejections-<lekcja>`) do 20 odrzuconych ćwiczeń na
grupę kodów:

| Grupa | Odrzucenia (`Rejection.kind` / `code`) |
|---|---|
| bramka podpowiedzi | `rule` / `hint_reveals_answer` |
| sędzia podpowiedzi | `hint` / `hint_unsupported`, `hint_language`, `hint_reveals_paraphrase` |
| kontrola otwarta | `open` / `open_not_accepted` |
| ślepe rozwiązanie | `blind` / każdy kod (dziś `blind_mismatch`) |
| warianty | `variant` / każdy kod (dziś `variant_rejected`) |

Grupy dotyczą tylko odrzuceń modelowych i bramki podpowiedzi; odrzucenia
`shape`, `rule` (poza `hint_reveals_answer`), `lesson`, `leak` i `limit` są
deterministyczne i raport podaje dla nich same liczby z histogramu.

Wiersz zawiera kontekst zagadnienia, ćwiczenie i nazwę grupy z jednym
zdaniem opisu reguły (po polsku, stałe w skrypcie) — bez `detail`, odpowiedzi
rozwiązującego i werdyktu gradera. Oceniający wpisuje `justified` | `unjustified`
| `unclear` i notę. Ocena jak w §6.2 (dwóch + rozjemca). Raport: odsetek
`unjustified` per grupa i lekcja z przedziałem Wilsona 95%; grupa z mniej niż
5 próbkami ma tylko liczby.

## 7. Decyzja

`decide.cjs <katalog pomiaru>`:

1. sprawdza SHA-256 `thresholds.json` wobec wartości z `plan.json`;
2. czyta zrzuty (kompletność, porażki, koszt, czas, `deadline`), wyniki
   `score.cjs --final` i `agreement.json`;
3. dla każdej lekcji wypisuje każdy warunek §4 osobno (`pass` | `fail` |
   `no_data`) z wartościami i werdykt `agent` | `pipeline` |
   `owner_decision`;
4. zapisuje `decision.json` (same liczby i werdykty).

Werdykt `owner_decision` rozstrzyga właściciel na podstawie raportu; bez jego
odpowiedzi przedmiot zostaje na potoku.

## 8. Raport

`docs/superpowers/reports/2026-11-05-lesson-pool-agent-acceptance.md` (data
pomiaru w nazwie), po polsku:

- konfiguracja (modele, commit, polityka, hash progów i materiałów);
- tabela per lekcja: W, K5, kompletność, porażki, koszt, czas obu źródeł,
  warunki i werdykt;
- zgodność oceniających, liczba rozbieżności;
- metryki diagnostyczne z §2, w tym fałszywe odrzucenia per grupa;
- dla przegranych przedmiotów: główne źródła wad i odrzuceń opisane słownie
  (kryterium, typ ćwiczenia, charakter błędu) — **bez cytatów materiału ani
  treści ćwiczeń**;
- wydatki łącznie i per źródło.

Surowe dane (materiały, zrzuty, ślady, arkusze, werdykty) zostają w katalogu
pomiaru poza repozytorium.

## 9. Bramka zgody i koszty

Płatne wywołania startują dopiero po jawnej zgodzie właściciela w czacie,
wydanej na wiadomość zawierającą: plan 18 przebiegów, limit rejestru,
szacunek kosztu, hash `thresholds.json` i hash commitu sondy. Zgoda dotyczy
tego planu; dołożenie przebiegów (np. po przekroczeniu limitu) wymaga nowej.

**Szacunek** (próba 2026-11-03 i przebieg kontrolny 2a): agent — rozdział
0,11–0,15, gramatyka ok. 0,07, szkoła 0,20–0,31 + kontrole 2b 0,03–0,15 USD;
potok 0,05–0,20 USD na przebieg. Razem ok. 3–4 USD. **Limit rejestru: 6 USD**
(`UMIEM_PROBE_COSTS_INIT=1`, `UMIEM_PROBE_COSTS_CAP_USD=6`, nowy plik
`costs.json` w katalogu pomiaru).

Ocena subagentami nie zużywa OpenRouter. Szacunkowo ok. 1200 wierszy
arkuszy lekcji i do ok. 300 wierszy arkuszy odrzuceń, każdy oceniany dwa razy,
plus rozjemcy.

## 10. Przełączenie domyślne

### 10.1. Wartość `auto`

Dziś `withConfigDefaults` traktuje pusty łańcuch jak brak wartości, więc po
zmianie domyślnej listy na niepustą jawne `UMIEM_LESSON_AGENT_SUBJECTS=""` nie
wyłączyłoby agenta. Dlatego:

- `CONFIG_DEFAULTS.UMIEM_LESSON_AGENT_SUBJECTS = "auto"`;
- `auto` = lista przedmiotów przyjętych w odbiorze, stała
  `ACCEPTED_LESSON_AGENT_SUBJECTS` w `config.ts` (z raportu), z regułą:
  przedmiot z niepustym `agentPolicy.openAnswerCheckTypes` wchodzi tylko przy
  pełnej konfiguracji gradera (`graderConfigured(env)`); bez niej zostaje na
  potoku i worker zapisuje jedno ostrzeżenie `[config]` przy starcie;
- `none` = agent wyłączony (nowa wartość jawna; `""` po `withConfigDefaults`
  oznacza `auto`);
- jawna lista działa jak dziś (także szkoła bez gradera — jak w 2b);
- `auto`, `none` i lista się wykluczają (`auto,school` to błąd startu).

Jedna czysta funkcja `resolveLessonAgentSubjects(env, subjects)` (w miejscu
`agentSubjectIds`) obsługuje worker (`lessonAgentSubjectsFromEnv`) i web
(`lessonAgentPublicFromEnv`), więc panel pokazuje te same przedmioty co worker
przy tym samym env. Gdy odbiór nie przyjmie żadnego przedmiotu, stała jest
pusta, a domyślna wartość i tak staje się `auto` (bez zmiany zachowania) —
kolejne przyjęcia zmieniają tylko stałą.

Brak klucza OpenRouter przy niepustym wyniku działa jak dziś: ostrzeżenie i
potok (`lessonAgentSettingsFromEnv`).

### 10.2. Testy i światy

- **E2E:** światy (`tests/e2e/**` global setup i env weba/workera) ustawiają
  jawnie `UMIEM_LESSON_AGENT_SUBJECTS=none`, bo przy `UMIEM_FAKE_PROVIDERS=1`
  niepusta lista składa `FakeLessonPoolAgent`, a asercje speców opierają się na
  potoku. Ścieżkę agenta pokrywają testy integracyjne
  `lesson-agent-generation.test.ts` (fake'i i `MockLanguageModel`).
- **Integracja:** helpery składające usługi z env (`tests/integration/helpers.ts`
  i miejsca z `withConfigDefaults`) ustawiają `none`, poza testami agenta,
  które ustawiają listę jawnie (jak dziś).
- **Unit:** `resolveLessonAgentSubjects` — `auto` z graderem i bez, `none`,
  `""`, jawna lista, mieszanki jako błąd, nieznany przedmiot; zgodność workera
  i weba (te same przedmioty dla tego samego env).

### 10.3. Wdrożenie

Bez migracji. Web i worker wdrażamy razem (panel i worker czytają tę samą
wartość). Po wdrożeniu przedmioty z `ACCEPTED_LESSON_AGENT_SUBJECTS` generuje
agent, gdy worker ma klucz OpenRouter; szkoła dodatkowo wymaga
`UMIEM_GRADER_*` w workerze. Wycofanie: `UMIEM_LESSON_AGENT_SUBJECTS=none`.

## 11. Prywatność

- Sonda tworzy lekcje bez profilu dziecka; do modeli trafia wyłącznie to, co w
  produkcji (spec 2a §11, 2b §8). Ślad agenta zawiera dane wysyłane do
  checkera i gradera, więc leży wyłącznie poza repozytorium
  (`resolveOutsideRepoPath`).
- Konsola sondy i skryptów: liczby, kody, slugi, stany. Bez treści ćwiczeń,
  podpowiedzi, odpowiedzi rozwiązującego, materiału i `detail`.
- Subagenci oceniający dostają materiał i ćwiczenia (jak 2026-11-03), bez
  danych dziecka.
- Raport w repozytorium bez cytatów materiału i treści ćwiczeń (§8).

## 12. Testy przed płatnym pomiarem

- **Unit** (`vitest.unit.config.ts`, nowe pliki dopisane do `include`):
  `merge-verdicts`, `score --final`, `decide` (wszystkie warunki §4, brak
  danych, wysoki szum, zły hash), `gen-rejection-sheet` (losowanie z seedem,
  limit 20, brak `detail` w wierszach), `--chunk` arkusza,
  `agent-trace` (dekoratory przekazują argumenty, wyniki, `signal`, `cost`;
  błąd zapisu nie przerywa), plan i limit w `run-acceptance` (czysta funkcja
  harmonogramu: limit wydatków, powtórka tylko technicznej klasy błędu,
  wznowienie).
- **Próba sondy bez kosztu:** `UMIEM_FAKE_PROVIDERS=1` z
  `UMIEM_PROBE_GENERATOR=agent` dla trzech przedmiotów (szkoła z fake
  graderem): powstaje zrzut i ślad, nagłówek ma modele, konsola nie zawiera
  treści (sprawdzenie skryptem na `run.log`). Fake nie wymaga zgody.
- **Konfiguracja (§10):** unit i integracja jak w §10.2.
- **Przed PR:** `pnpm check`, `pnpm test:integration`, pełny
  `pnpm test:e2e:shards` (po przełączeniu domyślnym zachowanie światów nie
  może się zmienić).

## 13. Dokumentacja

- `docs/architecture.md` §19.17: status etapu 3, wynik odbioru, `auto`/`none`,
  odesłanie do raportu; opis pomiaru (`UMIEM_PROBE_GENERATOR`,
  `UMIEM_PROBE_AGENT_TRACE`, skrypty `acceptance/`).
- `docs/provider-config.md`, `.env.example`: `auto`, `none`, reguła szkoły z
  graderem.
- `AGENTS.md`: zdanie „Agent jest domyślnie wyłączony” → stan po odbiorze
  (`auto`, przyjęte przedmioty, `none` wyłącza).
- `docs/SPEC.md` §29a.10: przełączenie domyślne.
- API → MCP → `SKILL.md`: bez wpływu (generowanie i katalog nie są częścią
  MCP; brak nowych pól); uzasadnienie w opisie PR.

## 14. Ryzyka i ograniczenia

- **Jedna lekcja na przedmiot:** wynik może nie uogólnić się na inne
  materiały; raport mówi to wprost.
- **Oceniający z tej samej rodziny modeli** (Opus) mogą mieć wspólne
  skrzywienia; rozjemca tego nie usuwa. Zgodność mierzy tylko szum losowy.
- **Zmienność zagadnień** zwiększa rozrzut między przebiegami; 3 przebiegi to
  mało, a margines 3 pkt proc. jest kompromisem.
- **Ślad agenta** owija porty, więc nie widzi decyzji wewnątrz `admitBatch`
  poza wynikiem `submit`; to wystarcza do fałszywych odrzuceń.
- **Ceny OpenRouter** mogą się zmienić; koszt raportujemy z `usage.cost` w
  dniu pomiaru.
- **`auto` zmienia zachowanie wdrożeń**, które nie ustawiają zmiennej: po
  aktualizacji przyjęte przedmioty generuje agent (przy kluczu). Opis PR i
  `provider-config.md` mówią to wprost, z `none` jako wycofaniem.
