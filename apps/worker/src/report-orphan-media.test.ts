import { describe, expect, it } from "vitest";
import { parseOrphanReportArgs } from "./report-orphan-media";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("parseOrphanReportArgs", () => {
  it("bez opcji zostawia domyślny okres karencji serwera", () => {
    expect(parseOrphanReportArgs([])).toEqual({});
  });

  it("przelicza jawny próg wieku z dni na milisekundy", () => {
    expect(parseOrphanReportArgs(["--min-age-days", "30"])).toEqual({ minAgeMs: 30 * DAY_MS });
    expect(parseOrphanReportArgs(["--min-age-days", "0"])).toEqual({ minAgeMs: 0 });
  });

  it("odrzuca tryb kasowania i inne nieznane opcje — raport jest wyłącznie dry-run", () => {
    expect(() => parseOrphanReportArgs(["--delete"])).toThrow(/Invalid arguments/);
    expect(() => parseOrphanReportArgs(["--apply"])).toThrow(/Invalid arguments/);
    expect(() => parseOrphanReportArgs(["--min-age-days"])).toThrow(/Invalid arguments/);
    expect(() => parseOrphanReportArgs(["--min-age-days", "-1"])).toThrow(/Invalid arguments/);
    expect(() => parseOrphanReportArgs(["--min-age-days", "7", "--min-age-days", "8"])).toThrow(/Invalid arguments/);
  });
});
