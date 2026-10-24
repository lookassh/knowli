import {
  AppError,
  getMockTestReport,
  listMockTests,
  getLessonMockTestReport,
  listLessonMockTests,
  readDeckKind,
  mockTestKindOfSession,
  createLesson,
  createLessonDraftFromPublished,
  deckIdOfLessonVersion,
  editLessonDraft,
  getProgress,
  lessonCatalog,
  publishLessonDraft,
  readGeneration,
  readLessonDeck,
  lessonObjectiveProgress,
  listLessonVerdicts,
  decideLessonVerdict,
  acceptVerdictAsVariant,
  regenerateObjective,
  retryGeneration,
  upsertAssignment,
  removeAssignment,
  readParentWorkCard,
  type Services,
} from "@learning/server";
import {
  AssignmentPutSchema,
  LessonCommandSchema,
  LessonVerdictDecisionSchema,
  PublishCommandSchema,
} from "@learning/contracts";
import { z } from "zod";
import { readJson } from "@/http/errors";
import { assertSameOrigin, requireParentSession } from "@/http/security";

/**
 * Router API rodzica pod /api/v1/parent/* (ścieżki wg architecture.md §12) —
 * wyłącznie grupy jeszcze niezmigrowane do oRPC (zadanie 11): mock-tests,
 * work-card, lekcje, werdykty, generation, assignments, progress. Profile
 * dzieci (children), zestawy (decks) i szkice (drafts) obsługuje router oRPC
 * `apps/web/src/orpc/parent-router.ts` z priorytetem w catch-all. Każde
 * żądanie sprawdza sesję, mutacje dodatkowo Origin (CSRF).
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
  if (first === "work-card" && request.method === "GET" && second === undefined) {
    const params = new URL(request.url).searchParams;
    const childId = params.get("childId"), date = params.get("date");
    if (!childId) throw new AppError("validation");
    return Response.json(await readParentWorkCard(services, { childId, ...(date === null ? {} : { date }) }), { headers: { "Cache-Control": "no-store" } });
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

  // --- decks/drafts/children: zmigrowane do oRPC (`orpc/parent-router.ts`) ---

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
    if (request.method === "DELETE") {
      await removeAssignment(services, second, third);
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
