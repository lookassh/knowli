import {
  AppError,
  authorizeDisclosure,
  completePresentation,
  recordEvent,
  submitAttempt,
  submitSpeechAttempt,
  MULTIPART_OVERHEAD_BYTES,
  MAX_AUDIO_BYTES,
  type Services,
} from "@learning/server";
import {
  AttemptInputSchema,
  EventInputSchema,
  UuidSchema,
} from "@learning/contracts";
import { readJson } from "@/http/errors";
import { assertSameOrigin } from "@/http/security";
import { readCappedFormData } from "./multipart";

/**
 * Router Kid API pod /api/v1/kid/* (ścieżki wg architecture.md §12) — część
 * legacy obsługująca mutacje zadań (POST /tasks/*). Odczyty (GET), odsłuch
 * feedbacku i mutacje sesji (POST /sessions/*) serwuje oRPC
 * (`../orpc/kid-router`) z priorytetem w catch-all. Model zaufany bez
 * autoryzacji dziecka (arch §13); mutacje sprawdzają Origin jak w API rodzica.
 * Odpowiedzi nigdy nie zawierają klucza odpowiedzi ani technicznych score'ów —
 * o tym decydują DTO w @learning/contracts.
 */
export async function handleKidApi(
  request: Request,
  services: Services,
  segments: string[],
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    assertSameOrigin(request);
  }
  const [first, second, ...thirdParts] = segments;
  const third = thirdParts.join("/");

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

  throw new AppError("not_found");
}
