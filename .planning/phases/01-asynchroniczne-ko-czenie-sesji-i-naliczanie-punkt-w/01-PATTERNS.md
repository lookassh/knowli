# Phase 1: Asynchroniczne kończenie sesji i naliczanie punktów - Pattern Map

**Mapped:** 2026-10-21  
**Files analyzed:** 12  
**Analogs found:** 12 / 12

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/contracts/src/reward-activity.ts` | contract/schema | transform | ten sam plik, `SessionActivityResultDtoSchema` | exact |
| `packages/server/src/modules/session-activity.ts` | service | request-response + transaction | ten sam plik, `reviewSessionActivity` / `readSessionActivityResult` | exact |
| `packages/server/src/modules/sessions.ts` | service | request-response | ten sam plik, `endSession` | exact |
| `apps/web/src/kid/kid-router.ts` | route | request-response | `GET /sessions/:id/mock-test-summary` | exact |
| `packages/kid-ui/src/api/KidApi.ts` | API interface | request-response | `readMockTestSummary` | exact |
| `packages/kid-ui/src/api/client.ts` | HTTP client | request-response | `readMockTestSummary` and `endSession` | exact |
| `packages/kid-ui/src/session/session-controller.ts` | controller | event-driven + polling | `#deliverPendingActivity`, `#finishSession`, `refreshProfiles` | exact |
| `packages/kid-ui/src/screens/SessionActivityResultView.tsx` | component | presentation | ten sam komponent | exact |
| `packages/server/src/modules/sessions.test.ts` | test | request-response | istniejące testy modułu sesji | role-match |
| `packages/kid-ui/src/session/session-controller.test.ts` | test | event-driven | `makeApi`, bramki obietnic i testy kończenia sesji | exact |
| `packages/kid-ui/src/api/client.test.ts` | test | request-response | testy `endSession` i klienta HTTP | exact |
| `packages/kid-ui/src/screens/reward-summary.test.tsx` | test | presentation | testy `SessionActivityResultView` | exact |

## Pattern Assignments

### `packages/contracts/src/reward-activity.ts` (contract/schema, transform)

**Analog:** ten sam plik, linie 226-238.

Zachować małe, ścisłe DTO dziecka. Aktualny kontrakt ogranicza odpowiedź do statusu, liczby punktów i jawnego kodu błędu:

```ts
export const SessionActivityResultDtoSchema = z.object({
  status: SessionActivityResultStatusSchema,
  pointsAwarded: z.number().int().nonnegative(),
  errorCode: z.string().min(1).nullable(),
}).strict();
```

Endpoint odczytu ma zwracać istniejący `SessionActivityResultDto`, bez kopiowania trwałego `SessionActivityReviewRecord` i bez ujawniania `reason`, sekund, raportu ani werdyktu LLM.

### `packages/server/src/modules/session-activity.ts` (service, request-response + transaction)

**Analog:** `reviewSessionActivity()` (linie 362-499) oraz `readSessionActivityResult()` (linie 583-610).

Przyjęcie raportu korzysta z transakcji i blokady sesji; identyczne żądanie widzi zapisany wynik albo `already_started`:

```ts
if (session.activityReview !== null) {
  const saved = SessionActivityReviewRecordSchema.safeParse(session.activityReview);
  if (!saved.success) throw new AppError("conflict", { message: "stored session activity review is invalid" });
  return { kind: "stored", review: saved.data } as AcceptancePlan;
}
if (session.activityReviewStartedAt !== null) {
  if (now.getTime() - session.activityReviewStartedAt.getTime() < SESSION_ACTIVITY_REVIEW_DEADLINE_MS) {
    return { kind: "already_started" } as AcceptancePlan;
  }
}
```

Odczyt statusu ma pozostać tylko odczytem trwałego wyniku oraz istniejącym rozstrzygnięciem przekroczonego deadline:

```ts
export async function readSessionActivityResult(services: Services, sessionId: string): Promise<SessionActivityResultDto | null> {
  await resolveInterruptedSessionActivity(services, sessionId);
  const [row] = await services.db.select({ review: learningSessions.activityReview })
    .from(learningSessions).where(eq(learningSessions.id, sessionId));
  if (!row?.review) return null;
  const saved = SessionActivityReviewRecordSchema.safeParse(row.review);
  if (!saved.success) return null;
  return reviewRecordDto(saved.data);
}
```

Zachować `finalizeSessionActivity()` jako jedyne miejsce atomowego zapisu wyniku i podniesienia `rewardPoints` pod blokadą profilu i sesji.

### `packages/server/src/modules/sessions.ts` (service, request-response)

**Analog:** `endSession()` (linie 1413-1427).

Obecna metoda najpierw wywołuje `closeSessionKnowledge()`, a potem dołącza wynik aktywności do HTTP DTO. Zmiana ma rozdzielić przyjęcie raportu od długiego wykonania oceny, pozostawiając tę samą konstrukcję podsumowania:

```ts
const summary = await closeSessionKnowledge(services, sessionId);
if (activityReport !== undefined) {
  const result = await reviewSessionActivity(services, sessionId, activityReport);
  return { ...summary, activity: result };
}
```

Szybka odpowiedź końca sesji nadal opiera się na `closeSessionKnowledge()`. Uruchomienie pracy w tle musi obsłużyć odrzucenie obietnicy, aby nie powstało nieobsłużone odrzucenie.

### `apps/web/src/kid/kid-router.ts` (route, request-response)

**Analog:** `GET /sessions/:id/mock-test-summary` (linie 96-101) i odczyty `profiles`/`decks` (linie 80-92).

Nowy odczyt statusu aktywności ma być gałęzią w `first === "sessions"`, walidować `second` jako UUID na granicy i zwracać JSON z brakiem cache:

```ts
if (request.method === "GET" && second !== undefined && third === "mock-test-summary") {
  const kind = await mockTestKindOfSession(services.db, second);
  const summary = kind === "lesson" ? await readLessonMockTestSummary(services, second) : await readMockTestSummary(services, second);
  return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
}
```

Router ma pozostać cienki: żadnego providera LLM, obliczania punktów ani danych trwałego raportu w handlerze.

### `packages/kid-ui/src/api/KidApi.ts` i `packages/kid-ui/src/api/client.ts` (API interface + HTTP client, request-response)

**Analogi:** `readMockTestSummary()` w interfejsie i kliencie (odpowiednio linie 18-20 i 128-133), `endSession()` (linie 53 oraz 192-198).

Metodę odczytu trzeba dodać do `KidApi` oraz implementować przez wspólny `request()` i `parseWith(SessionActivityResultDtoSchema)`:

```ts
function parseWith<T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }): (body: unknown) => T {
  return (body) => {
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new KidApiError("internal", false);
    return parsed.data;
  };
}
```

Nie stosować szczególnego 45-sekundowego timeoutu `endSession()` do krótkiego `GET` statusu; standardowy limit i walidacja odpowiedzi są właściwym wzorcem.

### `packages/kid-ui/src/session/session-controller.ts` (controller, event-driven + polling)

**Analogi:** `#deliverPendingActivity()` (linie 385-427), `#finishSession()` (linie 668-716) i `refreshProfiles()` (linie 1293-1320).

Kontroler jest właścicielem stanu przez zmianę ekranów i profili. Ochrona przed spóźnioną odpowiedzią używa pary `epoch` oraz aktualnego `childId`:

```ts
if (epoch === this.#epoch && this.#childId === childId) this.#lastActivityResult = summary.activity ?? null;
```

Po zakończeniu odpytywania należy odświeżyć profile przez istniejącą metodę, która zachowuje ostatnie potwierdzone dane podczas błędu sieci:

```ts
} catch { /* Keep the last confirmed balances during a temporary network failure. */ }
```

Zadanie ma przechowywać zarówno `sessionId`, jak i docelowe `childId`; wynik sesji innego dziecka nie może nadpisać widocznego profilu. Nie wolno ponownie używać `endSession()` jako pollingu, bo żądanie zawiera raport i może zmieniać stan.

### `packages/kid-ui/src/screens/SessionActivityResultView.tsx` (component, presentation)

**Analog:** cały komponent (linie 1-15).

Widok pozostaje czystą prezentacją `SessionActivityResultDto | null`:

```tsx
{activity.status === "evaluated"
  ? format(messages.kid.rewardSession, { points: activity.pointsAwarded })
  : activity.status === "already_started"
    ? messages.kid.rewardAlreadyStarted
    : messages.kid.rewardError}
```

Krótkie copy oczekiwania albo dyskretny wskaźnik mają korzystać z `messages`; nie tworzyć osobnego stanu asynchronicznego w komponencie.

### Testy (unit, request-response + event-driven)

**Analogi:**

- `packages/kid-ui/src/session/session-controller.test.ts`, `makeApi()` (linie 193-280): fake `KidApi`, bramki `Promise<void>` i `endActivityResult` umożliwiają sprawdzenie braku blokowania bez realnych timerów sieciowych.
- `packages/kid-ui/src/api/client.test.ts`, test `endSession()` (linie 20-40): sprawdza metodę, URL i serializowany payload przez `fetchImpl`.
- `packages/kid-ui/src/screens/reward-summary.test.tsx`, test `shows the session points...` (linie 65-81): renderuje komponent funkcją `textNodes` i sprawdza tekst dla `evaluated`, `error` oraz `already_started`.
- `packages/server/src/modules/sessions.test.ts`: właściwe miejsce na testy publicznego zachowania końca sesji po rozdzieleniu ścieżki wiedzy i oceny; obecny plik jest śledzonym testem modułu.

Testy powinny użyć obecnego fake API i kontrolowanych bramek, aby potwierdzić: natychmiastowe podsumowanie, pojedyncze uruchomienie oceny, odczyt statusu bez efektów ubocznych, błąd bez punktów oraz aktualizację punktów właściwego dziecka po zmianie profilu.

## Shared Patterns

### Walidacja i prywatne DTO

**Źródła:** `packages/contracts/src/reward-activity.ts:226-238`, `packages/kid-ui/src/api/client.ts:89-105`.

Każdy nowy odczyt Kid API zwraca schemat z `@learning/contracts`, a klient waliduje go przez `safeParse`. Żaden obiekt bazy ani rekord oceny LLM nie przechodzi do Kid UI.

### Routing i brak cache

**Źródło:** `apps/web/src/kid/kid-router.ts:77-101`.

Odczyty Kid API zwracają `Response.json(..., { headers: { "Cache-Control": "no-store" } })`. Mutacje wymagają `assertSameOrigin`; nowy status jest odczytem `GET` i nie powinien uruchamiać dostawcy ani zmieniać punktów.

### Jednorazowość i transakcja punktów

**Źródło:** `packages/server/src/modules/session-activity.ts:362-570`.

Fingerprint raportu, `activityReviewStartedAt`, blokady oraz `finalizeSessionActivity()` są jednym mechanizmem. Rozdzielenie czasu odpowiedzi nie może tworzyć drugiego mechanizmu idempotencji albo osobnej arytmetyki punktów.

### Aktualizacje klienta odporne na zmianę ekranu

**Źródło:** `packages/kid-ui/src/session/session-controller.ts:376-427, 1293-1320`.

Wszystkie asynchroniczne wyniki kontroler wiąże z `#epoch`, `childId` i aktualnym ekranem. Polling aktywności musi przestrzegać tej samej zasady oraz odświeżać `#profiles` wyłącznie przez `refreshProfiles()`.

### Granica MCP i skill Hermesa

**Źródło:** `integrations/umiem-mcp/skills/umiem-learning/SKILL.md` oraz `01-RESEARCH.md`.

Endpoint statusu należy wyłącznie do Kid API. Plan i późniejsze summary mają zapisać sprawdzenie, że nie rozszerza on `learning-overview`, nie eksportuje punktów ani szczegółów oceny i dlatego nie wymaga zmiany MCP lub skilla.

## No Analog Found

Brak. Wszystkie zmieniane warstwy mają bezpośredni, śledzony przez Git analog w bieżącym kodzie.

## Metadata

**Analog search scope:** `packages/contracts/src`, `packages/server/src/modules`, `apps/web/src/kid`, `packages/kid-ui/src`.  
**Files scanned:** 12 śledzonych plików źródłowych i testowych.  
**Pattern extraction date:** 2026-10-21.
