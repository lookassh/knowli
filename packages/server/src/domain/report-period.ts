const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type ReportPeriod = {
  from: string;
  to: string;
  days: number;
  dates: readonly string[];
  startUtc: string;
  endExclusiveUtc: string;
};

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function formatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

function partsAt(format: Intl.DateTimeFormat, instant: number): LocalParts {
  const parts = Object.fromEntries(
    format.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]),
  );
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
  };
}

function dateString({ year, month, day }: LocalParts): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(day: string, count: number): string {
  const stamp = Date.parse(`${day}T00:00:00.000Z`);
  return new Date(stamp + count * 86_400_000).toISOString().slice(0, 10);
}

function localMidnight(day: string, format: Intl.DateTimeFormat): number {
  const [year, month, date] = day.split("-").map(Number);
  const target = Date.UTC(year, month - 1, date);
  let candidate = target;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = partsAt(format, candidate);
    const represented = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    candidate += target - represented;
    const resolved = partsAt(format, candidate);
    if (dateString(resolved) === day && resolved.hour === 0 && resolved.minute === 0 && resolved.second === 0) {
      return candidate;
    }
  }
  throw new RangeError(`Local midnight does not exist for ${day}`);
}

export function buildReportPeriod(now: string, timezone: string, days: number): ReportPeriod {
  const instant = Date.parse(now);
  if (!Number.isFinite(instant)) throw new RangeError("Invalid report instant");
  if (!Number.isInteger(days) || days < 1 || days > 31) throw new RangeError("Invalid report period length");

  let timeFormatter: Intl.DateTimeFormat;
  try {
    timeFormatter = formatter(timezone);
    // Force ICU to validate the zone before deriving any date boundaries.
    timeFormatter.format(new Date(instant));
  } catch {
    throw new RangeError("Invalid IANA timezone");
  }

  const to = dateString(partsAt(timeFormatter, instant));
  const from = addDays(to, 1 - days);
  const dates = Array.from({ length: days }, (_, index) => addDays(from, index));
  const start = localMidnight(from, timeFormatter);
  const end = localMidnight(addDays(to, 1), timeFormatter);
  return {
    from,
    to,
    days,
    dates,
    startUtc: new Date(start).toISOString(),
    endExclusiveUtc: new Date(end).toISOString(),
  };
}
