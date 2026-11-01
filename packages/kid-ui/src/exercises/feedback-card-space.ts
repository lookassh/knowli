/**
 * Geometria ramy zadania w px wewnętrznych (zoom dużego okna), mierzona przez
 * ExerciseFrame względem górnej krawędzi `.kid-exercise-frame`.
 */
export type FeedbackCardGeometry = {
  /** offsetHeight ramy. */
  frameHeight: number;
  /** Najniższa dolna krawędź dzieci `.kid-material-content` względem górnej krawędzi ramy. */
  contentBottom: number;
  /** scrollTop materiału — przewinięcie korygujące przesuwa treść w górę. */
  scrollTop: number;
  /** Część odstępu od góry zwartej ramy, która już ustąpiła (pełny − bieżący). */
  offsetGiven: number;
  /** Wysokość nakładki panelu (ułamkowa, z prostokąta). */
  overlayHeight: number;
  /** offsetHeight karty wyniku w panelu (bez transformacji animacji wejścia). */
  cardHeight: number;
};

/**
 * Między treścią a panelem i pod panelem: padding treści 4 + odstęp ramy 8
 * + górny padding stopki 8 + dolny padding stopki 4. Tyle zostawia zwarta rama;
 * w zwykłej ramie te same 20 px nad panelem to wybrany odstęp.
 */
export const FEEDBACK_FOOTER_CLEARANCE = 24;

/** Zapas na zaokrąglenia — panel nie styka się z dolną krawędzią ramy. */
export const FEEDBACK_CARD_SLACK = 8;

/**
 * Najwyższa karta wyniku, przy której panel mieści się w wolnym miejscu pod
 * odpowiedzią: nie zasłania treści i kończy się nad dolną krawędzią ramy (spec
 * 2026-10-31-kid-ui-dock-followups §3.1). `null`, gdy miejsca nie ma — wtedy
 * działa dotychczasowy limit karty.
 *
 * Dolna krawędź treści jest liczona tak, jakby panelu nie było: przewinięcie
 * korygujące (`scrollTop`) i ustąpienie odstępu od góry (`offsetGiven`) są
 * cofane, a rezerwa pod panelem treści nie przesuwa. Ponowny pomiar przy
 * widocznym panelu daje więc ten sam wynik i karta nie rośnie w pętli.
 * Reszta panelu (odznaka, odstępy, akcja) to `overlayHeight − cardHeight`.
 */
export function feedbackCardMax(geometry: FeedbackCardGeometry): number | null {
  const { frameHeight, contentBottom, scrollTop, offsetGiven, overlayHeight, cardHeight } = geometry;
  const available = frameHeight - (contentBottom + scrollTop + offsetGiven) - FEEDBACK_FOOTER_CLEARANCE;
  const cardMax = Math.floor(available - FEEDBACK_CARD_SLACK - (overlayHeight - cardHeight));
  return cardMax > 0 ? cardMax : null;
}
