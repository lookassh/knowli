import { messages, type SubjectCatalogDto } from "@learning/contracts";

type CatalogSubject = SubjectCatalogDto["subjects"][number];

/**
 * Informacje o usługach, do których trafia lekcja przedmiotu generowanego agentem puli
 * (wpis katalogu z `checkService`). Pola `null`, gdy przedmiot nie ma nadpisania — wtedy
 * obowiązują dotychczasowe komunikaty (usługa katalogowa i krytyk).
 */
export interface SubjectServiceInfo {
  /** Usługi generujące, np. „host · model, host · model”. */
  generationServices: string | null;
  /** Komunikat o generowaniu (materiał trafia do usług z `generationServices`). */
  generation: string | null;
  /** Komunikat o drugim modelu rozwiązującym ćwiczenia; wariant z materiałem wg polityki checkera. */
  check: string | null;
}

export function subjectServiceInfo(subject: CatalogSubject | undefined): SubjectServiceInfo {
  const checkService = subject?.checkService;
  const services = subject?.generationServices?.join(", ") ?? null;
  if (!checkService) return { generationServices: services, generation: null, check: null };
  const checkTemplate = subject.checkServiceIncludesMaterial ? messages.lessons.checkServiceInfoWithMaterial : messages.lessons.checkServiceInfo;
  return {
    generationServices: services,
    generation: services ? messages.lessons.generationServiceInfo.replace("{service}", () => services) : null,
    check: checkTemplate.replace("{service}", () => checkService),
  };
}
