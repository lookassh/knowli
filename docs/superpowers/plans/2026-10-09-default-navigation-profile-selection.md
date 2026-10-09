# Zmiana domyślnej nawigacji na wybór profilu dziecka — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Bez delegacji bez zgody właściciela.

**Goal:** Ustawić wybór profilu dziecka jako domyślny start aplikacji pod `/`, przenieść panel rodzica pod `/parent`, dodać link do panelu rodzica na ekranach nawigacyjnych dziecka i usunąć niepotrzebną trasę `/learn`.

**Architecture:**
Biblioteka `@learning/kid-ui` zyskuje wstrzykiwalny slot akcji nagłówka (`parentLink` / `headerActions`), który renderuje się na ekranie wyboru profilu (`ProfileScreen`) oraz wyboru talii (`DeckScreen`), a znika podczas właściwych ćwiczeń (`LearnScreen`). Kontroler sesji przestaje automatycznie pomijać wybór profilu przy pojedynczym dziecku, gdy nie przekazano `initialChildId`. W aplikacji `apps/web` trasa `/` renderuje `KidLearningHost` z odnośnikiem do `/parent`, trasa `/parent` przejmuje `ParentApp` z linkiem powrotnym do `/`, `manifest.ts` ustawia `start_url: "/"`, a trasa `/learn` zostaje usunięta.

**Tech Stack:** TypeScript, Next.js App Router, React, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-09-default-navigation-profile-selection-design.md`

## Global Constraints

- Brak sztucznej kompatybilności wstecznej — trasa `/learn` zostaje trwale usunięta; wejście ogólne to `/`.
- Trasa bezpośrednia `/kids/[childId]/learn` pozostaje nienaruszona i przyjmuje parametr profilu.
- Izolacja `@learning/kid-ui`: biblioteka nie importuje Next.js (`next/link`, `next/navigation`) ani tras serwera; link lub element nagłówka przekazuje host webowy.
- Panel rodzica pod `/parent` bezwzględnie wymaga uwierzytelnienia PIN-em — sam link w UI nie omija zabezpieczeń.
- Dziecko w trakcie aktywnej sesji ćwiczeń nie może mieć widocznego odnośnika do rodzica.
- Wszystkie etykiety pochodzą z `packages/contracts/src/messages.ts`.

## Review Focus

1. Wejście na `/`, gdy w bazie zarejestrowany jest dokładnie 1 profil dziecka — oczekiwane wyświetlenie ekranu wyboru profilu z tym dzieckiem, a nie natychmiastowe przeskoczenie do talii.
2. Wejście z bezpośredniego adresu `/kids/[childId]/learn` — oczekiwane natychmiastowe otwarcie talii wskazanego dziecka (zachowanie `initialChildId`).
3. Wejście na `/`, gdy w bazie jest 0 profili — oczekiwane wyświetlenie stanu pustego profilu z widocznym linkiem do panelu rodzica.
4. Ukrycie linku do rodzica podczas rozwiązywania zadań (ekran `learning`) — odnośnik musi zniknąć po kliknięciu startu talii i nie może być dostępny w trakcie ćwiczeń.
5. Poprawne działanie autoryzacji i powrotu pod `/parent` — wejście bez sesji pokazuje logowanie PIN, po zalogowaniu dostępny jest link powrotny do nauki `/`.

---

### Task 1: Kontrakty i zachowanie sesji w `@learning/kid-ui`

**Files:**
- Modify: `packages/contracts/src/messages.ts`
- Modify: `packages/kid-ui/src/session/session-controller.ts`
- Test: `packages/kid-ui/src/session/session-controller.test.ts`

**Interfaces:**
- `messages.kid.parentZone = "Strefa rodzica"`
- `messages.parent.kidZone = "Do nauki"`
- `LearningSessionController.start()`: gdy `this.#initialChildId === undefined`, zawsze ustawia stan `{ kind: "profile", profiles }` (nawet dla `profiles.length === 1`).

- [ ] **Step 1: Napisać test sprawdzający, że 1 profil bez `initialChildId` nie przeskakuje do talii**

W `packages/kid-ui/src/session/session-controller.test.ts` dodać test:
```ts
test("pojedynczy profil bez initialChildId zatrzymuje się na ekranie wyboru profilu", async () => {
  const { controller } = createTestRig({
    profiles: [{ childId: "child-1", displayName: "Adaś", avatarKey: "fox" }],
  });
  await controller.start();
  expect(controller.getScreen().kind).toBe("profile");
});
```

- [ ] **Step 2: Uruchomić test i potwierdzić oczekiwaną porażkę (RED)**

Run: `pnpm --filter @learning/kid-ui test session-controller.test.ts`
Expected: FAIL (obecnie zwraca `"deck"` zamiast `"profile"`).

- [ ] **Step 3: Dodać etykiety do `messages.ts` i zmodyfikować `start()` w `session-controller.ts`**

W `packages/contracts/src/messages.ts`:
- Dodać `messages.kid.parentZone: "Strefa rodzica"`
- Dodać w sekcji rodzica `messages.parent.kidZone: "Do nauki"` (lub `messages.auth.kidZone`)

W `packages/kid-ui/src/session/session-controller.ts`:
- W metodzie `start()` usunąć gałąź `else if (this.#profiles.length === 1)`. Zachować obsługę `this.#initialChildId`.

- [ ] **Step 4: Uruchomić testy jednostkowe `session-controller.test.ts` i zweryfikować przejście (GREEN)**

Run: `pnpm --filter @learning/kid-ui test session-controller.test.ts`
Expected: PASS (wszystkie testy przechodzą).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/messages.ts packages/kid-ui/src/session/session-controller.ts packages/kid-ui/src/session/session-controller.test.ts
git commit -m "feat: keep single child on profile selection when no initialChildId provided"
```

---

### Task 2: Slot nagłówka i link do rodzica w komponentach `@learning/kid-ui`

**Files:**
- Modify: `packages/kid-ui/src/KidApp.tsx`
- Modify: `packages/kid-ui/src/screens/ProfileScreen.tsx`
- Modify: `packages/kid-ui/src/screens/DeckScreen.tsx`
- Modify: `packages/kid-ui/src/styles.css`
- Test: `packages/kid-ui/src/screens/ProfileScreen.test.tsx` (lub `DeckScreen.test.tsx`)

**Interfaces:**
- `KidAppProps`: dodane pole `parentLink?: { label: string; href: string }` lub `headerActions?: React.ReactNode`.
- `ProfileScreenProps`: dodane pole `headerActions?: React.ReactNode`.
- `DeckScreenProps`: dodane pole `headerActions?: React.ReactNode`.

- [ ] **Step 1: Napisać test sprawdzający obecność linku do rodzica na ekranach `ProfileScreen` i `DeckScreen`**

Stworzyć test weryfikujący renderowanie `headerActions` w `ProfileScreen` (oraz `DeckScreen`):
```tsx
test("ProfileScreen renderuje dostarczone akcje nagłówka / link do rodzica", () => {
  render(<ProfileScreen profiles={[]} onSelect={() => {}} headerActions={<a href="/parent">Strefa rodzica</a>} />);
  expect(screen.getByRole("link", { name: "Strefa rodzica" })).toHaveAttribute("href", "/parent");
});
```

- [ ] **Step 2: Uruchomić test i potwierdzić oczekiwaną porażkę (RED)**

Run: `pnpm --filter @learning/kid-ui test`
Expected: FAIL (brak właściwości `headerActions`).

- [ ] **Step 3: Zaimplementować przekazywanie i renderowanie akcji nagłówka**

- W `packages/kid-ui/src/screens/ProfileScreen.tsx`: dodać opcjonalne `headerActions?: React.ReactNode` i wyrenderować je na samej górze w kontenerze `<header className="kid-top-bar">` lub obok tytułu.
- W `packages/kid-ui/src/screens/DeckScreen.tsx`: dodać opcjonalne `headerActions?: React.ReactNode` w nagłówku ekranu.
- W `packages/kid-ui/src/KidApp.tsx`: przyjąć `parentLink?: { label: string; href: string }` lub `headerActions?: React.ReactNode`. Przekazać link do `ProfileScreen` oraz `DeckScreen`. Na ekranie `learning` nie renderować akcji.
- W `packages/kid-ui/src/styles.css`: dodać style dla `.kid-parent-link` i `.kid-top-bar` (np. link w prawym górnym rogu z odpowiednim paddingiem, czytelnym obrysem i spójną typografią).

- [ ] **Step 4: Uruchomić testy w `@learning/kid-ui` i potwierdzić sukces (GREEN)**

Run: `pnpm --filter @learning/kid-ui test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/kid-ui/src/KidApp.tsx packages/kid-ui/src/screens/ProfileScreen.tsx packages/kid-ui/src/screens/DeckScreen.tsx packages/kid-ui/src/styles.css packages/kid-ui/src/screens/
git commit -m "feat(kid-ui): add header actions slot and parent link support to navigation screens"
```

---

### Task 3: Reorganizacja tras i hosta web w `apps/web`

**Files:**
- Create: `apps/web/src/kid/KidLearningHost.tsx`
- Create: `apps/web/src/app/parent/page.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/parent/ParentApp.tsx`
- Modify: `apps/web/src/app/kids/[childId]/learn/page.tsx`
- Delete: `apps/web/src/app/learn/page.tsx`
- Delete: `apps/web/src/app/learn/KidLearningHost.tsx`
- Modify: `apps/web/src/app/manifest.ts`

**Interfaces:**
- `KidLearningHost({ initialChildId, parentHref }: { initialChildId?: string; parentHref?: string })`: renderuje `KidApp` z `parentLink={{ label: messages.kid.parentZone, href: parentHref ?? "/parent" }}`.
- `apps/web/src/app/page.tsx`: renderuje `<KidLearningHost />`.
- `apps/web/src/app/parent/page.tsx`: renderuje `<ParentApp />`.
- `ParentApp.tsx`: w `<header className="row space">` zawiera link powrotny `<a href="/" data-testid="to-learning">{messages.parent.kidZone}</a>`.

- [ ] **Step 1: Przenieść `KidLearningHost` i skonfigurować prop `parentLink`**

Utworzyć `apps/web/src/kid/KidLearningHost.tsx`:
```tsx
"use client";

import { useMemo } from "react";
import { messages } from "@learning/contracts";
import {
  createBrowserMedia,
  createBrowserPreferences,
  createKidApiClient,
  KidApp,
} from "@learning/kid-ui";
import "@learning/kid-ui/styles.css";

export function KidLearningHost({ initialChildId, parentHref = "/parent" }: { initialChildId?: string; parentHref?: string }) {
  const api = useMemo(() => createKidApiClient({ baseUrl: "" }), []);
  const media = useMemo(() => createBrowserMedia(), []);
  const storage = useMemo(() => createBrowserPreferences(), []);
  return (
    <KidApp
      api={api}
      media={media}
      storage={storage}
      parentLink={{ label: messages.kid.parentZone, href: parentHref }}
      {...(initialChildId === undefined ? {} : { initialChildId })}
    />
  );
}
```

- [ ] **Step 2: Zaktualizować `apps/web/src/app/kids/[childId]/learn/page.tsx` i usunąć `apps/web/src/app/learn`**

- W `apps/web/src/app/kids/[childId]/learn/page.tsx` zmienić import `KidLearningHost` z `@/kid/KidLearningHost`.
- Usunąć `apps/web/src/app/learn/page.tsx` oraz `apps/web/src/app/learn/KidLearningHost.tsx` (i usunąć pusty katalog `learn`).

- [ ] **Step 3: Skonfigurować `apps/web/src/app/page.tsx`, `apps/web/src/app/parent/page.tsx` i link powrotny w `ParentApp.tsx`**

- W `apps/web/src/app/page.tsx`:
  ```tsx
  import { KidLearningHost } from "@/kid/KidLearningHost";

  export default function Page() {
    return <KidLearningHost />;
  }
  ```
- W `apps/web/src/app/parent/page.tsx`:
  ```tsx
  import ParentApp from "@/parent/ParentApp";

  export default function ParentPage() {
    return <ParentApp />;
  }
  ```
- W `apps/web/src/parent/ParentApp.tsx`: w nagłówku panelu rodzica dodać link prowadzący do `/`:
  ```tsx
  <a href="/" className="nav-link" data-testid="to-learning">
    {messages.parent.kidZone}
  </a>
  ```
- W `apps/web/src/app/manifest.ts`: zmienić `start_url: "/learn"` na `start_url: "/"`.

- [ ] **Step 4: Zweryfikować kompilację i typowanie aplikacji webowej**

Run: `pnpm typecheck`
Expected: PASS (brak błędów typowania).

- [ ] **Step 5: Commit**

```bash
git add apps/web/
git commit -m "feat(web): make kid profile selection root route and relocate parent app to /parent"
```

---

### Task 4: Aktualizacja testów E2E i dokumentacji projektu

**Files:**
- Modify: `docs/SPEC.md`
- Modify: `docs/architecture.md`
- Modify: `tests/e2e/parent-flow.spec.ts`
- Modify: `tests/e2e/parent-edit-protection.spec.ts`
- Modify: `tests/e2e/generation-request-retry.spec.ts`
- Modify: `tests/e2e/manual-deck-flow.spec.ts`
- Modify: `tests/e2e/progress-panel.spec.ts`
- Modify: `tests/e2e/privacy.spec.ts`
- Modify: `tests/e2e/kid-flow.spec.ts`
- Modify: `tests/e2e/test-preparation.spec.ts`
- Create / Modify: `tests/e2e/navigation.spec.ts` (lub test w `kid-flow.spec.ts`)

- [ ] **Step 1: Zaktualizować adresy `page.goto` w testach rodzica i dziecka**

- W plikach testów panelu rodzica (`parent-flow.spec.ts`, `parent-edit-protection.spec.ts`, `generation-request-retry.spec.ts`, `manual-deck-flow.spec.ts`, `progress-panel.spec.ts`, `privacy.spec.ts`): zmienić `page.goto("/")` na `page.goto("/parent")`.
- W plikach testów dziecka (`kid-flow.spec.ts`, `test-preparation.spec.ts`): zmienić `page.goto("/learn")` na `page.goto("/")`.

- [ ] **Step 2: Dodać test E2E weryfikujący przepływ nowej nawigacji**

Dodać test weryfikujący:
1. `page.goto("/")` otwiera ekran wyboru profilu dziecka z widocznym linkiem "Strefa rodzica".
2. Kliknięcie linku "Strefa rodzica" przechodzi do `/parent` i wyświetla ekran logowania/PIN.
3. Kliknięcie w panelu rodzica "Do nauki" wraca do `/`.
4. Po wejściu w profil i rozpoczęciu nauki, link "Strefa rodzica" nie jest obecny na ekranie ćwiczeń.

- [ ] **Step 3: Uaktualnić dokumentację `docs/SPEC.md` i `docs/architecture.md`**

- W `docs/SPEC.md`: zaktualizować punkt 70, 73 i A40 odzwierciedlając trasę `/` dla dziecka i `/parent` dla rodzica.
- W `docs/architecture.md`: zaktualizować sekcję 5 (Trasy web rodzica i dziecka).

- [ ] **Step 4: Uruchomić weryfikację (testy jednostkowe, integracyjne i typecheck)**

Run: `pnpm typecheck`
Run: `pnpm test:unit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/ tests/
git commit -m "docs & test: update documentation and e2e tests for default navigation routes"
```
