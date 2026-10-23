import type { Router } from "@orpc/server";
import type { ORpcContext } from "./base";

/**
 * Pusty router oRPC Kid API — montowany z priorytetem nad legacy
 * `handleKidApi` w catch-all `/api/v1/kid/[...path]` (wzorzec strangler,
 * migracja oRPC v2). Zero procedur ⇒ `matched === false` dla każdej ścieżki,
 * więc każde żądanie spada niezmienione do routera legacy.
 *
 * Kolejne zadania migracji dopisują tu procedury z kontraktu kid
 * (`kidApiContract`) i usuwają odpowiadające gałęzie z
 * `apps/web/src/kid/kid-router.ts` — ten plik jest punktem montażu.
 */
export const emptyKidORpcRouter: Router<ORpcContext> = {};
