import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  AttemptInputSchema,
  type AttemptDto,
  type AttemptInput,
} from "@learning/contracts";
import type { Services } from "../config";
import {
  attempts,
  deckVersions,
  itemRevisions,
} from "../db/schema";
import { AppError } from "../errors";
import { matchWrittenAnswer } from "../domain/evaluate";
import { qualifyAttempt } from "../domain/independence";
import type {
  AnswerKey,
  EvaluationContext,
  Grade,
  PronunciationDetails,
  Skill,
  SkillGrade,
} from "../domain/types";
import type {
  AudioInput,
  PronunciationResult,
  SpeechEvidence,
} from "../ports/ai";
import { normalizeAudioInput } from "../providers/audio/normalize";
import { finalizeAttempt, startAttempt } from "./attempts";

/** Łączny deadline analizy nagrania (arch §11). */
export const SPEECH_ANALYSIS_TIMEOUT_MS = 30_000;
/**
 * Startowy próg wiarygodności transkrypcji — wartość do kalibracji próbą
 * techniczną (SPEC §23: nie wymyślamy pewności, której usługa nie zwraca;
 * niepewne rozpoznanie nie tworzy mylonej pary).
 */
export const MIN_STT_CONFIDENCE = 0.5;

/** Typy zadań przyjmujące odpowiedź ustną (SPEC §12.5–12.6). */
const SPEECH_EXERCISES: ReadonlySet<string> = new Set(["recall", "speech"]);

function unevaluated(reason: SkillGrade["reason"]): SkillGrade {
  return { outcome: "unevaluated", reason, independent: false, confirmationEligible: false };
}

/**
 * Analizuje nagranie poza transakcją (arch §10–11): najpierw STT ustala treść,
 * a ocena wymowy wykonywana jest względem kanonicznej odpowiedzi tylko wtedy,
 * gdy dziecko rzeczywiście ją wypowiedziało. Błędy i przerwania zwracają
 * statusy porażki zamiast wyjątków — bajty i transkrypcja nie trafiają do logów.
 */
export async function analyzeSpeech(
  services: Services,
  audio: AudioInput,
  key: AnswerKey,
  signal?: AbortSignal,
): Promise<SpeechEvidence> {
  const deps = services.speech;
  if (!deps) {
    throw new AppError("internal", { message: "speech providers are not configured" });
  }
  const timeoutMs = deps.analysisTimeoutMs ?? SPEECH_ANALYSIS_TIMEOUT_MS;
  const deadline = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);

  const transcription = await deps.stt.transcribe(audio, deadline).then(
    (result) => (deadline.aborted ? { status: "failed" as const, text: null, confidence: null } : result),
    () => ({ status: "failed" as const, text: null, confidence: null }),
  );

  let pronunciation: SpeechEvidence["pronunciation"] = null;
  if (
    transcription.status === "ok" &&
    transcription.text !== null &&
    (transcription.confidence === null || transcription.confidence >= MIN_STT_CONFIDENCE)
  ) {
    const match = matchWrittenAnswer(transcription.text, key);
    if (match.ci && match.matchedVariant === key.target) {
      const result = await deps.pronunciation.assess(audio, key.target, deadline).then(
        (scored) => (deadline.aborted ? ({ status: "failed", overallScore: null, recognizedText: null } satisfies PronunciationResult) : scored),
        () => ({ status: "failed" as const, overallScore: null, recognizedText: null }),
      );
      pronunciation = { ...result, provider: deps.pronunciation.name, expectedText: key.target };
    }
  }
  return { sttProvider: deps.stt.name, transcription, pronunciation };
}

/**
 * Ocena dowodów z nagrania według klucza i zamrożonego kontekstu (arch §11).
 * Treść zalicza wyłącznie dopasowanie transkrypcji do klucza i zatwierdzonych
 * wariantów — nigdy score wymowy oczekiwanego tekstu. Wynik wymowy względem
 * innego tekstu niż wypowiedziany wariant nie jest przenoszony; bez pasm
 * skalibrowanych w polityce wynik wymowy pozostaje nieocenioną daną.
 */
export function assessSpeechEvidence(
  evidence: SpeechEvidence,
  key: AnswerKey,
  ctx: EvaluationContext,
): Grade {
  const t = evidence.transcription;
  const credible =
    t.status === "ok" &&
    t.text !== null &&
    (t.confidence === null || t.confidence >= MIN_STT_CONFIDENCE);
  // w ćwiczeniu wymowy wzorzec jest oczekiwaną częścią nauki (SPEC §13.2)
  const attempt = qualifyAttempt(
    key.exerciseType === "speech"
      ? { ...ctx, assistance: ctx.assistance.filter((kind) => kind !== "model_audio") }
      : ctx,
  );
  const skills: Partial<Record<Skill, SkillGrade>> = {};
  const assessesContent = key.exerciseType !== "speech";

  if (!credible) {
    const reason: SkillGrade["reason"] = t.status === "ok" ? "ambiguous" : "technical";
    if (assessesContent) skills.recall = unevaluated(reason);
    skills.pronunciation = unevaluated(reason);
    return { skills, attempt };
  }

  const match = matchWrittenAnswer(t.text!, key);
  // ćwiczenie wymowy: treść wypowiedzi decyduje o wykonaniu zadania —
  // ocena wymowy może pozostać nieoceniona (§12.6, §15.4)
  const speechAttempt = key.exerciseType === "speech" ? { contentMatched: match.ci } : undefined;
  if (assessesContent) {
    skills.recall = {
      outcome: match.ci ? "correct" : "incorrect",
      independent: attempt.independent,
      confirmationEligible: attempt.independent && attempt.confirmationEligible && match.ci,
    };
  }

  const p = evidence.pronunciation;
  if (!match.ci) {
    // wiarygodny tekst spoza zatwierdzonego zbioru: wynik wymowy oczekiwanego
    // słowa byłby nieadekwatny — w ogóle go nie oceniamy (Review Focus 3)
    return { skills, attempt, ...(speechAttempt ? { speechAttempt } : {}) };
  }
  if (!p || p.status !== "ok" || p.overallScore === null || p.expectedText !== match.matchedVariant) {
    // oceny nie ma albo dotyczy innego wariantu — pronunciation nieocenione
    skills.pronunciation = unevaluated(p?.status === "failed" ? "technical" : undefined);
    return { skills, attempt, ...(speechAttempt ? { speechAttempt } : {}) };
  }

  const details: PronunciationDetails = { provider: p.provider, score: p.overallScore };
  const bands = ctx.policy.pronunciationBands[p.provider];
  if (!bands) {
    skills.pronunciation = { ...unevaluated(undefined), details: { pronunciation: details } };
    return { skills, attempt, ...(speechAttempt ? { speechAttempt } : {}) };
  }
  const band: PronunciationDetails["band"] =
    p.overallScore >= bands.correctMinScore
      ? "correct"
      : p.overallScore >= bands.partialMinScore
        ? "partial"
        : "below";
  if (band === "below") {
    // poniżej progu „prawie” to niepewna ocena, nie błąd wiedzy (design
    // 2026-10-09, docs/speech-spike.md) — wynik zostaje w details dla rodzica
    skills.pronunciation = { ...unevaluated(undefined), details: { pronunciation: { ...details, band } } };
  } else {
    skills.pronunciation = {
      outcome: band === "correct" ? "correct" : "incorrect",
      independent: attempt.independent,
      confirmationEligible: attempt.independent && attempt.confirmationEligible && band === "correct",
      details: { pronunciation: { ...details, band } },
    };
  }
  return { skills, attempt, ...(speechAttempt ? { speechAttempt } : {}) };
}

/** Dowody „nagranie było, analizy nie było” — np. brak skonfigurowanych kluczy. */
function unavailableEvidence(): SpeechEvidence {
  return {
    sttProvider: "none",
    transcription: { status: "failed", text: null, confidence: null },
    pronunciation: null,
  };
}

export interface SpeechAttemptInput {
  taskId: string;
  clientAttemptId: string;
}

/**
 * Ścieżka mowy (arch §10): rezerwuje próbę processing z zamrożonym kontekstem,
 * analizuje nagranie poza transakcją i atomowo finalizuje wynik. Retry dla
 * próby processing zwraca ten sam rekord bez drugiej płatnej analizy; awaria
 * kończy się próbą techniczną — bez fałszywego sukcesu i bez obniżania postępu.
 */
export async function submitSpeechAttempt(
  services: Services,
  input: SpeechAttemptInput,
  audio: AudioInput,
  signal?: AbortSignal,
): Promise<AttemptDto> {
  const valid = AttemptInputSchema.parse({ ...input, modality: "audio" }) as Extract<
    AttemptInput,
    { modality: "audio" }
  >;
  const normalized = normalizeAudioInput(audio);

  const reserved = await services.db.transaction(async (tx) => {
    const started = await startAttempt(tx, services, valid);
    if (started.kind !== "fresh") {
      return started;
    }
    if (!SPEECH_EXERCISES.has(started.task.exerciseType)) {
      throw new AppError("validation", { message: "task does not take speech answers" });
    }
    const targetLocale = (
      await tx
        .select({ locale: deckVersions.targetLocale })
        .from(itemRevisions)
        .innerJoin(deckVersions, eq(deckVersions.id, itemRevisions.deckVersionId))
        .where(eq(itemRevisions.id, started.task.itemRevisionId))
    )[0]!.locale;
    const attemptId = randomUUID();
    await tx.insert(attempts).values({
      id: attemptId,
      childId: started.task.childId,
      taskId: started.task.id,
      itemRevisionId: started.task.itemRevisionId,
      clientAttemptId: valid.clientAttemptId,
      requestHash: started.requestHash,
      attemptNumber: started.attemptNumber,
      modality: "audio",
      state: "processing",
      answer: null,
      context: started.frozen as unknown as Record<string, unknown>,
      policyId: started.session.policyId,
      receivedAt: started.receivedAt,
    });
    return { ...started, attemptId, targetLocale };
  });
  if (reserved.kind !== "fresh") {
    return reserved.dto;
  }

  const analyze: AudioInput = { ...normalized, locale: reserved.targetLocale };
  const evidence = services.speech ? await analyzeSpeech(services, analyze, reserved.key, signal) : unavailableEvidence();
  const grade = assessSpeechEvidence(evidence, reserved.key, {
    ...reserved.frozen,
    policy: reserved.policy,
  });
  return finalizeAttempt(services, reserved.attemptId, grade, {
    transcript: evidence.transcription.text,
    sttProvider: evidence.sttProvider,
    pronunciationProvider: evidence.pronunciation?.provider ?? null,
  });
}
