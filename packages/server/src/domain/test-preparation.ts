const PREPARATION_WINDOW_MS = 48 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

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

function localParts(format: Intl.DateTimeFormat, instant: number): LocalParts {
  const parts = Object.fromEntries(
    format.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function dateKey({ year, month, day }: LocalParts): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isValidDate(date: string): boolean {
  if (!DATE_PATTERN.test(date)) return false;
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === date;
}

function localMidnight(date: string, format: Intl.DateTimeFormat): number | null {
  const [year, month, day] = date.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  let candidate = target;

  // Convert local wall time to an instant by correcting against the zone's
  // actual offset. Re-evaluate after each correction so DST is handled by
  // calendar rules instead of assuming a fixed offset or 24-hour day.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = localParts(format, candidate);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    candidate += target - represented;

    const resolved = localParts(format, candidate);
    if (
      dateKey(resolved) === date &&
      resolved.hour === 0 &&
      resolved.minute === 0 &&
      resolved.second === 0
    ) {
      return candidate;
    }
  }

  // A few time zones have skipped local midnight transitions. If midnight
  // does not exist, do not enable a priority from an ambiguous boundary.
  return null;
}

export function isTestPreparationWindow(input: {
  now: string;
  testDate: string | null;
  timezone: string;
}): boolean {
  const now = Date.parse(input.now);
  if (!Number.isFinite(now) || input.testDate === null || !isValidDate(input.testDate)) {
    return false;
  }

  try {
    const timeFormatter = formatter(input.timezone);
    const today = dateKey(localParts(timeFormatter, now));
    if (today === input.testDate) return true;
    if (today > input.testDate) return false;

    const start = localMidnight(input.testDate, timeFormatter);
    return start !== null && now < start && start - now <= PREPARATION_WINDOW_MS;
  } catch {
    return false;
  }
}
