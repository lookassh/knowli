# Zmiana domyślnej nawigacji: wybór profilu dziecka na stronie głównej i relokacja panelu rodzica

Data: 2026-10-09. Stan bazowy: `17a5fe8`, gałąź `change_default_navigation_profile`.
Ścieżka workflow: architectural (zmiana architektury tras webowych aplikacji, głównego punktu wejścia, manifestu PWA, powiązań między strefą dziecka a rodzica oraz kryteriów w SPEC i architekturze).

## 1. Cel i zakres

Głównym punktem wejścia do aplikacji pod adresem `/` staje się interfejs dziecka rozpoczynający się od wyboru profilu dziecka. Panel rodzica zostaje przeniesiony z adresu `/` na dedykowaną trasę `/parent`. Na ekranach wyboru profilu oraz wyboru talii pojawia się link prowadzący do panelu rodzica (`/parent`), natomiast w trakcie aktywnej sesji ćwiczeń link ten jest ukryty, by nie rozpraszać dziecka.

W związku z tym, że jest to nowa aplikacja i kompatybilność wsteczna nie jest wymagana (decyzja właściciela):
- Trasa `/learn` zostaje usunięta, a jej rolę przejmuje strona główna `/`.
- Trasa bezpośrednia `/kids/[childId]/learn` pozostaje bez zmian (używana m.in. przez linki "Rozpocznij naukę" w panelu rodzica).
- Dotychczasowe automatyczne przeskakiwanie do talii przy dokładnie 1 profilu zostaje wyłączone przy wejściu ogólnym (`/`) — dziecko zawsze widzi ekran wyboru profilu.
- W panelu rodzica pojawia się link powrotny do strefy nauki (`/`).
- Manifest PWA wskazuje `start_url: "/"`.

## 2. Architektura tras webowych (`apps/web`)

1. **Trasa główna `/` (`apps/web/src/app/page.tsx`)**:
   - Renderuje komponent hostujący aplikację dziecka (`KidLearningHost`).
   - Przekazuje konfigurację odnośnika do panelu rodzica (`/parent`).
   - Jest to domyślny ekran startowy aplikacji oraz `start_url` w manifeście PWA.

2. **Trasa panelu rodzica `/parent` (`apps/web/src/app/parent/page.tsx`)**:
   - Nowa strona renderująca `ParentApp`.
   - Wszystkie dotychczasowe funkcje panelu (konfiguracja PIN, logowanie, zarządzanie zestawami, edycja profili, postępy) działają pod tym adresem.
   - W nagłówku `ParentApp` dodany link prowadzący z powrotem do strefy nauki (`/`).

3. **Usunięcie trasy `/learn`**:
   - Plik `apps/web/src/app/learn/page.tsx` zostaje usunięty.
   - Komponent `KidLearningHost` zostaje przeniesiony/wydzielony do `apps/web/src/kid/KidLearningHost.tsx` (lub `apps/web/src/app/KidLearningHost.tsx`) i współdzielony przez `apps/web/src/app/page.tsx` oraz `apps/web/src/app/kids/[childId]/learn/page.tsx`.

4. **Trasa `/kids/[childId]/learn` (`apps/web/src/app/kids/[childId]/learn/page.tsx`)**:
   - Pozostaje bez zmian. Przyjmuje parametr `childId` i przekazuje go jako `initialChildId` do `KidLearningHost`.
   - Zgodnie z architekturą, linki z panelu rodzica otwierają bezpośrednio talie danego dziecka.

5. **Manifest PWA (`apps/web/src/app/manifest.ts`)**:
   - Aktualizacja pola `start_url` z `"/learn"` na `"/"`.

## 3. Zmiany w bibliotece `@learning/kid-ui`

Zgodnie z zasadami projektu, `@learning/kid-ui` pozostaje całkowicie niezależna od Next.js i routingu serwerowego:

1. **Interfejs komponentu `KidApp` (`packages/kid-ui/src/KidApp.tsx`)**:
   - `KidAppProps` otrzymuje opcjonalną właściwość `parentLink?: { label: string; href: string }` lub ogólniejszą `renderHeaderActions?: (screenKind: KidScreen["kind"]) => ReactNode`.
   - `KidApp` przekazuje tę konfigurację do ekranów `ProfileScreen` oraz `DeckScreen`.
   - W trakcie trwania ćwiczeń (`screen.kind === "learning"`) akcje nagłówka / link do rodzica nie są renderowane.

2. **Ekran profilu (`packages/kid-ui/src/screens/ProfileScreen.tsx`)**:
   - Na górze ekranu (np. w pasku nawigacyjnym / prawym górnym rogu) renderowany jest odnośnik do panelu rodzica.
   - Dostępny zarówno gdy w systemie są już profile, jak i w stanie pustym (gdy rodzic dopiero musi dodać profil).

3. **Ekran talii (`packages/kid-ui/src/screens/DeckScreen.tsx`)**:
   - Na górze ekranu (np. obok przełącznika mikrofonu lub nazwy dziecka) renderowany jest odnośnik do panelu rodzica.

4. **Zachowanie sesji (`packages/kid-ui/src/session/session-controller.ts`)**:
   - W metodzie `start()`:
     - Gdy `initialChildId` jest podany i prawidłowy: przechodzimy do `DeckScreen` dla tego dziecka (bez zmian).
     - Gdy `initialChildId` nie jest podany: ZAWSZE ustawiamy stan `{ kind: "profile", profiles }`, nawet gdy `profiles.length === 1`.
     - Usunięcie gałęzi automatycznego pomijania:
       ```ts
       // USUNIĘTO:
       // } else if (this.#profiles.length === 1) {
       //   await this.#openDeckScreen(this.#profiles[0]!.childId);
       //   return;
       ```

## 4. Komunikaty i UI (`packages/contracts` i style)

1. **Nowe komunikaty w `packages/contracts/src/messages.ts`**:
   - W `messages.kid`:
     - `parentZone: "Strefa rodzica"` (etykieta linku prowadzącego do `/parent`).
   - W `messages.auth` / `messages.app`:
     - `toLearning: "Do nauki"` (etykieta linku powrotnego z panelu rodzica do `/`).
2. **Style (`packages/kid-ui/src/styles.css` oraz `apps/web/src/app/globals.css`)**:
   - Klasa `.kid-parent-link` w `@learning/kid-ui` zapewniająca spójny wygląd przycisku/linku z dużym obszarem dotykowym (`touch-friendly`), estetycznie wkomponowanego w nagłówek.

## 5. Bezpieczeństwo i autoryzacja

- Wybór profilu dziecka nie jest mechanizmem autoryzacji (zgodnie z architekturą §13).
- Panel rodzica pod `/parent` bezwzględnie wymaga uwierzytelnienia PIN-em (serwerowa sesja HTTP-only cookie). Kliknięcie linku "Strefa rodzica" przenosi na `/parent`, gdzie nieautoryzowany użytkownik widzi formularz podania PIN-u (lub konfiguracji początkowej przy pierwszym uruchomieniu).

## 6. Aktualizacja dokumentacji projektu

1. **`docs/SPEC.md`**:
   - Aktualizacja punktu 70: adres `/` otwiera aplikację dziecka (ekran wyboru profilu), a `/parent` panel rodzica.
   - Aktualizacja punktu 73 i kryterium akceptacji A40: odnotowanie nowej roli `/` zamiast `/learn` oraz obecności linku do `/parent` na ekranach startowych dziecka.
2. **`docs/architecture.md`**:
   - Aktualizacja sekcji 5 (Trasy web rodzica i dziecka): `/` dla KidApp, `/parent` dla panelu rodzica, usunięcie opisu `/learn`, potwierdzenie zachowania `/kids/{childId}/learn`.

## 7. Plan testów i weryfikacji

1. **Testy jednostkowe (`packages/kid-ui`)**:
   - `session-controller.test.ts`: test sprawdzający, że przy 1 profilu bez `initialChildId` sesja zatrzymuje się na stanie `profile` zamiast automatycznie przechodzić do `deck`.
   - Testy renderowania `ProfileScreen` i `DeckScreen` z linkiem do panelu rodzica.
2. **Testy integracyjne / kontraktów**:
   - Weryfikacja spójności typów i komunikatów w `@learning/contracts`.
3. **Testy end-to-end (`tests/e2e`)**:
   - Dostosowanie adresów bazowych w testach rodzica: zmiana `page.goto("/")` na `page.goto("/parent")` w:
     - `tests/e2e/parent-flow.spec.ts`
     - `tests/e2e/parent-edit-protection.spec.ts`
     - `tests/e2e/generation-request-retry.spec.ts`
     - `tests/e2e/manual-deck-flow.spec.ts`
     - `tests/e2e/progress-panel.spec.ts`
     - `tests/e2e/privacy.spec.ts`
   - Dostosowanie adresów w testach dziecka: zmiana `page.goto("/learn")` na `page.goto("/")` w:
     - `tests/e2e/kid-flow.spec.ts`
     - `tests/e2e/test-preparation.spec.ts`
   - Dodanie nowego scenariusza testowego E2E:
     - Otwarcie `/` -> widoczny wybór profilu oraz link "Strefa rodzica".
     - Kliknięcie linku "Strefa rodzica" -> przejście na `/parent` i wyświetlenie ekranu PIN/logowania rodzica.
     - Wybór profilu -> przejście do listy talii (link "Strefa rodzica" nadal dostępny).
     - Wejście do nauki -> link "Strefa rodzica" znika z widoku ćwiczeń.
