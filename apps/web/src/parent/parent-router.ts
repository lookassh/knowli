import {
  AppError,
  getMockTestReport,
  listMockTests,
  getLessonMockTestReport,
  listLessonMockTests,
  readDeckKind,
  mockTestKindOfSession,
  archiveDeck,
  createEmptyDeck,
  createDraftFromPublished,
  createLesson,
  createLessonDraftFromPublished,
  setDeckCover,
  clearDeckCover,
  deckIdOfLessonVersion,
  editDraft,
  editLessonDraft,
  enqueueDeckGeneration,
  getProgress,
  lessonCatalog,
  listDecks,
  omitRevisionAsset,
  publishDraft,
  publishLessonDraft,
  readDeck,
  readDraft,
  readGeneration,
  readLessonDeck,
  lessonObjectiveProgress,
  listLessonVerdicts,
  decideLessonVerdict,
  acceptVerdictAsVariant,
  regenerateObjective,
  regenerateRevisionAsset,
  retryGeneration,
  upsertAssignment,
  type Services,
} from "@learning/server";
import {
  AssignmentPutSchema,
  CreateEmptyDeckCommandSchema,
  CreateEmptyDeckResultSchema,
  DraftPatchSchema,
  DeckCoverCommandSchema,
  GenerationCommandSchema,
  LessonCommandSchema,
  LessonVerdictDecisionSchema,
  OmitIllustrationSchema,
  PublishCommandSchema,
  RevisionAssetCommandSchema,
} from "@learning/contracts";
import { z } from "zod";
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
  if (first === "mock-tests" && request.method === "GET") {
    if (second) {
      // GET /parent/mock-tests/:sessionId — lekcja → raport per cel; słówka → per skill.
      const kind = await mockTestKindOfSession(services.db, second);
      const report = kind === "lesson" ? await getLessonMockTestReport(services, second) : await getMockTestReport(services, second);
      return Response.json(report, { headers: { "Cache-Control": "no-store" } });
    }
    const params = new URL(request.url).searchParams;
    const childId = params.get("childId"), deckId = params.get("deckId");
    if (!childId || !deckId) throw new AppError("validation");
    const kind = await readDeckKind(services.db, deckId);
    const list = kind === "lesson" ? await listLessonMockTests(services, childId, deckId) : await listMockTests(services, childId, deckId);
    return Response.json(list, { headers: { "Cache-Control": "no-store" } });
  }

  // --- Lekcje (zadanie 11): ścieżki rozłączne z `decks`/`drafts` słówek ---
  if (first === "lesson-catalog" && request.method === "GET" && second === undefined) {
    return Response.json(lessonCatalog(services));
  }

  if (first === "lessons") {
    if (request.method === "POST" && second === undefined) {
      const cmd = LessonCommandSchema.parse(await readJson(request));
      const result = await createLesson(services, cmd);
      return Response.json({ runId: result.runId, deckId: result.deckId }, { status: 202 });
    }
    if (request.method === "GET" && second !== undefined && third === undefined) {
      return Response.json(await readLessonDeck(services, second));
    }
    if (request.method === "GET" && second !== undefined && third === "progress" && fourth === undefined) {
      // GET /parent/lessons/:deckId/progress?childId= → postęp celów lekcji (zadanie 16)
      const childId = new URL(request.url).searchParams.get("childId");
      if (!childId) throw new AppError("validation", { message: "childId is required" });
      return Response.json(await lessonObjectiveProgress(services, second, childId), { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "GET" && second !== undefined && third === "verdicts" && fourth === undefined) {
      // GET /parent/lessons/:deckId/verdicts → werdykty modelu dla ćwiczeń lekcji (zadanie 16)
      return Response.json(await listLessonVerdicts(services, second), { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "POST" && second !== undefined && third === "draft" && fourth === undefined) {
      return Response.json(await createLessonDraftFromPublished(services, second), { status: 201 });
    }
  }

  if (first === "lesson-verdicts" && second !== undefined) {
    if (request.method === "POST" && third === "decision" && fourth === undefined) {
      // POST /parent/lesson-verdicts/:id/decision → decyzja rodzica (zadanie 16)
      const cmd = z.object({ decision: LessonVerdictDecisionSchema }).parse(await readJson(request));
      return Response.json(await decideLessonVerdict(services, second, cmd.decision));
    }
    if (request.method === "POST" && third === "accept-as-variant" && fourth === undefined) {
      // POST /parent/lesson-verdicts/:id/accept-as-variant → dodaj wariant (zadanie 16)
      return Response.json(await acceptVerdictAsVariant(services, second));
    }
  }

  if (first === "lesson-drafts" && second !== undefined) {
    if (request.method === "PATCH" && third === undefined) {
      return Response.json(await editLessonDraft(services, second, await readJson(request)));
    }
    if (request.method === "POST" && third === "publish" && fourth === undefined) {
      const cmd = PublishCommandSchema.parse(await readJson(request));
      return Response.json(await publishLessonDraft(services, second, cmd.expectedEditNumber));
    }
    if (request.method === "POST" && third === "regenerate" && fourth === undefined) {
      const schema = z.object({
        objectiveId: z.string().min(1),
        count: z.number().int().positive(),
        expectedEditNumber: z.number().int().positive(),
        clientRequestId: z.uuid(),
      });
      const cmd = schema.parse(await readJson(request));
      // regenerateObjective bierze deckId, nie versionId: wyznaczamy go z wersji.
      const deckId = await deckIdOfLessonVersion(services, second);
      const result = await regenerateObjective(services, {
        deckId,
        objectiveId: cmd.objectiveId,
        count: cmd.count,
        expectedEditNumber: cmd.expectedEditNumber,
        clientRequestId: cmd.clientRequestId,
      });
      return Response.json({ generationRunId: result.runId, deckId: result.deckId }, { status: 202 });
    }
  }

  if (first === "decks") {
    if (request.method === "GET" && second === undefined) {
      return Response.json(await listDecks(services));
    }
    if (request.method === "POST" && second === "generate") {
      const cmd = GenerationCommandSchema.parse(await readJson(request));
      const result = await enqueueDeckGeneration(services, cmd);
      return Response.json({ generationRunId: result.runId, deckId: result.deckId }, { status: 202 });
    }
    if (request.method === "POST" && second === undefined) {
      const command = CreateEmptyDeckCommandSchema.parse(await readJson(request));
      const result = await createEmptyDeck(services, command);
      const response = CreateEmptyDeckResultSchema.parse({ deckId: result.deckId });
      return Response.json(response, { status: result.created ? 201 : 200 });
    }
    if (request.method === "GET" && second !== undefined && third === undefined) {
      return Response.json(await readDeck(services, second));
    }
    if (second !== undefined && third === "cover" && fourth === undefined) {
      if (request.method === "DELETE") {
        DeckCoverCommandSchema.parse({ action: "clear" });
        await clearDeckCover(services, second);
        return new Response(null, { status: 204 });
      }
      if (request.method === "POST") {
        const mimeType = request.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
        if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) {
          throw new AppError("validation", { message: "Wybierz obraz PNG, JPEG lub WebP." });
        }
        const declaredLength = Number(request.headers.get("content-length") ?? 0);
        if (declaredLength > 5 * 1024 * 1024) throw new AppError("validation", { message: "Obraz musi mieć maksymalnie 5 MB." });
        const reader = request.body?.getReader();
        if (!reader) throw new AppError("validation", { message: "Brak pliku obrazu." });
        const chunks: Uint8Array[] = [];
        let length = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 5 * 1024 * 1024) {
            await reader.cancel();
            throw new AppError("validation", { message: "Obraz musi mieć maksymalnie 5 MB." });
          }
          chunks.push(value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const assetId = await setDeckCover(services, second, { bytes, declaredMimeType: mimeType });
        return Response.json({ coverAssetId: assetId });
      }
    }
    if (request.method === "POST" && second !== undefined && third === "draft" && fourth === undefined) {
      // nowy edytowalny szkic z bieżącej opublikowanej wersji (architecture.md §12)
      return Response.json(await createDraftFromPublished(services, second), { status: 201 });
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
      await upsertAssignment(services, second, third, cmd.testDate, cmd);
      return new Response(null, { status: 204 });
    }
  }

  if (first === "progress" && second === undefined && request.method === "GET") {
    // GET /api/v1/parent/progress?childId=&deckId= (architecture.md §12)
    const childId = new URL(request.url).searchParams.get("childId");
    const deckId = new URL(request.url).searchParams.get("deckId");
    if (!childId || !deckId) {
      throw new AppError("validation", { message: "childId and deckId are required" });
    }
    return Response.json(await getProgress(services, childId, deckId));
  }

  throw new AppError("not_found");
}
