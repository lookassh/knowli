# Temat Present Continuous w lekcjach gramatyki — projekt

Wersja 1 (przed przeglądem trzech krytyków), 2026-11-05. Gałąź `feature/present-continuous` od `origin/main` 3b4c1ec0.
Powiązane: #279 (poziom materiału, osobno), #280 (Present Continuous v2), #237 (agent puli — etap 3 w toku).

## 1. Cel i kontekst

Trzeci temat katalogu przedmiotu `english_grammar`: `present_continuous@1`. Główny odbiorca to 11-latek po tematach „to be” i Present Simple, który zna Present Simple niepewnie; młodsze dzieci (7–8 lat) dostają podzbiór celów wybrany przez rodzica.

Cel właściciela: dziecko ma **zrozumieć, kiedy użyć czasu**, a nie wkuć formę. Trudność polskiego ucznia leży w wyborze czasu, nie w budowie formy: polskie „Ola czyta” odpowiada i „Ola reads”, i „Ola is reading”. Dlatego porównanie z Present Simple jest częścią tematu od pierwszej sesji.

Temat to dane katalogu plus reguły przedmiotu `english_grammar` (walidator, prompty). Bez zmian w silniku lekcji, kontraktach, bazie, Kid UI, panelu rodzica, MCP i `SKILL.md`.

## 2. Zasady dydaktyczne

Źródła: TeachingEnglish (British Council) — pytania sprawdzające znaczenie zamiast formy; metaanalizy nauczania gramatyki — jawne wyjaśnienie skuteczniejsze od samej ekspozycji, obiecujące podejście „przykłady, potem reguła”; hipoteza aspektu (Andersen, Shirai) — uczniowie rzadko dodają -ing do czasowników stanu, więc reguła o nich nie jest pilna. Badań dla dzieci 7–11 lat jest mało; poniższe zasady to synteza praktyki, nie wynik badań na tej grupie.

1. **Znaczenie od pierwszej sesji.** Cel porównania (`now_or_usually`) stoi na drugim miejscu katalogu; scheduler wprowadza dwa nowe cele na sesję, więc pierwsza sesja to forma i wybór czasu.
2. **Przykłady przed regułą.** Pierwsza karta celu 1 to scenka bez definicji; reguła na drugiej karcie.
3. **Budowa z części, które dziecko zna:** am/is/are z „to be” + -ing.
4. **Polski jako kotwica znaczenia.** Przykład dwuznaczności to czasownik bez polskiej pary aspektowej („Ola czyta”, „Tata gotuje”). Para idzie/chodzi służy jako most: „po polsku też mówisz inaczej — idzie teraz, chodzi codziennie”. Nie używamy „biegnie”, „płynie”, „idzie” jako przykładów dwuznaczności.
5. **Jednoznaczny kontekst w każdym ćwiczeniu** z wyborem czasu (§5). Około połowa ćwiczeń porównania opiera się na polskiej scence („Cicho, dziadek śpi.”), reszta na wskaźnikach czasu — żeby nie uczyć polowania na słowo „now”.
6. **Kontrastowe pary zdań** na kartach porównania: „Dad cooks dinner every day. / Look! Dad is cooking now.”
7. **Feedback wskazuje przyczynę:** wyjaśnienie błędu (`explanationPl`) w celach porównania nazywa wskaźnik lub scenkę („Widzisz every day? To zwykle, więc Ola reads.”).
8. **Dobry czas ze złą formą Present Simple to „prawie”,** nie błąd wyboru czasu (§7.3).
9. **Definicja dla dzieci: „teraz, w tej chwili”.** Sytuacje „w tych dniach” i tymczasowe („I'm reading Harry Potter”) są poprawną angielszczyzną, ale w v1 generator ich unika (§7.2), a karty ich nie uczą (#280).

## 3. Katalog `present_continuous@1`

Plik `packages/server/src/domain/lessons/subjects/english-grammar/topics/present-continuous.ts`, prefiks celów `english_grammar.present_continuous`. Rejestracja: `topics: [presentSimpleV1, toBeV1, presentContinuousV1]` w `module.ts`.

### 3.1 Cele

| # | id | `titlePl` (widzi rodzic) | Typy ćwiczeń |
|---|---|---|---|
| 1 | `affirmative` | „Teraz: am/is/are + -ing” | card, notice, choice, listen_choice, order, gap, error_fix, open_answer |
| 2 | `now_or_usually` | „Teraz czy zwykle? (wymaga Present Simple)” | card, choice, listen_choice, gap, error_fix, open_answer |
| 3 | `negative` | „Przeczenie: isn't / aren't + -ing” | card, choice, listen_choice, gap, error_fix, transform, open_answer |
| 4 | `questions` | „Pytania i krótkie odpowiedzi” | card, choice, listen_choice, order, short_answer, gap, transform, open_answer |
| 5 | `ing_spelling` | „Pisownia -ing” | card, choice, gap, error_fix, open_answer |
| 6 | `now_or_usually_more` | „Teraz czy zwykle? Przeczenia i pytania” | card, choice, listen_choice, gap, error_fix, open_answer |

Typy oznaczają `lesson_*`. Każdy cel ma typ etapu prowadzonego, produktywnego i samodzielnego (`catalog-validation.ts`). `listen_choice` jest poza etapami; tam, gdzie go nie ma, różnica nie jest słyszalna (pisownia) albo nie należy do sprawdzanego elementu.

Zakres celów:
- **1 `affirmative`:** twierdzenia z czasownikami czynności; podmiot zaimek albo rzeczownik z materiału. `listen_choice`: is/are (am/is/are przy podmiocie przed luką).
- **2 `now_or_usually`:** wybór Present Simple albo Present Continuous w zdaniach twierdzących. `listen_choice`: forma PS vs PC tego samego czasownika („plays” / „is playing”).
- **3 `negative`:** am not / isn't / aren't + -ing. `listen_choice`: isn't / aren't. `transform`: `to_negative`.
- **4 `questions`:** pytania ogólne (Is she reading?), krótkie odpowiedzi (Yes, she is. / No, they aren't.) i stały zwrot „What + am/is/are + podmiot + doing?” z odpowiedzią pełnym zdaniem. `listen_choice`: Is / Are na początku pytania. `transform`: `to_question`.
- **5 `ing_spelling`:** pisownia formy -ing; wyłącznie czasowniki z tabeli (§4).
- **6 `now_or_usually_more`:** wybór czasu w przeczeniach i pytaniach (doesn't vs isn't, Do you…? vs Are you…?). `listen_choice`: doesn't / isn't, Do / Are.

Przekształcenia tematu: `to_negative` „Zamień na przeczenie”, `to_question` „Zamień na pytanie”, `to_affirmative` „Zamień na zdanie twierdzące”.

Rekomendacja dla rodzica (w opisie PR i SPEC, bez zmiany formularza): młodsze dzieci — cele 1, 2, 4; 11-latek — wszystkie. Tytuły celów niosą tę informację (cel 2 i 6: „wymaga Present Simple”). Formularz nadal zaznacza domyślnie wszystkie cele.

### 3.2 Karty (szkic treści; jedno–dwa krótkie zdania na kartę)

Cel 1 `affirmative`:
- „Co się dzieje?”: „Popatrz! Tom is running. Mum is cooking. To dzieje się teraz, w tej chwili.”
- „Dwie części”: „am / is / are już znasz. Dokładasz czasownik z -ing: she is reading, they are playing.”
- „Przykłady z lekcji”: „Zobacz, co dzieje się teraz: {{examples}}”

Cel 2 `now_or_usually`:
- „Teraz czy zwykle?”: „Po polsku mówisz: Ola czyta. Po angielsku zapytaj: teraz czy zwykle?”
- „Dwa zdania”: „Dad cooks dinner every day. — zwykle. Look! Dad is cooking now. — teraz.”
- „Po polsku też to słychać”: „Tom idzie do szkoły (teraz) — Tom chodzi do szkoły (zwykle). Po angielsku: is walking / walks.”
- „Przykłady z lekcji”: „{{examples}}”

Cel 3 `negative`:
- „Dodaj not”: „Przeczenie: am not, isn't, aren't + -ing: he isn't sleeping, we aren't playing.”
- „Przykłady z lekcji”: „{{examples}}”

Cel 4 `questions`:
- „Zamień kolejność”: „W pytaniu am/is/are idzie przed osobę: Is she reading? Are they playing?”
- „Krótka odpowiedź”: „Odpowiadasz tą samą formą: Yes, she is. No, they aren't.”
- „Co robisz?”: „What are you doing? — Co robisz? What is he doing? — Co on robi?”
- „Przykłady z lekcji”: „{{examples}}”

Cel 5 `ing_spelling`:
- „Znika e”: „make → making, ride → riding.”
- „Podwójna litera”: „Krótkie słowo z jedną samogłoską między spółgłoskami: run → running, swim → swimming.”
- „ie → y”: „lie → lying, die → dying.”
- „Przykłady z lekcji”: „{{examples}}”

Cel 6 `now_or_usually_more`:
- „Pytania”: „Do you play football? — zwykle. Are you playing football now? — teraz.”
- „Przeczenia”: „She doesn't eat meat. — zwykle. She isn't eating now. — teraz.”
- „Przykłady z lekcji”: „{{examples}}”

Ostateczne brzmienie kart ustala implementacja; kontrolą jest test spójności katalogu (karta z `{{examples}}`, długość) i przegląd w PR.

### 3.3 Kategorie błędów

Nowe w `extraErrorCategories` tematu (walidacja katalogu sprawdza unikalność w obrębie tematu i względem kategorii bazowych i przedmiotu, nie między tematami — `catalog-validation.ts`):

| code | `labelPl` |
|---|---|
| `wrong_be_form` | Zła forma czasownika „to be” (am/is/are) |
| `missing_be_form` | Brak formy czasownika „to be” |
| `missing_ing` | Brak końcówki -ing |
| `ing_spelling` | Błąd w pisowni -ing |
| `be_plus_simple` | Forma „to be” z czasownikiem bez -ing (np. „she is plays”) |
| `continuous_for_habit` | -ing zamiast zwykłego czasu (czynność codzienna) |
| `simple_for_now` | Zwykły czas zamiast -ing (czynność teraz) |

Przypisanie do celów (każda kategoria celu ma szablon podpowiedzi):
- 1: `missing_be_form`, `wrong_be_form`, `missing_ing`, `be_plus_simple`, `wrong_subject_agreement`
- 2: `continuous_for_habit`, `simple_for_now`, `be_plus_simple`, `missing_ending`
- 3: `wrong_negation`, `wrong_be_form`, `missing_ing`, `extra_auxiliary`
- 4: `word_order`, `wrong_be_form`, `extra_auxiliary`, `short_answer_form`, `missing_ing`
- 5: `ing_spelling`, `missing_ing`
- 6: `continuous_for_habit`, `simple_for_now`, `wrong_auxiliary`, `extra_auxiliary`

Podpowiedzi celów 2 i 6 powtarzają refren „Zapytaj: teraz czy zwykle?”. `be_plus_simple`: „Gdy jest am/is/are, czasownik ma -ing: she is playing. Gdy zwykle — bez am/is/are: she plays.”

## 4. Forma -ing

Nowy plik `packages/server/src/domain/lessons/subjects/english/ing-forms.ts` (+ test): zamknięta tabela ok. 80 czasowników czynności poziomu A1–A2 → forma -ing w pisowni brytyjskiej (`answerLocale: en-GB`): m.in. play, read, write, ride, make, swim, run, sit, get, lie, travel (travelling). API:

- `ingFormOf(base: string): string | undefined` — `undefined` dla czasownika spoza tabeli.
- `baseOfIngForm(form: string): string | undefined` — odwrotność po tabeli.

Tabela zamiast reguł: podwojenie spółgłoski zależy od akcentu (visit → visiting, begin → beginning), a brytyjskie „-ll” od konwencji. Czasownik spoza tabeli w sprawdzanym miejscu odrzuca ćwiczenie (lepiej odrzucić niż przepuścić złą pisownię). Tabela wyklucza czasowniki stanu (§5.3).

## 5. Reguły jednoznaczności (cele 2 i 6, częściowo 1, 3, 4, 5)

### 5.1 Wskaźniki czasu (zamknięte listy, po normalizacji)

- **Teraz (EN):** now, right now, at the moment, look, listen, today, this morning, this afternoon.
- **Zwykle (EN):** every day/week/morning/evening/weekend/Monday…Sunday, usually, always, often, sometimes, never, on Mondays…Sundays, at weekends, once a week, twice a week.
- **Teraz (PL, w poleceniu):** teraz, właśnie, w tej chwili, popatrz, patrz, posłuchaj, słuchaj, cicho.
- **Zwykle (PL, w poleceniu):** codziennie, zwykle, zawsze, często, czasem, nigdy, co tydzień, w każdy, w każdą, w weekendy.

„today” oznacza teraz tylko w zestawieniu z formą -ing; w celach 2 i 6 walidator traktuje „today” jak wskaźnik „teraz” wyłącznie razem z innym wskaźnikiem tej grupy albo scenką PL — samo „today” nie wystarcza.

### 5.2 Wymóg w celach 2 i 6

Każde ćwiczenie (poza kartą) ma co najmniej jeden wskaźnik z §5.1 — w zdaniu angielskim (`stem`, `statement`, odpowiedź) albo jako scenka w `instructionPl` (dla `open_answer`: w `prompt`) — i wszystkie wskaźniki ćwiczenia należą do jednej grupy (teraz albo zwykle). Czas odpowiedzi kanonicznej i wariantów zgadza się z grupą: „teraz” → Present Continuous, „zwykle” → Present Simple. Ćwiczenie bez wskaźnika albo z mieszanymi grupami jest odrzucane.

### 5.3 Czasowniki stanu

Zamknięta lista: like, love, hate, want, need, know, understand, believe, remember, have, think, see, hear, look (jako „wyglądać”), feel, taste, smell, own, belong. W celach 2 i 6 żadne zdanie ćwiczenia ani odpowiedź nie zawiera tych czasowników (w dowolnej formie) — tak, żeby „I know it now” nie dało sprzecznego werdyktu. W pozostałych celach czasownik z tej listy nie występuje w formie -ing w odpowiedziach ani wariantach („I am liking” nigdy nie jest poprawne). „look” jako „Look!” (wskaźnik) jest dozwolone.

### 5.4 Tłumaczenia w celach 1, 3, 4, 5

`prompt` (polskie zdanie do przetłumaczenia) zawiera wskaźnik „teraz” z §5.1 (PL), bo „Mama gotuje” bez kontekstu ma dwa poprawne tłumaczenia. Warianty odpowiedzi obejmują wersję z „now” i bez niego, gdy polski wskaźnik to „właśnie”/„teraz” (generator dodaje oba; walidator nie wymaga obu).

## 6. Walidator przedmiotu

Plik `english-grammar/validators.ts`, nowa gałąź `topic.id === "present_continuous"` w `validateEnglishGrammarExercise`, kod tematu w nowym pliku `english-grammar/present-continuous-validation.ts` (walidator już ma ok. 600 linii).

### 6.1 Wydzielenie wspólnych funkcji „to be”

Zgodność podmiotu z formą be dziś żyje w ścieżce `to_be` (`bePronounNearGap`, `expectedBeFormNearGap`, `parseBeGapAnswer`, części `validateBeAnswerText`). Wydzielamy je do `english-grammar/be-agreement.ts` jako czyste funkcje i używamy w obu tematach. `checkBePolarity` dostaje mapę cel → biegunowość zamiast stałych identyfikatorów celów `to_be`. Zachowanie tematu `to_be` bez zmian — pilnują istniejące testy.

### 6.2 Luka (`lesson_gap`)

- Zdanie zawiera czasownik w nawiasie zaraz po luce: „He ___ (swim) now.”; `hint` pusty. Checker agenta i kartkówka nie widzą `hint` (`agent/solver.ts`, `lesson-materialize.ts`), więc czasownik musi być w zdaniu. W celu 6 z operatorem: „___ you (play) tennis every Saturday?” → „Do”.
- Cele 1, 3, 5 i pytania celu 4: odpowiedź to [am|is|are|'m][ not| n't]? + forma -ing czasownika z nawiasu (`ingFormOf`), sama forma -ing (gdy forma be stoi w zdaniu) albo sama forma be (gdy -ing stoi w zdaniu); forma be zgodna z podmiotem (§6.1); biegunowość zgodna z celem (3 — przeczenie).
- Krótkie odpowiedzi celu 4: jak `short_answers` w `to_be`.
- Cele 2 i 6: odpowiedź to forma PS albo PC czasownika z nawiasu, zgodna z grupą wskaźnika (§5.2); formy PS sprawdzają istniejące `isAcceptablePresentSimpleAnswer` i reguły operatora (`objectiveAllowsOperator` rozszerzone o `now_or_usually_more`).
- Odpowiedź luki ma najwyżej 3 słowa po rozwinięciu skrótów (`MAX_GAP_ANSWER_TOKENS`).

### 6.3 Całe zdania (choice, error_fix, transform, short_answer, open_answer, order)

- Każda forma be w odpowiedzi i wariantach zgadza się z podmiotem; po formie be w zdaniu PC stoi forma -ing z tabeli.
- `be_plus_simple` w odpowiedzi poprawnej odrzuca ćwiczenie („She is plays”).
- `answer` i `acceptedAnswers` nie zawierają skrótów he's/she's/it's ani skrótu `'s` po rzeczowniku: `contractions.ts` rozwija „'s” do „is” albo „has”, a dopasowanie przyjmuje dowolny wspólny wariant, więc klucz „He's running.” zaliczyłby „He has running.”. Dziecko nadal może wpisać „He's running” — dopasuje się do klucza „He is running”.
- Pytanie szczegółowe tylko we wzorcu „What + am/is/are + podmiot + doing?”; inne pytajniki odrzucają ćwiczenie.
- `error_fix`: błędne zdanie różni się od poprawnego dokładnie sprawdzanym elementem celu (brak be, brak -ing, hybryda, zła pisownia, zły czas w celach 2/6).
- Cele 2 i 6: reguły §5.2 i §5.3.
- Cele 1, 3, 4, 5: §5.3 (bez -ing przy czasownikach stanu) i §5.4 dla `open_answer`.

### 6.4 Wybór (`lesson_choice`) i polski kontekst

Polski kontekst (scenka) tylko w `instructionPl` — Kid UI renderuje bodziec z `lang` en-GB, a nagranie zdania po odpowiedzi czyta bodziec angielskim lektorem. Bodziec to angielska rama z luką („Ola ___ .”), opcje to formy („reads” / „is reading”). Walidator odrzuca polskie znaki diakrytyczne w `stem` i opcjach.

### 6.5 „Wskaż słowo” (`lesson_notice`)

Tylko cel 1: dziecko wskazuje formę -ing; segmentacja na pojedyncze słowa. Nowa ogólna reguła w `pool-validation.ts` (`validateNotice`), dla wszystkich przedmiotów: `correctOption` pasuje do dokładnie jednego segmentu we wszystkich zdaniach — dziś materializacja bierze pierwszy pasujący segment, a ocena porównuje identyfikator, więc drugie wystąpienie tego samego słowa daje fałszywy błąd. Przed włączeniem sprawdzamy, że istniejące pule testowe i fixture'y E2E spełniają regułę; gdyby nie, reguła działa tylko dla nowych pul (przy walidacji generacji), nie przy odczycie opublikowanych.

### 6.6 Posłuchaj i wybierz (`lesson_listen_choice`)

Istniejące reguły (`listenChoiceSibilantErrors`) obowiązują. Opcje z is/are, isn't/aren't, doesn't/isn't, Do/Are albo „plays”/„is playing”; nie „He's”/„He” (scala się przed wyrazami na s: swimming, singing, sitting).

## 7. Prompty

Plik `english-grammar/prompts.ts`. Prompt agenta puli składa się z `lessonSystemPrompt` (`fieldRules` przedmiotu i opisy celów), więc zmiany obejmują agenta bez zmian w jego kodzie.

### 7.1 Zawężenie reguł Present Simple

Zdania `fieldRules` o luce w Present Simple i operatorze do/does dotyczą dziś całego przedmiotu. Zawężamy je do „objectives whose id contains '.present_simple.'” (wzorem bloku `.to_be.`). Test kontraktu prompt↔walidator (`module.test.ts`) obejmuje nowy blok.

### 7.2 Blok `.present_continuous.`

Treść (po angielsku, dla modelu):
- luka: czasownik w nawiasie po luce, `hint` null, odpowiedź do 3 słów (formy z §6.2);
- tylko sytuacje „right now”, czasowniki czynności; nigdy czasowniki stanu z §5.3 w formie -ing; bez sytuacji „these days” i tymczasowych;
- tłumaczenia celów 1, 3, 4, 5: polskie zdanie z „teraz”/„właśnie”/„w tej chwili”; warianty z „now” i bez;
- klucze bez he's/she's/it's i bez „'s” po rzeczowniku (pełne „is”);
- „What + am/is/are + subject + doing?” jako jedyne pytanie szczegółowe;
- cele 2 i 6: każde ćwiczenie z jednoznacznym kontekstem — wskaźnik z listy albo polska scenka w `instructionPl`; mniej więcej połowa ćwiczeń na scence bez angielskiego słowa-wskaźnika; nigdy czasowniki stanu; `explanationPl` nazywa wskaźnik lub scenkę, która przesądza o czasie;
- polski tekst tylko w `instructionPl`/`prompt`, bodziec i opcje po angielsku;
- `listen_choice`: pary z §6.6.

Listy wskaźników w prompcie generuje kod z tych samych stałych co walidator (jedno źródło).

### 7.3 Opisy celów (`descriptionEn`) a ocena

`descriptionEn` celów 2 i 6 mówi wprost: sprawdzanym elementem jest wybór czasu; dobrze wybrany czas z błędem formy Present Simple (np. brak -s) to „almost”. To istniejący mechanizm werdyktu `almost` modelu oceniającego (odpowiedzi tekstowe niedopasowane deterministycznie); bez nowego kodu. Opis celu 2 dopuszcza Present Simple w historyjce (§9).

## 8. Agent puli (#237)

Bez zmian w `agent-policy.ts` gramatyki. Czasownik w nawiasie (§6.2) daje checkerowi wszystko do rozwiązania luki na ślepo; dwuznaczność zamyka deterministycznie walidator (§5), checker jest niezależną drugą kontrolą. Typy rozwiązywane na ślepo i sprawdzanie wariantów jak w polityce przedmiotu.

## 9. Historyjka

Do promptu historyjki trafiają opisy wybranych celów (`lesson-story-generation.ts`). Wspólnych `storyRules` nie zmieniamy. Mieszanie czasów („Every day Tom walks to school. Today he is riding his bike.”) wynika z opisu celu 2 i pojawia się tylko wtedy, gdy rodzic wybrał cel 2 albo 6. Pytania historyjki dotyczą treści.

## 10. Dane, prywatność, kontrakty

Bez nowych przepływów danych: do modeli trafia to samo co dla innych tematów gramatyki. Bez migracji, bez zmian DTO (`topicId` to string), bez zmian Kid UI i panelu. MCP i `SKILL.md` bez zmian — lekcje nie są w MCP ani `learning-overview`; uzasadnienie w opisie PR.

## 11. Testy

Jednostkowe (bez bazy):
- `ing-forms.test.ts`: każda reguła pisowni z tabeli, pisownia brytyjska, czasownik spoza tabeli → `undefined`, brak czasowników stanu w tabeli, odwrotność.
- `module.test.ts`: rejestr udostępnia `present_continuous@1`; pętla spójności tematów obejmuje nowy temat (kolejność celów, kategorie z podpowiedziami, karta z `{{examples}}`, trzy przekształcenia); wersje `present_simple@1` i `to_be@1` bez zmian; cele ze słyszalną różnicą mają `lesson_listen_choice`, cel 5 nie ma; przykłady z bloku `.present_continuous.` przechodzą walidator; listy wskaźników w prompcie równe stałym walidatora.
- `present-continuous-validation.test.ts`: dla każdego celu przypadki poprawne i odrzucane, w tym: dwuznaczne zdanie bez wskaźnika (cele 2, 6), wskaźnik niezgodny z czasem, mieszane grupy, „today” bez drugiego wskaźnika, he's w kluczu, czasownik stanu w celu 2 i w formie -ing w celu 1, hybryda „She is plays”, czasownik spoza tabeli, „What is he doing?” i odrzucenie „Where is he going?”, polski tekst w `stem`, tłumaczenie bez „teraz”, `hint` niepusty w luce, luka bez nawiasu.
- `be-agreement.test.ts` + istniejące `validators.test.ts`: zachowanie `to_be` bez zmian po wydzieleniu.
- `pool-validation.test.ts`: reguła „dokładnie jeden segment” dla `lesson_notice`.

Integracyjne (po scaleniu PR 2 etapu 3, ścieżka agenta na fake-agencie):
- generowanie lekcji `present_continuous` z celami 1–6 → szkic, publikacja, sesja dziecka: karty, ćwiczenie celu 2, ocena odpowiedzi „He's running” przy kluczu „He is running” jako poprawnej.

Sonda (płatna, `tests/probes`): pula dla celów 1–6 na przykładowym materiale z podręcznika; raport: odsetek odrzuceń z powodami, liczba ćwiczeń celów 2 i 6 na scenkach i na wskaźnikach, wynik checkera. Uruchomienie wyłącznie po wyraźnej zgodzie właściciela na konkretną wiadomość z szacunkiem kosztu; każde ponowienie wymaga nowej zgody. Na podstawie wyniku strojenie promptu przed PR.

Kontrola końcowa: `pnpm check`; `pnpm test:e2e:shards` przed PR (bez nowych speców E2E — brak zmian UI).

## 12. Kolejność prac i koordynacja z #237

1. Część domenowa (tabela -ing, wydzielenie be, walidator, prompty, katalog, testy jednostkowe) od razu na `feature/present-continuous` — PR 2 etapu 3 nie dotyka `english-grammar/` ani `english/`.
2. Po scaleniu PR 2 etapu 3: rebase na `origin/main`, test integracyjny na ścieżce agenta, sonda.
3. Jeden PR do zatwierdzenia przez właściciela; dokumentacja w tym samym PR.

## 13. Dokumentacja

- `docs/SPEC.md` (lekcje): lista tematów katalogu + Present Continuous, rekomendacja wyboru celów dla młodszych.
- `docs/folder-structure.md`: nowe pliki tematu i `english/ing-forms.ts`.
- `.kiro/specs/grammar-module/`: wzmianka o trzecim temacie, jeśli dokument wymienia tematy.

## 14. Poza zakresem (v2, #280)

Czasowniki stanu jako cel, pytania where/why/who, Present Continuous jako przyszłość, sytuacje „w tych dniach”, piktogramy czynności, poziom materiału (#279), zmiany formularza rodzica (opisy celów, domyślne odznaczenie).

## 15. Ryzyka

- **Odsetek odrzuceń w celach 2 i 6** przez twarde reguły jednoznaczności może wymagać kilku rund dogenerowania. Mitigacja: listy wskaźników w prompcie z tych samych stałych, sonda przed PR.
- **Rozjazd wieku:** prompty mówią „~8 lat”, karty pisane dla 9–11 (do #279).
- **Słaby Present Simple** może obniżać wyniki celów 2 i 6; werdykt „prawie” działa tylko dla odpowiedzi ocenianych modelem, nie dla wyboru zamkniętego, gdzie opcje mają poprawne formy.
