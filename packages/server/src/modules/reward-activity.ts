import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  RewardActivitySignalSchema,
  type RewardActivitySignal,
  type RewardActivitySignalDto,
  type RewardActivityPauseReason,
  type RewardActivitySummaryDto,
  type XboxRewardRequestDecision,
  type XboxRewardRequestDto,
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
  familySettings,
  learningEvents,
  mediaAssets,
  revisionAssets,
  sessionTasks,
  childProfiles,
  rewardActivityXboxBlocks,
  rewardActivityXboxRequests,
} from "../db/schema";
import { AppError } from "../errors";
import {
  MAX_ACTIVITY_GAP_MS,
  REWARD_ACTIVITY_IDLE_MS,
  REWARD_ACTIVITY_POLICY_VERSION,
  REWARD_ACTIVITY_SIGNAL_INTERVAL_MS,
  creditedSeconds,
  REWARD_POINT_INTERVAL_MS,
  rewardAward,
  splitRewardIntervalByLocalDay,
  localDateAt,
  validRewardTimezone,
  xboxPacksForDay,
} from "../domain/reward-activity";
import { lockTaskWithSession } from "./events";
import { mp3DurationMs } from "../providers/audio/mp3-duration";

const XBOX_PACK_POINTS = 30;
const XBOX_PACK_MINUTES = 15;

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
  // Serialize reward accounting per child without taking locks in the learning
  // session/profile order used by session start and completion transactions.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.childId}::text, 0))`);
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
    deckId: sql`(select deck_id from learning_app.learning_sessions where id = ${input.sessionId})`,
    timezone: sql`(select coalesce(context->>'timezone', 'Europe/Warsaw') from learning_app.learning_sessions where id = ${input.sessionId})`,
  }).onConflictDoNothing({ target: [rewardActivitySettlements.taskId, rewardActivitySettlements.completionRef] }).returning();
  if (!settlement) return;
  await tx.update(rewardActivitySegments).set({ settlementRef: settlement.id }).where(and(
    eq(rewardActivitySegments.childId, input.childId),
    eq(rewardActivitySegments.sessionId, input.sessionId),
    eq(rewardActivitySegments.taskId, input.taskId),
    isNull(rewardActivitySegments.settlementRef),
  ));
  const credited = (await tx.select({ milliseconds: sql<number>`coalesce(sum(extract(epoch from (${rewardActivitySegments.endedAt} - ${rewardActivitySegments.startedAt})) * 1000), 0)::bigint`.mapWith(Number) })
    .from(rewardActivitySegments).where(eq(rewardActivitySegments.settlementRef, settlement.id)))[0]?.milliseconds ?? 0;
  const prior = (await tx.select({ milliseconds: sql<number>`coalesce(sum(${rewardActivitySettlements.creditedMilliseconds}), 0)::bigint`.mapWith(Number) })
    .from(rewardActivitySettlements).where(and(eq(rewardActivitySettlements.childId, input.childId), sql`${rewardActivitySettlements.id} <> ${settlement.id}`)))[0]?.milliseconds ?? 0;
  const previousRemainder = prior % REWARD_POINT_INTERVAL_MS;
  const award = rewardAward(credited, previousRemainder);
  await tx.update(rewardActivitySettlements).set({ creditedMilliseconds: credited, awardedPoints: award.points, remainderMilliseconds: award.remainderMilliseconds })
    .where(eq(rewardActivitySettlements.id, settlement.id));
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

export interface KidRewardSnapshot {
  earnedPoints: number;
  pointsToUse: number;
  todayCreditedSeconds: number;
  readyXboxPacks: number;
  xboxRequest: XboxRewardRequestDto | null;
  pointsByDeck: Map<string, number>;
}

function xboxRequestDto(row: typeof rewardActivityXboxRequests.$inferSelect): XboxRewardRequestDto {
  return {
    requestId: row.id,
    status: row.status as XboxRewardRequestDto["status"],
    requestedAt: row.requestedAt.toISOString(),
    localDate: row.localDateSnapshot,
    blockNumber: row.blockNumberSnapshot,
    pointsCost: 30,
    xboxMinutes: 15,
  };
}

/** Reads the child's server-settled reward ledger and day totals. */
export async function readKidRewardSnapshot(services: Services, childId: string, now = services.clock.now()): Promise<KidRewardSnapshot> {
  const child = UuidSchema.parse(childId);
  const settlements = await services.db.select({
    deckId: rewardActivitySettlements.deckId,
    points: rewardActivitySettlements.awardedPoints,
  }).from(rewardActivitySettlements).where(eq(rewardActivitySettlements.childId, child));
  const pointsByDeck = new Map<string, number>();
  let earnedPoints = 0;
  for (const row of settlements) {
    earnedPoints += row.points;
    pointsByDeck.set(row.deckId, (pointsByDeck.get(row.deckId) ?? 0) + row.points);
  }
  const [family] = await services.db.select({ timezone: familySettings.timezone }).from(familySettings).limit(1);
  const currentTimezone = family?.timezone ?? "Europe/Warsaw";
  const timezone = validRewardTimezone(currentTimezone);
  const today = localDateAt(now, timezone);
  const intervals = await services.db.select({
    start: rewardActivitySegments.startedAt,
    end: rewardActivitySegments.endedAt,
    timezone: learningSessions.context,
  }).from(rewardActivitySegments).innerJoin(learningSessions, eq(learningSessions.id, rewardActivitySegments.sessionId)).where(and(
    eq(rewardActivitySegments.childId, child), isNotNull(rewardActivitySegments.settlementRef),
  ));
  const daily = new Map<string, number>();
  for (const interval of intervals) {
    const context = interval.timezone as { timezone?: unknown };
    const sessionTimezone = validRewardTimezone(context?.timezone);
    for (const [day, milliseconds] of splitRewardIntervalByLocalDay(interval.start, interval.end, sessionTimezone)) {
      const key = `${sessionTimezone}:${day}`;
      daily.set(key, (daily.get(key) ?? 0) + milliseconds);
    }
  }
  const xboxRequests = await services.db.select().from(rewardActivityXboxRequests)
    .where(eq(rewardActivityXboxRequests.childId, child)).orderBy(asc(rewardActivityXboxRequests.requestedAt));
  const consumedPacks = xboxRequests.filter((row) => row.status === "pending" || row.status === "fulfilled").length;
  const latestRequest = xboxRequests.find((row) => row.status === "pending") ?? xboxRequests.at(-1) ?? null;
  const earnedXboxPacks = [...daily.values()].reduce((sum, milliseconds) => sum + xboxPacksForDay(milliseconds), 0);
  return {
    earnedPoints,
    pointsToUse: Math.max(0, earnedPoints - consumedPacks * XBOX_PACK_POINTS),
    todayCreditedSeconds: Math.floor((daily.get(`${timezone}:${today}`) ?? 0) / 1000),
    readyXboxPacks: Math.max(0, earnedXboxPacks - consumedPacks),
    xboxRequest: latestRequest ? xboxRequestDto(latestRequest) : null,
    pointsByDeck,
  };
}

/** Rezerwuje najstarszy niewykorzystany pełny blok i stałą cenę w jednej blokadzie per dziecko. */
export async function requestXboxPack(services: Services, childId: string): Promise<XboxRewardRequestDto> {
  const child = UuidSchema.parse(childId);
  return services.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${child}::text, 0))`);
    const profile = (await tx.select({ id: childProfiles.id }).from(childProfiles).where(eq(childProfiles.id, child)).for("update"))[0];
    if (!profile) throw new AppError("not_found");

    const pending = (await tx.select().from(rewardActivityXboxRequests).where(and(
      eq(rewardActivityXboxRequests.childId, child), eq(rewardActivityXboxRequests.status, "pending"),
    )).orderBy(asc(rewardActivityXboxRequests.requestedAt)).limit(1).for("update"))[0];
    if (pending) return xboxRequestDto(pending);

    const intervals = await tx.select({
      start: rewardActivitySegments.startedAt,
      end: rewardActivitySegments.endedAt,
      context: learningSessions.context,
    }).from(rewardActivitySegments).innerJoin(learningSessions, eq(learningSessions.id, rewardActivitySegments.sessionId)).where(and(
      eq(rewardActivitySegments.childId, child), isNotNull(rewardActivitySegments.settlementRef),
    ));
    const daily = new Map<string, { timezone: string; localDate: string; milliseconds: number }>();
    for (const interval of intervals) {
      const context = interval.context as { timezone?: unknown };
      const timezone = validRewardTimezone(context?.timezone);
      for (const [localDate, milliseconds] of splitRewardIntervalByLocalDay(interval.start, interval.end, timezone)) {
        const key = `${timezone}:${localDate}`;
        const current = daily.get(key) ?? { timezone, localDate, milliseconds: 0 };
        current.milliseconds += milliseconds;
        daily.set(key, current);
      }
    }
    const qualified = [...daily.values()].flatMap((day) => Array.from(
      { length: xboxPacksForDay(day.milliseconds) },
      (_, index) => ({ ...day, blockNumber: index + 1 }),
    ));

    const earned = (await tx.select({ points: sql<number>`coalesce(sum(${rewardActivitySettlements.awardedPoints}), 0)::int` })
      .from(rewardActivitySettlements).where(eq(rewardActivitySettlements.childId, child)))[0]?.points ?? 0;
    const consumed = (await tx.select({ count: sql<number>`count(*)::int` }).from(rewardActivityXboxRequests).where(and(
      eq(rewardActivityXboxRequests.childId, child), inArray(rewardActivityXboxRequests.status, ["pending", "fulfilled"]),
    )))[0]?.count ?? 0;
    if (earned - consumed * XBOX_PACK_POINTS < XBOX_PACK_POINTS || qualified.length <= consumed) {
      throw new AppError("conflict", { message: "a full Xbox block and 30 available points are required" });
    }

    const existingBlocks = await tx.select().from(rewardActivityXboxBlocks).where(eq(rewardActivityXboxBlocks.childId, child));
    const blockIdentity = (timezone: string, localDate: string, blockNumber: number) => `${timezone}:${localDate}:${blockNumber}`;
    const existingIdentities = new Set(existingBlocks.map((row) => blockIdentity(row.timezone, row.localDate, row.blockNumber)));
    const missingBlocks = qualified.filter((block) => !existingIdentities.has(blockIdentity(block.timezone, block.localDate, block.blockNumber)));
    if (missingBlocks.length > 0) {
      await tx.insert(rewardActivityXboxBlocks).values(missingBlocks.map((block) => ({
        id: randomUUID(), childId: child, timezone: block.timezone, localDate: block.localDate,
        blockNumber: block.blockNumber, creditedSecondsAtCreation: Math.floor(block.milliseconds / 1000),
      }))).onConflictDoNothing({ target: [
        rewardActivityXboxBlocks.childId, rewardActivityXboxBlocks.timezone,
        rewardActivityXboxBlocks.localDate, rewardActivityXboxBlocks.blockNumber,
      ] });
    }

    const blocks = await tx.select().from(rewardActivityXboxBlocks).where(eq(rewardActivityXboxBlocks.childId, child))
      .orderBy(asc(rewardActivityXboxBlocks.localDate), asc(rewardActivityXboxBlocks.blockNumber), asc(rewardActivityXboxBlocks.timezone));
    const usedBlocks = await tx.select({ blockId: rewardActivityXboxRequests.blockId }).from(rewardActivityXboxRequests).where(and(
      eq(rewardActivityXboxRequests.childId, child), inArray(rewardActivityXboxRequests.status, ["pending", "fulfilled"]),
    ));
    const usedBlockIds = new Set(usedBlocks.map((row) => row.blockId));
    const block = blocks.find((candidate) => !usedBlockIds.has(candidate.id));
    if (!block) throw new AppError("conflict", { message: "no unreserved full Xbox block is available" });
    const dailySnapshot = daily.get(`${block.timezone}:${block.localDate}`);
    const now = services.clock.now();
    const [request] = await tx.insert(rewardActivityXboxRequests).values({
      id: randomUUID(), childId: child, blockId: block.id, status: "pending",
      timezoneSnapshot: block.timezone, localDateSnapshot: block.localDate,
      blockNumberSnapshot: block.blockNumber, creditedSecondsSnapshot: Math.floor((dailySnapshot?.milliseconds ?? 0) / 1000),
      pointsCost: XBOX_PACK_POINTS, xboxMinutes: XBOX_PACK_MINUTES, requestedAt: now,
    }).returning();
    if (!request) throw new AppError("internal");
    return xboxRequestDto(request);
  });
}

/** Changes a parent's Xbox request decision once, serialized with reservations for that child. */
export async function decideXboxRewardRequest(
  services: Services,
  requestId: string,
  decision: XboxRewardRequestDecision,
): Promise<XboxRewardRequestDto> {
  const request = UuidSchema.parse(requestId);
  return services.db.transaction(async (tx) => {
    const initial = (await tx.select({ childId: rewardActivityXboxRequests.childId }).from(rewardActivityXboxRequests)
      .where(eq(rewardActivityXboxRequests.id, request)).limit(1))[0];
    if (!initial) throw new AppError("not_found");
    const child = UuidSchema.parse(initial.childId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${child}::text, 0))`);
    const current = (await tx.select().from(rewardActivityXboxRequests)
      .where(and(eq(rewardActivityXboxRequests.id, request), eq(rewardActivityXboxRequests.childId, child)))
      .for("update"))[0];
    if (!current) throw new AppError("not_found");
    if (current.status !== "pending") {
      if (current.status === decision) return xboxRequestDto(current);
      throw new AppError("conflict", { message: "Xbox request already has a different final decision" });
    }
    const [updated] = await tx.update(rewardActivityXboxRequests).set({ status: decision })
      .where(eq(rewardActivityXboxRequests.id, current.id)).returning();
    if (!updated) throw new AppError("internal");
    return xboxRequestDto(updated);
  });
}

export async function readSessionRewardDelta(tx: Tx, sessionId: string): Promise<{ creditedSeconds: number; pointsEarned: number }> {
  const rows = await tx.select({ milliseconds: rewardActivitySettlements.creditedMilliseconds, points: rewardActivitySettlements.awardedPoints })
    .from(rewardActivitySettlements).where(eq(rewardActivitySettlements.sessionId, UuidSchema.parse(sessionId)));
  const milliseconds = rows.reduce((total, row) => total + row.milliseconds, 0);
  return { creditedSeconds: Math.floor(milliseconds / 1000), pointsEarned: rows.reduce((total, row) => total + row.points, 0) };
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
