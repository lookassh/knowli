import {
  AppError,
  authorizeDisclosure,
  completePresentation,
  endSession,
  listKidDecks,
  listKidProfiles,
  nextTask,
  readAttempt,
  recordEvent,
  startSession,
  submitAttempt,
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
      const input = AttemptInputSchema.parse({ ...((await readJson(request)) as object), taskId: second });
      const attempt = await submitAttempt(services, input);
      return Response.json(attempt, { status: attempt.state === "processing" ? 202 : 200 });
    }
  }

  if (request.method === "GET" && first === "attempts" && second !== undefined && third === undefined) {
    return Response.json(await readAttempt(services, second));
  }

  throw new AppError("not_found");
}
