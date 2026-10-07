import {
  AppError,
  archiveDeck,
  editDraft,
  enqueueDeckGeneration,
  listDecks,
  omitRevisionAsset,
  publishDraft,
  readDeck,
  readDraft,
  readGeneration,
  regenerateRevisionAsset,
  retryGeneration,
  upsertAssignment,
  type Services,
} from "@learning/server";
import {
  AssignmentPutSchema,
  DraftPatchSchema,
  GenerationCommandSchema,
  OmitIllustrationSchema,
  PublishCommandSchema,
  RevisionAssetCommandSchema,
} from "@learning/contracts";
import { readJson } from "@/http/errors";
import { assertSameOrigin, requireParentSession } from "@/http/security";

/**
 * Router API rodzica pod /api/v1/parent/* (ścieżki wg architecture.md §12;
 * profile dzieci obsługują własne trasy). Każde żądanie sprawdza sesję,
 * mutacje dodatkowo Origin (CSRF).
 */
export async function handleParentApi(
  request: Request,
  services: Services,
  segments: string[],
): Promise<Response> {
  await requireParentSession(request, services);
  if (request.method !== "GET" && request.method !== "HEAD") {
    assertSameOrigin(request);
  }
  const [first, second, third, fourth] = segments;

  if (first === "decks") {
    if (request.method === "GET" && second === undefined) {
      return Response.json(await listDecks(services));
    }
    if (request.method === "POST" && second === "generate") {
      const cmd = GenerationCommandSchema.parse(await readJson(request));
      const result = await enqueueDeckGeneration(services, cmd);
      return Response.json({ generationRunId: result.runId, deckId: result.deckId }, { status: 202 });
    }
    if (request.method === "GET" && second !== undefined && third === undefined) {
      return Response.json(await readDeck(services, second));
    }
    if (request.method === "POST" && second !== undefined && third === "archive" && fourth === undefined) {
      await archiveDeck(services, second);
      return new Response(null, { status: 204 });
    }
  }

  if (first === "drafts" && second !== undefined) {
    if (request.method === "GET" && third === undefined) {
      return Response.json(await readDraft(services, second));
    }
    if (request.method === "PATCH" && third === undefined) {
      const patch = DraftPatchSchema.parse(await readJson(request));
      return Response.json(await editDraft(services, second, patch));
    }
    if (request.method === "POST" && third === "publish" && fourth === undefined) {
      const cmd = PublishCommandSchema.parse(await readJson(request));
      return Response.json(await publishDraft(services, second, cmd.expectedEditNumber));
    }
    if (request.method === "POST" && third === "assets" && fourth === "regenerate") {
      const cmd = RevisionAssetCommandSchema.parse(await readJson(request));
      const result = await regenerateRevisionAsset(services, { draftId: second, ...cmd });
      return Response.json(result, { status: 202 });
    }
    if (request.method === "POST" && third === "assets" && fourth === "omit") {
      const cmd = OmitIllustrationSchema.parse(await readJson(request));
      await omitRevisionAsset(services, { draftId: second, ...cmd });
      return new Response(null, { status: 204 });
    }
  }

  if (first === "generation" && second !== undefined) {
    if (request.method === "GET" && third === undefined) {
      return Response.json(await readGeneration(services, second));
    }
    if (request.method === "POST" && third === "retry" && fourth === undefined) {
      return Response.json(await retryGeneration(services, second));
    }
  }

  if (first === "assignments" && second !== undefined && third !== undefined && fourth === undefined) {
    if (request.method === "PUT") {
      const cmd = AssignmentPutSchema.parse(await readJson(request));
      await upsertAssignment(services, second, third, cmd.testDate);
      return new Response(null, { status: 204 });
    }
  }

  throw new AppError("not_found");
}
