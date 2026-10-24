import { describe, expect, it } from "vitest";
import type { Services } from "../config";

import { listKidProfiles } from "./kid";

const childId = "10000000-0000-4000-8000-000000000001";

describe("Kid profile activity", () => {
  it("keeps profile selection available when the approved-time query fails", async () => {
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
            where: async () => { throw new Error("review query unavailable"); },
          }),
        }),
      },
      clock: { now: () => new Date("2026-10-24T12:00:00.000Z") },
    } as unknown as Services;

    await expect(listKidProfiles(services)).resolves.toMatchObject([{
      childId,
      displayName: "Ola",
      rewardPoints: 7,
      todayActivitySeconds: 0,
      todayActivityUnavailable: true,
    }]);
  });
});
