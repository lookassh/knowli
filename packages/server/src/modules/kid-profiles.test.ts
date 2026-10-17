import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Services } from "../config";

vi.mock("./reporting", () => ({ readActivitySummary: vi.fn() }));
vi.mock("./reward-activity", () => ({ readKidRewardSnapshots: vi.fn() }));

import { listKidProfiles } from "./kid";
import { readActivitySummary } from "./reporting";
import { readKidRewardSnapshots } from "./reward-activity";

const childId = "10000000-0000-4000-8000-000000000001";
const rewards = {
  earnedPoints: 0,
  pointsToUse: 0,
  todayCreditedSeconds: 0,
  readyXboxPacks: 0,
  xboxRequest: null,
  pointsByDeck: new Map(),
};

describe("Kid profile activity", () => {
  beforeEach(() => {
    vi.mocked(readKidRewardSnapshots).mockResolvedValue(new Map([[childId, rewards]]));
  });

  it("keeps profile selection available when today's activity report fails", async () => {
    vi.mocked(readActivitySummary).mockRejectedValue(new Error("report unavailable"));
    const services = {
      db: {
        select: () => ({
          from: () => ({
            orderBy: async () => [{
              childId,
              displayName: "Ola",
              avatarKey: "cat",
              recordingMode: "hold",
              canRead: true,
            }],
          }),
        }),
      },
    } as unknown as Services;

    await expect(listKidProfiles(services)).resolves.toMatchObject([{
      childId,
      displayName: "Ola",
      todayActivitySeconds: undefined,
      todayActivityUnavailable: true,
    }]);
  });
});
