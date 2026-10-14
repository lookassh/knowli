# Design: Feedback pisowni z różnicą liter (issue #9)

- Data: 2026-10-12
- Status: projekt zatwierdzony przez właściciela (decyzje w sekcji „Decyzje”); czeka na plan implementacji.
- Zgłoszenie: [lookassh/knowli#9](https://github.com/lookassh/knowli/issues/9) — „[Produkt] Feedback pisowni pokazujący brakujące, nadmiarowe i przestawione litery” (P1).
- Stan odniesienia: `main` = 4475e4a (2026-10-11), PR #49.
- Ścieżka: architectural (zmiana publicznego kontraktu Kid API).

## Cel

Po błędnej próbie pisemnej pokazać dziecku obok siebie jego zapis i właściwy zapis z zaznaczonym miejscem różnicy (brakująca, nadmiarowa, zamieniona litera, przestawiona para liter), bez ocen liczbowych i bez zwiększania liczby prób. Pomoc pojawia się wyłącznie po odpowiedzi, a pokazanie poprawnego zapisu pozostaje zapisanym ujawnieniem.

## Decyzje (zatwierdzone przez właściciela, 2026-10-12)

1. **Granica literówki:** diff pokazujemy, gdy odległość edycyjna od najbliższego zatwierdzonego wariantu wynosi maksymalnie 2 operacje; maksymalnie 1 operację, gdy najkrótszy kandydat ma ≤ 4 znaki. Poza progiem — dotychczasowy komunikat `incorrect` z pełnym rozwiązaniem, bez diagnozy liter.
2. **Forma oznaczeń: „pigułki”** — różniące się fragmenty w zaokrąglonej ramce z delikatnym tłem. Ramka jest drugim kanałem informacji obok koloru (wymóg dostępności z issue). Wpis dziecka: neutralny/niebieski (język „spróbuj jeszcze raz”); poprawny wzorzec: zielony akcent.
3. **Podejście implementacyjne:** diff liczony w domenie serwera, segmenty przekazywane w `FeedbackDto`; kid-ui wyłącznie renderuje. Klient nie zna listy zatwierdzonych wariantów i nie wylicza treści feedbacku (zasada: tekst i ton nie są wyliczane z odpowiedzi klienta).
4. **Spec i plan pozostają lokalnie bez commita i bez PR** (materiał wejdzie później do PR z implementacją).

## Klasyfikacja przypadków

Zakres: próby pisemne (`modality: "text"`) w zadaniach oceniających pisownię — typy `recall`, `spelling`, `letter_completion`. Mowa, wybór opcji i prezentacje pozostają bez zmian.

| Przypadek (odpowiedź pisemna) | Feedback |
| --- | --- |
| Zgodna co do znaku z którymś wariantem | `great` (bez zmian) |
| Zgodna z wariantem po zignorowaniu wielkości liter | `capitalization_hint` (bez zmian, bez diffu) |
| Nie zgodna z żadnym wariantem; odległość od najbliższego ≤ próg | **nowy `spelling_hint`**: wpis + właściwy zapis z pigułkami; opcjonalnie wskazówka kapitalizacyjna |
| Nie zgodna; odległość > próg | `incorrect` z `correctText` (bez zmian) |
| Pusta odpowiedź, `skip`, `dont_remember`, awaria techniczna | bez diagnozy liter (dotychczasowe rodzaje `not_assessed`/`unevaluated`/`incorrect` z `reason`) |
| Kartkówka (`mock_test`) | feedback `null` — bez diffu (bez zmian) |

Odpowiedź dokładnie zgodna z zatwierdzonym wariantem nigdy nie jest porównywana z innym wariantem — kryterium „poprawny zatwierdzony wariant nie jest oznaczany jako literówka względem innego wariantu” spełnia z definicji (wymagane dopasowanie do jakiegokolwiek wariantu, nie do konkretnego).

## Algorytm porównania

Nowa czysta funkcja domenowa w `packages/server/src/domain/spelling-diff.ts`: `compareSpelling(answer, key)`.

1. Normalizacja wejść: NFC + trim (jak `matchWrittenAnswer`).
2. Kandydaci: `[key.target, ...key.acceptedAnswers]`.
3. Metryka: **Damerau–Levenshtein** (wstawienie, usunięcie, zamiana litery, przestawienie pary sąsiednich liter) liczona **bez rozróżniania wielkości liter**, z pełnym odczytem alignmentu (backtracking), O(n·m) na krótkich pojedynczych słowach.
4. Wybór wariantu porównania: wariant o najmniejszej odległości; przy remisie kanoniczny `key.target`.
5. Próg: ≤ 2 operacje; ≤ 1, gdy najkrótszy kandydat ma ≤ 4 znaki.
6. Segmentacja alignmentu: sąsiednie pozycje o tym samym statusie sklejane w segmenty. Statusy: zgodny fragment (`plain`) oraz różnica (`pill` — do pigułki). Wyjście: `given` (zapis dziecka) i `expected` (wariant) w tej samej konwencji segmentów.
7. Flaga `capitalizationHint`: prawdziwa, gdy w obrębie alignmentu istnieje para liter zgodna po zignorowaniu wielkości liter, ale niezgodna dokładnie (np. „wendsday” vs „Wednesday”: brakujące „d” oraz mała litera na początku).
8. Wynik zwraca też odległość i wybrany wariant; `null`, gdy odpowiedź jest pusta.

## Kontrakt (DTO)

`packages/contracts/src/kid.ts`:

- `FeedbackDtoSchema.kind` zyskuje wartość `"spelling_hint"`.
- Nowe schematy:

```ts
const SpellingDiffSegmentSchema = z.object({
  text: z.string().min(1),
  state: z.enum(["plain", "pill"]),
});

const SpellingDiffSchema = z.object({
  given: z.array(SpellingDiffSegmentSchema).min(1).max(32),
  expected: z.array(SpellingDiffSegmentSchema).min(1).max(32),
  capitalizationHint: z.boolean().optional(),
});
```

- `FeedbackDtoSchema` zyskuje opcjonalne pole `spellingDiff: SpellingDiffSchema.optional()`.
- `superRefine`: `spellingDiff` jest dozwolone **wyłącznie** przy `kind === "spelling_hint"` i wtedy **wymagane**; `expected` sklejone pokrywa się z `correctText`.
- DTO nie zawiera odległości ani technicznych score'ów (dziecko nie widzi liczb).

## Reguły feedbacku i ekspozycji

- `chooseFeedback` (packages/server/src/domain/feedback.ts) — kolejność wyboru dla ocenianych umiejętności pisanych: `great` → `capitalization_hint` → `spelling_hint` → `incorrect`. Diff liczony wyłącznie, gdy ocena pisowni to `incorrect`; jeżeli Recall zaliczony, a pisownia nie, to z definicji jest to `capitalizationOnlyDefect` (dopasowanie po wielkości liter), więc `spelling_hint` dotyczy odpowiedzi bliskich, ale niezaliczonych.
- Tekst nowego komunikatu w rodzaju: „Prawie! Popraw zapis:”. Uczciwy wobec wyniku: podobieństwo tekstu nie zalicza znaczenia (A16, SPEC §12.8), więc komunikat nie chwali odpowiedzi jako poprawnej — „prawie” odnosi się wyłącznie do zapisu.
- **Oceny umiejętności: nienaruszone.** Diff nie zmienia `outcome`, `independent`, `confirmationEligible`, nie tworzy mylonej pary, nie zmienia liczby prób, przejścia zadania ani budżetu sesji.
- **Ekspozycje:** `spelling_hint` ujawnia poprawny zapis — korzysta z istniejącego mechanizmu (`feedback_issued` zapisywany w tej samej transakcji przed odpowiedzią HTTP, arch §9.2). Poprawka: przy `spelling_hint` `correctText` może być najbliższym **wariantem**, a nie kanonicznym targetem, więc `feedbackExposureKeys` musi uwzględniać klucz policzony z faktycznego `correctText` (nie tylko z canonical), aby scheduler chronił cele samodzielnych sprawdzeń także dla ujawnionych wariantów.
- Sukces po diffu pozostaje wsparciem: jeśli dziecko poprawi zapis po zobaczeniu pigułek, nowa próba oceniana jest zwykłymi regułami samodzielności (kolejna próba tego zadania nie jest niezależnym potwierdzeniem).

## Kid UI

- `AnswerFeedback.tsx` (packages/kid-ui/src/screens): pod komunikatem, gdy dto zawiera `spellingDiff`, dwa wiersze z etykietami „Twój zapis” / „Poprawnie” i segmentami; `state: "pill"` renderowany jako pigułka (zaokrąglona ramka + delikatne tło).
- Drugi kanał informacji poza kolorem: kształt (ramka). Kolory: wpis — neutralny/niebieski, wzorzec — zielony; spójne z istniejącym językiem kolorów feedbacku.
- Dostępność: sekcja w `role="status"`; dla czytników ekranu pełny opis słowny („Wpisałeś: {given}. Poprawnie: {expected}.”) — pigułki nie są jedynym nośnikiem informacji; etykiety wierszy jako `aria-label`.
- `data-testid`: `kid-spelling-given`, `kid-spelling-expected`, segment pigułki `kid-spelling-pill` — pod testy e2e.
- Komunikaty w `packages/contracts/src/messages.ts` (polskie, krótkie, czytelne na małym ekranie): tekst główny `spelling_hint`, wariant z wskazówką kapitalizacyjną, etykiety wierszy.
- Mobile first, duże litery, brak modalu.

### Widok jednoliniowy „Prawie! Uzupełnij brakujące litery” (PR #61, wyrównane 2026-10-14)

Gdy zapis dziecka **nie zawiera żadnej błędnej litery**, a odpowiedź różni się od wariantu wyłącznie brakującymi literami, zamiast dwóch wierszy pokazujemy jedno pełne słowo wzorca z zielonymi pigułkami na brakujących fragmentach (bez wiersza „Twój zapis” — nie ma czego poprawiać, tylko uzupełnić). Komunikat: „Prawie! Uzupełnij brakujące litery:”; opis dla czytników: „Poprawnie: {expected}.”. `isIncompleteWord` ma pierwszeństwo przed wskazówką kapitalizacyjną (prefiks małą literą nie wyświetla mylącego komunikatu o wielkiej literze).

Kwalifikacja dzieli się na warunki strukturalne (serwer `isLetterOmissionOnly` w `spelling-diff.ts` **i** UI `isIncompleteWord` w `spelling-diff-view.ts`) i próg długości (tylko serwer):

- zapis dziecka składa się wyłącznie z segmentów `plain` (żadnej błędnej, nadmiarowej ani przestawionej litery),
- brakuje **co najwyżej jednej dziury gdziekolwiek** (urwany początek `day`→`[Mon]day`, urwany koniec `Mon`→`Mon[day]`, litera w środku `Wenesday`→`We[d]nesday`) **albo obu końców naraz** (wpisany środek słowa `dnes`→`[We]dnes[day]`),
- braki rozproszone — dwie i więcej dziur w środku (`Weay`, `Wdnsdy`) — pozostają poza diagnozą,
- próg długości (tylko serwer, ścieżka brakujących liter): wpisany fragment ma ≥ 2 znaki i (≥ 3 znaki albo ≥ 50% długości wariantu) — pojedyncza litera (`M`) i zbyt krótkie fragmenty (`We` na 9 liter) nie dostają podpowiedzi z tej ścieżki.

Konsekwencja podziału: diff może też przyjść zwykłą ścieżką literówkową (dystans ≤ progu) i wtedy UI klasyfikuje wyłącznie po kształcie segmentów, bez progu długości — np. `a` dla `at` (dystans 1 ≤ progu 1) pokaże widok jednoliniowy `a[t]`, mimo że ścieżka brakujących liter wymaga ≥ 2 znaków.

Reguła dotyczy wyłącznie komunikatu: oceny Recall i pisownii pozostają `incorrect` (A16), więc jednoliniowy widok nigdy nie zalicza odpowiedzi.

## Testy

- **Unit — `spelling-diff.test.ts`:** przypadki operacji (brakująca, nadmiarowa, zamieniona, przestawiona); próg (≤2; ≤1 dla krótkich); wybór wariantu z remisem → canonical; dopasowanie dokładne wariantu → brak diffu; liczenie bez rozróżnienia wielkości liter; flaga `capitalizationHint`; segmentacja (sklejanie sąsiednich).
- **Unit — `feedback.test.ts`:** precedencja `great` > `capitalization_hint` > `spelling_hint` > `incorrect`; `spelling_hint` nie zalicza Recall; brak diffu dla pustej odpowiedzi, `skip`, `dont_remember`, mowy.
- **Kontrakty:** schemat przyjmuje poprawne `spellingDiff` przy `kind: "spelling_hint"`; odrzuca `spellingDiff` przy innych rodzajach; odrzuca `spelling_hint` bez `spellingDiff`.
- **Ekspozycje:** `feedbackExposureKeys` zawiera klucz wyliczony z `correctText`-wariantu.
- **Komponentowy (kid-ui):** render wierszy i pigułek; brak sekcji diff bez `spellingDiff`.
- **E2E:** scenka pisowni z literówką — pigułki widoczne po ocenie, niewidoczne przed odpowiedzią; liczba prób i budżet bez zmian.
- Regresje wskazane w planie implementacji (m.in. ekspozycje zapisane przed HTTP, tryb bez mikrofonu, kartkówka bez diffu).

## Dokumentacja do aktualizacji (w ramach planu)

- `docs/SPEC.md` §12.8 i §16 — opis feedbacku pisowni z zaznaczeniem różnic.
- `docs/architecture.md` §9 — pole `spellingDiff` w kontrakcie Kid API.

## Poza zakresem

Ocena tekstu przez LLM, automatyczne dopisywanie akceptowanych odpowiedzi, diagnozowanie zaburzeń uczenia, diff dla odpowiedzi ustnych (mają własne fragmenty wymowy), zmiany ocen umiejętności i liczby prób, tryb kartkówki.
