import { normalizeTokens } from "../../normalize";
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

  return { nodeForms, next, nodesByForm };
}

/** Czy token węzła ma wspólną formę z tokenem elementu (równy albo ten sam rdzeń). */
function sharesForm(nodeForms: readonly string[], targetForms: ReadonlySet<string>): boolean {
  return nodeForms.some((form) => targetForms.has(form));
}

/** Czy dalsze tokeny elementu (od `position`) idą po kolejnych węzłach grafu od `node`. */
function continuesFrom(index: MaterialPhraseIndex, node: number, target: readonly ReadonlySet<string>[], position: number): boolean {
  if (position === target.length) return true;
  const forms = target[position]!;
  return index.next[node]!.some(
    (successor) => sharesForm(index.nodeForms[successor]!, forms) && continuesFrom(index, successor, target, position + 1),
  );
}

/**
 * `target` występuje w tekście jako ciągła fraza: w którymś wariancie
 * normalizacji (rozwinięcia skrótów elementu) tokeny bez wiodących
 * `a`/`an`/`the`/`to` idą po kolejnych tokenach tekstu, a każda para tokenów jest
 * równa albo ma wspólny rdzeń. Element z samych wiodących słów albo pusty nie
 * pasuje. Ram z lukami nie odrzuca — to `isSentenceFrame`.
 */
export function phraseInMaterial(target: string, index: MaterialPhraseIndex): boolean {
  for (const variant of englishNormalizer.normalize(target)) {
    const tokens = withoutLeading(variant);
    if (tokens.length === 0) continue;
    const forms = tokens.map((token) => new Set(formsOf(token)));
    const starts = new Set<number>();
    for (const form of forms[0]!) {
      for (const node of index.nodesByForm.get(form) ?? []) starts.add(node);
    }
    for (const start of starts) {
      if (continuesFrom(index, start, forms, 1)) return true;
    }
  }
  return false;
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
