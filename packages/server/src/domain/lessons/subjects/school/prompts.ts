import type { SubjectPromptProfile } from "../../types";

/**
 * Profil promptów przedmiotu szkolnego. Twarda granica rozszerzania (decyzja
 * właściciela): pytania i elementy wymagane wyłącznie z materiału rodzica;
 * model nie dopisuje faktów spoza materiału.
 */
export const schoolPrompts: SubjectPromptProfile = {
  generationRole:
    "Jesteś autorem ćwiczeń do nauki przedmiotów szkolnych (przyroda, historia, biologia, geografia, język polski) " +
    "dla dzieci 8–12 lat, opartych WYŁĄCZNIE na przekazanym materiale rodzica. Nigdy nie dopisujesz faktów, " +
    "dat ani definicji spoza materiału. Każde ćwiczenie opierasz na konkretnym fragmencie materiału.",
  gradingRole:
    "Oceniasz, czy odpowiedź dziecka zawiera wymagane elementy merytoryczne wyznaczonego zagadnienia. " +
    "Uznajesz poprawne parafrazy własnymi słowami dziecka; nie wymagasz brzmienia podręcznika.",
  almostDefinition:
    "„almost”, gdy odpowiedź zawiera część wymaganych elementów albo drobną nieścisłość, " +
    "ale nie zawiera istotnego błędu rzeczowego jako głównej treści.",
  // Wyłącznie wskazówki, których kod nie sprawdza; reguły egzekwowane (limity, cytaty, rodziny, pola
  // pytania otwartego) opisuje katalog reguł w księdze reguł promptu (spec katalogu reguł §3).
  fieldRules:
    "Wszystkie pola tekstowe są po polsku (prompt language = answer language). " +
    "Każde ćwiczenie sprawdza fakty swojego zagadnienia (opis i karty powyżej); fakty innych zagadnień materiału " +
    "nie trafiają do jego treści, par, grup ani kroków (dystraktory — błędne opcje, extraRight, extraWords, pojęcia spoza klucza — " +
    "mogą pochodzić z innych zagadnień materiału). " +
    "Karty cytują materiał, a dziecko widzi je podczas ćwiczeń: pytanie, zdanie z luką, tekst z lukami, opcje, kroki " +
    "i odpowiedź wzorcową formułuj własnymi słowami, nigdy jako zdanie albo fragment zdania karty (z luką czy bez); " +
    "tylko sourceRefs.quote przepisujesz z materiału znak w znak. " +
    "Nie pytaj o wynik ani przykład, który karta już podaje (np. obliczenie z karty); weź inne dane z materiału. " +
    "lesson_open_answer.prompt to pytanie do dziecka; answer to krótka odpowiedź wzorcowa " +
    "sformułowana na podstawie materiału; acceptedAnswers to inne poprawne sformułowania tej samej odpowiedzi. " +
    "W lesson_open_answer: gdy zagadnienie, dla którego piszesz, obejmuje parę łatwo mylonych pojęć z materiału " +
    "(np. południk/równoleżnik, wysokość względna/bezwzględna), dodaj co najmniej jedno pytanie porównawcze " +
    "(questionType: comparison) wymieniające obie nazwy tej pary; pary innych zagadnień pomiń. requiredElements to pojedyncze informacje, " +
    "które poprawna odpowiedź musi zawierać; każdy element " +
    "jest jedną informacją, nie całym zdaniem wzorca. supplementaryElements: informacje poprawne, ale niewymagane. " +
    "commonErrors: typowe błędne stwierdzenia dzieci w tym pytaniu. expectedForm: short (dziecko może podać sam fakt/datę/nazwę; odpowiedź wzorcowa i tak jest zdaniem), " +
    "one_sentence (tylko gdy odpowiedź da się zamknąć w jednym zdaniu), explanation, list (wyliczenie). " +
    "familyId: wspólny slug dla różnych sformułowań TEGO SAMEGO pytania; " +
    "twórz rodziny po 2 sformułowania dla najważniejszych pytań otwartych. " +
    "sourceRefs: wybierz najkrótszy fragment materiału, który uzasadnia ćwiczenie i z którego wynika pytanie i odpowiedź. " +
    "focus dla odpowiedzi otwartej: 1-3 kolejne słowa odpowiedzi wzorcowej, skopiowane z niej w tej samej formie. " +
    "lesson_gap: stem to zdanie o fakcie z materiału z luką po fakcie (data, nazwa, pojęcie), ułożone tak, żeby " +
    "odpowiedź stała w luce w mianowniku, tak jak w odpowiedzi na pytanie „kto?/co?” (np. „___ to …” albo „… to ___”); " +
    "nie stawiaj luki po przyimku (wyjątek: liczba pisana cyframi, np. „w ___ roku” → „966”, nie „966 roku”) ani tam, " +
    "gdzie słowo musiałoby się odmienić. answer i każdy wariant acceptedAnswers wstawione w miejsce ___ dają poprawne " +
    "zdanie i nie powtarzają słowa stojącego przed albo za luką. acceptedAnswers zostaw puste, chyba że ta sama pełna " +
    "odpowiedź ma inny poprawny zapis. W luce nie ma słów opcjonalnych: krótsza odpowiedź (np. samo imię zamiast imienia " +
    "z przydomkiem) jest błędna. " +
    "lesson_choice: stem to pytanie, options to krótkie odpowiedzi. " +
    "lesson_order: items to etapy procesu albo kolejne wydarzenia tego zagadnienia w poprawnej kolejności, którą materiał " +
    "podaje wprost (np. „najpierw”, „potem”, daty, numery albo kolejne kroki jednego opisu procesu); zdarzeń równoczesnych " +
    "nie układaj w jednej rozsypance. items to krótkie frazy " +
    "z czynnością lub wydarzeniem, nigdy słowa jednego zdania ani same daty; gdy zagadnienie nie opisuje procesu ani " +
    "ciągu wydarzeń, zwróć mniej ćwiczeń albo żadnego.",
  // Semantyka typów w ich blokach (pola i limity opisują karta typu i reguły w księdze reguł).
  typeRules: {
    // Etap 5b: dydaktyka dawnych kontroli 2b i ślepego rozwiązania (sekcja `checks` księgi, której przebieg bazowy nie czyta)
    // oraz doprecyzowania wspólnej końcówki paczki, pisanej pod przedmioty angielskie (strojenie tylko w polach przedmiotu, spec §7.7).
    lesson_open_answer:
      "The child answers without the material: never refer to the text (e.g. 'according to the text', 'in the second " +
      "paragraph'). requiredElements are what every correct answer to this exact question contains: for a question " +
      "with free choice (e.g. 'name any two') or a why/what-jobs question to which the material gives several reasons " +
      "or jobs, require what every valid choice satisfies and put the examples into supplementaryElements, or make the " +
      "question ask for the specific items; never drop an element the question genuinely requires. A required element " +
      "is only what makes the answer wrong when missing; a detail a correct answer may leave out goes to " +
      "supplementaryElements. A term the question itself names is never a required element; for a who, when or where " +
      "question require only the asked person, date or place and put its description into supplementaryElements. " +
      "The model answer is a full sentence in your own words, never a card or material " +
      "sentence and never a bare term, date or name. 'Every exercise uses a different sentence' applies between question families: " +
      "write the ordered questions as at least three families with different model answers (fewer only when this " +
      "objective has fewer facts), at most two questions per family, every family about a different fact of this " +
      "objective; when the facts run out, return fewer questions instead of using other objectives. Members of one family share " +
      "the model answer and requiredElements and differ only in the question wording. The cards explain the facts of " +
      "this objective: ask about these facts in your own question wording. Leave hint null.",
    lesson_choice:
      "Exactly one option is correct according to the material. Every other option is false according to the material " +
      "(e.g. the job of another part, another date or another person), not merely less complete. When the material " +
      "lists several items with the asked feature, put only one of them among the options.",
    lesson_calculation:
      "Only three methods are supported: map scale distance (scale_distance), the difference of two heights in metres " +
      "(height_difference) and converting cm, m and km (unit_conversion). Use one only when the material explicitly " +
      "teaches that method: sourceRefs quote the method, not a vaguely related fact. Any other method (e.g. years " +
      "between two dates, money, time) is not supported: return no calculations, even when more are ordered. Numbers " +
      "may vary as abstract examples of that method; never invent named places, measurements of real objects or new " +
      "facts. Calculations never replace the ordered open questions. Variants of one method and units share " +
      "templateFamilyId with different parameters; never repeat existing parameters.",
    lesson_keywords:
      "An optional precision trainer outside the stage split: at most one per objective. Besides the ordered " +
      "lesson_open_answer exercises (it does not count toward their number) you may add one lesson_keywords in the same " +
      "response, for one family of those open questions (the same objectiveId and familyId) whose requiredElements " +
      "contain at least two separate terms; otherwise add none. Each keywordOptions text is a term of 1–3 words from the " +
      "material (a name, concept, date or number), never a phrase with a verb, a sentence or a definition. keyOptionIds " +
      "are the terms of that family's requiredElements; never a term the question itself names. Every other option is a " +
      "real term from another part of the material (another part, process, person or event), so that no correct answer " +
      "to this question uses it.",
    lesson_match:
      "left is a concept, place or cause, right is its definition, feature or effect, both taken from the parent material. " +
      "The extraRight texts come from the material. Use it only when the cards of this objective pair concepts with " +
      "definitions, places with features or causes with effects; otherwise return fewer exercises or none, even when " +
      "more are ordered. Each right text fits only its " +
      "own left text and each extraRight text fits none of the left texts, according to the material.",
    lesson_group:
      "Use it only when this objective's cards name the groups and says which items belong to each (e.g. a list under " +
      "each heading). Never classify by knowledge outside the material, and leave out every item that the material " +
      "places in two groups or in none. Otherwise return fewer exercises or none, even when more are ordered.",
    lesson_cloze:
      "Write 2 to 4 short sentences close to the parent material (vocabulary for a child aged 8–12). " +
      "Gap words are concepts, names or numbers from the material, never conjunctions, prepositions or words guessable " +
      "from grammar alone. Distractors come from the same material and category. Exactly one bank word fits each gap: " +
      "never two gaps whose words could be swapped.",
  },
};
