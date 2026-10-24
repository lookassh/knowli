import { z } from "zod";
import { LearningOverviewDtoSchema, LearningOverviewQuerySchema, type LearningOverviewQuery } from "@learning/contracts";
import { AppError, getLearningOverview, type IntegrationPrincipal, type Services } from "@learning/server";
import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { implement, type Middleware, type Router } from "@orpc/server";
import { appErrorMiddleware } from "../orpc/base";
import { createOpenApiHandler } from "../orpc/handler";
import { errorResponse } from "../http/errors";
import { IntegrationReadLimiter, learningOverviewLimiter } from "./integration-read-limiter";

/**
 * Procedura oRPC `GET /api/v1/integrations/learning-overview` — kontrakt+
 * implementacja + montaż endpointu raportu rodzinnego dla Hermesa. Migracja
 * z ręcznego handlera (`learning-overview-route.ts`, zdekomisjonowany):
 * kontrakt na wire pozostaje bajt w bajt — ścieżka, Bearer, koperta błędów
 * `{code, message, retryable, requestId}`, nagłówek `Cache-Control:
 * no-store, max-age=0` (też na błędach), `Retry-After` przy 429 i DTO
 * produkowane przez TEN SAM przypadek użycia `getLearningOverview`, którego
 * używa serwer MCP. Kontrakt jest wewnętrzny dla apps/web (jak
 * `parent/orpc-contract.ts`) — Hermes jest klientem HTTP, nie kontraktu.
 */

/** Pełny prefix montowania procedury (doklejany przy `handle`). */
const LEARNING_OVERVIEW_PREFIX = "/api/v1/integrations";

/**
 * Query endpointu w formie nadawczej: wartości przychodzą jako stringi
 * (spike v2 — kodek OpenAPI nie JSON-parsuje query), a `days`/
 * `upcomingTestDays` dekoduje `Number(...)` — dokładnie jak legacy
 * `parseQuery`. Schematy pól (bounds + domyślne 7/14 + UUID) pochodzą z
 * `LearningOverviewQuerySchema`, więc granica nie duplikuje reguł.
 * Duplikat klucza (`days=3&days=4`) dekoduje się do tablicy i pada na
 * walidacji — jak w legacy; `z.strictObject` odrzuca nieznane klucze.
 */
const LearningOverviewWireQuerySchema = z.strictObject({
  days: z.preprocess((value) => (value === undefined ? value : Number(value)), LearningOverviewQuerySchema.shape.days),
  upcomingTestDays: z.preprocess((value) => (value === undefined ? value : Number(value)), LearningOverviewQuerySchema.shape.upcomingTestDays),
  childId: LearningOverviewQuerySchema.shape.childId,
});

/** Odpowiedź 200 z wymuszonym brakiem cache (regresja R04) — jak legacy. */
const LearningOverviewDetailedOutputSchema = z.object({
  status: z.number().int().min(200).max(399).optional(),
  headers: z.object({ "cache-control": z.literal("no-store, max-age=0") }).loose(),
  body: LearningOverviewDtoSchema,
});

/** Kontrakt pojedynczej procedury (metoda GET; inne metody → not_found). */
export const learningOverviewContract = {
  learningOverview: oc
    .input(LearningOverviewWireQuerySchema)
    .output(LearningOverviewDetailedOutputSchema)
    .meta(openapi({ method: "GET", path: "/learning-overview", outputStructure: "detailed" })),
};

/**
 * Stan per żądanie tworzony przez `handleLearningOverviewRequest`: procedura
 * zapisuje tu zautoryzowany principal i wyliczone `Retry-After`, bo koperta
 * błędu oRPC (`encodeError`) nie ma dostępu do nagłówków odpowiedzi błędu.
 * Stabilna referencja w kontekście przetrwa scalanie kontekstu oRPC.
 */
export interface LearningOverviewRequestState {
  principal?: IntegrationPrincipal;
  retryAfterSeconds?: number;
}

/** Kontekst handlera oRPC learning-overview (bez sesji rodzica — patrz bearer). */
export interface LearningOverviewContext {
  services: Services;
  headers: Headers;
  /** Pełny adres żądania (spójny kontekst bazowy oRPC; nieużywany bezpośrednio). */
  url: string;
  /** Współdzielony limit z endpointem MCP; domyślnie singleton `learningOverviewLimiter`. */
  limiter: IntegrationReadLimiter;
  state: LearningOverviewRequestState;
}

/** Pole kontekstu doklejane przez `bearerMiddleware`. */
export interface LearningOverviewBearerContext {
  bearerToken: string;
}

/**
 * Autoryzacja Bearer endpointu integracji (token `learning:read` z bazy,
 * weryfikowany w `getLearningOverview`) — NIE sesja rodzica, więc ten
 * middleware celowo nie komponuje `parentSessionMiddleware`. Semantyka
 * legacy: nagłówek musi pasować do `^Bearer ([^\s]+)$`, inaczej 401 bez
 * odczytu query. Middleware implementera działa PRZED walidacją inputu,
 * więc — jak w legacy — brak/zepty Bearer wygrywa z błędem query (401 > 400).
 */
const bearerMiddleware: Middleware<
  LearningOverviewContext,
  LearningOverviewBearerContext,
  unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- zgodnie z generykami buildera ($Output = any)
  any,
  Record<never, never>
> = async ({ context, next }) => {
  const authorization = context.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  if (!match) throw new AppError("unauthorized");
  return next({ context: { bearerToken: match[1]! } });
};

const learningOverviewImplementer = implement({ learningOverview: learningOverviewContract.learningOverview })
  .$context<LearningOverviewContext>()
  // appError zewnętrznie (konwersja AppError→ORPCError), bearer wewnętrznie —
  // oba na implementerze, przed walidacją inputu (kolejność błędów jak legacy).
  .use(appErrorMiddleware)
  .use(bearerMiddleware);

const learningOverview = learningOverviewImplementer.learningOverview.handler(async ({ context, input }) => {
  const query = input as LearningOverviewQuery;
  try {
    const payload = await getLearningOverview(context.services, query, context.bearerToken, (authenticated) => {
      // Principal zapisany PRZED consume — potrzebny w catch do Retry-After (jak legacy).
      context.state.principal = authenticated;
      context.limiter.consume(authenticated, context.services.clock.now().getTime());
    });
    return { headers: { "cache-control": "no-store, max-age=0" }, body: payload };
  } catch (error) {
    if (error instanceof AppError && error.code === "rate_limited" && context.state.principal) {
      context.state.retryAfterSeconds = context.limiter.retryAfterSeconds(
        context.state.principal,
        context.services.clock.now().getTime(),
      );
    }
    // Port klasyfikacji z legacy `failure()`: awarie sterownika Postgresa
    // (klasy 08/53/57, zerwane połączenie) → learning_summary_unavailable/503
    // zamiast internal/500; surowy SQL nigdy nie trafia do odpowiedzi.
    if (!(error instanceof AppError)) {
      const driverCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
      if (/^(08|53|57)/.test(driverCode) || driverCode === "ECONNRESET" || driverCode === "ECONNREFUSED") {
        throw new AppError("learning_summary_unavailable");
      }
    }
    throw error;
  }
});

export const learningOverviewRouter: Router<LearningOverviewContext> =
  learningOverviewImplementer.router({ learningOverview });

// Handler budowany raz per proces (module scope); Services trafiają per
// żądanie przez kontekst przekazywany do `handle`.
const learningOverviewHandler = createOpenApiHandler(learningOverviewRouter);

/**
 * Odtwarza nagłówki błędów legacy: `Cache-Control: no-store, max-age=0` na
 * każdej odpowiedzi błędowej (kodek oRPC ustawia puste nagłówki błędów) oraz
 * `Retry-After` przy 429 rate_limited. Ciało (koperta z encodera lub
 * `errorResponse`) pozostaje nietknięte.
 */
function decorateError(response: Response, state: LearningOverviewRequestState): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store, max-age=0");
  if (response.status === 429 && state.retryAfterSeconds !== undefined) {
    headers.set("retry-after", String(state.retryAfterSeconds));
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * Pełny dispatch endpointu `/api/v1/integrations/learning-overview` —
 * następca `handleLearningOverviewRequest` z `learning-overview-route.ts`.
 * Metoda/ścieżka spoza kontraktu (`matched === false`, np. POST/HEAD) →
 * `AppError("not_found")` i koperta 404, dokładnie jak legacy dispatch;
 * odpowiedzi błędowe (z oRPC i spoza niego) dostają nagłówki `decorateError`.
 */
export async function handleLearningOverviewRequest(
  request: Request,
  services: Services,
  limiter: IntegrationReadLimiter = learningOverviewLimiter,
): Promise<Response> {
  const state: LearningOverviewRequestState = {};
  try {
    const { matched, response } = await learningOverviewHandler.handle(request, {
      prefix: LEARNING_OVERVIEW_PREFIX,
      context: { services, headers: request.headers, url: request.url, state, limiter },
    });
    if (matched) {
      return response.ok ? response : decorateError(response, state);
    }
    throw new AppError("not_found");
  } catch (error) {
    return decorateError(errorResponse(error), state);
  }
}
