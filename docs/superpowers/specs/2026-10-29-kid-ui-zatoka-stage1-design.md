# Redesign Kid UI „Zatoka” — etap 1: język wizualny i ekrany wokół sesji

**Status:** projekt zatwierdzony w rozmowie 2026-10-29 (kierunek, sekcje 1–3); przy akceptacji specu właściciel zdecydował: **tylko ciemny motyw** — jasny schemat nie powstaje w tym etapie. Zastępuje paletę z #148 i kolorystykę z `2026-10-11-kid-ui-redesign-design.md`; ramę sesji, zasady ekranu zadania i viewportu z tamtego specu zachowuje.

## 1. Cel, odbiorca, kryteria

Kid UI ma wyglądać na aplikację dla ok. 8-letniego dziecka: ciepło i spokojnie, bez rozpraszaczy w zadaniu. Obecny granatowy, ciemny Material 3 jest odbierany jako zbyt poważny; ekrany poza zadaniem mają słabą hierarchię.

Kryteria sukcesu:

- Na każdym ekranie jedna oczywista główna akcja; drugorzędne akcje nadal osiągalne.
- Jeden ciemny motyw Zatoka, niezależny od `prefers-color-scheme` systemu (jak dziś), z kontrastem WCAG AA (tekst 4,5:1, duży tekst, granice kontrolek i istotna grafika 3:1).
- Brak poziomego przepełnienia i cele dotykowe ≥ 48 px (główna akcja ≥ 54 px) w portrait, landscape telefonu, tablecie i desktopie — potwierdzone testami geometrii Playwright.
- Istniejące zachowanie, `data-testid`, kontrakty i przepływy bez zmian.

## 2. Zakres i podział

Redesign ma dwa etapy, każdy z własnym specem, planem i PR do scalenia przez właściciela.

- **Etap 1 (ten dokument):** język wizualny (tokeny ciemnego motywu, typografia, kształty, ilustracje) oraz ekrany: wybór profilu (`ProfileScreen`), wybór zestawu (`DeckScreen`), podsumowanie sesji (`SummaryScreen` z `SessionActivityResultView`), start i podsumowanie kartkówki (`MockTestReadyScreen`, `MockTestSummaryScreen`), podsumowanie kartkówki lekcji (`LessonMockTestSummaryScreen`), konflikt sesji (`SessionConflictScreen`) i puste stany tych ekranów.
- **Etap 2 (osobno):** rama sesji, widoki ćwiczeń słownictwa i lekcji, panel wyniku (`ExerciseFeedbackDock`, `AnswerFeedback*`, `SpeechFeedback*`). W etapie 1 te ekrany dostają wyłącznie nowe tokeny, czcionki i kształty przez istniejące aliasy — bez zmian układu — i muszą przejść obecne testy geometrii i kontrastu (także z emulacją jasnego i ciemnego motywu systemu).

Poza zakresem: zmiany Kid API, DTO, bazy, ocen, harmonogramu, ekspozycji, kartkówki i panelu rodzica; przełącznik motywu w UI; gamifikacja; maskotka reagująca na wyniki. MCP i `SKILL.md` nie są dotknięte (brak zmian API) — uzasadnienie trafia do opisu PR.

## 3. Referencja wizualna

Zatwierdzony kierunek **B · Zatoka** na canvasie [Umiem! — kierunki Kid UI](https://claude.ai/artifact/RFfcE7SPiNsjppeMjYFJkj) (artboard `Zatoka.dc.html`; obowiązuje telefon „Ciemny”, wersja jasna z makiety nie jest wdrażana). Makieta jest pomocniczym szkicem, nie kodem ani zależnością: przykładowe dane (imię „Ola”, zestawy, liczby, 3 gwiazdki zamiast `MASTERY_STAR_MAX = 6`), kolory szkicu i ilustracje okładek nie trafiają do produkcji jako wartości. Okładki zestawów pozostają z `coverAssetId`/`coverVisual`.

## 4. Język wizualny

### 4.1 Kolory

- Jeden pełny ciemny schemat Material 3 (`DynamicScheme`, wariant tonal spot, `isDark: true`). Parametry wyjściowe: primary — morski błękit, hue ≈ 240, chroma ≈ 40; secondary — ten sam hue, niższa chroma; tertiary (sukces) — zieleń, hue ≈ 150; neutral i neutral variant — morski granat, hue ≈ 225, chroma odpowiednio ≈ 10 i ≈ 16 (zamiast obecnego fioletowawego hue 268); error — łagodna czerwień jak dziś (hue 25, chroma 56). Grupa „warm” (bursztyn, hue 75) zostaje dla gwiazdek, chipu terminu kartkówki i stanu „prawie”; ciepło ciemnego motywu dają warm, okładki i ilustracje, nie tło. Dokładne wartości chroma dobiera się tak, aby test kontrastu (§7) przechodził; zmienia się parametry i regeneruje całość, nie pojedyncze role.
- Sukces musi różnić się od primary także jasnością, nie samym odcieniem (sprawdza test kontrastu par ról, §7).
- Nowy skrypt deweloperski `scripts/kid-palette.mjs` z `@material/material-color-utilities` (devDependency w root) wypisuje blok tokenów kolorów; parametry są w komentarzu bloku i w skrypcie. Wynik wkleja się do `styles.css`; skrypt nie jest częścią buildu. Później może wygenerować też schemat jasny, gdyby właściciel go zechciał — poza tym etapem.
- Struktura `styles.css` bez zmian: jeden blok `.kid-theme, .kid-ui { … }` jest jedynym miejscem literałów koloru, rozmiaru fontu i promienia.
- Nowa rola: `--kid-color-header` / `--kid-color-on-header` (z `primary-container` / `on-primary-container`) dla pasa nagłówka. Aliasy `--kid-*` pozostają.
- Wymuszony ciemny motyw zostaje: `color-scheme: dark` w `.kid-ui` i `kid-theme.module.css`, `KidThemeProvider` z `data-kid-theme="night"` (bez zmian testów zakresu motywu). Kid UI nadal nie zależy od Mantine ani motywu rodzica.

### 4.2 Typografia

- **Fredoka** (nagłówki, tytuły kart, główne przyciski) i **Nunito** (treść, etykiety, chipy); obie na licencji SIL OFL. Pliki zmiennych czcionek w `apps/web/public/fonts/kid/` z `@font-face` w `apps/web/src/kid-fonts.css` (`font-display: swap`); Manrope wypada z Kid UI. Plik licencji OFL obok czcionek. Bez Google Fonts w runtime. Pobranie plików wymaga zgody właściciela przed wykonaniem.
- **Zmiana 2026-10-30: tylko Nunito.** Fredoka wypadła z Kid UI: oficjalny plik (identyczny z google/fonts, źródło autorki bez zmian od 2022) nie ma liter ą ć ę ń ś ź ż, więc polskie słowa mieszały dwa kroje, a jej wagi 600–700 zlewały litery w pytaniach i odpowiedziach. Oba tokeny wskazują Nunito; pilnuje tego `tests/kid-design-tokens.test.ts`.
- Tokeny: `--kid-font-display` i `--kid-font-body` w bloku tokenów; skala `--kid-type-*` bez zmian rozmiarów, chyba że test geometrii wymusi korektę (wtedy w bloku tokenów).
- Tekst słówek po angielsku dalej z `lang="en-GB"`.

### 4.3 Kształty i powierzchnie

- Skala `--kid-shape-*` przestawiona na kafelkową: przyciski, chipy akcji i małe kafelki 16 px; karty 20 px; okładki 14–18 px; `full` tylko dla elementów okrągłych z natury.
- Karty na tle: powierzchnia `surface-container-lowest`/`surface-container` z granicą `outline-variant` (`--kid-line`) zamiast cienia; granice kontrolek interaktywnych `outline`. Cienie `--kid-shadow-*` tylko tam, gdzie już są (np. panel wyniku), bez rozszerzania.

### 4.4 Ilustracje

- Nowy katalog `packages/kid-ui/src/illustrations/` z inline SVG, zawsze `aria-hidden="true"`, bez tekstu w grafice:
  - `HeaderWave` — fala dolnej krawędzi pasa nagłówka, kolor z `--kid-color-header`;
  - `ProfileAvatar` — sześć zwierzątek dla `avatarKey`: `fox`, `bear`, `cat`, `dog`, `owl`, `rabbit`; nieznany klucz → neutralna buzia SVG (zastępuje emoji i fallback 🙂);
  - `EmptyScene` — prosta scena dla pustych stanów (brak profili, brak zestawów) i ekranu konfliktu.
- Ilustracje mogą mieć literały kolorów, jak deterministyczne `visuals/`; wyjątek dopisany do `tests/kid-design-tokens.test.ts`. Kolory ilustracji muszą być czytelne na ciemnych powierzchniach (sprawdzane zrzutami E2E).

### 4.5 Ruch

Bez zmian zasad: Motion (`m.*`, `LazyMotion` + `domAnimation`), wyłącznie `transform` i `opacity`, bez propsa `layout`, `MotionConfig reducedMotion="user"`. Istniejące wejścia ze staggerem i `CelebrationBurst` zostają; fala i ilustracje są statyczne.

## 5. Komponenty wspólne

- `KidScreen.Header` dostaje wariant `variant="band"`: pas w `--kid-color-header` od górnej krawędzi (z `safe-area-inset-top`), na dole `HeaderWave`, w środku pasek górny, tytuł, opcjonalne powitanie i chipy. Pas rośnie z treścią (bez stałej wysokości i bez `overflow: hidden` przycinającego tekst); jedynym właścicielem pomiaru viewportu pozostaje `KidPage`. Ekrany nie rysują fali samodzielnie.
- Przyciski z samą ikoną w pasku górnym (mikrofon, odsłuch, link rodzica przekazywany jako `headerActions`) to kafelki 48 × 48 przez `IconActionButton`/`MicrophoneSettingsButton`/`GuidanceButton` z kształtem 16 px.
- Nowy wzorzec listy „karta z wierszami” (`kid-row-list`): jedna karta, wiersze rozdzielone `--kid-line`, każdy wiersz ma okładkę/ikonę, tytuł, opis i akcję. Implementowany jako klasa CSS + małe komponenty w miejscu użycia lub wspólny komponent, jeśli używają go ≥ 2 ekrany (zestawy, podsumowania, kartkówki — więc wspólny `RowList`/`RowListItem` w `components/` z testem).
- Chip informacyjny (`kid-chip`): czas zatwierdzony dziś, punkty, termin kartkówki (wariant warm).
- `ActionButton` bez zmian API; zmieniają się tylko tokeny kształtu i czcionki.

## 6. Ekrany etapu 1

| Ekran | Projekt |
| --- | --- |
| Wybór profilu | Pas: „Kto się dziś uczy?”, `headerActions` i odsłuch. Profile jako kafelki (`ProfileChoiceButton`, cały kafelek klikalny): `ProfileAvatar` ok. 72 px, imię, tag „Uczę się bez czytania” (gdy `!canRead`), chip punktów. Siatka: 2 kolumny compact, 3 od medium, 4 od expanded; w niskiej wysokości kafelek poziomy. Brak profili → `EmptyScene` + istniejący komunikat. |
| Co dziś robimy? | Pas: chip „Zatwierdzono dziś: …” (lub wartość niedostępna), `headerActions`, mikrofon, odsłuch; powitanie (bez emoji 👋 — zmiana w `messages.ts`) i tytuł. Sekcja „Rekomendowane”: każdy zestaw jako duża karta z etykietą sekcji, okładką, tytułem, opisem (liczba słów albo przedmiot lekcji), gwiazdkami opanowania (`MASTERY_STAR_MAX`), chipem terminu, główną akcją „Ucz się”/„Wróć do nauki” i drugorzędną („Próbna kartkówka” albo „Zakończ”). Sekcja „Wszystkie zestawy”: `RowList`; wiersz z kafelkową strzałką (nazwa dostępna „Ucz się: {tytuł}”) i — gdy istnieje — drugorzędną akcją jako mały przycisk tonal ≥ 48 px pod opisem. Autofocus pierwszej głównej akcji, `data-testid` i `data-deck-id` bez zmian. Brak zestawów → `EmptyScene` + komunikat. Na tablecie/desktopie karty rekomendowane i lista w maks. dwóch kolumnach w granicach kontenera treści. |
| Podsumowanie sesji | Pas: „Gotowe!” z `CelebrationBurst`, wynik aktywności (`SessionActivityResultView` jako chip/karta). Liczniki samodzielnego przypominania i pisowni jako kafelki z dużą liczbą i podpisem; brak sukcesów → istniejący neutralny komunikat (bez fałszywej pochwały). „Jeszcze poćwiczymy” i cele lekcji jako `RowList`. Akcje bez zmian. |
| Start kartkówki | Pas: „Próbna kartkówka”. Kafelek z liczbą zadań (`taskBudget`) i informacją; akcje bez zmian. |
| Podsumowanie kartkówki (słówka, lekcja) | Pas: tytuł, informacja o niepełnej kartkówce, wynik aktywności i karta wyniku (`ScoreStars`, ton wyniku). Lista rozwiązań jako `RowList`: status jako ikona SVG + kolor + tekst odznaki (poprawne, błędne, pominięte, nietestowane), nigdy sam kolor; odsłuch jako kafelek 48 × 48; podpowiedzi i cele powtórki lekcji bez zmian treści. Błędy ładowania szczegółów i ponowienie bez zmian zachowania. |
| Konflikt sesji | `EmptyScene`, komunikat i dwie akcje bez zmian. |

## 7. Weryfikacja

- **Jednostkowe:** `tests/kid-design-tokens.test.ts` akceptuje wyjątek `illustrations/`; nowy test kontrastu parsuje blok tokenów i liczy WCAG dla par: `on-surface`/`surface` i kontenery, `on-surface-variant`/powierzchnie, `on-primary`/`primary`, `on-header`/`header`, `on-*-container`/`*-container` (sukces, błąd, warm), `outline`/powierzchnie (3:1), sukces vs primary (różnica jasności). Testy komponentów: `ProfileAvatar` (znane klucze + fallback), `RowList`, wariant `band`. Istniejące testy `kid-no-mantine`, zakresu motywu i Mantine rodzica przechodzą.
- **E2E (Playwright):** rozszerzyć `kid-flow-screens.spec.ts` i `kid-answer-contrast.spec.ts` o ekrany etapu 1; istniejące przebiegi z emulacją jasnego i ciemnego motywu systemu nadal sprawdzają, że Kid UI pozostaje ciemny i czytelny niezależnie od systemu; `kid-decks-layout.spec.ts`, `kid-responsive.spec.ts` i `kid-ui-layout.spec.ts` — asercje prostokątów pasa, kafelków profili, kart i wierszy zestawów względem viewportu i kontenera, brak poziomego przepełnienia, cele ≥ 48 px, główna akcja ≥ 54 px, w portrait, landscape, tablecie i desktopie. Zrzuty ekranów jako artefakty do przeglądu. Nowe specy dopisane do partycji w `tests/e2e/spec-projects.ts`.
- **Przed PR:** `pnpm typecheck`, `pnpm test:unit`, `pnpm build`, pełne `pnpm test:e2e:shards`.
- **Niezweryfikowane testami:** odbiór na fizycznym telefonie i tablecie oraz subiektywny odbiór przez dziecko — raportowane jawnie.

## 8. Ryzyka

- Nowa paleta zmienia kontrast w zadaniach etapu 2 (stany `AnswerGrid`, feedback, `visuals/`); test kontrastu ról i istniejący `kid-answer-contrast.spec.ts` mają to wyłapać.
- Wariant `band` dodaje wysokość nad treścią; w niskiej wysokości (< 480 px) pas jest kompaktowy (mniejsze powitanie, fala niższa), aby akcje pozostały osiągalne.
- Zmiana czcionki może przesunąć szerokości tekstu w istniejących testach geometrii; korekty tylko w tokenach.

## 9. Ustalenia z implementacji (2026-10-29)

Rozstrzygnięcia podjęte podczas wykonania planu; zastępują odpowiednie fragmenty §4–§6.

- Sukces (tertiary) używa tonów 70/20/30/90 zamiast standardowego T80 — w ciemnym M3 primary i tertiary mają tę samą jasność (kontrast 1,00), a §4.1 wymaga różnicy jasności. Zapisane w `scripts/kid-palette.mjs` (`TERTIARY_TONES`) i w komentarzu bloku tokenów.
- Pas nagłówka obejmuje kolumnę `KidScreen` (maks. 560 px — zastąpione przez `2026-10-30-kid-ui-large-screens-design.md`: od szerokości expanded kolumna ma maks. 720 px, a duże okno z myszą jest dodatkowo powiększane), nie cały viewport na tablecie i desktopie. Z tego samego powodu ekran zestawów ma zawsze jedną kolumnę kart, a siatka profili ma 2 kolumny (compact) i 3 od 600 px.
- Kafelki profili, jako kontrolki interaktywne, mają granicę `outline`, nie `outline-variant`.
- Zestaw z aktywną sesją (`resumeOnly` + `activeSession`) jest pełną kartą na początku sekcji kart z główną akcją „Wznów naukę” i drugorzędnym „Zakończ sesję”, niezależnie od `recommended` z serwera. Sekcja kart pojawia się także wtedy, gdy nic innego nie jest rekomendowane.
- Cele lekcji w podsumowaniu mają neutralną ikonę bez zieleni sukcesu — to ćwiczone reguły, nie zaliczone.
- Nowe teksty: odznaki wyniku kartkówki „Poprawnie” / „Do poprawy”, liczba zadań kartkówki w trzech formach liczby mnogiej („zadanie”, „zadania”, „zadań”), etykiety kafelków podsumowania bez liczby. Bez zmian API, DTO i MCP.
- Testy E2E uruchamiane lokalnie na buildzie produkcyjnym: `UMIEM_E2E_WEB_MODE=dev` nie hydratuje pod Next 16.4 (`allowedDevOrigins`) — problem istniał wcześniej i nie jest naprawiany w tym etapie.
