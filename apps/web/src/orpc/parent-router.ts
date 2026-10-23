import type { Router } from "@orpc/server";
import type { ORpcContext } from "./base";

/**
 * Pusty router oRPC API rodzica — montowany z priorytetem nad legacy
 * `handleParentApi` w catch-all `/api/v1/parent/[...path]` (wzorzec
 * strangler, migracja oRPC v2). Zero procedur ⇒ `matched === false` dla
 * każdej ścieżki, więc każde żądanie spada niezmienione do routera legacy.
 *
 * Kolejne zadania migracji dopisują tu procedury z kontraktu parent
 * i usuwają odpowiadające gałęzie z `apps/web/src/parent/parent-router.ts`
 * — ten plik jest punktem montażu.
 */
export const emptyParentORpcRouter: Router<ORpcContext> = {};
