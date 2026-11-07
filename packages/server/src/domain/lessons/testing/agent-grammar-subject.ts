import { englishGrammarSubject } from "../subjects/english-grammar/module";
import type { SubjectModule } from "../types";

/**
 * Gramatyka na agencie puli — wyłącznie testy mechaniki workera i kierownika agenta (scenariusze
 * `runObjective`) do etapu 5 (#362), który usuwa agenta. Produkcja generuje gramatykę przebiegiem
 * bazowym (`baselinePool`).
 */
export const agentGrammarSubject: SubjectModule = (({ baselinePool: _baseline, ...rest }) => rest)(englishGrammarSubject);
