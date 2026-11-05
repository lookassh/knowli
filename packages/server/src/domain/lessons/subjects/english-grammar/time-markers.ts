import { APOSTROPHE_VARIANTS, normalizeTokens } from "../../normalize";

/**
 * Wskaźniki czasu tematu Present Continuous (design §5.1): zamknięte listy
 * i klasyfikacja tekstu na grupy „teraz” / „zwykle” oraz wskaźniki zakazane
 * (przyszłość i dwuznaczność). Czysta funkcja: bez bazy, sieci i zegara.
 * Listy są jedynym źródłem — z nich budowane są wzorce dopasowania i teksty
 * promptu, więc nie rozjadą się ze sobą.
 *
 * Składnia wpisu listy:
 * - `Look!` — wykrzyknienie: tylko na początku surowego tekstu, po nim `!` albo `,`
 *   (normalizacja tokenów usuwa `!`, więc sprawdzane jest surowe wejście);
 * - `Gdzie jest …` — fraza tylko na początku tekstu (pierwsze tokeny);
 * - `N times a week` — `N` to liczebnik (two…ten) albo liczba cyfrowa;
 * - `next *` — `*` to dowolny jeden token;
 * - pozostałe wpisy to frazy dopasowywane po tokenach `normalizeTokens`.
 */

export type MarkerGroup = "now" | "usually";

export interface MarkerScan {
  readonly groups: ReadonlySet<MarkerGroup>;
  /** Znormalizowane (małe litery) zakazane frazy w kolejności występowania, bez powtórzeń. */
  readonly forbidden: readonly string[];
}

const EN_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const EN_EVERY_NOUNS = ["day", "week", "morning", "evening", "night", "weekend", "summer"];
const PL_WEEKDAYS_LOCATIVE = [
  "w poniedziałki",
  "we wtorki",
  "w środy",
  "w czwartki",
  "w piątki",
  "w soboty",
  "w niedziele",
];

export const TIME_MARKER_LISTS = {
  nowEn: ["now", "right now", "at the moment", "Look!", "Listen!", "Shh!", "Be quiet!"],
  usuallyEn: [
    ...[...EN_EVERY_NOUNS, ...EN_WEEKDAYS].map((noun) => `every ${noun}`),
    "usually",
    "always",
    "often",
    "sometimes",
    "never",
    ...EN_WEEKDAYS.map((day) => `on ${day}s`),
    "at weekends",
    "once a week",
    "twice a week",
    "N times a week",
    "N times a day",
  ],
  nowPl: [
    "teraz",
    "właśnie",
    "w tej chwili",
    "w tym momencie",
    "akurat",
    "Cicho!",
    "Ciii!",
    "Patrz!",
    "Popatrz!",
    "Spójrz!",
    "Zobacz!",
    "Posłuchaj!",
    "Słuchaj!",
    "Gdzie jest …",
    "Gdzie są …",
  ],
  usuallyPl: [
    "codziennie",
    "każdego dnia",
    "każdego ranka",
    "każdego wieczoru",
    "co rano",
    "co wieczór",
    "co tydzień",
    "co sobotę",
    "w każdy",
    "w każdą",
    "w każde",
    ...PL_WEEKDAYS_LOCATIVE,
    "w weekendy",
    "zwykle",
    "zazwyczaj",
    "zawsze",
    "często",
    "czasem",
    "czasami",
    "rzadko",
    "nigdy",
  ],
  forbidden: [
    "tomorrow",
    "tonight",
    "next *",
    "this evening",
    "this morning",
    "this afternoon",
    "today",
    ...EN_WEEKDAYS.map((day) => `on ${day}`),
    "at the weekend",
    "jutro",
    "wieczorem",
    "dzisiaj",
  ],
} as const satisfies Record<string, readonly string[]>;

const NUMBER_WORDS = new Set(["two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]);

interface Phrase {
  readonly tokens: readonly string[];
  readonly kind: "anywhere" | "start" | "exclamation";
}

/** Wpis listy → fraza: rodzaj wynika ze składni wpisu, tokeny z `normalizeTokens`. */
function compile(entry: string): Phrase {
  const kind = entry.endsWith("!") ? "exclamation" : entry.endsWith("…") ? "start" : "anywhere";
  const tokens = entry
    .split(" ")
    .flatMap((word) => (word === "N" || word === "*" ? [word] : normalizeTokens(word)));
  return { tokens, kind };
}

function compileAll(entries: readonly string[]): Phrase[] {
  return entries.map(compile);
}

const PATTERNS = {
  en: {
    now: compileAll(TIME_MARKER_LISTS.nowEn),
    usually: compileAll(TIME_MARKER_LISTS.usuallyEn),
  },
  pl: {
    now: compileAll(TIME_MARKER_LISTS.nowPl),
    usually: compileAll(TIME_MARKER_LISTS.usuallyPl),
  },
} as const;

const FORBIDDEN_PATTERNS = compileAll(TIME_MARKER_LISTS.forbidden);

function tokenMatches(pattern: string, token: string): boolean {
  if (pattern === "*") return true;
  if (pattern === "N") return NUMBER_WORDS.has(token) || /^\d+$/.test(token);
  return pattern === token;
}

function matchesAt(tokens: readonly string[], index: number, phrase: readonly string[]): boolean {
  if (index + phrase.length > tokens.length) return false;
  return phrase.every((part, offset) => tokenMatches(part, tokens[index + offset]!));
}

function matchesAnywhere(tokens: readonly string[], phrase: Phrase): boolean {
  for (let i = 0; i < tokens.length; i += 1) {
    if (matchesAt(tokens, i, phrase.tokens)) return true;
  }
  return false;
}

/** Surowy tekst bez wiodących znaków innych niż litera/cyfra (cudzysłów, myślnik), małymi literami. */
function rawLead(text: string): string {
  return text
    .normalize("NFC")
    .replace(APOSTROPHE_VARIANTS, "'")
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, "");
}

/** Wykrzyknienie na początku surowego tekstu: słowa frazy, potem `!` albo `,`. */
function startsWithExclamation(lead: string, phrase: Phrase): boolean {
  const words = phrase.tokens.join(String.raw`\s+`);
  return new RegExp(String.raw`^${words}\s*[!,]`, "u").test(lead);
}

function hasMarker(
  phrases: readonly Phrase[],
  tokens: readonly string[],
  lead: string,
): boolean {
  return phrases.some((phrase) => {
    if (phrase.kind === "exclamation") return startsWithExclamation(lead, phrase);
    if (phrase.kind === "start") return matchesAt(tokens, 0, phrase.tokens);
    return matchesAnywhere(tokens, phrase);
  });
}

function findForbidden(tokens: readonly string[]): string[] {
  const found: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    for (const phrase of FORBIDDEN_PATTERNS) {
      if (!matchesAt(tokens, i, phrase.tokens)) continue;
      const matched = tokens.slice(i, i + phrase.tokens.length).join(" ");
      if (!found.includes(matched)) found.push(matched);
    }
  }
  return found;
}

/**
 * Klasyfikuje wskaźniki czasu w tekście ćwiczenia (jedno pole). `lang` wybiera
 * listy grup; wskaźniki zakazane (przyszłość, dwuznaczność) są wspólne.
 */
export function scanTimeMarkers(text: string, lang: "en" | "pl"): MarkerScan {
  const tokens = normalizeTokens(text);
  const lead = rawLead(text);
  const patterns = PATTERNS[lang];
  const groups = new Set<MarkerGroup>();
  if (hasMarker(patterns.now, tokens, lead)) groups.add("now");
  if (hasMarker(patterns.usually, tokens, lead)) groups.add("usually");
  return { groups, forbidden: findForbidden(tokens) };
}
