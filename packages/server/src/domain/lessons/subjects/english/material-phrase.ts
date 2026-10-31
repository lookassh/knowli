import { APOSTROPHE_VARIANTS, normalizeTokens } from "../../normalize";
import { withoutLeading } from "./function-words";
import { formsOf } from "./inflection";
import { englishNormalizer } from "./normalizer";

/**
 * Dopasowanie słówka do tekstu źródła (design „Angielski — rozdział” §6.2):
 * `target` wygenerowany przez model pasuje, gdy po normalizacji występuje
 * w tekście jako ciągła fraza na granicach słów. Normalizacja jak w słowniku
 * materiału (§4.4): NFC, małe litery, zwykły apostrof, interpunkcja i łączniki
 * jako odstęp, skróty rozwijane normalizatorem angielskim po obu stronach,
 * prosta odmiana (`formsOf`), pominięte wiodące `a`/`an`/`the`/`to`. Czyste
 * funkcje nad tekstem; nie ogranicza rodzica (sprawdza tylko wyjście modelu).
 *
 * Tekst źródła ma do 16 000 znaków i setki skrótów. Normalizator angielski na
 * całym tekście tworzy iloczyn wariantów przycięty do 32, więc gubiłby dalsze
 * rozwinięcia (i działa w czasie kwadratowym). Indeks rozwija więc każdy token
 * osobno i trzyma rozwinięcia jako alternatywne ścieżki grafu: każde
 * wystąpienie skrótu jest dopasowywalne w każdym rozwinięciu.
 */

/**
 * Znormalizowany tekst źródła do wielokrotnego sprawdzania. Węzły to tokeny po
 * rozwinięciu skrótów; krawędzie prowadzą do następnego tokenu w każdej
 * alternatywie (`it's` → `it`→`is` | `it`→`has`). Kształt wewnętrzny — wywołujący
 * tylko przekazuje indeks do `phraseInMaterial`.
 */
export interface MaterialPhraseIndex {
  /** Formy porównania tokenu węzła (`formsOf`). */
  readonly nodeForms: readonly (readonly string[])[];
  /** Następniki węzła: kolejne tokeny we wszystkich alternatywach. */
  readonly next: readonly (readonly number[])[];
  /** Węzły według formy porównania — początki dopasowania. */
  readonly nodesByForm: ReadonlyMap<string, readonly number[]>;
  /** Pary form sąsiednich węzłów (`formPair`) — szybkie odrzucenie elementu przed przejściem grafu. */
  readonly formPairs: ReadonlySet<string>;
}

/** Klucz pary form sąsiednich tokenów. */
function formPair(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

/**
 * Buduje indeks tekstu źródła: tokenizacja bazowa całego tekstu (liniowo), potem
 * rozwinięcia skrótów i formy odmiany per token (z pamięcią podręczną dla
 * powtarzających się tokenów).
 */
export function materialPhraseIndex(material: string): MaterialPhraseIndex {
  const expansionsCache = new Map<string, readonly (readonly string[])[]>();
  const formsCache = new Map<string, readonly string[]>();
  const nodeForms: (readonly string[])[] = [];
  const next: number[][] = [];
  const nodesByForm = new Map<string, number[]>();

  const addNode = (token: string): number => {
    let forms = formsCache.get(token);
    if (forms === undefined) {
      forms = formsOf(token);
      formsCache.set(token, forms);
    }
    const id = nodeForms.length;
    nodeForms.push(forms);
    next.push([]);
    for (const form of forms) {
      const nodes = nodesByForm.get(form);
      if (nodes === undefined) nodesByForm.set(form, [id]);
      else nodes.push(id);
    }
    return id;
  };

  let previousLasts: readonly number[] = [];
  for (const baseToken of normalizeTokens(material)) {
    let expansions = expansionsCache.get(baseToken);
    if (expansions === undefined) {
      expansions = englishNormalizer.normalize(baseToken).filter((sequence) => sequence.length > 0);
      expansionsCache.set(baseToken, expansions);
    }
    const firsts: number[] = [];
    const lasts: number[] = [];
    for (const sequence of expansions) {
      let previous: number | undefined;
      for (const token of sequence) {
        const id = addNode(token);
        if (previous === undefined) firsts.push(id);
        else next[previous]!.push(id);
        previous = id;
      }
      if (previous !== undefined) lasts.push(previous);
    }
    if (firsts.length === 0) continue;
    for (const last of previousLasts) next[last]!.push(...firsts);
    previousLasts = lasts;
  }

  const formPairs = new Set<string>();
  next.forEach((successors, node) => {
    for (const successor of successors) {
      for (const from of nodeForms[node]!) for (const to of nodeForms[successor]!) formPairs.add(formPair(from, to));
    }
  });

  return { nodeForms, next, nodesByForm, formPairs };
}

/** Warianty normalizacji elementu bez wiodących słów: niepuste, bez powtórzeń, w kolejności normalizatora. */
function targetVariants(target: string): readonly (readonly string[])[] {
  const seen = new Set<string>();
  const variants: (readonly string[])[] = [];
  for (const variant of englishNormalizer.normalize(target)) {
    const tokens = withoutLeading(variant);
    const key = tokens.join(" ");
    if (tokens.length === 0 || seen.has(key)) continue;
    seen.add(key);
    variants.push(tokens);
  }
  return variants;
}

/**
 * `target` występuje w tekście jako ciągła fraza: w którymś wariancie
 * normalizacji (rozwinięcia skrótów elementu) tokeny bez wiodących
 * `a`/`an`/`the`/`to` idą po kolejnych tokenach tekstu, a każda para tokenów jest
 * równa albo ma wspólny rdzeń. Element z samych wiodących słów albo pusty nie
 * pasuje. Ram z lukami nie odrzuca — to `isSentenceFrame`.
 *
 * Przejście frontem (przegląd Etapu 4): dla każdej pozycji wariantu zbiór węzłów,
 * w których może się kończyć dopasowany prefiks — każdy węzeł raz na pozycję,
 * więc praca to O(warianty × pozycje × węzły) zamiast rekurencji wykładniczej
 * w tekście z samych dwuznacznych skrótów. Warianty w kolejności normalizatora
 * dzielą długie prefiksy, więc fronty wspólnego prefiksu z poprzednim wariantem
 * są używane ponownie. Wariant z tokenem bez węzła w tekście albo z parą
 * sąsiednich tokenów, która w tekście nigdzie nie stoi obok siebie, odpada bez
 * przejścia grafu.
 */
export function phraseInMaterial(target: string, index: MaterialPhraseIndex): boolean {
  const variants = targetVariants(target);
  if (variants.length === 0) return false;

  const tokenCache = new Map<string, { forms: readonly string[]; nodeLists: readonly (readonly number[])[] }>();
  /** Formy tokenu elementu i listy węzłów tekstu z tymi formami. */
  const lookup = (token: string) => {
    let entry = tokenCache.get(token);
    if (entry === undefined) {
      const forms = formsOf(token);
      entry = {
        forms,
        nodeLists: forms.flatMap((form) => {
          const nodes = index.nodesByForm.get(form);
          return nodes === undefined ? [] : [nodes];
        }),
      };
      tokenCache.set(token, entry);
    }
    return entry;
  };
  /** Warunek konieczny dopasowania: każdy token i każda para sąsiednich tokenów stoi w tekście. */
  const possible = (tokens: readonly string[]): boolean =>
    tokens.every((token, position) => {
      if (lookup(token).nodeLists.length === 0) return false;
      if (position === 0) return true;
      const before = lookup(tokens[position - 1]!).forms;
      return lookup(token).forms.some((to) => before.some((from) => index.formPairs.has(formPair(from, to))));
    });

  // `mark[node] === stamp` — węzeł pasuje do bieżącej pozycji i nie trafił jeszcze do frontu,
  // więc każdy węzeł wchodzi do frontu pozycji co najwyżej raz.
  const mark = new Int32Array(index.nodeForms.length);
  let stamp = 0;
  const frontierFor = (token: string, previous: readonly number[] | undefined): number[] => {
    stamp += 1;
    const { nodeLists } = lookup(token);
    for (const nodes of nodeLists) {
      for (const node of nodes) mark[node] = stamp;
    }
    const frontier: number[] = [];
    const take = (node: number) => {
      if (mark[node] !== stamp) return;
      mark[node] = 0;
      frontier.push(node);
    };
    if (previous === undefined) {
      for (const nodes of nodeLists) for (const node of nodes) take(node);
    } else {
      for (const node of previous) for (const successor of index.next[node]!) take(successor);
    }
    return frontier;
  };

  // fronts[p] — węzły końca dopasowania pozycji 0..p bieżącego wariantu
  const fronts: number[][] = [];
  let previousTokens: readonly string[] = [];
  for (const tokens of variants) {
    if (!possible(tokens)) continue;
    let shared = 0;
    while (shared < fronts.length && shared < tokens.length && tokens[shared] === previousTokens[shared]) shared += 1;
    fronts.length = shared;
    previousTokens = tokens;
    if (shared > 0 && fronts[shared - 1]!.length === 0) continue;
    for (let position = shared; position < tokens.length; position += 1) {
      const frontier = frontierFor(tokens[position]!, fronts[position - 1]);
      fronts.push(frontier);
      if (frontier.length === 0) break;
    }
    if (fronts.length === tokens.length && fronts[tokens.length - 1]!.length > 0) return true;
  }
  return false;
}

/**
 * Słówko zestawu ze źródła (§6.2) na wyjściu modelu: nie jest ramą z luką
 * (`isSentenceFrame` — rama będąca początkiem zdania tekstu przeszłaby samo
 * dopasowanie, bo luka znika przy normalizacji) i występuje w tekście jako fraza
 * (`phraseInMaterial`). Słowa funkcyjne stojące w tekście („it is”, „today”,
 * „How are you?”) są dozwolone — rozdział uczy też zwrotów i słów pytających,
 * a o doborze decyduje rodzic przy sprawdzaniu szkicu (przegląd Etapu 4).
 * Odrzucane są tylko element pusty i same wiodące `a`/`an`/`the`/`to`.
 */
export function isMaterialVocabularyTarget(target: string, index: MaterialPhraseIndex): boolean {
  return !isSentenceFrame(target) && phraseInMaterial(target, index);
}

/** Końcowa interpunkcja zdania (i spacje między nią) zdejmowana z zapisu słówka. */
const TRAILING_PUNCTUATION: ReadonlySet<string> = new Set([" ", ".", "!", "?", "…", ",", ";", ":"]);

/** Liniowe zdjęcie końcowych znaków ze zbioru (bez wyrażenia z nawrotami). */
function trimTrailing(text: string, chars: ReadonlySet<string>): string {
  let end = text.length;
  while (end > 0 && chars.has(text[end - 1]!)) end -= 1;
  return text.slice(0, end);
}

/**
 * Zapis słówka zestawu ze źródła (przegląd Etapu 4): NFC, apostrofy typograficzne
 * jako `'`, zwinięte białe znaki i bez końcowej interpunkcji (`.`, `!`, `?`, `…`,
 * `,`, `;`, `:`); wewnętrzna interpunkcja zostaje („Mr. Smith's hat”, „yes, please”).
 * Ocena pisemna słówek porównuje tekst co do znaku poza wielkością liter
 * (`matchWrittenAnswer`), więc cel „It's raining.” wzięty ze zdania tekstu
 * odrzucałby poprawne „it's raining” dziecka. Sprawdzenie ramy (`isSentenceFrame`)
 * idzie po surowym celu — zdjęty wielokropek ukryłby lukę.
 */
export function materialTargetText(text: string): string {
  return trimTrailing(text.normalize("NFC").replace(APOSTROPHE_VARIANTS, "'").replace(/\s+/gu, " ").trim(), TRAILING_PUNCTUATION);
}

/**
 * Klucz duplikatu słówka ze źródła (przegląd Etapu 4): tokeny bez wiodących
 * `a`/`an`/`the`/`to` i bez interpunkcji, więc „coat” ≡ „a coat” i „It's raining”
 * ≡ „It's raining.”. Tokeny dokładne — odmiana („coat”/„coats”) i rozwinięcia
 * skrótów („it's”/„it is”) to osobne pozycje do decyzji rodzica.
 */
export function materialTargetMatchKey(target: string): string {
  return withoutLeading(normalizeTokens(target)).join(" ");
}

/** Luka ramy zdaniowej: wielokropek, trzy kropki, co najmniej dwa podkreślenia albo nawias. */
const SENTENCE_FRAME = /…|\.{3}|_{2,}|[()]/u;

/**
 * Rama zdaniowa z luką („I'm wearing (a) …”, „It's ___”) nie jest słówkiem
 * (§6.2) — model czasem wypisuje ją z materiału jako „zwrot”.
 */
export function isSentenceFrame(target: string): boolean {
  return SENTENCE_FRAME.test(target);
}
