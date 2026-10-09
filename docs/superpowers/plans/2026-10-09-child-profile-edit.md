# Edycja profilu dziecka — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Delegacja przez superpowers:subagent-driven-development wymaga wyraźnej zgody właściciela. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Rodzic zmienia imię lub awatar dziecka, zachowując jego identyfikator, historię nauki i ustawienia.

**Architecture:** Formularz przy profilu wysyła wyłącznie zmienione pola do chronionego PATCH. Przypadek użycia wykonuje pojedyncze UPDATE dwóch dozwolonych kolumn i mapuje wynik na istniejące ChildDto. Bez migracji bazy i optymistycznej aktualizacji UI.

**Tech Stack:** Next.js App Router, React, TypeScript strict, Zod, Drizzle, PostgreSQL, pnpm, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-09-child-profile-edit-design.md` — zatwierdzona 2026-10-09.

## Global Constraints

- `PATCH /api/v1/parent/children/{id}` → HTTP 200, `ChildDto`; wejście zawiera co najmniej jedno z pól `displayName`, `avatarKey`.
- `displayName`: trim, długość 1–80; `avatarKey`: długość 1–40. Nieznane pola są odrzucane.
- UI oferuje `fox`, `cat`, `owl`, `panda`; inny istniejący awatar zachowuje jako opcję z neutralną ikoną.
- Chronione są UUID, `birthYear`, `createdAt`, `policyId` i wszystkie dane nauki. Pominięte pola pozostają bez zmian.
- Sesja rodzica i istniejąca kontrola Origin/CSRF obowiązują każdą mutację. Błędy korzystają ze wspólnego formatu API.
- Interfejs `pl-PL`, teksty wyłącznie w `messages.ts`. Brak nowych bibliotek, modali i synchronizacji realtime.
- Nie nagrywać audio ani używać rzeczywistych danych dzieci w testach. PostgreSQL integracyjny i fake providerzy zgodnie z istniejącym setupem.
- Przed implementacją każdego nowego zachowania utrwalić dowód RED; awaria Docker lub narzędzi nie jest RED funkcji.
- Pozostać w aktualnym izolowanym worktree; sprawdzić to przez using-git-worktrees przy wykonaniu. Nie nadpisywać obcych zmian. Commitować tylko pliki zadania, bez push/merge.

## Review Focus

1. Zapis tylko imienia przy awatarze spoza listy nie może zmienić obrazka — zadanie 3.
2. Udany PATCH i nieudany GET odświeżenia nie mogą zostać pokazane jako nieudany zapis — zadanie 3.
3. Dwa klienty z otwartym formularzem zmieniające różne pola nie nadpisują pominiętych wartości — zadania 2 i 3.
4. Profil usunięty w drugim kliencie nie może odtworzyć się po zapisie starego formularza — zadania 2 i 3.
5. Submit klawiszem Enter i szybkie powtórzenie kliknięcia nie powodują dwóch mutacji ani utraty fokusu — zadanie 3.

## Mapa plików i zależności

1. `packages/contracts/src/decks.ts`, nowy `packages/contracts/src/child-profile.test.ts`: polecenie aktualizacji i jego walidacja.
2. `packages/server/src/modules/profiles.ts`, `packages/server/src/index.ts`, `apps/web/src/app/api/v1/parent/children/[id]/route.ts`: przypadek użycia i cienki handler. Testy: `tests/integration/auth-profiles.test.ts`, `tests/integration/history.test.ts`. Dokumentacja kontraktu: `docs/architecture.md`, `docs/folder-structure.md`, `docs/implementation-plan.md`.
3. `apps/web/src/parent/ChildEditor.tsx`, `packages/contracts/src/messages.ts`: formularz i komunikaty. Testy: `tests/e2e/parent-flow.spec.ts`.

Zadanie 2 korzysta z kontraktu zadania 1; zadanie 3 z gotowego API. Nie wydzielać nowego modułu profili ani przebudowywać ustawień wymowy.

## Zadanie 1: Walidowany kontrakt częściowej aktualizacji

**Interfaces:** Consumes: istniejący `ChildDto`. Produces: `ChildPatchSchema`, `type ChildPatch = z.infer<typeof ChildPatchSchema>` eksportowane przez istniejący barrel contracts.

- [x] Dodać `child-profile.test.ts` z testami poniższych asercji oraz osobnymi przypadkami granic długości: 80/81 dla imienia po trimowaniu i 40/41 dla awatara.

```ts
expect(ChildPatchSchema.parse({ displayName: "  Krzyś  " })).toEqual({ displayName: "Krzyś" });
expect(ChildPatchSchema.parse({ avatarKey: "cat" })).toEqual({ avatarKey: "cat" });
expect(ChildPatchSchema.parse({ displayName: "Krzyś", avatarKey: "owl" }))
  .toEqual({ displayName: "Krzyś", avatarKey: "owl" });
for (const input of [{}, null, { displayName: "  " }, { avatarKey: "" },
  { displayName: 7 }, { displayName: "Ala", birthYear: 2018 },
  { displayName: "Ala", id: "x" }, { displayName: "Ala", policyId: "learning-v2" }]) {
  expect(ChildPatchSchema.safeParse(input).success).toBe(false);
}
```

- [x] RED: `pnpm test:unit packages/contracts/src/child-profile.test.ts` — oczekiwana porażka z powodu brakującego `ChildPatchSchema`.
- [x] Zdefiniować strict object z opcjonalnymi polami i refinementem wymagającym co najmniej jednej zdefiniowanej wartości. Zachować istniejące `ChildInputSchema` i `ChildDtoSchema`.
- [x] GREEN: ta sama komenda i `pnpm typecheck` — PASS.
- [x] Selektywnie commitować kontrakt i test: `feat: add child profile patch contract`.

## Zadanie 2: Aktualizacja profilu i ochrona historii

**Interfaces:** Consumes: `ChildPatchSchema`, `ChildPatch`, `UuidSchema`, `Services`, `toChildDto`, istniejące helpery HTTP. Produces: `updateChild(services: Services, childId: string, input: ChildPatch): Promise<ChildDto>` i eksport `PATCH(request: Request, context: RouteContext): Promise<Response>`.

- [x] W `auth-profiles.test.ts` dodać testy aktualizacji imienia, awatara i obu pól. Korzystać z `buildTestServices`, `createChild`, `listChildren`, istniejących `jsonRequest`, `childRouteContext` i cookie logowania. Przykład testu przypadku użycia:

```ts
const original = await createChild(services, { displayName: "Ola", avatarKey: "fox", birthYear: 2018 });
expect(await updateChild(services, original.id, { displayName: "  Ala  " }))
  .toEqual({ ...original, displayName: "Ala" });
expect(await updateChild(services, original.id, { avatarKey: "cat" }))
  .toEqual({ ...original, displayName: "Ala", avatarKey: "cat" });
```

- [x] Dodać test handlera: poprawna sesja → 200 i równość DTO; brak cookie → 401; poprawne cookie i obcy Origin lub `sec-fetch-site: cross-site` → 403; niepoprawny UUID/JSON/wejście → 400; nieistniejący UUID → 404. Po każdym błędzie porównać stan profilu z wcześniejszym odczytem. Sprawdzić DTO nie zawiera `policyId` ani `createdAt`.
- [x] Dodać test dwóch połączeń do tej samej bazy przez `openRestartedServices`: równoległe `updateChild(id, {displayName: "Ala"})` i `updateChild(id, {avatarKey: "panda"})` przez `Promise.all` dają profil z obiema wartościami. Po `deleteChild` aktualizacja tego UUID ma kod `not_found`, a profil nie pojawia się na liście. Zamknąć dodatkową pulę w `finally`.
- [x] W `history.test.ts` użyć istniejącego `sessionWithAttempt(childId)`. Utworzyć także drugie dziecko z historią i ustawić poprawną istniejącą `policyId` profilu. Odczytać stabilnie posortowane pełne rekordy tabel sesji, zadań, prób, ocen, zdarzeń, ekspozycji, projekcji i przypisań oraz materiału. Porównać przed i po `updateChild`; same liczniki nie wystarczają. Asercje: wszystkie te rekordy identyczne i niepuste dla badanego dziecka, drugi profil identyczny, `birthYear`, `createdAt`, `policyId` bez zmian, jedynie nazwa/awatar badanego profilu zmienione. Aktywna sesja zachowuje wersję zestawu i polityki.
- [x] RED: `pnpm test:integration tests/integration/auth-profiles.test.ts tests/integration/history.test.ts` — oczekiwana porażka nowych testów z powodu braku `updateChild`/PATCH, przy działającym setupie PostgreSQL.
- [x] Zaimplementować `updateChild`: parse UUID/input, jawne warunkowe `.set` wyłącznie z dostarczonymi polami, pojedynczy UPDATE z RETURNING, brak wiersza → `AppError("not_found")`, wynik → `toChildDto`. Eksportować z server/index.
- [x] Dodać PATCH do istniejącego route: Origin, sesja, parse JSON i schematu, wywołanie przypadku użycia, JSON 200. Zachować DELETE i runtime serwera. Nie dublować logiki domenowej w handlerze.
- [x] Uzupełnić dokumentację o kontrakt PATCH, `updateChild`, odpowiedzialność modułu i rozszerzenie R03. Bez zmiany projektowego SQL.
- [x] GREEN: powtórzyć integrację i `pnpm typecheck`; dotychczasowe testy DELETE i niezmienności historii również muszą przechodzić.
- [x] Selektywnie commitować pliki tego zadania: `feat: update child profiles without deleting history`.

## Zadanie 3: Formularz rodzica i zachowanie w przeglądarce

**Interfaces:** Consumes: PATCH z zadania 2, `ChildDto`, `apiFetch<T>`, `errorMessage`, istniejący prop `onChanged: () => Promise<void>`. Produces: istniejący `ChildEditor` z edycją jednego profilu i komunikatami w katalogu.

- [x] Dodać niezależne testy Playwright z syntetycznym profilem o unikalnym imieniu. Logowanie korzysta z istniejącego przebiegu setup/login. Lokalizować karty przez href UUID, a nie zmienne imię lub indeks.
- [x] Test „edycja i anulowanie zachowują profil”: otwarcie pokazuje aktualne wartości; fokus jest w imieniu; Anuluj nie wysyła PATCH, przywraca fokus, ponowne otwarcie pokazuje stare dane. Zmienić imię i awatar, zapisać przez Enter, oczekiwać jednego PATCH i zachowanego href. Reload pokazuje nowe wartości. Asercje kluczowe:

```ts
await expect(row.getByTestId("child-edit-name")).toHaveValue(originalName);
await expect(row.getByTestId("child-edit-name")).toBeFocused();
await expect(row.getByTestId("child-learn-link")).toHaveAttribute("href", originalHref);
expect(patchBody).toEqual({ displayName: updatedName, avatarKey: "cat" });
```

- [x] Testy UI sprawdzają brak aktywnego zapisu dla imienia `"  "` i braku zmian; tylko jedno rozwinięcie; przełączenie dziecka odrzuca robocze dane. Zmiana wyłącznie imienia wysyła body `{displayName: updatedName}`. Profil z `avatarKey: "legacy"` zachowuje tę wartość po edycji imienia.
- [x] Testy błędów przez `page.route`: PATCH 500 pozostawia wartości i alert, retry może się udać; udany PATCH + przechwycony kolejny GET 500 pokazuje osobny komunikat odświeżenia i zamyka edycję. Usunięcie przez drugiego klienta + PATCH 404 pozostawia czytelny błąd, nie tworzy profilu; po reload karta znika.
- [x] Test blokad: zatrzymać odpowiedź PATCH przez sterowany promise w routingu. W trakcie żądania pola, Anuluj, Usuń i akcje zmiany edytowanego profilu są nieaktywne; próba ponownego submit nie zwiększa liczby PATCH. Uwolnić promise w `finally`. Gdy odświeżenie listy usunie otwarty profil, formularz znika.
- [x] RED: `pnpm test:e2e tests/e2e/parent-flow.spec.ts --grep "edycja profilu"` — nadać wszystkim nowym testom ten fragment nazwy; oczekiwana porażka braku przycisku/formularza, nie awaria setupu.
- [x] Dodać w messages.children klucze `edit`, `cancel`, `saved`, `savedRefreshFailed` z dokładnym tekstem specyfikacji. Zachować istniejący `save`.
- [x] W ChildEditor dodać stan edytowanego UUID, bazowych wartości, roboczych pól, zapisu, błędu i potwierdzenia. Użyć osobnego semantycznego formularza w karcie, nazwanych pól z testid `child-edit-name`, `child-edit-avatar`, przycisków `child-edit`, `child-edit-save`, `child-edit-cancel`. Obliczać PATCH przez porównanie trimowanego imienia/awatara z bazą. Jedna ścieżka submit obsługuje Enter i kliknięcie; chronić przed równoległym żądaniem również synchroniczną blokadą.
- [x] Obsłużyć sukces PATCH osobno od `onChanged`, fokus i zamknięcie przy braku profilu. Zachować nieznany awatar jako dodatkową bieżącą opcję. Ustawienia wymowy i dodawanie/usuwanie zachowują dotychczasowe zachowanie.
- [x] GREEN: powtórzyć nowy grep, następnie cały `pnpm test:e2e tests/e2e/parent-flow.spec.ts`. Wypełniony widok sprawdzić także przy viewportach 390×844 i 768×1024: brak poziomego overflow, pola i przyciski widoczne oraz dostępne, fokus i etykiety poprawne. Zachować screenshoty jako dowód kontroli wyglądu.
- [x] Selektywnie commitować UI, katalog komunikatów i E2E: `feat: edit child name and avatar in parent panel`.

## Końcowa weryfikacja i przekazanie

- [x] Użyć verification-before-completion; uruchomić `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm build`. Nie powtarzać tych samych pełnych sprawdzeń bez kolejnych zmian lub nowych problemów.
- [x] `git diff --check` oraz przegląd diffu: brak migracji, sekretów w DTO, zmian pól chronionych i obcego kodu. Review zgodnie z requesting-code-review; jeśli bez zgody na delegację, wykonać własny przegląd i ujawnić brak niezależnego review.
- [x] Uaktualnić checklisty specyfikacji i planu rzeczywistymi dowodami RED/GREEN. Raportować środowiskowe blokady oddzielnie od wyniku testu. Nie deklarować wdrożenia ani zdrowia produkcji.
- [x] Podsumować zmianę i faktycznie uruchomione testy; odnotować ewentualnie pominięte kroki workflow i powody. Bez push/merge/deploy.

## Przegląd planu i stan workflow

Przegląd własny wykonany: sekcje specyfikacji mają zadania, nazwy kontraktów są spójne, pięć przypadków Review Focus ma testy, istniejąca konfiguracja obejmuje nowe testy jednostkowe. Integracja i E2E korzystają z Dockera oraz PostgreSQL; dostępność środowiska trzeba sprawdzić przy wykonaniu, nie jest tutaj potwierdzona.

- [x] Pisemna specyfikacja zatwierdzona przez właściciela.
- [x] Writing-plans: zapis planu i przegląd własny.
- [x] Przegląd planu przez właściciela oraz wybór wykonania bez delegacji.
- [x] Executing-plans, test-driven-development i rzeczywiste RED/GREEN.
- [x] Review i verification-before-completion.

Rekomendowane wykonanie: samodzielnie w tej rozmowie, bez delegacji. Trzy zadania są małe i zależą kolejno od jednego kontraktu. Jeśli właściciel wybierze agentów, jego odpowiedź musi wyraźnie zezwolić na delegację, w tym review. Implementacja została zakończona i zweryfikowana.

## Wyniki wykonania — 2026-10-09

- RED kontraktu: 14 testów nie przeszło z powodu brakującego `ChildPatchSchema`; GREEN: 14/14.
- RED API: 4 nowe testy integracyjne nie przeszły z powodu brakujących `updateChild`/PATCH; GREEN z dotychczasowymi: 18/18 na PostgreSQL.
- RED formularza: 7 nowych E2E nie przeszło z powodu brakującego przycisku edycji. GREEN po implementacji i poprawce dostępnej etykiety awatara; dodatkowy test dwóch niezależnych kontekstów przeglądarki potwierdził zachowanie różnych zmienianych pól.
- Końcowe `pnpm test:unit`: 243/243; `pnpm test:integration`: 128/128; `pnpm test:e2e`: 19/19; `pnpm typecheck` i `pnpm build`: exit 0. Node 22.19.0, pnpm 11.25.0, Docker/PostgreSQL i fake providerzy. Lockfile i zależności bez zmian.
- Obejrzano zrzuty formularza dla 390×844 i 768×1024; testy potwierdziły brak poziomego overflow, etykiety, fokus, zapis Enter, anulowanie, retry, nieudane odświeżenie po udanym zapisie i usunięcie przez innego klienta.
- Przegląd całości zmian wykonany samodzielnie według requesting-code-review. Brak pozostałych problemów blokujących i odłożonych uwag.

Decyzje i odstępstwa workflow:

1. Zgodnie z zatwierdzonym wykonaniem bez delegacji nie powołano niezależnego reviewera. Koszt: brak drugiej, niezależnej oceny.
2. Użyto PowerShell i ręcznego ledger/checklist zamiast Bash task-start/task-done z ekstrakcją angielskich nagłówków z polskiego planu. Uruchomiono sdd-workspace i review-package. Koszt: ręczna kontrola postępu; dowody RED/GREEN sprawdzono i zachowano w tym raporcie.
3. Pełny E2E ujawnił istniejącą zależność kolejności: test podsumowania zostawiał profil, a kolejny scenariusz zakładał jeden profil i czekał na niewydany ekran zestawów. Zmiana w `tests/e2e/kid-flow.spec.ts` sprząta wyłącznie syntetyczny profil w finally i sprawdza widoczność zestawów po hydratacji. Koszt: niewielkie rozszerzenie zakresu o izolację istniejącego testu, bez zmiany aplikacji. Dowód: wcześniejszy timeout 12 minut, po poprawce ten scenariusz PASS w 9.9 s i pełny zestaw PASS.

Dwa uruchomienia pełnego E2E zatrzymały się podczas startu na EADDRINUSE portu 24500. Zakończono wyłącznie procesy tego przebiegu, sprawdzono możliwość związania portu, a finalny przebieg zakończył się PASS. Nie zmieniano konfiguracji testów ani portów aplikacji.

Worktree zachowany zgodnie z planem; brak push, merge i deploy. Weryfikacja lokalna nie stanowi potwierdzenia wdrożenia.

## Poprawka po dodatkowym self-review — 2026-10-09

P2: porównanie przyciętego imienia z nieprzyciętą wartością bazową dołączało niezmieniane imię do zapisu awatara i mogło nadpisać nowszą nazwę z innej przeglądarki. `nameChanged` porównuje teraz obie strony po trim i steruje zarówno aktywnością zapisu, jak i obecnością pola `displayName` w PATCH. Kontrakt API bez zmian.

Regresję dwóch niezależnych kontekstów przeglądarki rozszerzono o imię ze spacjami. RED: niezmieniony formularz miał aktywny zapis; GREEN: oba warianty 2/2 i body zmiany awatara zawiera wyłącznie `avatarKey`. Pełny przegląd aktualizacji nie wykazał pozostałych problemów blokujących.

Do gałęzi `feature/child-profile-edit` włączono `origin/main` = `015fb83`. Konflikt przeniesionego testu podsumowania rozwiązano zachowując kolejność z main i sprzątanie syntetycznego profilu. Weryfikacja po połączeniu: unit 243/243, PostgreSQL integration 128/128, E2E 23/23, typecheck i build exit 0. Pierwszy przebieg celowanego E2E miał błędnie escapowany grep i nie znalazł testów; poprawiony grep uruchomił właściwą regresję RED/GREEN.

Właściciel wyraźnie zlecił scalanie z main i push po poprawnej weryfikacji. Wynik po scaleniu zostanie sprawdzony ponownie przed wypchnięciem; to zastępuje wcześniejsze ograniczenie tego zadania do lokalnego worktree. Nadal bez delegacji.

### Weryfikacja po scaleniu do main

Scalanie do lokalnego `main` utworzyło `68bc5f5`. Podczas pracy lokalny main zawierał już commit `312808d` z ręcznym tworzeniem zestawów. Konflikt `docs/implementation-plan.md` rozwiązano zachowując oba uzupełnienia; kod scalił się automatycznie. Dokładny wynik scalania zweryfikowano w `C:/Users/looka/IdeaProjects/knowli`: unit 246/246, integration PostgreSQL 135/135, pełne E2E 35/35, typecheck i produkcyjny build exit 0. Zwiększone liczby obejmują ręczne tworzenie zestawów i regresję edycji profilu ze spacjami. Przegląd poprawki i rozwiązania konfliktów nie wykazał dalszych problemów blokujących; bez niezależnego reviewera zgodnie z ustaleniem.

Po weryfikacji na main doszedł commit `e800a9e`, zmieniający wyłącznie AGENTS.md. Potwierdzono brak różnic w kodzie aplikacji względem przetestowanego stanu. Niniejszy commit aktualizuje wyłącznie raport. Użyto finishing-a-development-branch z wcześniej udzieloną zgodą na merge i push; worktree zarządzane przez Codex pozostaje zachowane zgodnie z regułą skilla dla workspace należącego do hosta.
