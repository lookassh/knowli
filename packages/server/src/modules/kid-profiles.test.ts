import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Services } from "../config";

vi.mock("./reporting", () => ({ readActivitySummary: vi.fn() }));

import { listKidProfiles } from "./kid";
import { readActivitySummary } from "./reporting";

const childId = "10000000-0000-4000-8000-000000000001";

describe("Kid profile activity", () => {
  beforeEach(() => {
    vi.mocked(readActivitySummary).mockReset();
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
              rewardPoints: 7,
            }],
          }),
        }),
      },
    } as unknown as Services;

    await expect(listKidProfiles(services)).resolves.toMatchObject([{
      childId,
      displayName: "Ola",
      rewardPoints: 7,
      todayActivitySeconds: undefined,
      todayActivityUnavailable: true,
    }]);
  });
});
