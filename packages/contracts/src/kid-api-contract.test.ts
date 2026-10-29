import { describe, expect, it } from "vitest";
import { getOpenAPIMeta } from "@orpc/openapi";
import type { AnyProcedureContract } from "@orpc/contract";
import {
  CompletePresentationInputSchema,
  DisclosureKindSchema,
  FeedbackAudioPathSchema,
  KidDecksQuerySchema,
  SpeechAttemptMultipartInputSchema,
  kidApiContract,
} from "./kid-api-contract";

const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";
const INSTANT = "2026-10-23T10:00:00Z";

interface ZodLike {
  safeParse(value: unknown): { success: boolean };
}

/** Schemat wejścia procedury — kontrakt kid woła `.input()` dokładnie raz. */
function inputOf(proc: unknown): ZodLike {
  const schemas = (proc as { "~orpc"?: { inputSchemas?: unknown[] } })["~orpc"]?.inputSchemas;
  if (!schemas || schemas.length !== 1) throw new Error("procedura musi mieć dokładnie jeden schemat wejścia");
  return schemas[0] as ZodLike;
}

/** Schemat wyjścia procedury — kontrakt kid woła `.output()` dokładnie raz. */
function outputOf(proc: unknown): ZodLike {
  const schemas = (proc as { "~orpc"?: { outputSchemas?: unknown[] } })["~orpc"]?.outputSchemas;
  if (!schemas || schemas.length !== 1) throw new Error("procedura musi mieć dokładnie jeden schemat wyjścia");
  return schemas[0] as ZodLike;
}

/** Meta openapi procedury (method/path/statusy/struktury) — zawsze ustawione. */
function metaOf(proc: unknown) {
  return getOpenAPIMeta(proc as AnyProcedureContract)!;
}

/** Globalny `File` bez zależności testu od lib.dom (Node ≥ 20 ma go wbudowany). */
const newFile = new (globalThis as unknown as {
  File: new (bits: readonly number[], name: string, options?: { type?: string }) => unknown;
}).File([1, 2, 3], "recording.webm", { type: "audio/webm" });

// Przykłady DTO zgodne z istniejącymi schematami — pełne okrążenie kontraktu
// bez zależności od serwera (kid-ui importuje kontrakt bezpośrednio).
const taskDto = {
  taskId: UUID, sessionId: UUID2, ordinal: 0, exerciseType: "recall",
  direction: null, state: "issued", prompt: { kind: "recall", prompt: "kot" },
  remainingAssessed: 3,
};
const sessionDto = {
  mode: "training", sessionId: UUID, childId: UUID2, deckId: UUID2,
  deckVersionId: UUID, policyId: "policy-1", microphoneEnabled: true,
  canRead: true, vocabularyFormat: "standard", state: "active",
  taskBudget: 10, tasksIssued: 0, assessedTasksIssued: 0,
  startedAt: INSTANT, resumed: false,
};
const attemptDto = {
  attemptId: UUID, taskId: UUID2, state: "completed", modality: "text",
  feedback: null, taskState: "answered", stepId: "s1",
  receivedAt: INSTANT, completedAt: INSTANT,
};
const processingAttemptDto = { ...attemptDto, attemptId: UUID2, state: "processing", completedAt: null };

describe("kształt routera kontraktu kid API", () => {
  it("odzwierciedla segmenty URL: uiAudio, profiles, decks, sessions, tasks, attempts", () => {
    expect(Object.keys(kidApiContract).sort()).toEqual(["attempts", "decks", "profiles", "sessions", "tasks", "uiAudio"]);
    expect(Object.keys(kidApiContract.sessions).sort()).toEqual([
      "activityResult", "create", "disableMicrophone", "end", "mockTestSummary", "next",
    ]);
    expect(Object.keys(kidApiContract.tasks).sort()).toEqual([
      "attempts", "completePresentation", "dictation", "disclosures", "events",
    ]);
    expect(Object.keys(kidApiContract.attempts).sort()).toEqual(["feedbackAudio", "get"]);
  });
});

describe("GET ui-audio / profiles / decks", () => {
  it("ui-audio: GET /ui-audio, szczegółowe wyjście z no-store", () => {
    const meta = metaOf(kidApiContract.uiAudio);
    expect(meta.method).toBe("GET");
    expect(meta.path).toBe("/ui-audio");
    expect(meta.outputStructure).toBe("detailed");
    const out = outputOf(kidApiContract.uiAudio);
    expect(out.safeParse({ headers: { "cache-control": "no-store" }, body: { ready: true, assets: {} } }).success).toBe(true);
    // Brak nagłówka no-store musi złapać walidację wyjścia — regresja R04.
    expect(out.safeParse({ body: { ready: true, assets: {} } }).success).toBe(false);
  });

  it("profiles: GET /profiles, szczegółowe wyjście z no-store", () => {
    const meta = metaOf(kidApiContract.profiles);
    expect(meta.method).toBe("GET");
    expect(meta.path).toBe("/profiles");
    expect(meta.outputStructure).toBe("detailed");
    const profile = {
      childId: UUID, displayName: "Ala", avatarKey: "cat", recordingMode: "hold",
      canRead: true, rewardPoints: 0,
    };
    expect(outputOf(kidApiContract.profiles).safeParse({
      headers: { "cache-control": "no-store" }, body: [profile],
    }).success).toBe(true);
  });

  it("decks: GET /decks, stringbool w query przyjmuje tylko prawdziwe wartości", () => {
    const meta = metaOf(kidApiContract.decks);
    expect(meta.method).toBe("GET");
    expect(meta.path).toBe("/decks");
    expect(meta.outputStructure).toBe("detailed");
    // Query przychodzi jako string — spike v2: liście nie są JSON-parsowane.
    expect(KidDecksQuerySchema.safeParse({ childId: UUID, microphoneEnabled: "true" }).success).toBe(true);
    expect(KidDecksQuerySchema.safeParse({ childId: UUID, microphoneEnabled: "false" }).success).toBe(true);
    expect(KidDecksQuerySchema.safeParse({ childId: UUID }).success).toBe(true);
    expect(KidDecksQuerySchema.safeParse({ childId: UUID, microphoneEnabled: "abc" }).success).toBe(false);
    expect(KidDecksQuerySchema.safeParse({ microphoneEnabled: "true" }).success).toBe(false);
    expect(inputOf(kidApiContract.decks)).toBe(KidDecksQuerySchema);
    const deck = {
      deckId: UUID, title: "Zwierzęta", itemCount: 10, independentlyRecalledCount: 2,
      testDate: null, recommended: false,
    };
    expect(outputOf(kidApiContract.decks).safeParse({
      headers: { "cache-control": "no-store" }, body: [deck],
    }).success).toBe(true);
  });
});

describe("sesje", () => {
  it("create: POST /sessions, wejście SessionInput, wyjście SessionDto (200)", () => {
    const meta = metaOf(kidApiContract.sessions.create);
    expect(meta.method).toBe("POST");
    expect(meta.path).toBe("/sessions");
    expect(meta.successStatus ?? 200).toBe(200);
    expect(meta.outputStructure).toBeUndefined();
    expect(inputOf(kidApiContract.sessions.create).safeParse({
      childId: UUID, deckId: UUID2, microphoneEnabled: true,
    }).success).toBe(true);
    expect(outputOf(kidApiContract.sessions.create).safeParse(sessionDto).success).toBe(true);
  });

  it("next: POST /sessions/{sessionId}/next, dynamiczny 200 z zadaniem albo 204 puste", () => {
    const meta = metaOf(kidApiContract.sessions.next);
    expect(meta.method).toBe("POST");
    expect(meta.path).toBe("/sessions/{sessionId}/next");
    expect(meta.successStatus).toBe(204);
    expect(meta.outputStructure).toBe("detailed");
    const out = outputOf(kidApiContract.sessions.next);
    expect(out.safeParse({ status: 200, body: taskDto }).success).toBe(true);
    expect(out.safeParse({ status: 204, body: undefined }).success).toBe(true);
    // Inne statusy niż dzisiejsze 200/204 nie przechodzą.
    expect(out.safeParse({ status: 202, body: taskDto }).success).toBe(false);
    expect(inputOf(kidApiContract.sessions.next).safeParse({ sessionId: UUID }).success).toBe(true);
    expect(inputOf(kidApiContract.sessions.next).safeParse({ sessionId: "not-a-uuid" }).success).toBe(false);
  });

  it("end: POST /sessions/{sessionId}/end, opcjonalny raport aktywności w ciele", () => {
    const meta = metaOf(kidApiContract.sessions.end);
    expect(meta.method).toBe("POST");
    expect(meta.path).toBe("/sessions/{sessionId}/end");
    expect(meta.successStatus ?? 200).toBe(200);
    const input = inputOf(kidApiContract.sessions.end);
    expect(input.safeParse({ sessionId: UUID }).success).toBe(true);
    expect(input.safeParse({
      sessionId: UUID,
      activityReport: {
        version: 1, elapsedMs: 1000, activeMs: 500, compacted: false,
        tasks: [{
          taskId: UUID2, exerciseType: "recall", shownFromMs: 0, shownToMs: 1000,
          activeIntervals: [[0, 500]], editCount: 0, editWindows: [],
          submittedAttempts: [], playbacks: [], pauses: [],
        }],
      },
    }).success).toBe(true);
    const summary = {
      sessionId: UUID, state: "completed" as const, tasksIssued: 3, assessedTasksIssued: 3,
      endedAt: INSTANT, independentSuccesses: { recall: 1, spelling: 0 }, practiceItems: [],
    };
    expect(outputOf(kidApiContract.sessions.end).safeParse(summary).success).toBe(true);
  });

  it("disableMicrophone: POST /sessions/{sessionId}/disable-microphone, wyjście SessionDto", () => {
    const meta = metaOf(kidApiContract.sessions.disableMicrophone);
    expect(meta.method).toBe("POST");
    expect(meta.path).toBe("/sessions/{sessionId}/disable-microphone");
    expect(meta.successStatus ?? 200).toBe(200);
    expect(inputOf(kidApiContract.sessions.disableMicrophone).safeParse({ sessionId: UUID }).success).toBe(true);
    expect(outputOf(kidApiContract.sessions.disableMicrophone).safeParse(sessionDto).success).toBe(true);
  });

  it("activityResult: GET /sessions/{sessionId}/activity-result, 200 z no-store", () => {
    const meta = metaOf(kidApiContract.sessions.activityResult);
    expect(meta.method).toBe("GET");
    expect(meta.path).toBe("/sessions/{sessionId}/activity-result");
    expect(meta.outputStructure).toBe("detailed");
    expect(outputOf(kidApiContract.sessions.activityResult).safeParse({
      headers: { "cache-control": "no-store" },
      body: { status: "evaluated", pointsAwarded: 2, errorCode: null },
    }).success).toBe(true);
    expect(outputOf(kidApiContract.sessions.activityResult).safeParse({
      body: { status: "evaluated", pointsAwarded: 2, errorCode: null },
    }).success).toBe(false);
  });

  it("mockTestSummary: GET /sessions/{sessionId}/mock-test-summary, unia słówek i lekcji", () => {
    const meta = metaOf(kidApiContract.sessions.mockTestSummary);
    expect(meta.method).toBe("GET");
    expect(meta.path).toBe("/sessions/{sessionId}/mock-test-summary");
    expect(meta.outputStructure).toBe("detailed");
    const out = outputOf(kidApiContract.sessions.mockTestSummary);
    expect(out.safeParse({
      headers: { "cache-control": "no-store" },
      body: { sessionId: UUID, deckId: UUID2, state: "ended", complete: true, taskBudget: 5, answeredCount: 5, solutions: [] },
    }).success).toBe(true);
    expect(out.safeParse({
      headers: { "cache-control": "no-store" },
      body: {
        sessionId: UUID, deckId: UUID2, state: "ended", complete: true, taskBudget: 4,
        answeredCount: 4, solutions: [],
      },
    }).success).toBe(true);
  });
});

describe("zadania", () => {
  it("events: POST /tasks/{taskId}/events, 204 bez ciała odpowiedzi", () => {
    const meta = metaOf(kidApiContract.tasks.events);
    expect(meta.method).toBe("POST");
    expect(meta.path).toBe("/tasks/{taskId}/events");
    expect(meta.successStatus).toBe(204);
    expect(meta.outputStructure).toBeUndefined();
    expect(outputOf(kidApiContract.tasks.events).safeParse(undefined).success).toBe(true);
    expect(inputOf(kidApiContract.tasks.events).safeParse({
      taskId: UUID, clientEventId: UUID2, kind: "display_confirmed",
    }).success).toBe(true);
  });

  it("disclosures: POST /tasks/{taskId}/disclosures, kind ograniczony do hint/audio", () => {
    const meta = metaOf(kidApiContract.tasks.disclosures);
    expect(meta.method).toBe("POST");
    expect(meta.path).toBe("/tasks/{taskId}/disclosures");
    expect(meta.successStatus ?? 200).toBe(200);
    expect([...DisclosureKindSchema.options]).toEqual(["hint", "audio"]);
    expect(DisclosureKindSchema.safeParse("video").success).toBe(false);
    const input = inputOf(kidApiContract.tasks.disclosures);
    expect(input.safeParse({ taskId: UUID, kind: "hint" }).success).toBe(true);
    expect(input.safeParse({ taskId: UUID, kind: "video" }).success).toBe(false);
    expect(outputOf(kidApiContract.tasks.disclosures).safeParse({
      taskId: UUID, stepId: "s1", kind: "hint", reveal: { target: "cat" },
    }).success).toBe(true);
  });

  it("completePresentation: POST /tasks/{taskId}/complete-presentation, opcjonalny clientCommandId", () => {
    const meta = metaOf(kidApiContract.tasks.completePresentation);
    expect(meta.method).toBe("POST");
    expect(meta.path).toBe("/tasks/{taskId}/complete-presentation");
    expect(meta.successStatus ?? 200).toBe(200);
    expect(CompletePresentationInputSchema.safeParse({}).success).toBe(true);
    expect(CompletePresentationInputSchema.safeParse({ clientCommandId: UUID }).success).toBe(true);
    expect(CompletePresentationInputSchema.safeParse({ clientCommandId: "abc" }).success).toBe(false);
    const input = inputOf(kidApiContract.tasks.completePresentation);
    expect(input.safeParse({ taskId: UUID }).success).toBe(true);
    expect(input.safeParse({ taskId: UUID, clientCommandId: UUID2 }).success).toBe(true);
    expect(input.safeParse({ clientCommandId: UUID2 }).success).toBe(false);
    expect(outputOf(kidApiContract.tasks.completePresentation).safeParse({
      taskId: UUID, state: "completed", completedAt: INSTANT,
    }).success).toBe(true);
  });

  it("attempts: POST /tasks/{taskId}/attempts, unia JSON/multipart i dynamiczny 200/202", () => {
    const meta = metaOf(kidApiContract.tasks.attempts);
    expect(meta.method).toBe("POST");
    expect(meta.path).toBe("/tasks/{taskId}/attempts");
    // Celowo bez requestBodyHint: w beta.45 hint trafia do parsera ciała
    // i wymuszałby formData() także dla JSON (TypeError → 400). Formę rozstrzyga
    // Content-Type żądania; multipart w spece wynika z detekcji File w unii.
    expect(meta.requestBodyHint).toBeUndefined();
    expect(meta.outputStructure).toBe("detailed");
    const input = inputOf(kidApiContract.tasks.attempts);
    // Gałąź JSON — AttemptInput wprost z ciała.
    expect(input.safeParse({
      taskId: UUID, clientAttemptId: UUID2, modality: "text", text: "cat",
    }).success).toBe(true);
    // Gałąź multipart — nagranie jako File poza JSON-em.
    const audio = newFile;
    expect(input.safeParse({ taskId: UUID, clientAttemptId: UUID2, audio }).success).toBe(true);
    expect(input.safeParse({ taskId: UUID, clientAttemptId: UUID2 }).success).toBe(false);
    // SpeechAttemptMultipartInputSchema sam w sobie wymaga id zadania z ścieżki.
    expect(SpeechAttemptMultipartInputSchema.safeParse({ clientAttemptId: UUID2, audio }).success).toBe(false);
    const out = outputOf(kidApiContract.tasks.attempts);
    expect(out.safeParse({ status: 200, body: attemptDto }).success).toBe(true);
    expect(out.safeParse({ status: 202, body: processingAttemptDto }).success).toBe(true);
    expect(out.safeParse({ status: 204, body: attemptDto }).success).toBe(false);
  });

  it("dictation: POST /tasks/{taskId}/dictation, multipart bez clientAttemptId, wynik bez score'ów z no-store", () => {
    const meta = metaOf(kidApiContract.tasks.dictation);
    expect(meta.method).toBe("POST");
    expect(meta.path).toBe("/tasks/{taskId}/dictation");
    expect(meta.outputStructure).toBe("detailed");
    const input = inputOf(kidApiContract.tasks.dictation);
    expect(input.safeParse({ taskId: UUID, audio: newFile }).success).toBe(true);
    expect(input.safeParse({ taskId: UUID }).success).toBe(false);
    const out = outputOf(kidApiContract.tasks.dictation);
    const noStore = { "cache-control": "no-store" };
    expect(out.safeParse({ headers: noStore, body: { status: "heard", text: "Równik to najdłuższy równoleżnik." } }).success).toBe(true);
    expect(out.safeParse({ headers: noStore, body: { status: "uncertain" } }).success).toBe(true);
    // niepewne rozpoznanie nie może nieść tekstu ani pewności
    expect(out.safeParse({ headers: noStore, body: { status: "uncertain", text: "When do we?" } }).success).toBe(false);
    expect(out.safeParse({ headers: noStore, body: { status: "heard", text: "Azja", confidence: 0.9 } }).success).toBe(false);
    expect(out.safeParse({ headers: noStore, body: { status: "heard", text: "a".repeat(601) } }).success).toBe(false);
  });
});

describe("próby", () => {
  it("get: GET /attempts/{attemptId}, 200 bez no-store (zwykłe compact)", () => {
    const meta = metaOf(kidApiContract.attempts.get);
    expect(meta.method).toBe("GET");
    expect(meta.path).toBe("/attempts/{attemptId}");
    expect(meta.outputStructure).toBeUndefined();
    expect(outputOf(kidApiContract.attempts.get).safeParse(attemptDto).success).toBe(true);
    expect(inputOf(kidApiContract.attempts.get).safeParse({ attemptId: UUID }).success).toBe(true);
    expect(inputOf(kidApiContract.attempts.get).safeParse({ attemptId: "abc" }).success).toBe(false);
  });

  it("feedbackAudio: POST /attempts/{attemptId}/feedback-audio, 200 z no-store", () => {
    const meta = metaOf(kidApiContract.attempts.feedbackAudio);
    expect(meta.method).toBe("POST");
    expect(meta.path).toBe("/attempts/{attemptId}/feedback-audio");
    expect(meta.outputStructure).toBe("detailed");
    expect(FeedbackAudioPathSchema.safeParse({ attemptId: UUID }).success).toBe(true);
    expect(FeedbackAudioPathSchema.safeParse({}).success).toBe(false);
    expect(inputOf(kidApiContract.attempts.feedbackAudio).safeParse({ attemptId: UUID }).success).toBe(true);
    expect(outputOf(kidApiContract.attempts.feedbackAudio).safeParse({
      headers: { "cache-control": "no-store" },
      body: { attemptId: UUID, taskId: UUID2, stepId: "s1", audioAssetId: UUID },
    }).success).toBe(true);
    expect(outputOf(kidApiContract.attempts.feedbackAudio).safeParse({
      body: { attemptId: UUID, taskId: UUID2, stepId: "s1", audioAssetId: UUID },
    }).success).toBe(false);
  });
});
