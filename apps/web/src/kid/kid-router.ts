import {
  AppError,
  readMockTestSummary,
  readLessonMockTestSummary,
  readUiAudio,
  mockTestKindOfSession,
  authorizeDisclosure,
  authorizeFeedbackAudio,
  completePresentation,
  endSession,
  listKidDecks,
  listKidProfiles,
  nextTask,
  readAttempt,
  recordEvent,
  startSession,
  submitAttempt,
  submitSpeechAttempt,
  MULTIPART_OVERHEAD_BYTES,
  MAX_AUDIO_BYTES,
  type Services,
} from "@learning/server";
import {
  AttemptInputSchema,
  EventInputSchema,
  SessionInputSchema,
  UuidSchema,
} from "@learning/contracts";
import { readJson } from "@/http/errors";
import { assertSameOrigin } from "@/http/security";
import { readCappedFormData } from "./multipart";

/**
 * Router Kid API pod /api/v1/kid/* (ścieżki wg architecture.md §12). Model
 * zaufany bez autoryzacji dziecka (arch §13); mutacje sprawdzają Origin jak
 * w API rodzica. Odpowiedzi nigdy nie zawierają klucza odpowiedzi ani
 * technicznych score'ów — o tym decydują DTO w @learning/contracts.
 */
export async function handleKidApi(
  request: Request,
  services: Services,
  segments: string[],
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    assertSameOrigin(request);
  }
  const [first, second, third] = segments;

  if (request.method === "GET" && first === "ui-audio" && second === undefined) {
    return Response.json(await readUiAudio(services), { headers: { "Cache-Control": "no-store" } });
  }

  if (request.method === "GET" && first === "profiles" && second === undefined) {
    return Response.json(await listKidProfiles(services));
  }

  if (request.method === "GET" && first === "decks" && second === undefined) {
    const childId = new URL(request.url).searchParams.get("childId");
    if (!childId) {
      throw new AppError("validation");
    }
    return Response.json(await listKidDecks(services, UuidSchema.parse(childId)));
  }

  if (first === "sessions") {
    if (request.method === "GET" && second !== undefined && third === "mock-test-summary") {
      // Lekcja → omówienie per cel; słówka → omówienie słówkowe.
      const kind = await mockTestKindOfSession(services.db, second);
      const summary = kind === "lesson" ? await readLessonMockTestSummary(services, second) : await readMockTestSummary(services, second);
      return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "POST" && second === undefined) {
      const input = SessionInputSchema.parse(await readJson(request));
      return Response.json(await startSession(services, input));
    }
    if (request.method === "POST" && second !== undefined && third === "next") {
      const task = await nextTask(services, second);
      return task === null ? new Response(null, { status: 204 }) : Response.json(task);
    }
    if (request.method === "POST" && second !== undefined && third === "end") {
      return Response.json(await endSession(services, second));
    }
  }

  if (first === "tasks" && second !== undefined) {
    if (request.method === "POST" && third === "events") {
      const input = EventInputSchema.parse({ ...((await readJson(request)) as object), taskId: second });
      await recordEvent(services, input);
      return new Response(null, { status: 204 });
    }
    if (request.method === "POST" && third === "disclosures") {
      const body = (await readJson(request)) as { kind?: string };
      const kind = body.kind === "hint" ? "hint" : body.kind === "audio" ? "audio" : undefined;
      if (kind === undefined) {
        throw new AppError("validation");
      }
      return Response.json(await authorizeDisclosure(services, { taskId: second, kind }));
    }
    if (request.method === "POST" && third === "complete-presentation") {
      const body = (await readJson(request).catch(() => ({}))) as { clientCommandId?: string };
      const clientCommandId = UuidSchema.optional().parse(body.clientCommandId);
      return Response.json(
        await completePresentation(services, {
          taskId: second,
          ...(clientCommandId === undefined ? {} : { clientCommandId }),
        }),
      );
    }
    if (request.method === "POST" && third === "attempts") {
      const contentType = request.headers.get("content-type") ?? "";
      if (contentType.startsWith("multipart/form-data")) {
        // odpowiedź ustna: multipart z bajtami nagrania (arch §11–12); limit
        // strumienia odrzuca nadmiarowy payload przed pełnym buforowaniem
        const form = await readCappedFormData(request, MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES);
        const audio = form.get("audio");
        const clientAttemptId = form.get("clientAttemptId");
        if (!(audio instanceof File) || typeof clientAttemptId !== "string") {
          throw new AppError("validation", { message: "audio file and clientAttemptId are required" });
        }
        const attempt = await submitSpeechAttempt(
          services,
          {
            taskId: second,
            clientAttemptId: UuidSchema.parse(clientAttemptId),
          },
          {
            bytes: new Uint8Array(await audio.arrayBuffer()),
            mimeType: audio.type || "application/octet-stream",
            locale: "en-GB",
          },
          request.signal,
        );
        return Response.json(attempt, { status: attempt.state === "processing" ? 202 : 200 });
      }
      const input = AttemptInputSchema.parse({ ...((await readJson(request)) as object), taskId: second });
      const attempt = await submitAttempt(services, input);
      return Response.json(attempt, { status: attempt.state === "processing" ? 202 : 200 });
    }
  }

  if (request.method === "GET" && first === "attempts" && second !== undefined && third === undefined) {
    return Response.json(await readAttempt(services, second));
  }
  if (request.method === "POST" && first === "attempts" && second !== undefined && third === "feedback-audio") {
    return Response.json(await authorizeFeedbackAudio(services, second), { headers: { "Cache-Control": "no-store" } });
  }

  throw new AppError("not_found");
}
