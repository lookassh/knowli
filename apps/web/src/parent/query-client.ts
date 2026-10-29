import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ORPCError } from "@orpc/client";
import { createRouterUtils } from "@orpc/tanstack-query";
import { ApiCallError, parentClient } from "./api";

/**
 * TanStack Query panelu rodzica (plan 2026-10-29-parent-ui-mantine, §3.2).
 *
 * Status HTTP błędu: `ApiCallError` (po `callParent`) albo `ORPCError` wprost
 * z klienta, któremu dekoder koperty w `./api` dokłada `data.status`.
 * Awaria sieci (TypeError) nie ma statusu.
 */
export function httpStatusOf(error: unknown): number | undefined {
  if (error instanceof ApiCallError) return error.status;
  if (error instanceof ORPCError) {
    const status = (error.data as { status?: unknown } | undefined)?.status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

const MAX_QUERY_RETRIES = 2;

/**
 * Odczyty ponawiamy tylko po awarii sieci lub błędzie 5xx — odpowiedź 4xx
 * (sesja, walidacja, brak zasobu) jest ostateczna.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const status = httpStatusOf(error);
  if (status !== undefined && status < 500) return false;
  return failureCount < MAX_QUERY_RETRIES;
}

/**
 * Klient zapytań panelu. Każdy 401 z zapytania lub mutacji woła
 * `onAuthExpired` (powrót do logowania) — jedno miejsce zamiast obsługi
 * per ekran. Mutacje nigdy nie są ponawiane automatycznie: ponowienie
 * polecenia z kluczem idempotencji jest świadomą akcją rodzica.
 */
export function createParentQueryClient(onAuthExpired: () => void): QueryClient {
  const handleError = (error: unknown) => {
    if (httpStatusOf(error) === 401) onAuthExpired();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError: handleError }),
    mutationCache: new MutationCache({ onError: handleError }),
    defaultOptions: {
      queries: { retry: shouldRetryQuery, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

/** Opcje zapytań i mutacji dla każdej procedury Parent API (`orpc.decks.list.queryOptions()` itd.). */
export const orpc = createRouterUtils(parentClient);
