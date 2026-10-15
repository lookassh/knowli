import { type HistoryEntryDto, type ProgressItemDto, type ReportSkill } from "@learning/contracts";

const DUE_STATUSES: ReadonlySet<string> = new Set(["practicing", "needs_reconfirmation"]);

/** Wpisy „Do ćwiczeń" jako para umiejętność + słowo (bez konkatenowanych stringów). */
export function dueEntries(items: ProgressItemDto[]): Array<{ skill: ReportSkill; target: string }> {
  return items.flatMap((item) =>
    (Object.entries(item.skills) as [ReportSkill, string][])
      .filter(([, status]) => DUE_STATUSES.has(status))
      .map(([skill]) => ({ skill, target: item.target })),
  );
}

function two(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Znacznik czasu historii: „dziś, 17:09" / „wczoraj, 18:44" / „12.10.2026".
 * `now` wstrzykiwany dla testów; dni i godziny liczone w UTC, bo DTO niosą
 * instanty, a etykieta ma być stabilna niezależnie od strefy przeglądarki.
 */
export function formatHistoryWhen(receivedAt: string, now: Date): string {
  const received = new Date(receivedAt);
  const utcDay = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const dayDiff = Math.round((utcDay(now) - utcDay(received)) / 86_400_000);
  const time = `${two(received.getUTCHours())}:${two(received.getUTCMinutes())}`;
  if (dayDiff === 0) {
    return `dziś, ${time}`;
  }
  if (dayDiff === 1) {
    return `wczoraj, ${time}`;
  }
  return `${two(received.getUTCDate())}.${two(received.getUTCMonth() + 1)}.${received.getUTCFullYear()}`;
}

export function historyRows(entries: HistoryEntryDto[], now: Date): Array<{
  key: string;
  source: string;
  target: string;
  outcome: HistoryEntryDto["outcome"];
  supported: boolean;
  when: string;
}> {
  return entries.map((entry, index) => ({
    key: `${entry.receivedAt}-${index}`,
    source: entry.source,
    target: entry.target,
    outcome: entry.outcome,
    supported: !entry.independent,
    when: formatHistoryWhen(entry.receivedAt, now),
  }));
}
