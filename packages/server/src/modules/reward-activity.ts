import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  RewardActivitySignalSchema,
  type RewardActivitySignal,
  type RewardActivitySignalDto,
  type RewardActivityPauseReason,
  type RewardActivitySummaryDto,
  UuidSchema,
} from "@learning/contracts";
import type { Services } from "../config";
import type { Tx } from "../db/client";
import {
  learningSessions,
  rewardActivitySegments,
  rewardActivityPauses,
  rewardActivityPlaybackAuthorizations,
  rewardActivitySettlements,
  rewardActivityStreams,
  learningEvents,
  mediaAssets,
  revisionAssets,
  sessionTasks,
} from "../db/schema";
import { AppError } from "../errors";
import {
  MAX_ACTIVITY_GAP_MS,
  REWARD_ACTIVITY_IDLE_MS,
  REWARD_ACTIVITY_POLICY_VERSION,
  REWARD_ACTIVITY_SIGNAL_INTERVAL_MS,
  creditedSeconds,
} from "../domain/reward-activity";
import { lockTaskWithSession } from "./events";
import { mp3DurationMs } from "../providers/audio/mp3-duration";

type PauseReason = NonNullable<RewardActivitySignalDto["pauseReason"]>;
const PAUSE_REASONS: Record<Extract<RewardActivitySignal["kind"], "pause">, PauseReason> = {
  pause: "background",
};

function dto(row: typeof rewardActivityStreams.$inferSelect): RewardActivitySignalDto {
  return {
    streamId: row.id,
    sequence: row.lastSequence,
    acceptedAt: row.lastSignalAt.toISOString(),
    paused: row.pausedReason !== null,
    pauseReason: row.pausedReason as PauseReason | null,
  };
}

async function recordPause(tx: Tx, stream: typeof rewardActivityStreams.$inferSelect, reason: PauseReason | null, at: Date): Promise<void> {
  if (!reason || stream.pausedReason === reason) return;
  await tx.insert(rewardActivityPauses).values({
    id: randomUUID(), streamId: stream.id, childId: stream.childId, pauseReason: reason, occurredAt: at,
  });
}

async function closeInterval(
  tx: Tx,
  stream: typeof rewardActivityStreams.$inferSelect,
  at: Date,
  reason: PauseReason | null,
): Promise<void> {
  if (!stream.active || stream.pausedReason !== null) return;
  const startMs = stream.playbackStartedAt?.getTime() ?? stream.lastSignalAt.getTime();
  const elapsed = at.getTime() - startMs;
  if (elapsed <= 0 || elapsed > MAX_ACTIVITY_GAP_MS) return;
  const idleAt = stream.playbackStartedAt ? Infinity : stream.lastInteractionAt.getTime() + REWARD_ACTIVITY_IDLE_MS;
  let playbackLimit = Infinity;
  if (stream.playbackStartedAt) {
    const activeAuthorization = (await tx.select({ playbackLimitAt: rewardActivityPlaybackAuthorizations.playbackLimitAt })
      .from(rewardActivityPlaybackAuthorizations).where(and(
        eq(rewardActivityPlaybackAuthorizations.streamId, stream.id),
        isNotNull(rewardActivityPlaybackAuthorizations.startedAt),
        isNull(rewardActivityPlaybackAuthorizations.endedAt),
        isNull(rewardActivityPlaybackAuthorizations.revokedAt),
      )).for("update"))[0];
    playbackLimit = activeAuthorization?.playbackLimitAt?.getTime() ?? startMs;
  }
  const endMs = Math.min(at.getTime(), idleAt, startMs + REWARD_ACTIVITY_SIGNAL_INTERVAL_MS, playbackLimit);
  if (endMs <= startMs) return;
  await tx.insert(rewardActivitySegments).values({
    id: randomUUID(), streamId: stream.id, childId: stream.childId,
    sessionId: stream.sessionId, taskId: stream.taskId,
    startedAt: new Date(startMs), endedAt: new Date(endMs),
    pauseReason: idleAt <= endMs ? "idle" : reason,
  });
}

/** Zapisuje wyłącznie ograniczone sygnały i znaczniki serwera, nigdy dane wejściowe dziecka. */
export async function recordRewardActivitySignal(services: Services, input: RewardActivitySignal): Promise<RewardActivitySignalDto> {
  const valid = RewardActivitySignalSchema.parse(input);
  return services.db.transaction(async (tx) => {
    const { task, session } = await lockTaskWithSession(tx, valid.taskId);
    if (task.sessionId !== valid.sessionId || task.state !== "issued" || session.state !== "active") {
      throw new AppError("conflict", { message: "reward activity requires the issued task of an active session" });
    }
    const now = services.clock.now();
    const oldStream = (await tx.select().from(rewardActivityStreams)
      .where(eq(rewardActivityStreams.id, valid.streamId)).for("update"))[0];
    if (oldStream) {
      if (valid.kind === "takeover" && oldStream.active) {
        throw new AppError("conflict", { message: "takeover must use a new stream id" });
      }
      if (valid.sequence === oldStream.lastSequence) return dto(oldStream);
      if (valid.sequence < oldStream.lastSequence) throw new AppError("conflict", { message: "reward activity sequence is stale" });
      if (!oldStream.active || oldStream.childId !== task.childId || oldStream.sessionId !== session.id || oldStream.taskId !== task.id) {
        throw new AppError("conflict", { message: "reward activity stream is no longer active for this task" });
      }
      if (valid.sequence !== oldStream.lastSequence + 1) throw new AppError("conflict", { message: "reward activity sequence must increase by one" });
    } else if (valid.sequence !== 1) {
      throw new AppError("conflict", { message: "reward activity stream must start at sequence one" });
    }
    let playbackAuthorization: typeof rewardActivityPlaybackAuthorizations.$inferSelect | undefined;
    if (valid.kind === "playback_start" || valid.kind === "playback_end") {
      if (!valid.playbackAuthorizationId) throw new AppError("conflict", { message: "playback requires server authorization" });
      playbackAuthorization = (await tx.select().from(rewardActivityPlaybackAuthorizations)
        .where(eq(rewardActivityPlaybackAuthorizations.id, valid.playbackAuthorizationId)).for("update"))[0];
      if (!playbackAuthorization || playbackAuthorization.streamId !== valid.streamId || playbackAuthorization.taskId !== task.id || playbackAuthorization.sessionId !== session.id || playbackAuthorization.childId !== task.childId) {
        throw new AppError("conflict", { message: "playback authorization is invalid for this task" });
      }
      if (playbackAuthorization.assetId !== valid.playbackAssetId || playbackAuthorization.revokedAt || (valid.kind === "playback_start" && playbackAuthorization.expiresAt <= now)) throw new AppError("conflict", { message: "playback authorization is invalid for this asset or expired" });
      if (valid.kind === "playback_start" && (playbackAuthorization.startedAt || playbackAuthorization.endedAt)) throw new AppError("conflict", { message: "playback authorization has already been used" });
      if (valid.kind === "playback_end" && (!playbackAuthorization.startedAt || playbackAuthorization.endedAt)) throw new AppError("conflict", { message: "playback authorization is not active" });
    }

    let stream = oldStream;
    if (!stream || valid.kind === "takeover") {
      if (valid.kind !== "takeover" && stream === null) {
        const active = (await tx.select().from(rewardActivityStreams)
          .where(and(eq(rewardActivityStreams.childId, task.childId), eq(rewardActivityStreams.active, true))).for("update"))[0];
        if (active) throw new AppError("conflict", { message: "another device owns the reward activity stream" });
      }
      if (valid.kind === "takeover") {
        const active = (await tx.select().from(rewardActivityStreams)
          .where(and(eq(rewardActivityStreams.childId, task.childId), eq(rewardActivityStreams.active, true))).for("update"))[0];
        if (active) {
          await closeInterval(tx, active, now, "task_changed");
          await recordPause(tx, active, "task_changed", now);
          await tx.update(rewardActivityStreams).set({ active: false, pausedReason: "task_changed" }).where(eq(rewardActivityStreams.id, active.id));
        }
      }
      const id = valid.streamId;
      await tx.insert(rewardActivityStreams).values({
        id, childId: task.childId, sessionId: session.id, taskId: task.id,
        policyVersion: REWARD_ACTIVITY_POLICY_VERSION,
        lastSequence: valid.sequence, lastSignalAt: now, lastInteractionAt: now,
        pausedReason: valid.kind === "pause" ? (valid.pauseReason ?? PAUSE_REASONS.pause) : null,
        playbackStartedAt: valid.kind === "playback_start" ? now : null,
        active: true,
      });
      stream = (await tx.select().from(rewardActivityStreams).where(eq(rewardActivityStreams.id, id)))[0]!;
      await recordPause(tx, stream, stream.pausedReason as PauseReason | null, now);
    } else {
      const idle = now.getTime() >= stream.lastInteractionAt.getTime() + REWARD_ACTIVITY_IDLE_MS;
      const expired = now.getTime() - stream.lastSignalAt.getTime() > MAX_ACTIVITY_GAP_MS;
      const heartbeatWhilePaused = valid.kind === "heartbeat" && stream.pausedReason !== null;
      if (valid.kind === "playback_start" && stream.playbackStartedAt !== null) {
        throw new AppError("conflict", { message: "playback is already active" });
      }
      const reason: PauseReason | null = valid.kind === "pause" ? (valid.pauseReason ?? PAUSE_REASONS.pause) : valid.kind === "interaction" ? null : heartbeatWhilePaused ? stream.pausedReason as PauseReason : idle ? "idle" : expired ? "signal_timeout" : null;
      await closeInterval(tx, stream, now, reason);
      const nextInteraction = valid.kind === "interaction" ? now : stream.lastInteractionAt;
      const paused = valid.kind === "pause" || heartbeatWhilePaused || (valid.kind !== "interaction" && (idle || expired));
      const playbackStartedAt = valid.kind === "playback_start" ? now : valid.kind === "playback_end" || valid.kind === "pause" ? null : stream.playbackStartedAt ? now : null;
      await tx.update(rewardActivityStreams).set({
        lastSequence: valid.sequence,
        lastSignalAt: now,
        lastInteractionAt: nextInteraction,
        pausedReason: paused ? reason : null,
        playbackStartedAt,
      }).where(eq(rewardActivityStreams.id, stream.id));
      if (playbackAuthorization && valid.kind === "playback_start") {
        await tx.update(rewardActivityPlaybackAuthorizations).set({ startedAt: now, playbackLimitAt: new Date(now.getTime() + playbackAuthorization.assetDurationMs) }).where(eq(rewardActivityPlaybackAuthorizations.id, playbackAuthorization.id));
      } else if (playbackAuthorization && valid.kind === "playback_end") {
        await tx.update(rewardActivityPlaybackAuthorizations).set({ endedAt: now }).where(eq(rewardActivityPlaybackAuthorizations.id, playbackAuthorization.id));
      }
      if (valid.kind === "pause") {
        const pendingPlayback = await tx.select().from(rewardActivityPlaybackAuthorizations).where(and(
          eq(rewardActivityPlaybackAuthorizations.streamId, stream.id),
          isNull(rewardActivityPlaybackAuthorizations.endedAt),
          isNull(rewardActivityPlaybackAuthorizations.revokedAt),
        )).for("update");
        for (const authorization of pendingPlayback) {
          await tx.update(rewardActivityPlaybackAuthorizations).set({
            ...(authorization.startedAt ? { endedAt: now } : {}), revokedAt: now,
          }).where(eq(rewardActivityPlaybackAuthorizations.id, authorization.id));
        }
      }
      await recordPause(tx, stream, reason, now);
      stream = (await tx.select().from(rewardActivityStreams).where(eq(rewardActivityStreams.id, stream.id)))[0]!;
    }
    return dto(stream);
  });
}

/** Issues a one-use, server-bound capability for real task audio playback. */
export async function authorizeRewardActivityPlayback(
  services: Services,
  input: { sessionId: string; taskId: string; streamId: string; assetId: string },
): Promise<{ authorizationId: string }> {
  return services.db.transaction(async (tx) => {
    const { task, session } = await lockTaskWithSession(tx, input.taskId);
    if (task.sessionId !== input.sessionId || task.state !== "issued" || session.state !== "active") throw new AppError("conflict");
    const stream = (await tx.select().from(rewardActivityStreams).where(eq(rewardActivityStreams.id, input.streamId)).for("update"))[0];
    if (!stream || !stream.active || stream.taskId !== task.id || stream.sessionId !== session.id || stream.childId !== task.childId) throw new AppError("conflict");
    const prompt = task.publicPrompt as { audioAssetId?: unknown; exampleAudioAssetId?: unknown };
    const promptHasAsset = [prompt.audioAssetId, prompt.exampleAudioAssetId].includes(input.assetId);
    const disclosedAudio = (await tx.select({ id: learningEvents.id }).from(learningEvents).where(and(
      eq(learningEvents.taskId, task.id), eq(learningEvents.kind, "audio_issued"), eq(learningEvents.sealed, true),
    )))[0];
    const disclosedAsset = disclosedAudio ? (await tx.select({ id: mediaAssets.id }).from(revisionAssets)
      .innerJoin(mediaAssets, eq(mediaAssets.id, revisionAssets.assetId)).where(and(
        eq(revisionAssets.itemRevisionId, task.itemRevisionId), eq(revisionAssets.assetId, input.assetId),
        eq(revisionAssets.role, "target_audio"), eq(revisionAssets.state, "approved"),
        eq(mediaAssets.kind, "tts"), eq(mediaAssets.state, "ready"),
      )))[0] : undefined;
    const asset = promptHasAsset
      ? (await tx.select({ id: mediaAssets.id, metadata: mediaAssets.metadata, storageKey: mediaAssets.storageKey, mimeType: mediaAssets.mimeType }).from(mediaAssets).where(and(eq(mediaAssets.id, input.assetId), eq(mediaAssets.kind, "tts"), eq(mediaAssets.state, "ready"))))[0]
      : disclosedAsset ? (await tx.select({ id: mediaAssets.id, metadata: mediaAssets.metadata, storageKey: mediaAssets.storageKey, mimeType: mediaAssets.mimeType }).from(mediaAssets).where(eq(mediaAssets.id, input.assetId)))[0] : undefined;
    if (!asset) throw new AppError("conflict", { message: "audio asset is not authorized for this task" });
    let durationMs = Number((asset.metadata as { durationMs?: unknown }).durationMs);
    if ((!Number.isSafeInteger(durationMs) || durationMs <= 0) && asset.storageKey && asset.mimeType?.startsWith("audio/mpeg") && services.mediaStore) {
      const stored = await services.mediaStore.get(asset.storageKey);
      if (stored?.mimeType.startsWith("audio/mpeg")) durationMs = mp3DurationMs(stored.bytes) ?? 0;
    }
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0) throw new AppError("conflict", { message: "audio duration is unavailable" });
    const now = services.clock.now();
    const pending = await tx.select().from(rewardActivityPlaybackAuthorizations).where(and(
      eq(rewardActivityPlaybackAuthorizations.streamId, stream.id),
      isNull(rewardActivityPlaybackAuthorizations.endedAt), isNull(rewardActivityPlaybackAuthorizations.revokedAt),
    )).for("update");
    if (pending.some((row) => row.startedAt !== null)) throw new AppError("conflict", { message: "playback is already active" });
    for (const row of pending) await tx.update(rewardActivityPlaybackAuthorizations).set({ revokedAt: now }).where(eq(rewardActivityPlaybackAuthorizations.id, row.id));
    const authorizationId = randomUUID();
    await tx.insert(rewardActivityPlaybackAuthorizations).values({
      id: authorizationId, streamId: stream.id, childId: stream.childId, sessionId: stream.sessionId, taskId: stream.taskId,
      assetId: input.assetId, assetDurationMs: durationMs, authorizedAt: now, expiresAt: new Date(now.getTime() + 30_000),
      startedAt: null, playbackLimitAt: null, endedAt: null, revokedAt: null,
    });
    return { authorizationId };
  });
}

/** Wywoływane w tej samej transakcji co zaakceptowany krok. */
export async function settleRewardActivity(
  tx: Tx,
  input: { childId: string; sessionId: string; taskId: string; completionRef: string; kind: "attempt" | "presentation"; at: Date },
): Promise<void> {
  const streams = await tx.select().from(rewardActivityStreams).where(and(
    eq(rewardActivityStreams.childId, input.childId),
    eq(rewardActivityStreams.sessionId, input.sessionId),
    eq(rewardActivityStreams.taskId, input.taskId),
    eq(rewardActivityStreams.active, true),
  )).for("update");
  for (const stream of streams) await closeInterval(tx, stream, input.at, null);
  const [settlement] = await tx.insert(rewardActivitySettlements).values({
    id: randomUUID(), childId: input.childId, sessionId: input.sessionId, taskId: input.taskId,
    completionRef: UuidSchema.parse(input.completionRef), kind: input.kind, settledAt: input.at,
  }).onConflictDoNothing({ target: [rewardActivitySettlements.taskId, rewardActivitySettlements.completionRef] }).returning();
  if (!settlement) return;
  await tx.update(rewardActivitySegments).set({ settlementRef: settlement.id }).where(and(
    eq(rewardActivitySegments.childId, input.childId),
    eq(rewardActivitySegments.sessionId, input.sessionId),
    eq(rewardActivitySegments.taskId, input.taskId),
    isNull(rewardActivitySegments.settlementRef),
  ));
  await tx.update(rewardActivityStreams).set({ active: false, pausedReason: "task_changed" }).where(and(
    eq(rewardActivityStreams.childId, input.childId),
    eq(rewardActivityStreams.taskId, input.taskId),
    eq(rewardActivityStreams.active, true),
  ));
}

/** Discards unaccepted task time and releases the child's single active stream. */
export async function discardRewardActivity(
  tx: Tx,
  input: { childId: string; sessionId: string; taskId: string; at: Date },
): Promise<void> {
  const streams = await tx.select().from(rewardActivityStreams).where(and(
    eq(rewardActivityStreams.childId, input.childId),
    eq(rewardActivityStreams.sessionId, input.sessionId),
    eq(rewardActivityStreams.taskId, input.taskId),
    eq(rewardActivityStreams.active, true),
  )).for("update");
  for (const stream of streams) {
    // Do not close an interval here: the step was not accepted, so none of its
    // uncommitted seconds may become reportable. Revoke any pending playback.
    await tx.update(rewardActivityPlaybackAuthorizations).set({ revokedAt: input.at }).where(and(
      eq(rewardActivityPlaybackAuthorizations.streamId, stream.id),
      isNull(rewardActivityPlaybackAuthorizations.endedAt),
      isNull(rewardActivityPlaybackAuthorizations.revokedAt),
    ));
    await recordPause(tx, stream, "task_changed", input.at);
    await tx.update(rewardActivityStreams).set({ active: false, pausedReason: "task_changed", playbackStartedAt: null })
      .where(eq(rewardActivityStreams.id, stream.id));
  }
}

export async function finishRewardActivitySession(tx: Tx, sessionId: string, at: Date): Promise<void> {
  const rows = await tx.select().from(rewardActivityStreams).where(and(
    eq(rewardActivityStreams.sessionId, sessionId), eq(rewardActivityStreams.active, true),
  )).for("update");
  for (const stream of rows) {
    await closeInterval(tx, stream, at, "session_ended");
    await recordPause(tx, stream, "session_ended", at);
    await tx.update(rewardActivityStreams).set({ active: false, pausedReason: "session_ended" }).where(eq(rewardActivityStreams.id, stream.id));
  }
}

/** Ograniczony widok faktów rozliczenia; wywołujący HTTP musi wcześniej sprawdzić Parent Mode. */
export async function readRewardActivitySummary(services: Services, childId: string): Promise<RewardActivitySummaryDto> {
  const child = UuidSchema.parse(childId);
  const sessions = await services.db.select({
    sessionId: learningSessions.id,
    startedAt: learningSessions.startedAt,
    endedAt: learningSessions.endedAt,
    segmentStart: rewardActivitySegments.startedAt,
    segmentEnd: rewardActivitySegments.endedAt,
    pauseReason: rewardActivitySegments.pauseReason,
  }).from(learningSessions).leftJoin(rewardActivitySegments, and(
    eq(rewardActivitySegments.sessionId, learningSessions.id),
    eq(rewardActivitySegments.childId, child),
    // tylko fakty przeniesione do dziennika rozliczeń
    isNotNull(rewardActivitySegments.settlementRef),
  )).where(eq(learningSessions.childId, child)).orderBy(asc(learningSessions.startedAt), asc(rewardActivitySegments.startedAt));
  const bySession = new Map<string, { startedAt: Date; endedAt: Date | null; intervals: { start: Date; end: Date }[]; reasons: Set<RewardActivityPauseReason> }>();
  for (const row of sessions) {
    const entry = bySession.get(row.sessionId) ?? { startedAt: row.startedAt, endedAt: row.endedAt, intervals: [] as { start: Date; end: Date }[], reasons: new Set<RewardActivityPauseReason>() };
    if (row.segmentStart && row.segmentEnd) entry.intervals.push({ start: row.segmentStart, end: row.segmentEnd });
    if (row.pauseReason) entry.reasons.add(row.pauseReason as RewardActivityPauseReason);
    bySession.set(row.sessionId, entry);
  }
  // Settled rows are the only reportable work.
  const creditedRows = await services.db.select({ sessionId: rewardActivitySegments.sessionId, start: rewardActivitySegments.startedAt, end: rewardActivitySegments.endedAt, pauseReason: rewardActivitySegments.pauseReason })
    .from(rewardActivitySegments).where(and(eq(rewardActivitySegments.childId, child), isNotNull(rewardActivitySegments.settlementRef)));
  const creditedBySession = new Map<string, { intervals: { start: Date; end: Date }[]; reasons: Set<RewardActivityPauseReason> }>();
  for (const row of creditedRows) {
    const entry = creditedBySession.get(row.sessionId) ?? { intervals: [] as { start: Date; end: Date }[], reasons: new Set<RewardActivityPauseReason>() };
    entry.intervals.push({ start: row.start, end: row.end });
    if (row.pauseReason) entry.reasons.add(row.pauseReason as RewardActivityPauseReason);
    creditedBySession.set(row.sessionId, entry);
  }
  const settledStreamIds = [...new Set(creditedRows.map((row) => row.sessionId))];
  const settledStreams = settledStreamIds.length === 0 ? [] : await services.db.selectDistinct({ streamId: rewardActivitySegments.streamId })
    .from(rewardActivitySegments).where(and(
      eq(rewardActivitySegments.childId, child),
      inArray(rewardActivitySegments.sessionId, settledStreamIds),
      isNotNull(rewardActivitySegments.settlementRef),
    ));
  const pauseRows = settledStreams.length === 0 ? [] : await services.db.select({
    sessionId: rewardActivityStreams.sessionId,
    pauseReason: rewardActivityPauses.pauseReason,
  }).from(rewardActivityPauses).innerJoin(rewardActivityStreams, eq(rewardActivityStreams.id, rewardActivityPauses.streamId))
    .where(and(eq(rewardActivityStreams.childId, child), inArray(rewardActivityStreams.id, settledStreams.map(({ streamId }) => streamId))));
  for (const row of pauseRows) {
    if (!row.pauseReason) continue;
    const entry = creditedBySession.get(row.sessionId) ?? { intervals: [] as { start: Date; end: Date }[], reasons: new Set<RewardActivityPauseReason>() };
    entry.reasons.add(row.pauseReason as RewardActivityPauseReason);
    creditedBySession.set(row.sessionId, entry);
  }
  const result = [...bySession].map(([sessionId, entry]) => {
    const credited = creditedBySession.get(sessionId) ?? { intervals: [] as { start: Date; end: Date }[], reasons: new Set<RewardActivityPauseReason>() };
    const seconds = creditedSeconds(credited.intervals);
    return { sessionId, startedAt: entry.startedAt.toISOString(), endedAt: entry.endedAt?.toISOString() ?? null, creditedSeconds: seconds, pauseReasons: [...credited.reasons] };
  });
  return {
    childId: child,
    sessions: result,
    creditedSeconds: creditedSeconds([...creditedBySession.values()].flatMap((entry) => entry.intervals)),
  };
}
