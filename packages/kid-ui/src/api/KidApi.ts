import type {
  MockTestSummaryDto,
  UiAudioCatalogDto,
  LessonMockTestSummaryDto,
  AttemptDto,
  AttemptInput,
  DictationDto,
  DisclosureDto,
  FeedbackAudioDto,
  EventInput,
  KidDeckDto,
  KidProfileDto,
  PresentationCompletionDto,
  SessionActivityReport,
  SessionActivityResultDto,
  SessionDto,
  SessionInput,
  SessionSummaryDto,
  TaskDto,
} from "@learning/contracts";
import type { RecordedAudio } from "../media/platform";

/**
 * Jawne API interfejsu dziecka (architecture.md §12) za konfigurowalnym
 * baseUrl. Pakiet jest przenośny: nie importuje Next.js, serwera ani bazy.
 * Odpowiedzi zawierają wyłącznie publiczne DTO — bez klucza odpowiedzi,
 * kryteriów oceny i technicznych score'ów.
 */
export interface KidApi {
  readUiAudio(): Promise<UiAudioCatalogDto>;
  readMockTestSummary(sessionId: string): Promise<MockTestSummaryDto>;
  /** Omówienie kartkówki lekcji (sesja lekcji) — per cel zamiast per umiejętność. */
  readLessonMockTestSummary(sessionId: string): Promise<LessonMockTestSummaryDto>;
  /**
   * Trwały status asynchronicznej oceny aktywności; `already_started` oznacza
   * oczekiwanie. Opcjonalne dla zgodności starszych hostów, których endSession
   * zwraca wynik terminalny synchronicznie. Hosty asynchroniczne implementują GET.
   */
  readSessionActivityResult?(sessionId: string): Promise<SessionActivityResultDto>;
  listProfiles(): Promise<KidProfileDto[]>;
  listDecks(childId: string, options?: { microphoneEnabled?: boolean }): Promise<KidDeckDto[]>;
  startSession(input: SessionInput): Promise<SessionDto>;
  /** Idempotentne wydanie aktywnego zadania; null oznacza koniec sesji. */
  nextTask(sessionId: string): Promise<TaskDto | null>;
  /** Odpowiedź tekstowa/wybór/nie pamiętam/pomiń (audio ma osobną ścieżkę). */
  submitAnswer(input: Exclude<AttemptInput, { modality: "audio" }>): Promise<AttemptDto>;
  /** Odpowiedź ustna: multipart z bajtami nagrania, 202 dla processing. */
  submitSpeech(taskId: string, clientAttemptId: string, audio: RecordedAudio): Promise<AttemptDto>;
  /**
   * Dyktowanie odpowiedzi lekcji: tekst do pola albo powód jego braku. Nie
   * tworzy próby ani oceny. Opcjonalne dla hostów bez tej ścieżki.
   */
  dictate?(taskId: string, audio: RecordedAudio): Promise<DictationDto>;
  readAttempt(attemptId: string): Promise<AttemptDto>;
  /** Zapis ekspozycji i zgoda na podpowiedź/odtworzenie wzorca (arch §9.2). */
  authorizeDisclosure(taskId: string, kind: "audio" | "hint"): Promise<DisclosureDto>;
  /** Autoryzacja wzorca z aktualnego feedbacku; serwer ponownie sprawdza próbę i kartę. */
  authorizeFeedbackAudio(attemptId: string): Promise<FeedbackAudioDto>;
  completePresentation(taskId: string, clientCommandId?: string): Promise<PresentationCompletionDto>;
  /** Opcjonalne potwierdzenie obserwacji; nie jest jedynym dowodem ujawnienia. */
  recordObservation(input: EventInput): Promise<void>;
  /**
   * Zakończenie sesji z opcjonalnym lokalnym raportem aktywności (jeden na
   * sesję; identyczne ponowienie zwraca zapisany wynik bez drugiego naliczenia).
   */
  endSession(sessionId: string, activityReport?: SessionActivityReport): Promise<SessionSummaryDto>;
  disableMicrophone(sessionId: string): Promise<SessionDto>;
  /** Adres nieprzejrzystego zasobu media (same-origin, immutable cache). */
  mediaUrl(assetId: string): string;
}
