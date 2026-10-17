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
  childRewardProjection,
  deckRewardProjection,
  rewardDayProjection,
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
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${task.childId}::text, 0))`);
    const now = services.clock.now();
    const oldStream = (await tx.select().from(rewardActivityStreams)
      .where(eq(rewardActivityStreams.id, valid.streamId)).for("update"))[0];
    if (oldStream) {
      if (!oldStream.active || oldStream.childId !== task.childId || oldStream.sessionId !== session.id || oldStream.taskId !== task.id) {
        throw new AppError("conflict", { message: "reward activity stream is no longer active for this task" });
      }
      if (valid.sequence === oldStream.lastSequence) return dto(oldStream);
      if (valid.kind === "takeover" && oldStream.active) {
        throw new AppError("conflict", { message: "takeover must use a new stream id" });
      }
      if (valid.sequence < oldStream.lastSequence) throw new AppError("conflict", { message: "reward activity sequence is stale" });
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
      if (valid.kind !== "takeover" && !stream) {
        const active = (await tx.select().from(rewardActivityStreams)
          .where(and(eq(rewardActivityStreams.childId, task.childId), eq(rewardActivityStreams.active, true))).for("update"))[0];
        if (active) throw new AppError("conflict", { message: "another device owns the reward activity stream" });
      }
      if (valid.kind === "takeover") {
        const active = (await tx.select().from(rewardActivityStreams)
          .where(and(eq(rewardActivityStreams.childId, task.childId), eq(rewardActivityStreams.active, true))).for("update"))[0];
        if (active) {
          // A takeover may follow a hidden/offline tab whose pause never reached
          // the server. Do not close its unacknowledged tail at takeover time,
          // which would otherwise credit time spent away from the lesson.
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
      const idle = stream.playbackStartedAt === null && now.getTime() >= stream.lastInteractionAt.getTime() + REWARD_ACTIVITY_IDLE_MS;
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
  const previous = (await tx.select({ remainder: childRewardProjection.remainderMilliseconds }).from(childRewardProjection)
    .where(eq(childRewardProjection.childId, input.childId)).for("update"))[0]?.remainder ?? 0;
  const award = rewardAward(credited, previous);
  await tx.update(rewardActivitySettlements).set({ creditedMilliseconds: credited, awardedPoints: award.points, remainderMilliseconds: award.remainderMilliseconds })
    .where(eq(rewardActivitySettlements.id, settlement.id));
  const settledSegments = await tx.select({ start: rewardActivitySegments.startedAt, end: rewardActivitySegments.endedAt, timezone: learningSessions.context })
    .from(rewardActivitySegments).innerJoin(learningSessions, eq(learningSessions.id, rewardActivitySegments.sessionId))
    .where(eq(rewardActivitySegments.settlementRef, settlement.id));
  const dayDeltas = new Map<string, { timezone: string; localDate: string; milliseconds: number }>();
  for (const segment of settledSegments) {
    const context = segment.timezone as { timezone?: unknown };
    const timezone = validRewardTimezone(context?.timezone);
    for (const [localDate, milliseconds] of splitRewardIntervalByLocalDay(segment.start, segment.end, timezone)) {
      const key = `${timezone}:${localDate}`;
      const day = dayDeltas.get(key) ?? { timezone, localDate, milliseconds: 0 };
      day.milliseconds += milliseconds;
      dayDeltas.set(key, day);
    }
  }
  let qualifiedDelta = 0;
  for (const day of dayDeltas.values()) {
    const old = (await tx.select({ milliseconds: rewardDayProjection.creditedMilliseconds }).from(rewardDayProjection).where(and(
      eq(rewardDayProjection.childId, input.childId), eq(rewardDayProjection.timezone, day.timezone), eq(rewardDayProjection.localDate, day.localDate),
    )).for("update"))[0]?.milliseconds ?? 0;
    qualifiedDelta += xboxPacksForDay(old + day.milliseconds) - xboxPacksForDay(old);
    await tx.insert(rewardDayProjection).values({ childId: input.childId, timezone: day.timezone, localDate: day.localDate, creditedMilliseconds: day.milliseconds })
      .onConflictDoUpdate({ target: [rewardDayProjection.childId, rewardDayProjection.timezone, rewardDayProjection.localDate], set: {
        creditedMilliseconds: sql`${rewardDayProjection.creditedMilliseconds} + ${day.milliseconds}`, updatedAt: input.at,
      } });
  }
  await tx.insert(childRewardProjection).values({
    childId: input.childId, earnedPoints: award.points, creditedMilliseconds: credited,
    remainderMilliseconds: award.remainderMilliseconds, qualifiedPacks: qualifiedDelta,
  }).onConflictDoUpdate({ target: childRewardProjection.childId, set: {
    earnedPoints: sql`${childRewardProjection.earnedPoints} + ${award.points}`,
    creditedMilliseconds: sql`${childRewardProjection.creditedMilliseconds} + ${credited}`,
    remainderMilliseconds: award.remainderMilliseconds,
    qualifiedPacks: sql`${childRewardProjection.qualifiedPacks} + ${qualifiedDelta}`,
    updatedAt: input.at,
  } });
  await tx.insert(deckRewardProjection).values({ childId: input.childId, deckId: settlement.deckId, earnedPoints: award.points })
    .onConflictDoUpdate({ target: [deckRewardProjection.childId, deckRewardProjection.deckId], set: {
      earnedPoints: sql`${deckRewardProjection.earnedPoints} + ${award.points}`, updatedAt: input.at,
    } });
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

/** Reads rebuildable reward projections for several profiles with bounded ledger reads. */
export async function readKidRewardSnapshots(services: Services, childIds: string[], now = services.clock.now()): Promise<Map<string, KidRewardSnapshot>> {
  const children = [...new Set(childIds.map(id => UuidSchema.parse(id)))];
  if (!children.length) return new Map();
  const projections = await services.db.select().from(childRewardProjection).where(inArray(childRewardProjection.childId, children));
  const projectionByChild = new Map(projections.map(row => [row.childId, row]));
  const [family] = await services.db.select({ timezone: familySettings.timezone }).from(familySettings).limit(1);
  const currentTimezone = family?.timezone ?? "Europe/Warsaw";
  const timezone = validRewardTimezone(currentTimezone);
  const today = localDateAt(now, timezone);
  const [todayRows, pendingRows, latestResult, deckRows] = await Promise.all([
    services.db.select({ childId: rewardDayProjection.childId, milliseconds: rewardDayProjection.creditedMilliseconds }).from(rewardDayProjection).where(and(
      inArray(rewardDayProjection.childId, children), eq(rewardDayProjection.timezone, timezone), eq(rewardDayProjection.localDate, today),
    )),
    services.db.select().from(rewardActivityXboxRequests).where(and(
      inArray(rewardActivityXboxRequests.childId, children), eq(rewardActivityXboxRequests.status, "pending"),
    )),
    services.db.execute(sql`SELECT requested.child_id AS "childId", latest.id, latest.block_id AS "blockId", latest.status,
        latest.timezone_snapshot AS "timezoneSnapshot", latest.local_date_snapshot AS "localDateSnapshot",
        latest.block_number_snapshot AS "blockNumberSnapshot", latest.credited_seconds_snapshot AS "creditedSecondsSnapshot",
        latest.points_cost AS "pointsCost", latest.xbox_minutes AS "xboxMinutes", latest.requested_at AS "requestedAt"
      FROM unnest(${sql.param(children)}::uuid[]) AS requested(child_id)
      LEFT JOIN LATERAL (
        SELECT * FROM learning_app.reward_activity_xbox_requests request
        WHERE request.child_id = requested.child_id
        ORDER BY request.requested_at DESC, request.id DESC
        LIMIT 1
      ) latest ON true`),
    services.db.select({ childId: deckRewardProjection.childId, deckId: deckRewardProjection.deckId, earnedPoints: deckRewardProjection.earnedPoints })
      .from(deckRewardProjection).where(inArray(deckRewardProjection.childId, children)),
  ]);
  const latestRows = (latestResult.rows as Array<typeof rewardActivityXboxRequests.$inferSelect & { childId: string }>).filter(row => row.id !== null)
    .map(row => ({ ...row, requestedAt: row.requestedAt instanceof Date ? row.requestedAt : new Date(row.requestedAt as unknown as string) }));
  const latestByChild = new Map(latestRows.map(row => [row.childId, row]));
  const pendingByChild = new Map(pendingRows.map(row => [row.childId, row]));
  const todayByChild = new Map(todayRows.map(row => [row.childId, row.milliseconds]));
  const decksByChild = new Map<string, Map<string, number>>();
  for (const row of deckRows) {
    const points = decksByChild.get(row.childId) ?? new Map<string, number>();
    points.set(row.deckId, row.earnedPoints);
    decksByChild.set(row.childId, points);
  }
  const result = new Map<string, KidRewardSnapshot>();
  for (const child of children) {
    const projection = projectionByChild.get(child);
    const earnedPoints = projection?.earnedPoints ?? 0;
    const consumedPacks = projection?.consumedPacks ?? 0;
    const pointsToUse = Math.max(0, earnedPoints - consumedPacks * XBOX_PACK_POINTS);
    const latest = pendingByChild.get(child) ?? latestByChild.get(child);
    result.set(child, {
      earnedPoints, pointsToUse,
      todayCreditedSeconds: Math.floor((todayByChild.get(child) ?? 0) / 1000),
      readyXboxPacks: Math.max(0, Math.min((projection?.qualifiedPacks ?? 0) - consumedPacks, Math.floor(pointsToUse / XBOX_PACK_POINTS))),
      xboxRequest: latest ? xboxRequestDto(latest) : null,
      pointsByDeck: decksByChild.get(child) ?? new Map(),
    });
  }
  return result;
}

/** Reads the child's server-settled reward projections. */
export async function readKidRewardSnapshot(services: Services, childId: string, now = services.clock.now()): Promise<KidRewardSnapshot> {
  return (await readKidRewardSnapshots(services, [childId], now)).get(childId)!;
}

/** Explicitly rebuilds one child's projections from immutable settlements under the settlement lock. */
export async function rebuildKidRewardProjection(services: Services, childId: string): Promise<void> {
  const child = UuidSchema.parse(childId);
  await services.db.transaction(async (tx) => {
    const profile = (await tx.select({ id: childProfiles.id }).from(childProfiles).where(eq(childProfiles.id, child)).for("key share"))[0];
    if (!profile) throw new AppError("not_found");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${child}::text, 0))`);

    const settlements = await tx.select().from(rewardActivitySettlements).where(eq(rewardActivitySettlements.childId, child));
    const earnedPoints = settlements.reduce((sum, row) => sum + row.awardedPoints, 0);
    const creditedMilliseconds = settlements.reduce((sum, row) => sum + Number(row.creditedMilliseconds), 0);
    const byDeck = new Map<string, number>();
    for (const row of settlements) byDeck.set(row.deckId, (byDeck.get(row.deckId) ?? 0) + row.awardedPoints);

    const segments = await tx.select({ start: rewardActivitySegments.startedAt, end: rewardActivitySegments.endedAt, context: learningSessions.context })
      .from(rewardActivitySegments).innerJoin(learningSessions, eq(learningSessions.id, rewardActivitySegments.sessionId))
      .where(and(eq(rewardActivitySegments.childId, child), isNotNull(rewardActivitySegments.settlementRef)));
    const byDay = new Map<string, { timezone: string; localDate: string; milliseconds: number }>();
    for (const segment of segments) {
      const context = segment.context as { timezone?: unknown };
      const timezone = validRewardTimezone(context?.timezone);
      for (const [localDate, milliseconds] of splitRewardIntervalByLocalDay(segment.start, segment.end, timezone)) {
        const key = `${timezone}:${localDate}`;
        const day = byDay.get(key) ?? { timezone, localDate, milliseconds: 0 };
        day.milliseconds += milliseconds;
        byDay.set(key, day);
      }
    }
    const [requestCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(rewardActivityXboxRequests).where(and(
      eq(rewardActivityXboxRequests.childId, child), inArray(rewardActivityXboxRequests.status, ["pending", "fulfilled"]),
    ));

    await tx.delete(rewardDayProjection).where(eq(rewardDayProjection.childId, child));
    await tx.delete(deckRewardProjection).where(eq(deckRewardProjection.childId, child));
    await tx.delete(childRewardProjection).where(eq(childRewardProjection.childId, child));
    if (byDay.size) await tx.insert(rewardDayProjection).values([...byDay.values()].map(day => ({
      childId: child, timezone: day.timezone, localDate: day.localDate, creditedMilliseconds: day.milliseconds,
    })));
    if (byDeck.size) await tx.insert(deckRewardProjection).values([...byDeck].map(([deckId, points]) => ({ childId: child, deckId, earnedPoints: points })));
    await tx.insert(childRewardProjection).values({
      childId: child, earnedPoints, creditedMilliseconds,
      remainderMilliseconds: creditedMilliseconds % REWARD_POINT_INTERVAL_MS,
      qualifiedPacks: [...byDay.values()].reduce((sum, day) => sum + xboxPacksForDay(day.milliseconds), 0),
      consumedPacks: requestCount?.count ?? 0,
      updatedAt: services.clock.now(),
    });
  });
}

/** Rezerwuje najstarszy niewykorzystany pełny blok i stałą cenę w jednej blokadzie per dziecko. */
export async function requestXboxPack(services: Services, childId: string): Promise<XboxRewardRequestDto> {
  const child = UuidSchema.parse(childId);
  return services.db.transaction(async (tx) => {
    const profile = (await tx.select({ id: childProfiles.id }).from(childProfiles).where(eq(childProfiles.id, child)).for("key share"))[0];
    if (!profile) throw new AppError("not_found");
    // Lock order matches session/task operations: profile row before per-child
    // advisory lock. This avoids a DELETE-profile queue forming a lock cycle.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${child}::text, 0))`);

    const pending = (await tx.select().from(rewardActivityXboxRequests).where(and(
      eq(rewardActivityXboxRequests.childId, child), eq(rewardActivityXboxRequests.status, "pending"),
    )).orderBy(asc(rewardActivityXboxRequests.requestedAt)).limit(1).for("update"))[0];
    if (pending) return xboxRequestDto(pending);

    const dailyRows = await tx.select({ timezone: rewardDayProjection.timezone, localDate: rewardDayProjection.localDate, milliseconds: rewardDayProjection.creditedMilliseconds })
      .from(rewardDayProjection).where(eq(rewardDayProjection.childId, child));
    const daily = new Map(dailyRows.map(day => [`${day.timezone}:${day.localDate}`, day]));
    const qualified = [...daily.values()].flatMap((day) => Array.from(
      { length: xboxPacksForDay(day.milliseconds) },
      (_, index) => ({ timezone: day.timezone, localDate: day.localDate, milliseconds: day.milliseconds, blockNumber: index + 1 }),
    ));

    const [projection] = await tx.select().from(childRewardProjection).where(eq(childRewardProjection.childId, child)).for("update");
    const earned = projection?.earnedPoints ?? 0;
    const consumed = projection?.consumedPacks ?? 0;
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
    await tx.insert(childRewardProjection).values({ childId: child, consumedPacks: 1 }).onConflictDoUpdate({
      target: childRewardProjection.childId,
      set: { consumedPacks: sql`${childRewardProjection.consumedPacks} + 1`, updatedAt: now },
    });
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
    if (decision === "rejected") await tx.update(childRewardProjection).set({
      consumedPacks: sql`greatest(0, ${childRewardProjection.consumedPacks} - 1)`, updatedAt: services.clock.now(),
    }).where(eq(childRewardProjection.childId, child));
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
