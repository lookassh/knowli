import { kidApiContract } from "@learning/contracts";
import { OpenAPIGenerator } from "@orpc/openapi";

/**
 * Read-only spec OpenAPI Kid API (arch §12), generowana w runtime z tego
 * samego `kidApiContract`, który obsługują handler oRPC i klient kid-ui —
 * jeden kontrakt, jedno źródło prawdy o ścieżkach, statusach i DTO.
 *
 * Świadomy zakres: TYLKO Kid API. Kontrakt Parent API
 * (`apps/web/src/parent/orpc-contract.ts`) jest wewnętrzny dla procesu web
 * (detale set-cookie, bootstrapu auth i wewnętrznych błędów), a kontrakt
 * integracji `learning-overview` ma własny, wersjonowany JSON Schema
 * w `integrations/umiem-mcp/` — żaden z nich nie trafia do tej speki.
 *
 * Znane ograniczenie (beta.45): procedura `tasks.attempts` ma wejście jako
 * unię (JSON `AttemptInput` albo multipart z nagraniem) w trybie compact.
 * Generator OpenAPI nie potrafi w tym trybie pobrać parametru ścieżki
 * `{taskId}` z unii (`OpenAPIGeneratorError`: "no object schema to source
 * them from") i cała generacja pada — dlatego procedura jest wyłączona
 * jawnym `filter` (dokumentowane rozszerzenie generatora), a endpoint
 * pozostaje na wire bez zmian. Nie zniekształcamy kontraktu pod spekę.
 * Ten sam błąd generator zgłasza dla `tasks.dictation` (multipart z `File`
 * i parametrem `{taskId}`, Etap 3 szkoły) — wyłączony tak samo.
 */
const EXCLUDED_PROCEDURES: ReadonlySet<string> = new Set(["tasks.attempts", "tasks.dictation"]);

const generator = new OpenAPIGenerator();

/** Generacja jest czysta i deterministiczna — memoizowana per proces. */
let specPromise: Promise<unknown> | undefined;

function kidOpenApiSpec(): Promise<unknown> {
  specPromise ??= generator.generate(kidApiContract, {
    base: {
      info: { title: "Umiem! Kid API", version: "1.0.0" },
      // Kontrakt trzyma ścieżki bez prefixu montowania; handler dokleja
      // /api/v1/kid, więc speka resolvuje pełne adresy przez serwer bazowy.
      servers: [{ url: "/api/v1/kid" }],
    },
    filter: (_procedure, path) => !EXCLUDED_PROCEDURES.has(path.join(".")),
  });
  return specPromise;
}

/** Spec OpenAPI Kid API; bez autoryzacji jak cały Kid API (arch §13). */
export async function GET(): Promise<Response> {
  const spec = await kidOpenApiSpec();
  return Response.json(spec, { headers: { "cache-control": "no-store" } });
}
