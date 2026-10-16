import { describe, expect, it } from "vitest";
import { RewardActivitySignalSchema } from "./reward-activity";

describe("reward activity contracts", () => {
  it("accepts bounded signals without client time or elapsed duration", () => {
    expect(RewardActivitySignalSchema.parse({
      sessionId: "00000000-0000-4000-8000-000000000001",
      taskId: "00000000-0000-4000-8000-000000000002",
      streamId: "00000000-0000-4000-8000-000000000003",
      sequence: 1,
      kind: "interaction",
    })).toBeDefined();
  });

  it("rejects client supplied time and invalid sequences", () => {
    const base = {
      sessionId: "00000000-0000-4000-8000-000000000001",
      taskId: "00000000-0000-4000-8000-000000000002",
      streamId: "00000000-0000-4000-8000-000000000003",
      sequence: 0,
      kind: "heartbeat",
    };
    expect(RewardActivitySignalSchema.safeParse(base).success).toBe(false);
    expect(RewardActivitySignalSchema.safeParse({ ...base, sequence: 1, elapsedSeconds: 3600 }).success).toBe(false);
  });

  it("requires the server-issued capability and exact asset for playback", () => {
    const base = {
      sessionId: "00000000-0000-4000-8000-000000000001",
      taskId: "00000000-0000-4000-8000-000000000002",
      streamId: "00000000-0000-4000-8000-000000000003",
      sequence: 2,
      kind: "playback_start",
    };
    expect(RewardActivitySignalSchema.safeParse(base).success).toBe(false);
    expect(RewardActivitySignalSchema.safeParse({ ...base, playbackAuthorizationId: "00000000-0000-4000-8000-000000000004", playbackAssetId: "00000000-0000-4000-8000-000000000005" }).success).toBe(true);
  });

  it("accepts pause reasons only on pause signals", () => {
    const base = {
      sessionId: "00000000-0000-4000-8000-000000000001",
      taskId: "00000000-0000-4000-8000-000000000002",
      streamId: "00000000-0000-4000-8000-000000000003",
      sequence: 1,
    };
    expect(RewardActivitySignalSchema.safeParse({ ...base, kind: "interaction", pauseReason: "offline" }).success).toBe(false);
    expect(RewardActivitySignalSchema.safeParse({ ...base, kind: "pause", pauseReason: "offline" }).success).toBe(true);
  });
});
