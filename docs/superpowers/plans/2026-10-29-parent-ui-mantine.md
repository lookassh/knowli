# Panel rodzica na Mantine 9 + TanStack Query, responsywny na telefonie — plan

Data: 2026-10-29. Stan: plan zaakceptowany przez właściciela 2026-10-29 z decyzjami: tryb ciemny wchodzi do zakresu, adresy URL sekcji i edytorów wchodzą do zakresu, szkice układu przygotowuje agent przed fazami 1, 5b i 6b.

## 1. Cel i decyzje

Przepisać warstwę prezentacji panelu rodzica (`apps/web/src/parent/**`) tak, żeby:

- korzystała z gotowych komponentów **Mantine 9** zamiast ręcznych kontrolek (154 surowe `<button>`/`<input>`/`<select>`/`<textarea>`, ~1480 linii `parent.css` + część `globals.css`);
- dane serwera obsługiwał **TanStack Query** przez `@orpc/tanstack-query` (dziś 51 `useEffect`, 121 `useState`, ręczne liczniki `requestSeq`/`loadVersion`, `setInterval` do odpytywania);
- była **wygodna na telefonie** (dziś tylko 3 reguły `@media` w `parent.css`, edytory niezmigrowane nawet do redesignu z 2026-10-14).

Zmiana decyzji: spec `2026-10-14-parent-panel-redesign-design.md` zakładał „bez nowego systemu stylowania, zero zależności”. Ten plan świadomie ją zmienia dla panelu rodzica. Kid UI pozostaje bez zmian i bez Mantine (`tests/kid-no-mantine.test.ts`).

Poza zakresem: Kid UI, endpointy `/api/v1/kid`, domena i przypadki użycia w `packages/server`, kontrakt Parent API (`orpc-contract.ts`) — plan nie zmienia API, więc nie dotyka MCP ani `SKILL.md`.

## 2. Co zostaje bez zmian (nienaruszalne)

- **Logika czysta** — przenoszona 1:1, z istniejącymi testami: `deck-editor-state.ts`, `lessons/lesson-editor-state.ts`, `deck-list-grouping.ts`, `build-skill-rows.ts`, `progress-lists.ts`, `mock-report-words.ts`, `generation-request.ts`, `deck-session-settings.ts`, `avatars.ts`.
- **Semantyka poleceń**: stały klucz idempotencji generacji i pustego zestawu (`pendingGenerationCommand`, `pendingEmptyCommand`), stan „niepewnego polecenia” tylko po awarii sieci (TypeError), `isDefinitiveGenerationRejection`, oczekujące polecenia lekcji w `NewLessonForm`, `clientRequestId` regeneracji lekcji.
- **Edytory**: ochrona niezapisanych zmian (`useParentLeaveGuard` + `beforeunload`), formularz nie jest nadpisywany odświeżeniem w trakcie edycji ani konfliktu, panel konfliktu wersji (lokalne vs zdalne, potwierdzenie wczytania), blokada zapisu lekcji do gotowości podglądów obliczeń, mapowanie błędów walidacji na ćwiczenia, okładka (5 MB, ochrona przed spóźnioną odpowiedzią, zwalnianie object URL).
- **Teksty** wyłącznie w `packages/contracts/src/messages.ts`.
- **`data-testid`** zachowane albo jawnie przeniesione razem ze specami; żadna asercja e2e nie znika bez równoważnej.
- **Dostępność**: cele dotykowe ≥ 44 px (panel rodzica; Kid UI ma własne 48 px), kontrast ≥ 4,5:1, regiony `role="status"`/`role="alert"`, fokus w oknach dialogowych.

## 3. Fundament techniczny

### 3.1 Mantine tylko w panelu rodzica

- Zależności w `apps/web`: `@mantine/core`, `@mantine/hooks`, `@mantine/form`, `@mantine/modals`, `@mantine/notifications` (v9, wymaga React 19.2+). Next 15.5 w App Routerze używa wbudowanej, starszej kopii Reacta bez `Activity`/`useEffectEvent`, więc build padał — decyzją właściciela (2026-10-29) przed fazą 0 weszła aktualizacja do Next 16.4.3 i React 19.3.1 (osobny PR).
- Globalny reset Mantine (`box-sizing: border-box` dla wszystkich elementów) działa także na stare ekrany panelu do czasu ich przepisania; na ekranie logowania usuwa zbędne przewijanie (pomiar fazy 0). Ustawienia `:root`/`body` z `globals.css` (bez warstwy) mają pierwszeństwo przed warstwą `mantine`, więc stare ekrany pozostają jasne także przy ciemnym schemacie systemu. `@mantine/dates` tylko jeśli natywny `type="date"` okaże się niewystarczający (patrz 3.4).
- `MantineProvider`, `ModalsProvider`, `Notifications` i style Mantine ładowane **wyłącznie w drzewie `/parent`** (layout trasy `app/parent`), w wersji z warstwami CSS (`styles.layer.css`), żeby reset Mantine nie dotknął Kid UI.
- **Motyw** z obecnych tokenów `pp-*` (spec 2026-10-14 §2.5): kolor główny indygo `#4356e0` jako 10-stopniowa paleta, promień 16 px, typografia systemowa, kolory stanów (zieleń/bursztyn/niebieski/szary/czerwony/fiolet lekcji) jako nazwane kolory motywu. Domyślny rozmiar kontrolek tak dobrany, żeby cele miały ≥ 44 px.
- **Tryb ciemny** (decyzja właściciela 2026-10-29): schematy jasny i ciemny, domyślnie „jak system” (`defaultColorScheme="auto"`), przełącznik Auto/Jasny/Ciemny w menu nagłówka, wybór zapamiętany w `localStorage` (menedżer schematu Mantine). Kolory stanów i wykresów mają warianty dla obu schematów (`light-dark()` / zmienne `--mantine-color-*`), kontrast ≥ 4,5:1 sprawdzany w obu. Brak migotania przy starcie wymaga `ColorSchemeScript` w `<head>` i `mantineHtmlProps` na `<html>` root layoutu — do zweryfikowania w fazie 0, że atrybut `data-mantine-color-scheme` na `<html>` nie zmienia Kid UI (ma własny ciemny schemat zakresowany do `.kid-ui`/`.kid-theme`). Inline SVG ikon (`ParentIcon`) używają `currentColor`.
- Kontrola izolacji: specy `kid-theme-scope`, `kid-responsive` i `*layout*` przechodzą bez zmian; nowy test jednostkowy pilnuje, że `packages/kid-ui` i trasy dziecka nie importują `@mantine/*`.

### 3.2 TanStack Query przez oRPC

- `@tanstack/react-query` + `@orpc/tanstack-query`; `QueryClientProvider` obok `MantineProvider`; narzędzia `orpc = createTanstackQueryUtils(parentClient)`.
- Zapytania: `orpc.decks.list.queryOptions()`, `orpc.children.list…`, `orpc.decks.get…` itd. Mutacje unieważniają właściwe klucze (np. publikacja → `decks.get` + `decks.list`), co zastępuje propsy `onChanged`.
- **Ponawianie**: zapytania nie ponawiają błędów 4xx; mutacje nigdy nie ponawiają automatycznie (domyślne zachowanie TanStack, utrwalone jawnie) — ponowienie polecenia z kluczem idempotencji pozostaje świadomą akcją rodzica.
- **Wygasła sesja**: jeden globalny handler w `QueryCache`/`MutationCache` (`status === 401` → ekran logowania). Naprawia obecną niespójność: dziś tylko część ekranów (lista zestawów, nowa lekcja, postępy, karta pracy) wraca do logowania, a edytory pokazują sam błąd.
- **Wygasła sesja nie może gubić niezapisanych zmian** (review #151): gdy leave guard zgłasza edytor z niezapisanymi zmianami, 401 nie odmontowuje ekranu — logowanie otwiera się jako modal nad bieżącym widokiem, a po zalogowaniu rodzic sam ponawia zapis (bez automatycznego ponowienia mutacji). Bez niezapisanych zmian 401 przechodzi do pełnego ekranu logowania z powrotem do adresu docelowego. Wymaganie wchodzi w fazie 1 (rama i logowanie), zanim edytory przejdą na zapytania w fazach 5a/6b; test e2e: wygaśnięcie sesji w trakcie edycji zachowuje formularz.
- **Odpytywanie generacji i mediów**: `refetchInterval` jako funkcja (1 s, gdy generacja `queued`/`running` lub zasób `pending`, inaczej `false`) zamiast `setInterval`.
- **Formularz edytora a dane serwera**: dane z zapytania zasilają formularz tylko do pierwszej edycji (jak dziś); w trakcie edycji lub konfliktu odświeżenie nie nadpisuje formularza. Formularz edytora pozostaje lokalnym stanem opartym na `deck-editor-state.ts` / `lesson-editor-state.ts` — nie przenosimy go do `@mantine/form`.
- `callParent`/`ApiCallError` zostają jako adapter błędów dla ekranów i komunikatów.

### 3.3 Formularze

- Proste formularze (logowanie, profil dziecka, progi wymowy, nowy materiał, nowa lekcja, budżet zadań) na `@mantine/form` z walidacją schematami z `@learning/contracts` (np. `ChildInputSchema`, `DeckSettingsPatchSchema`).
- Edytory zestawu i lekcji: kontrolki Mantine, stan jak w 3.2.

### 3.4 Wybór kontrolek pod testy i telefon

- **Listy wyboru**: `NativeSelect` dla krótkich enumeracji (avatar, tryb nagrywania, typ wizualizacji, format, przedmiot, typ pytania, jednostki). Na telefonie natywny picker jest wygodniejszy, a 16 miejsc w e2e używa `selectOption` — zostaje bez zmian. `Select`/`Combobox` tylko tam, gdzie potrzebne wyszukiwanie.
- **Daty** (termin sprawdzianu, dzień karty pracy): natywne `type="date"` przez `TextInput` — systemowy kalendarz na telefonie, e2e bez zmian.
- **Liczby**: `NumberInput` z `min`/`max`; e2e używające `fill` przechodzą, sprawdzić specy wpisujące wartości graniczne.
- **Potwierdzenia**: 3 wywołania `window.confirm` → `modals.openConfirmModal`; aktualizacja testu `deck-editor-assignments.test.tsx` („confirm cancel”).
- **Okna dialogowe**: 3 natywne `<dialog>` (`NewMaterialDialog`, `LeaveEditorDialog`, `ArchiveLessonDialog`) → `Modal` (pełny ekran na telefonie). Zachować role i nazwy dostępne, na których opierają się e2e (`dialog "Usuń lekcję z listy"`, `leave-editor-*`), oraz powrót fokusu.
- **Komunikaty o wyniku**: lokalne `role="status"` przy formularzach zostają (e2e i czytniki ekranu); `notifications` tylko dla zdarzeń globalnych (np. wylogowanie po wygaśnięciu sesji).
- **Selektory CSS w e2e** (`.pp-legend`, `.pp-stat`, `.pp-error`, `.pp-loading` w `progress-panel` i `parent-work-card`) → zamiana na `data-testid` lub role w tej samej fazie.

## 4. Układ responsywny

Klasy szerokości jak w Kid UI (M3): compact < 600 px, medium 600–839 px, expanded ≥ 840 px.

| Element | Telefon (compact) | Tablet / desktop |
| --- | --- | --- |
| Nawigacja (4 sekcje: Zestawy, Dzieci, Postępy, Karta pracy) | Dolny pasek nawigacji z ikonami (`AppShell.Footer`); „Do nauki” i „Wyloguj” w menu ⋯ w nagłówku | Zakładki pod nagłówkiem (jak dziś) lub boczny rail na expanded |
| Lista zestawów | Karty w jednej kolumnie, filtr rodzaju jako `SegmentedControl`, „+ Nowy materiał” jako pływający przycisk | Lista z meta w wierszu |
| Nowy materiał / dialogi | `Modal fullScreen` | Zwykły modal |
| Edytor zestawu | Elementy jako karty jedna pod drugą; akcje mediów (odsłuch, regeneracja, pominięcie obrazka) w menu ⋯; przypięty dolny pasek „Zapisz / Opublikuj”; przypisania jako karty per dziecko | Siatka 2 kolumn pól elementu |
| Konflikt wersji | Lokalna i zdalna wersja jedna pod drugą (`SimpleGrid cols={{ base: 1, sm: 2 }}`) | Obok siebie |
| Edytor lekcji | `Accordion` per cel → etap; ćwiczenie jako karta; pola opcji w pionie | Rozwinięte grupy |
| Dzieci | Karty w jednej kolumnie, edycja w `Drawer` od dołu | Siatka kart |
| Postępy | Filtr dziecka jako przewijany rząd avatarów; słowa jako karty (już są); paski umiejętności w pionie zamiast stałej kolumny 168 px | Tabela słów (≥ 901 px jak dziś) |
| Karta pracy | `Accordion` sesji zamiast `<details>` | Bez zmian struktury |

Najtrudniejsze ekrany (nawigacja, edytor zestawu, edytor lekcji) dostają przed implementacją **szkic układu** telefon + desktop, w obu schematach kolorów, do akceptacji właściciela.

### 4.1 Adresy URL i „wstecz” (decyzja właściciela 2026-10-29)

Dziś sekcja i otwarty zestaw są tylko w stanie komponentów, więc „wstecz” na telefonie wychodzi z panelu, a odświeżenie gubi miejsce. Docelowe adresy:

| Adres | Ekran |
| --- | --- |
| `/parent` | przekierowanie do `/parent/decks` |
| `/parent/decks` | lista zestawów (`?archived=1`, `?kind=lessons` opcjonalnie) |
| `/parent/decks/{deckId}` | edytor zestawu słówek albo lekcji (rodzaj z danych) |
| `/parent/lessons/new` | nowa lekcja |
| `/parent/children` | dzieci |
| `/parent/progress?child={id}&deck={id}` | postępy |
| `/parent/work-card?child={id}&date=YYYY-MM-DD` | karta pracy |

- Jedna strona catch-all `app/parent/[[...path]]/page.tsx` renderuje kliencki panel; routing sekcji to mały, własny moduł nad History API (`pushState` + `popstate`), a nie nawigacja App Routera — App Router nie ma oficjalnego blokowania przejść, a leave guard musi móc zatrzymać „wstecz” przy niezapisanych zmianach (cofnięcie `popstate` + `LeaveEditorDialog`).
- Modal „Nowy materiał” nie dostaje adresu; na telefonie „wstecz” go zamyka (wpis historii przy otwarciu).
- Logowanie zachowuje docelowy adres i wraca do niego po PIN-ie.
- Nieznany lub usunięty `deckId` → komunikat i powrót do listy.

## 5. Fazy (osobne PR, każdy działający)

Każda faza: typecheck, testy jednostkowe, pełny `pnpm test:e2e:shards` na buildzie produkcyjnym przed PR. Wielkość: S/M/L względem siebie.

| Faza | Zakres | Wielkość | Kontrola |
| --- | --- | --- | --- |
| **0. Fundament** | Zależności, providery tylko pod `/parent`, motyw z tokenów `pp-*` w wersji jasnej i ciemnej, `ColorSchemeScript`, warstwy CSS, `QueryClient` + `orpc` utils, globalny handler 401, test izolacji Kid UI. Ekrany jeszcze stare. Aktualizacja AGENTS.md (stack) i notki o zmianie decyzji. | S | Kid UI e2e bez zmian (także przy ciemnym schemacie systemu); rozmiar bundla `/parent` przed/po |
| **1. Rama, logowanie i adresy** | `AppShell`, nawigacja dolna/zakładki, przełącznik schematu, ekran PIN z powrotem do adresu docelowego, router sekcji nad History API z leave guardem (4.1), `ParentApp` na zapytaniach (`auth.state`, `children.list`, `decks.list`), `LeaveEditorDialog` na `Modal` | M | `parent-flow`, `navigation`, `parent-edit-protection` („wstecz” przy niezapisanych zmianach), overflow 390 px |
| **2. Zestawy (lista + nowy materiał)** | `DecksPanel` (grupy, filtr, archiwum) bez roli routera — otwarcie zestawu to adres `/parent/decks/{id}`, `NewMaterialDialog`, `ArchiveLessonDialog`; polecenia idempotentne bez zmian | M | `manual-deck-flow`, `generation-request-retry`, `lesson-archive` |
| **Punkt kontrolny** | Właściciel ogląda panel na telefonie; mierzymy ubytek kodu; decyzja o kontynuacji | — | — |
| **3. Dzieci** | `ChildEditor` + `PronunciationSettings` na `@mantine/form`, `confirm` → modal | M | `parent-flow`, specy wymowy |
| **4. Postępy i karta pracy** | `ProgressPanel`, `ProgressItems`, `MockTestReportPanel`, `WorkCardPanel`; selektory CSS w specach → testid | M | `progress-panel` (1280/768/390), `parent-work-card`, `mock-test-parent` |
| **5a. Edytor zestawu — dane** | `DeckEditor` na zapytaniach/mutacjach, `refetchInterval`, konflikt, okładka, przypisania — wygląd jeszcze stary | M | `manual-deck-flow`, `parent-edit-protection`, `deck-cover-image` |
| **5b. Edytor zestawu — UI** | Kontrolki Mantine, układ mobilny, przypięty pasek akcji, `DeckConflictPanel`, `DeckCoverSettings`, `DeckSessionTaskBudgetSettings`, `AssignmentTestGoalFields` | L | j.w. + overflow 390 px + cele ≥ 44 px |
| **6a. Nowa lekcja i nadzór** | `NewLessonForm`, `LessonSupervisionPanel` | M | `lesson-parent`, `lesson-parent-supervision`, `lesson-mock-test` |
| **6b. Edytor lekcji** | `LessonEditor` (dane jak 5a, potem UI jak 5b; ewentualnie dwa PR) | L | `lesson-parent`, `lesson-calculation`, `lesson-real-flow` |
| **7. Sprzątanie** | Usunięcie `parent.css` i klas panelu z `globals.css` (zostają reguły używane przez Kid UI), aktualizacja speca redesignu, `SPEC.md` §4 (adresy panelu) i `architecture.md` | S | pełny e2e |

Adresy URL weszły do fazy 1 (zamiast osobnej fazy na końcu), bo `DecksPanel` jest dziś jednocześnie routerem edytorów — przepisywanie go dwa razy byłoby droższe.

Kolejność 5a → 5b: najpierw zmiana warstwy danych przy niezmienionym wyglądzie, żeby regresje konfliktów i odpytywania dało się odróżnić od regresji układu.

## 6. Testy

- Istniejące specy e2e panelu: `parent-flow`, `manual-deck-flow`, `parent-edit-protection`, `generation-request-retry`, `lesson-parent`, `lesson-archive`, `lesson-calculation`, `lesson-parent-supervision`, `lesson-mock-test`, `lesson-real-flow`, `mock-test-parent`, `deck-cover-image`, `navigation`, `kid-flow` (zakładka postępów), `progress-panel` i `parent-work-card` (mocked).
- Nowy spec geometrii panelu (`parent-responsive.spec.ts`, partycja według reguł `spec-projects.ts`): 390×844, 844×390, 768×1024, 1280×800 — brak przepełnienia poziomego, główne akcje osiągalne, cele ≥ 44 px, dolna nawigacja widoczna na telefonie. Symulacja nie zastępuje sprawdzenia na fizycznym telefonie — raportowane jawnie.
- Tryb ciemny: spec emuluje `colorScheme: "dark"` i sprawdza, że wybór schematu przeżywa przeładowanie, a Kid UI wygląda tak samo niezależnie od schematu panelu.
- Adresy: spec nawigacji sprawdza głębokie linki, odświeżenie na edytorze, „wstecz”/„dalej” oraz zatrzymanie „wstecz” przy niezapisanych zmianach.
- Testy komponentów (Vitest + Testing Library) dla nowych miejsc z logiką UI: `DecksPanel` (polecenia oczekujące), globalny handler 401, wybór interwału odpytywania.

## 7. Ryzyka

- **Izolacja stylów** Mantine od Kid UI w tej samej aplikacji Next — zweryfikowana w fazie 0 (zrzuty Kid UI identyczne co do piksela w schemacie jasnym i ciemnym, pełny e2e).
- **`globals.css` bez warstwy** ma reguły elementów (`button`, `label`, `textarea`, `h1`–`h3`, `form button`), które wygrywają z warstwą `mantine` niezależnie od specyficzności i zepsują komponenty Mantine. Faza 1 przenosi te reguły do warstwy niższej niż `mantine` albo zawęża je do klas starych ekranów — przed pierwszym komponentem Mantine na ekranie.
- **Edytory** (895 i 988 linii) mają najwięcej subtelnych zachowań; rozbicie na dane/UI i pełne e2e po każdym kroku.
- **Selektory e2e** oparte na indeksach (`-0`, `-1`) i prefiksach — kolejność renderowania musi zostać zachowana.
- **Rozmiar bundla** panelu rośnie; panel nie jest krytyczny wydajnościowo, ale mierzymy przed/po.
- **Duże wersje Mantine** wychodzą mniej więcej raz do roku — aktualizacja jako osobne zadanie.

- **„Wstecz” z leave guardem** nad History API — przeglądarki nie pozwalają anulować `popstate`, więc guard musi przywrócić wpis historii; pokrycie e2e w fazie 1.

## 8. Decyzje właściciela (2026-10-29)

1. Tryb ciemny: tak (3.1).
2. Adresy URL i „wstecz”: tak, w fazie 1 (4.1).
3. Szkice układu: przygotowuje agent przed fazami 1, 5b i 6b.
