import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppError } from "@learning/server";
import {
  LessonAuthoringDraftDtoSchema,
  LessonCatalogDtoSchema,
  LessonCatalogInputSchema,
  LessonDraftAppendInputSchema,
  LessonDraftAppendResultSchema,
  LessonDraftCreateInputSchema,
  LessonDraftGetInputSchema,
  LessonDraftReplaceInputSchema,
  LessonDraftWriteResultSchema,
  LessonValidateInputSchema,
  LessonValidateResultSchema,
} from "@learning/contracts";
import { z } from "zod";
import { LEARNING_MCP_SERVER_INFO, toolError } from "./learning-mcp-server";

/** Narzędzia tokenu `lessons:write` (`docs/integrations/lesson-authoring.md`). Publikację zawsze robi rodzic w panelu. */
export const LESSON_AUTHORING_TOOLS = {
  catalog: "lesson_catalog",
  validate: "lesson_validate",
  create: "lesson_draft_create",
  get: "lesson_draft_get",
  replace: "lesson_draft_replace",
  append: "lesson_draft_append",
} as const;
export const LESSON_AUTHORING_TOOL_NAMES: ReadonlySet<string> = new Set(Object.values(LESSON_AUTHORING_TOOLS));
/** Zapisy zlecające płatne nagrania TTS: osobny limit na godzinę. */
export const LESSON_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([LESSON_AUTHORING_TOOLS.create, LESSON_AUTHORING_TOOLS.replace, LESSON_AUTHORING_TOOLS.append]);

type Operation = (input: unknown) => Promise<unknown>;
export type LessonAuthoringOperations = Record<keyof typeof LESSON_AUTHORING_TOOLS, Operation>;

const MESSAGES: Record<string, string> = {
  validation: "The input breaks lesson rules or does not fit the lesson; see details.",
  conflict: "The lesson changed meanwhile or a generation run is in progress; read it with lesson_draft_get and try again.",
  not_found: "Lesson not found.",
  forbidden: "This token cannot use lesson authoring.",
  unauthorized: "Bearer authentication required.",
  unavailable: "The service is temporarily unavailable.",
  internal: "The request failed.",
};

/** Kod błędu sterownika; Drizzle opakowuje błąd pg, więc kod bywa na `cause` (jak w `generation-runs.ts`). */
function driverCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code ?? (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === "string" ? code : "";
}

function transient(error: unknown): boolean {
  const code = driverCode(error);
  return code.startsWith("08") || code.startsWith("53") || code.startsWith("57") || code === "ECONNRESET" || code === "ECONNREFUSED";
}

/** Błąd serwera: jedna linia logu z bezpiecznymi metadanymi (bez wejścia narzędzia i tokenu), jak `http/errors.ts`. */
function serverError(code: "unavailable" | "internal", error: unknown, requestId: string, toolName: string) {
  console.error("[mcp]", code, requestId, toolName, driverCode(error) || (error instanceof Error ? error.name : ""));
  return toolError(code, MESSAGES[code]!, code === "unavailable", requestId);
}

/** Błąd przypadku użycia → neutralny błąd narzędzia; `details` tylko przy walidacji (indeksy, reguły, pola). */
function authoringError(error: unknown, requestId: string, toolName: string) {
  if (error instanceof z.ZodError) {
    return toolError("validation", MESSAGES.validation!, false, requestId, { issues: error.issues.map(({ path, message }) => ({ path: path.join("."), message })) });
  }
  if (error instanceof AppError) {
    const code = error.code === "immutable" ? "conflict" : error.code in MESSAGES ? error.code : "internal";
    if (code === "internal") return serverError(code, error, requestId, toolName);
    const details = code === "validation" ? (error.details ?? (error.message === "validation" ? undefined : { message: error.message })) : undefined;
    return toolError(code, MESSAGES[code]!, error.retryable, requestId, details);
  }
  return serverError(transient(error) ? "unavailable" : "internal", error, requestId, toolName);
}

const INPUT_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  [LESSON_AUTHORING_TOOLS.catalog]: LessonCatalogInputSchema,
  [LESSON_AUTHORING_TOOLS.validate]: LessonValidateInputSchema,
  [LESSON_AUTHORING_TOOLS.create]: LessonDraftCreateInputSchema,
  [LESSON_AUTHORING_TOOLS.get]: LessonDraftGetInputSchema,
  [LESSON_AUTHORING_TOOLS.replace]: LessonDraftReplaceInputSchema,
  [LESSON_AUTHORING_TOOLS.append]: LessonDraftAppendInputSchema,
};

/**
 * Argumenty narzędzia autorskiego sprawdzone przed SDK: SDK odrzuca złe wejście własnym tekstem
 * („Input validation error”), a agent ma dostać `validation` w formacie narzędzi (także przy ponad 150 zadaniach).
 * Zwraca błąd narzędzia albo `null`, gdy wejście pasuje do schematu lub narzędzie nie jest autorskie.
 */
export function lessonAuthoringInputError(toolName: string, args: unknown, requestId: string): ReturnType<typeof toolError> | null {
  const schema = INPUT_SCHEMAS[toolName];
  if (!schema) return null;
  const parsed = schema.safeParse(args ?? {});
  return parsed.success ? null : authoringError(parsed.error, requestId, toolName);
}

function register(
  server: McpServer,
  name: string,
  config: { description: string; inputSchema: z.ZodObject; outputSchema: z.ZodObject; readOnly: boolean; idempotent: boolean; destructive?: boolean },
  operation: Operation,
  requestId: string,
): void {
  server.registerTool(name, {
    description: config.description,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    annotations: { readOnlyHint: config.readOnly, destructiveHint: config.destructive === true, idempotentHint: config.idempotent, openWorldHint: false },
  }, async (input: unknown) => {
    let result: unknown;
    try {
      result = await operation(input);
    } catch (error) {
      return authoringError(error, requestId, name);
    }
    // Wyjście spoza listy dozwolonych pól to błąd serwera, nie wejścia agenta.
    const output = config.outputSchema.safeParse(result);
    if (!output.success) return serverError("internal", output.error, requestId, name);
    return { structuredContent: output.data as Record<string, unknown>, content: [{ type: "text" as const, text: JSON.stringify(output.data) }] };
  });
}

export function createLessonAuthoringMcpServer(operations: LessonAuthoringOperations, requestId: string): McpServer {
  const server = new McpServer(LEARNING_MCP_SERVER_INFO);
  const t = LESSON_AUTHORING_TOOLS;
  register(server, t.catalog, {
    description: "Rules for writing an Umiem! lesson: objectives with cards, allowed exercise types and the same rule book, prompt profile, stages, ordering and limits the lesson generator uses. Pass subjectId and topicId for a catalog topic, or deckId for an existing lesson (also one built from the parent's material, such as a school lesson). objectiveIds limits the answer to those objectives: the rule book is repeated per objective and is large. Call it first.",
    inputSchema: LessonCatalogInputSchema, outputSchema: LessonCatalogDtoSchema, readOnly: true, idempotent: true,
  }, operations.catalog, requestId);
  register(server, t.validate, {
    description: "Dry-run validation of a lesson (new, or with deckId against an existing lesson): per-exercise rule issues by array index and field, story errors, coverage gaps and exposure leaks including card sentences. With deckId and append: true the exercises are new ones checked together with the stored pool; indexes then point into the pool after the append (firstNewIndex). Saves nothing and orders no recordings.",
    inputSchema: LessonValidateInputSchema, outputSchema: LessonValidateResultSchema, readOnly: true, idempotent: true,
  }, operations.validate, requestId);
  register(server, t.create, {
    description: "Create a lesson draft without the generator (state review; the parent reviews and publishes it in the panel). deckId = clientRequestId, so a retry returns the same lesson. Orders paid TTS recordings: validate first. Never publishes or assigns.",
    inputSchema: LessonDraftCreateInputSchema, outputSchema: LessonDraftWriteResultSchema, readOnly: false, idempotent: true,
  }, operations.create, requestId);
  register(server, t.get, {
    description: "Read a lesson: its draft, or the published version when there is no draft. Returns the objectives (id, title, cards, allowed exercise types), the lesson material that sourceRefs quotes must come from, and every exercise in full (key, variants, criteria, sources), ready to send back unchanged. Exercise ids are needed to keep a child's history in lesson_draft_replace.",
    inputSchema: LessonDraftGetInputSchema, outputSchema: LessonAuthoringDraftDtoSchema, readOnly: true, idempotent: true,
  }, operations.get, requestId);
  register(server, t.replace, {
    description: "Replace all exercises of a lesson draft (also of a published lesson: a new draft is copied in the same transaction). Keep id from lesson_draft_get for existing exercises; an exercise without id is new and has no history. Fails with conflict on a stale expectedEditNumber or an exercise generation run in progress (a story generation run does not block). Orders paid TTS recordings.",
    inputSchema: LessonDraftReplaceInputSchema, outputSchema: LessonDraftWriteResultSchema, readOnly: false, idempotent: false, destructive: true,
  }, operations.replace, requestId);
  register(server, t.append, {
    description: "Add new exercises (without id) at the end of a lesson's pool without sending the rest (also to a published lesson: a new draft is copied in the same transaction). Stored exercises keep their ids and history; the whole pool is validated after the append and nothing is saved on any error. Returns the new exercise ids. Fails with conflict on a stale expectedEditNumber or an exercise generation run in progress. Orders paid TTS recordings: validate with append: true first.",
    inputSchema: LessonDraftAppendInputSchema, outputSchema: LessonDraftAppendResultSchema, readOnly: false, idempotent: false,
  }, operations.append, requestId);
  return server;
}
