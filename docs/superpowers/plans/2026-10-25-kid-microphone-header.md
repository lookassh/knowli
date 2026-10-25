# Mikrofon w nagłówku wyboru zestawu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Rekomendacja: wykonanie inline, następnie niezależny review całej zmiany. Implementacja dopiero po przeglądzie planu przez właściciela.

**Goal:** Zastąpić dolny panel mikrofonu ikoną w nagłówku, która otwiera ustawienie odpowiedzi głosowych.

**Architecture:** Właścicielem zmiany jest `packages/kid-ui`. Nowy wspólny komponent `MicrophoneSettingsButton` składa `IconActionButton`, `KidIcon`, Mantine Popover i Switch; `DeckScreen` odpowiada za jego położenie. Istniejący kontroler zachowuje reguły i wywołania API, bez nowych zależności serwerowych i bez zmian transakcji.

**Tech Stack:** React, TypeScript, Mantine, Vitest/Testing Library, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-25-kid-microphone-header-design.md` — propozycja do przeglądu razem z planem.

## Global Constraints

- `KidPage` pozostaje jedynym właścicielem pomiaru viewportu; kompozycja ekranu przez `KidScreen`.
- `IconActionButton`, minimum 48 × 48 px; bez surowych kontrolek HTML poza komponentami wspólnymi.
- Polski interfejs i teksty w `packages/contracts/src/messages.ts`; bez nowych zależności i instalacji pakietów.
- Domyślnie mikrofon wyłączony; otwarcie ustawienia nie uruchamia nagrywania ani uprawnień.
- Obsłużyć safe area, małą wysokość, klawiaturę i tekst 200%; brak poziomego overflow lub trwale przyciętych kontrolek.
- Bez zmian `LearnScreen`, kontrolera, DTO, backendu, bazy i MCP. Jeśli implementacja ujawni potrzebę zmiany kontraktu, najpierw zaktualizować plan.
- Nie commitować niezwiązanych plików; nie pushować i nie tworzyć PR w ramach samego przygotowania planu.

## Review Focus

1. Długi czas aktywności, „Strefa rodzica”, błąd odsłuchu i brak odsłuchu: ikony oraz lista nadal osiągalne — zadanie 2.
2. `microphone=false, micDenied=true` po świadomym wyłączeniu: neutralny stan wyłączony, bez fałszywego błędu uprawnień — zadanie 1.
3. Escape, dotyk poza panelem i obsługa Tab: poprawne zamknięcie i powrót fokusu, bez przypadkowego włączenia — zadania 1–2.
4. Krótki landscape, viewport 360×320 i tekst 200%: cały panel osiągalny także po pojawieniu się wskazówki, cele dotykowe ≥48 px — zadanie 2.
5. Sesja wznowiona i kartkówka: panel nie zmienia snapshotu trwającej sesji ani zasad kartkówki — zadanie 2, istniejące testy przepływu/kontrolera.

## Stan bazowy i mapa plików

- Worktree: `C:/Users/looka/.codex/worktrees/kid-microphone-header/knowli`.
- Branch: `feature/kid-microphone-header`, utworzony z odświeżonego `origin/main`, commit `67320681d8b18d8c4c096bd407acd7fb32b61a6f`.
- `.env` i `node_modules` istnieją po automatycznym hooku setup; nie instalować ponownie.
- Baseline: `corepack pnpm test:unit packages/kid-ui/src/screens/profile-decks.test.tsx` — 7/7 PASS.
- `DeckScreen.tsx`: obecny Switch w dolnym `Paper`; `styles.css`: `.kid-deck-microphone` jest sticky.
- `session-controller.ts`: `#openDeckScreen` ustawia `microphone: false`; `setMicrophone` aktualizuje stan i listę zestawów. Czytać jako istniejący kontrakt, bez modyfikacji.

### Task 1: Dostępne ustawienie mikrofonu i integracja nagłówka

**Files:**
- Create: `packages/kid-ui/src/components/MicrophoneSettingsButton.tsx`
- Create: `packages/kid-ui/src/components/MicrophoneSettingsButton.test.tsx`
- Modify: `packages/kid-ui/src/screens/DeckScreen.tsx`
- Modify: `packages/kid-ui/src/screens/profile-decks.test.tsx`
- Modify: `apps/web/src/kid/deck-screen.test.ts`
- Modify: `packages/kid-ui/src/styles.css`
- Modify: `packages/contracts/src/messages.ts`

**Interfaces:**
- Consumes: `IconActionButton`, `KidIcon`, `microphone: boolean`, `micDenied: boolean`, `onToggleMicrophone: (on: boolean) => void` z obecnego `DeckScreen`.
- Produces: `MicrophoneSettingsButton({ microphone, micDenied, onToggleMicrophone }: MicrophoneSettingsButtonProps): ReactElement`; stan otwarcia wyłącznie lokalny. Ikona: `data-testid="kid-mic-settings"`; zachować `kid-mic-toggle`, `kid-microphone-hint`, `kid-mic-denied-hint` wewnątrz rozwijanego panelu.
- Teksty: `messages.kid.microphoneSettingsTitle = "Odpowiedzi głosowe"`, `microphoneSettingsOn = "Odpowiedzi głosowe włączone"`, `microphoneSettingsOff = "Odpowiedzi głosowe wyłączone"`; wykorzystać istniejące `microphone`, `microphoneLearningHint`, `microphoneDeniedHint`.

- [x] **Step 1: Dodać testy RED.** Testy obejmują panel ukryty i otwarty, stany aria, bezpieczne otwarcie, przełącznik w obie strony, odmowę i Escape z powrotem fokusu. Test widoku potwierdza ikonę w nagłówku bez dostępnego odsłuchu i brak dolnego aside.
- [x] **Step 2: Zaobserwować RED.** Test widoku najpierw failed oczekując `kid-mic-settings`, gdy ikona jeszcze nie istniała. Po dodaniu testu komponentu pakiet celowany failed importem brakującego komponentu i asercją brakującego przycisku; obie porażki wynikały z braku funkcji.
- [x] **Step 3: Implementować komponent i kompozycję.** `Popover` z Mantine wywoływał w produkcyjnym bundle React `useEffectEvent`, którego bundle klienta nie udostępniał. Ruling: panel zbudowano jako `Paper` pozycjonowany względem viewportu; komponent obsługuje Escape z powrotem fokusu oraz klik poza panelem. Powód: uniknąć niedziałającego Mantine Popover przy zachowaniu wymaganych interakcji. Koszt błędnej diagnozy: utrzymanie małej własnej obsługi pozycjonowania zamiast komponentu biblioteki. Testy E2E potwierdzają pozycję, Escape i pointer outside. Reszta: panel ma szerokość do 280 px, maksymalną przewijaną wysokość, trzyma się viewportu przy scroll/resize; callback tylko przez Switch; nagłówek dopuszcza zawijanie; usunięto dolny `Paper` i sticky CSS.
- [x] **Step 4: GREEN.** `corepack pnpm test:unit packages/kid-ui/src/components/MicrophoneSettingsButton.test.tsx packages/kid-ui/src/screens/profile-decks.test.tsx packages/kid-ui/src/session/session-controller.test.ts` — 3 pliki, 148 testów PASS. Pełny unit później: 177 plików, 1859 testów PASS.
- [x] **Step 5: Commit implementacji i testów komponentu.** Selektywnie dodać wyłącznie pliki zadania; commit `feat(kid-ui): move microphone settings into deck header`.

### Task 2: Geometria, dostępność i regresje przepływów

**Files:**
- Modify: `tests/e2e/kid-decks-layout.spec.ts`
- Modify: `tests/e2e/kid-mantine-responsive.spec.ts`
- Modify: `tests/e2e/helpers/kid-ui-fixture.ts` — tylko jeśli potrzebne rozszerzenie fixture do stanu/błędu audio.
- Modify: miejsca użycia `kid-mic-toggle` w `kid-flow.spec.ts`, `learning-algorithm.spec.ts`, `kid-ui-layout.spec.ts`, `lesson-real-flow.spec.ts`, `speech-recording-ux.spec.ts`, `test-preparation.spec.ts`.
- Modify: `packages/kid-ui/src/styles.css` — wyłącznie korekty potwierdzone testami geometrii.

**Interfaces:**
- Consumes: `kid-mic-settings` otwierający ustawienie, `kid-mic-toggle` widoczny po otwarciu; dotychczasowe fixture i kontrakty HTTP.
- Produces: regresje potwierdzające brak zasłaniania listy oraz niezmienione parametry startu sesji.

- [x] **Step 1: Dodać testy RED geometrii i interakcji.** Matryca 360×640, 390×844, 844×390, 768×1024, 1280×800 oraz osobny przypadek 360×320. Testuje bounding boxes ikony ≥48 px, brak poziomego overflow, scroll do ostatniego zestawu, panel w viewporcie także z tekstem 200%, Escape z powrotem fokusu, pointer outside, Tab i zmianę wysokości po ujawnieniu wskazówki. Istniejące E2E zachowują wznowienie sesji i kartkówkę. RED: pierwsza wersja geometrii wykryła źle wyrównany panel (x=-216 przy viewport 360).
- [x] **Step 2: Uruchomić celowane E2E i zapisać RED.** Początkowo failed: error boundary Mantine Popover wskazał brak `useEffectEvent`; po zmianie do `Paper` test geometrii wykrył overflow; następnie widok listy po scroll poprawnie oczekuje dostępności ostatniej akcji bez wymagania widoczności nagłówka. Celowane E2E: 14/14 PASS.
- [x] **Step 3: Dostosować istniejące scenariusze.** Zaktualizowano wszystkie E2E korzystające z `kid-mic-toggle`, by jawnie otwierały panel. Zmieniono też SSR test `apps/web/src/kid/deck-screen.test.ts`; scenariusze aktywnego nagrywania zachowują asercje.
- [x] **Step 4: GREEN i weryfikacja końcowa.** `corepack pnpm test:unit`: 177 plików, 1859 testów PASS. `corepack pnpm typecheck`: PASS. `corepack pnpm build`: PASS. Geometria + responsive: 14/14 PASS; po ostatniej poprawce dwa testy geometrii 2/2 PASS. Pozostałe sześć specyfikacji E2E: 79/79 PASS. Brak zmian serwera/bazy. `git diff --cached --check` PASS.
- [x] **Step 5: Review i raport.** Niezależny reviewer przejrzał cały diff względem `origin/main` i poprawkę krótkiego viewportu; brak actionable findings. Brak odbioru fizycznego telefonu. API → MCP → skill bez zmian: UI w Kid UI nie zmienia endpointów, DTO, autoryzacji ani znaczenia raportów.
- [x] **Step 6: Commit regresji.** Dodać wyłącznie pliki planu, specyfikacji i E2E; commit `test(kid-ui): cover header microphone settings and responsive layouts`. Push i PR są autoryzowane przez właściciela w bieżącym poleceniu.

## Self-review planu

Zakres projektu przypisany do zadań 1–2; komponent nie zmienia publicznych propsów DeckScreen ani reguł kontrolera. Zidentyfikowano wszystkie aktualne pliki E2E i SSR z przełącznikiem. Każdy punkt Review Focus ma test w zadaniu właściciela. Błąd Mantine Popover rozwiązano przez przewidywalny panel w portalu aplikacji; E2E potwierdza geometrię panelu.
