import {
  AppError,
  authorizeDisclosure,
  completePresentation,
  endSession,
  disableSessionMicrophone,
  nextTask,
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
  SessionEndInputSchema,
  SESSION_ACTIVITY_REPORT_VERSION,
  SESSION_ACTIVITY_REPORT_MAX_BYTES,
  UuidSchema,
} from "@learning/contracts";
import { readJson } from "@/http/errors";
import { assertSameOrigin } from "@/http/security";
import { readCappedFormData } from "./multipart";

/** Odczyt JSON z limitem bajtów — raport aktywności ma twardy sufit rozmiaru. */
async function readCappedJson(request: Request, capBytes: number): Promise<unknown> {
  // Content-Length ponad limit odrzucamy od razu, bez buforowania żądania.
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > capBytes) {
    throw new AppError("validation", { message: "payload exceeds the activity report size limit" });
  }
  const text = await request.text();
  // Brak ciała = koniec sesji bez raportu; nadmiarowy lub zepsuty JSON
  // dostaje jawny błąd walidacji, a nie ciche porzucenie raportu.
  if (text.trim() === "") return null;
  // Limit deklarowany w bajtach — porównujemy bajty UTF-8, nie jednostki UTF-16.
  if (Buffer.byteLength(text, "utf8") > capBytes) {
    throw new AppError("validation", { message: "payload exceeds the activity report size limit" });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError("validation");
  }
}

/**
 * Router Kid API pod /api/v1/kid/* (ścieżki wg architecture.md §12) — część
 * legacy obsługująca mutacje (POST). Odczyty (GET) i odsłuch feedbacku serwuje
 * oRPC (`../orpc/kid-router`) z priorytetem w catch-all. Model zaufany bez
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
      // Opcjonalny raport aktywności: jeden, ograniczony rozmiarem, w znanej
      // wersji formatu. Nieznana wersja wymaga odświeżenia klienta.
      const body = await readCappedJson(request, SESSION_ACTIVITY_REPORT_MAX_BYTES);
      const end = SessionEndInputSchema.safeParse(body ?? {});
      if (!end.success) {
        const version = (body as { activityReport?: { version?: unknown } } | null)?.activityReport?.version;
        if (version !== undefined && version !== SESSION_ACTIVITY_REPORT_VERSION) {
          throw new AppError("validation", { details: { reason: "activity_report_update_required" } });
        }
        throw new AppError("validation");
      }
      return Response.json(await endSession(services, second, end.data.activityReport));
    }
    if (request.method === "POST" && second !== undefined && third === "disable-microphone") {
      return Response.json(await disableSessionMicrophone(services, second));
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

  throw new AppError("not_found");
}
