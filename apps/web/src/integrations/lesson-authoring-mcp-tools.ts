import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppError, type IntegrationScope } from "@learning/server";
import {
  DeckDraftCreateInputSchema,
  DeckDraftEditInputSchema,
  DeckDraftWriteResultSchema,
  DeckGetInputSchema,
  IllustrationOmitInputSchema,
  IllustrationOmitResultSchema,
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
  MaterialArchiveInputSchema,
  MaterialArchiveResultSchema,
  MaterialListInputSchema,
  MaterialListResultSchema,
  MaterialPublishInputSchema,
  MaterialPublishResultSchema,
  RecordingRegenerateInputSchema,
  RecordingRegenerateResultSchema,
  SourceCreateInputSchema,
  SourceCreateResultSchema,
  SourceGetInputSchema,
  SourceListInputSchema,
  SourceListResultSchema,
  SourceMaterialDtoSchema,
  SourceUpdateInputSchema,
  VocabularyDeckDtoSchema,
} from "@learning/contracts";
import { z } from "zod";
import { LEARNING_MCP_SERVER_INFO, toolError } from "./learning-mcp-server";

/**
 * Narzędzia redagowania materiałów (`docs/integrations/lesson-authoring.md`). Token ma jeden zakres:
 * `lessons:write` — lekcje; `materials:write` — lekcje, zestawy słówek, źródła, nagrania i lista materiałów;
 * `materials:publish` — lista, publikacja i archiwizacja. Token redagujący nie publikuje ani nie archiwizuje,
 * a żaden z tych zakresów nie daje dostępu do dzieci, przypisań, postępów ani ustawień.
 */
export const LESSON_AUTHORING_TOOLS = {
  catalog: "lesson_catalog",
  validate: "lesson_validate",
  create: "lesson_draft_create",
  get: "lesson_draft_get",
  replace: "lesson_draft_replace",
  append: "lesson_draft_append",
  materialList: "material_list",
  deckGet: "deck_get",
  deckCreate: "deck_draft_create",
  deckEdit: "deck_draft_edit",
  sourceList: "source_list",
  sourceGet: "source_get",
  sourceCreate: "source_create",
  sourceUpdate: "source_update",
  recordingRegenerate: "recording_regenerate",
  illustrationOmit: "illustration_omit",
  publish: "material_publish",
  archive: "material_archive",
} as const;
type ToolKey = keyof typeof LESSON_AUTHORING_TOOLS;

type Operation = (input: unknown) => Promise<unknown>;
export type LessonAuthoringOperations = Record<ToolKey, Operation>;

interface ToolDefinition {
  scopes: readonly IntegrationScope[];
  /** Zapis zlecający płatne nagrania albo zmieniający stan materiału: osobny limit na godzinę. */
  write?: true;
  description: string;
  inputSchema: z.ZodObject;
  outputSchema: z.ZodObject;
  readOnly: boolean;
  idempotent: boolean;
  destructive?: true;
}

const LESSONS: readonly IntegrationScope[] = ["lessons:write", "materials:write"];
const WRITE: readonly IntegrationScope[] = ["materials:write"];
const PUBLISH: readonly IntegrationScope[] = ["materials:publish"];

const DEFINITIONS: Record<ToolKey, ToolDefinition> = {
  catalog: {
    scopes: LESSONS,
    description: "Rules for writing an Umiem! lesson: objectives with cards, allowed exercise types and the same rule book, prompt profile, stages, ordering and limits the lesson generator uses. Pass subjectId and topicId for a catalog topic, or deckId for an existing lesson (also one built from the parent's material, such as a school lesson). objectiveIds limits the answer to those objectives: the rule book is repeated per objective and is large. Call it first.",
    inputSchema: LessonCatalogInputSchema, outputSchema: LessonCatalogDtoSchema, readOnly: true, idempotent: true,
  },
  validate: {
    scopes: LESSONS,
    description: "Dry-run validation of a lesson (new, or with deckId against an existing lesson): per-exercise rule issues by array index and field, story errors, coverage gaps and exposure leaks including card sentences. With deckId and append: true the exercises are new ones checked together with the stored pool; indexes then point into the pool after the append (firstNewIndex). Saves nothing and orders no recordings.",
    inputSchema: LessonValidateInputSchema, outputSchema: LessonValidateResultSchema, readOnly: true, idempotent: true,
  },
  create: {
    scopes: LESSONS, write: true,
    description: "Create a lesson draft without the generator (state review; the parent reviews and publishes it in the panel). deckId = clientRequestId, so a retry returns the same lesson. Orders paid TTS recordings: validate first. Never publishes or assigns.",
    inputSchema: LessonDraftCreateInputSchema, outputSchema: LessonDraftWriteResultSchema, readOnly: false, idempotent: true,
  },
  get: {
    scopes: LESSONS,
    description: "Read a lesson: its draft, or the published version when there is no draft. Returns the objectives (id, title, cards, allowed exercise types), the lesson material that sourceRefs quotes must come from, and every exercise in full (key, variants, criteria, sources), ready to send back unchanged. Exercise ids are needed to keep a child's history in lesson_draft_replace.",
    inputSchema: LessonDraftGetInputSchema, outputSchema: LessonAuthoringDraftDtoSchema, readOnly: true, idempotent: true,
  },
  replace: {
    scopes: LESSONS, write: true, destructive: true,
    description: "Replace all exercises of a lesson draft (also of a published lesson: a new draft is copied in the same transaction). Keep id from lesson_draft_get for existing exercises; an exercise without id is new and has no history. Fails with conflict on a stale expectedEditNumber or an exercise generation run in progress (a story generation run does not block). Orders paid TTS recordings.",
    inputSchema: LessonDraftReplaceInputSchema, outputSchema: LessonDraftWriteResultSchema, readOnly: false, idempotent: false,
  },
  append: {
    scopes: LESSONS, write: true,
    description: "Add new exercises (without id) at the end of a lesson's pool without sending the rest (also to a published lesson: a new draft is copied in the same transaction). Stored exercises keep their ids and history; the whole pool is validated after the append and nothing is saved on any error. Returns the new exercise ids. Fails with conflict on a stale expectedEditNumber or an exercise generation run in progress. Orders paid TTS recordings: validate with append: true first.",
    inputSchema: LessonDraftAppendInputSchema, outputSchema: LessonDraftAppendResultSchema, readOnly: false, idempotent: false,
  },
  materialList: {
    scopes: [...WRITE, ...PUBLISH],
    description: "List the family's lessons and vocabulary decks: deckId, title, kind, state, item count, the draft's edit number and whether a published version exists. query filters by a title fragment. Returns no children, assignments or progress.",
    inputSchema: MaterialListInputSchema, outputSchema: MaterialListResultSchema, readOnly: true, idempotent: true,
  },
  deckGet: {
    scopes: WRITE,
    description: "Read a vocabulary deck: its draft, or the published version when there is no draft. Items come in full (source, target translation, acceptedAnswers, locales, example, visual), ready to send back in deck_draft_edit; recordings lists the state of each item's audio and illustration.",
    inputSchema: DeckGetInputSchema, outputSchema: VocabularyDeckDtoSchema, readOnly: true, idempotent: true,
  },
  deckCreate: {
    scopes: WRITE,
    description: "Create an empty vocabulary deck draft (Polish to British English). deckId = clientRequestId, so a retry returns the same deck. Add words with deck_draft_edit. Never publishes or assigns.",
    inputSchema: DeckDraftCreateInputSchema, outputSchema: DeckDraftWriteResultSchema, readOnly: false, idempotent: true,
  },
  deckEdit: {
    scopes: WRITE, write: true, destructive: true,
    description: "Edit a vocabulary deck without sending all of it: an item with id replaces the stored item (send every field from deck_get, changed as needed), an item without id is a new word added at the end, remove deletes items, the rest stays. For a published deck a new draft is copied in the same transaction. The child's history stays with the item id; changing the translation or accepted answers starts new criteria for the affected skills only. Fails with conflict on a stale expectedEditNumber; nothing is saved on any error. Orders the missing paid recordings and illustrations.",
    inputSchema: DeckDraftEditInputSchema, outputSchema: DeckDraftWriteResultSchema, readOnly: false, idempotent: false,
  },
  sourceList: {
    scopes: WRITE,
    description: "List the parent's source materials (pasted chapter texts that lessons and decks are built from): id, title, revision and how many decks use each.",
    inputSchema: SourceListInputSchema, outputSchema: SourceListResultSchema, readOnly: true, idempotent: true,
  },
  sourceGet: {
    scopes: WRITE,
    description: "Read one source material in full: its text, revision and the decks built from it (stale = the text changed after the deck copied it).",
    inputSchema: SourceGetInputSchema, outputSchema: SourceMaterialDtoSchema, readOnly: true, idempotent: true,
  },
  sourceCreate: {
    scopes: WRITE,
    description: "Save a new source material (title and text). A retry with the same clientRequestId and content returns the same source; the same id with other content is a conflict.",
    inputSchema: SourceCreateInputSchema, outputSchema: SourceCreateResultSchema, readOnly: false, idempotent: true,
  },
  sourceUpdate: {
    scopes: WRITE, destructive: true,
    description: "Change the title or text of a source material. expectedRevision is the revision from source_get; a stale one is a conflict. Decks already built keep their own copy of the text.",
    inputSchema: SourceUpdateInputSchema, outputSchema: SourceMaterialDtoSchema, readOnly: false, idempotent: false,
  },
  recordingRegenerate: {
    scopes: WRITE, write: true,
    description: "Order a new take of a recording or illustration in a draft: a vocabulary item (target_audio, example_audio, illustration), a lesson exercise (target_audio, prompt_audio, explanation_audio), an objective card or the lesson story. Works only on a draft (conflict when the deck has none). Paid.",
    inputSchema: RecordingRegenerateInputSchema, outputSchema: RecordingRegenerateResultSchema, readOnly: false, idempotent: false,
  },
  illustrationOmit: {
    scopes: WRITE,
    description: "Decide that a vocabulary item in a draft has no illustration (not allowed in a picture deck).",
    inputSchema: IllustrationOmitInputSchema, outputSchema: IllustrationOmitResultSchema, readOnly: false, idempotent: true,
  },
  publish: {
    scopes: PUBLISH, write: true,
    description: "Publish the draft of a lesson or vocabulary deck, with the same checks as the parent panel (coverage, ready recordings). After publishing children assigned to it learn from the new version. expectedEditNumber is draftEditNumber from material_list. Do it only when the parent asked for it.",
    inputSchema: MaterialPublishInputSchema, outputSchema: MaterialPublishResultSchema, readOnly: false, idempotent: false,
  },
  archive: {
    scopes: PUBLISH, write: true, destructive: true,
    description: "Archive a lesson or vocabulary deck: it leaves new learning sessions, history stays. There is no tool to undo it. Do it only when the parent asked for it.",
    inputSchema: MaterialArchiveInputSchema, outputSchema: MaterialArchiveResultSchema, readOnly: false, idempotent: true,
  },
};

const KEYS = Object.keys(DEFINITIONS) as ToolKey[];
export const LESSON_AUTHORING_TOOL_NAMES: ReadonlySet<string> = new Set(Object.values(LESSON_AUTHORING_TOOLS));
export const LESSON_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set(KEYS.filter((key) => DEFINITIONS[key].write).map((key) => LESSON_AUTHORING_TOOLS[key]));

/** Narzędzia widoczne dla tokenu o danym zakresie; pozostałe dla niego nie istnieją. */
export function authoringToolNames(scope: IntegrationScope): ReadonlySet<string> {
  return new Set(KEYS.filter((key) => DEFINITIONS[key].scopes.includes(scope)).map((key) => LESSON_AUTHORING_TOOLS[key]));
}

const MESSAGES: Record<string, string> = {
  validation: "The input breaks the rules or does not fit the material; see details.",
  conflict: "The material changed meanwhile, has no draft, is not ready, or a generation run is in progress; read it again and retry.",
  not_found: "Not found.",
  forbidden: "This token cannot use this tool.",
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

/** Błąd przypadku użycia → neutralny błąd narzędzia; `details` przy walidacji i konflikcie (indeksy, reguły, pola, braki publikacji). */
function authoringError(error: unknown, requestId: string, toolName: string) {
  if (error instanceof z.ZodError) {
    return toolError("validation", MESSAGES.validation!, false, requestId, { issues: error.issues.map(({ path, message }) => ({ path: path.join("."), message })) });
  }
  if (error instanceof AppError) {
    const code = error.code === "immutable" ? "conflict" : error.code in MESSAGES ? error.code : "internal";
    if (code === "internal") return serverError(code, error, requestId, toolName);
    const details = code === "validation" || code === "conflict"
      ? (error.details ?? (error.message === error.code ? undefined : { message: error.message }))
      : undefined;
    return toolError(code, MESSAGES[code]!, error.retryable, requestId, details);
  }
  return serverError(transient(error) ? "unavailable" : "internal", error, requestId, toolName);
}

const INPUT_SCHEMAS: Readonly<Record<string, z.ZodType>> = Object.fromEntries(KEYS.map((key) => [LESSON_AUTHORING_TOOLS[key], DEFINITIONS[key].inputSchema]));

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

/** Serwer MCP z narzędziami zakresu tokenu. */
export function createLessonAuthoringMcpServer(operations: LessonAuthoringOperations, requestId: string, scope: IntegrationScope): McpServer {
  const server = new McpServer(LEARNING_MCP_SERVER_INFO);
  for (const key of KEYS) {
    const config = DEFINITIONS[key];
    if (!config.scopes.includes(scope)) continue;
    const name = LESSON_AUTHORING_TOOLS[key];
    server.registerTool(name, {
      description: config.description,
      inputSchema: config.inputSchema,
      outputSchema: config.outputSchema,
      annotations: { readOnlyHint: config.readOnly, destructiveHint: config.destructive === true, idempotentHint: config.idempotent, openWorldHint: false },
    }, async (input: unknown) => {
      let result: unknown;
      try {
        result = await operations[key](input);
      } catch (error) {
        return authoringError(error, requestId, name);
      }
      // Wyjście spoza listy dozwolonych pól to błąd serwera, nie wejścia agenta.
      const output = config.outputSchema.safeParse(result);
      if (!output.success) return serverError("internal", output.error, requestId, name);
      return { structuredContent: output.data as Record<string, unknown>, content: [{ type: "text" as const, text: JSON.stringify(output.data) }] };
    });
  }
  return server;
}
