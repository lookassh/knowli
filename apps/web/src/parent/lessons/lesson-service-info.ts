import { messages, type SubjectCatalogDto } from "@learning/contracts";

type CatalogSubject = SubjectCatalogDto["subjects"][number];

/**
 * Informacje o usługach, do których trafia lekcja przedmiotu przy generowaniu puli
 * (wpis katalogu z `checkService`). Pola `null`, gdy przedmiot nie ma nadpisania — wtedy
 * obowiązuje dotychczasowy komunikat (usługa katalogowa).
 */
export interface SubjectServiceInfo {
  /** Usługi generujące, np. „host · model, host · model”. */
  generationServices: string | null;
  /**
   * Usługa, do której trafiają tematy zdań: sam model paczek (pierwsza z `generationServices`; usługa
   * etapu zagadnień i runu historyjki tematów nie dostaje). Drugi model (`checkService`) tematów nie dostaje,
   * tylko gotowe zdania — mówi o tym sam komunikat `themesService`.
   */
  themesService: string | null;
  /** Komunikat o generowaniu (materiał trafia do usług z `generationServices`). */
  generation: string | null;
  /** Komunikat o drugim modelu sprawdzającym ćwiczenia zamknięte; wariant z materiałem wg `checkServiceIncludesMaterial`. */
  check: string | null;
}

export function subjectServiceInfo(subject: CatalogSubject | undefined): SubjectServiceInfo {
  const checkService = subject?.checkService;
  const list = subject?.generationServices ?? [];
  const services = list.length > 0 ? list.join(", ") : null;
  const themesService = list[0] ?? null;
  if (!checkService) return { generationServices: services, themesService, generation: null, check: null };
  const checkTemplate = subject.checkServiceIncludesMaterial ? messages.lessons.checkServiceInfoWithMaterial : messages.lessons.checkServiceInfo;
  // Kilka usług (paczki i UMIEM_LLM) — liczba mnoga.
  const generationTemplate = list.length > 1 ? messages.lessons.generationServicesInfo : messages.lessons.generationServiceInfo;
  return {
    generationServices: services,
    themesService,
    generation: services ? generationTemplate.replace("{service}", () => services) : null,
    check: checkTemplate.replace("{service}", () => checkService),
  };
}
