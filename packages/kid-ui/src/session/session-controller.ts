import {
  messages,
  type AttemptDto,
  type FeedbackDto,
  type KidDeckDto,
  type KidProfileDto,
  type SessionDto,
  type SessionSummaryDto,
  type TaskDto,
} from "@learning/contracts";
import type { KidApi } from "../api/KidApi";
import { isNetworkError, KidApiError } from "../api/client";
import type { PlatformMedia, SpeechRecorder } from "../media/platform";
import { MIC_DENIED_KEY, type LocalPreferences } from "../storage";
import { randomUUID } from "./uuid";

/**
 * Sterownik przepływu nauki (plan zadania 9): czysta maszyna stanu nad
 * Kid API, bez Reacta — komponenty subskrybują snapshoty przez hook.
 *
 * Zasady wynikające ze SPEC/architektury, pilnowane tutaj:
 * - autoryzacja serwerowa PRZED odtworzeniem wzorca i podpowiedzią, także
 *   z cache (arch §9.2) — znaczenie odsłuchu zależy od typu zadania (§13.2);
 * - utrata sieci ukrywa wzorce, blokuje odsłuchy i oceniane próby; sukces
 *   pochodzi wyłącznie z odpowiedzi serwera, nigdy lokalnie;
 * - retry po awarii sieci używa tego samego clientAttemptId (A20);
 * - odmowa mikrofonu przełącza na tryb bez nagrywania i jest zapamiętywana;
 * - po obiecanej liczbie zadań nie dokładamy nowych (banner „Jeszcze N”);
 * - opuszczenie widoku zatrzymuje nagrywanie i odtwarzanie (RF5).
 */

export interface LearningScreen {
  kind: "learning";
  session: SessionDto;
  task: TaskDto | null;
  /**
   * Feedback po próbie; retry=true, gdy zadanie ma drugie podejście.
   * `chosenOptionId` różni próbę wyboru od pozostałych i zasila
   * podświetlenie opcji w siatce odpowiedzi (design 2026-10-09).
   */
  feedback: { dto: FeedbackDto | null; retry: boolean; chosenOptionId?: string } | null;
  /** Ujawniona podpowiedź czekająca na potwierdzenie dziecka. */
  reveal: { target: string } | null;
  offline: boolean;
  busy: boolean;
  micDenied: boolean;
  recording: boolean;
  /** Odpowiedź ustna w drodze/oceniana przez serwer. */
  processing: boolean;
  /** Błąd aplikacji (nie sieci) z przyciskiem ponowienia. */
  error: string | null;
}

export type KidScreen =
  | { kind: "loading" }
  | { kind: "initError"; message: string }
  | { kind: "profile"; profiles: KidProfileDto[] }
  | {
      kind: "deck";
      profiles: KidProfileDto[];
      childId: string;
      decks: KidDeckDto[];
      microphone: boolean;
      micDenied: boolean;
    }
  | LearningScreen
  | { kind: "summary"; childId: string; profiles: KidProfileDto[]; summary: SessionSummaryDto };

export interface LearningSessionDeps {
  api: KidApi;
  media: PlatformMedia;
  storage: LocalPreferences;
  /** Profile requested by the host route; ignored if it is no longer available. */
  initialChildId?: string;
  /** Odstęp odpytywania o wynik oceny mowy (testy skracają). */
  pollIntervalMs?: number;
}

/** Payload odpowiedzi bez kluczy transportowych — audio ma osobną ścieżkę. */
type AnswerPayload =
  | { modality: "choice"; optionId: string }
  | { modality: "text"; text: string }
  | { modality: "dont_remember" }
  | { modality: "skip" };

const POLL_INTERVAL_MS = 1_000;
const POLL_DEADLINE_MS = 90_000;
const REMAINING_BANNER_FROM = 3;

function messageForError(error: unknown): string {
  if (error instanceof KidApiError) {
    return messages.errors[error.code] ?? messages.errors.internal!;
  }
  return messages.errors.internal!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function audioAssetOf(task: TaskDto): string | null {
  if (task.prompt.kind === "exposure" || task.prompt.kind === "listening" || task.prompt.kind === "speech") {
    return task.prompt.audioAssetId;
  }
  return null;
}

export class LearningSessionController {
  readonly #api: KidApi;
  readonly #media: PlatformMedia;
  readonly #storage: LocalPreferences;
  readonly #pollIntervalMs: number;
  readonly #initialChildId: string | undefined;

  #screen: KidScreen = { kind: "loading" };
  #listeners = new Set<() => void>();
  #profiles: KidProfileDto[] = [];
  #childId: string | null = null;
  #micDenied = false;
  #recorder: SpeechRecorder | null = null;
  /** Ostatnia operacja do ponowienia po powrocie sieci/błędzie aplikacji. */
  #resume: (() => Promise<void>) | null = null;
  /** Wybrana opcja próby w toku; do podświetlenia w feedbacku (design 2026-10-09). */
  #pendingChoice: string | null = null;
  /** Wycofuje operacje zdążające po zmianie ekranu/teardown. */
  #epoch = 0;

  constructor(deps: LearningSessionDeps) {
    this.#api = deps.api;
    this.#media = deps.media;
    this.#storage = deps.storage;
    this.#pollIntervalMs = deps.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.#initialChildId = deps.initialChildId;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getScreen = (): KidScreen => this.#screen;

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }

  #learning(): LearningScreen | null {
    return this.#screen.kind === "learning" ? this.#screen : null;
  }

  #setLearning(patch: Partial<LearningScreen>): void {
    if (this.#screen.kind !== "learning") return;
    this.#screen = { ...this.#screen, ...patch };
    this.#emit();
  }

  async start(): Promise<void> {
    try {
      this.#profiles = await this.#api.listProfiles();
      if (this.#initialChildId !== undefined) {
        const requestedProfile = this.#profiles.find((profile) => profile.childId === this.#initialChildId);
        if (requestedProfile) {
          await this.#openDeckScreen(requestedProfile.childId);
          return;
        }
        // A stale or mistyped profile URL falls back to the available profiles.
        this.#screen = { kind: "profile", profiles: this.#profiles };
      } else {
        this.#screen = { kind: "profile", profiles: this.#profiles };
      }
    } catch (error) {
      this.#screen = { kind: "initError", message: messageForError(error) };
    }
    this.#emit();
  }

  async selectProfile(childId: string): Promise<void> {
    this.#epoch += 1;
    this.#teardownRecording();
    this.#media.player.stop();
    this.#screen = { kind: "loading" };
    this.#emit();
    await this.#openDeckScreen(childId);
  }

  async #openDeckScreen(childId: string): Promise<void> {
    const epoch = this.#epoch;
    try {
      const decks = await this.#api.listDecks(childId);
      if (epoch !== this.#epoch) return;
      this.#childId = childId;
      this.#micDenied = this.#storage.read(MIC_DENIED_KEY) === "1";
      this.#screen = {
        kind: "deck",
        profiles: this.#profiles,
        childId,
        decks,
        microphone: !this.#micDenied,
        micDenied: this.#micDenied,
      };
    } catch (error) {
      if (epoch !== this.#epoch) return;
      this.#screen = { kind: "initError", message: messageForError(error) };
    }
    this.#emit();
  }

  setMicrophone(on: boolean): void {
    if (this.#screen.kind !== "deck") return;
    // jawny wybór rodzica/dziecka nadpisuje zapamiętaną odmowę w obie strony —
    // po odmowie przełącznik nadal pozwala wrócić do nagrywania (SPEC §14)
    this.#micDenied = !on;
    if (on) {
      this.#storage.remove(MIC_DENIED_KEY);
    } else {
      this.#storage.write(MIC_DENIED_KEY, "1");
    }
    this.#screen = { ...this.#screen, microphone: on, micDenied: !on };
    this.#emit();
  }

  async startLearning(deckId: string): Promise<void> {
    if (this.#screen.kind !== "deck") return;
    const { childId, microphone } = this.#screen;
    this.#epoch += 1;
    const epoch = this.#epoch;
    // nowa sesja nie dziedziczy wyboru z poprzedniej (np. przerwanego awarią)
    this.#pendingChoice = null;
    try {
      const session = await this.#api.startSession({ childId, deckId, microphoneEnabled: microphone });
      if (epoch !== this.#epoch) return;
      this.#screen = {
        kind: "learning",
        session,
        task: null,
        feedback: null,
        reveal: null,
        offline: false,
        busy: true,
        micDenied: this.#micDenied,
        recording: false,
        processing: false,
        error: null,
      };
      this.#emit();
      await this.#loadNext(epoch, session.sessionId);
    } catch (error) {
      if (epoch !== this.#epoch) return;
      this.#screen = { kind: "initError", message: messageForError(error) };
      this.#emit();
    }
  }

  async #loadNext(epoch: number, sessionId: string): Promise<void> {
    this.#resume = () => this.#loadNext(epoch, sessionId);
    try {
      const task = await this.#api.nextTask(sessionId);
      if (epoch !== this.#epoch || this.#screen.kind !== "learning") return;
      if (task === null) {
        await this.#finishSession(epoch);
        return;
      }
      // odsłuch poprzedniego zadania nie przenosi się do następnego
      this.#media.player.stop();
      this.#screen = {
        ...this.#screen,
        task,
        feedback: null,
        reveal: null,
        busy: false,
        offline: false,
        processing: false,
        error: null,
      };
      this.#emit();
      // prezentacja od razu odtwarza wzorcową wymowę, a pytanie słuchowe
      // stanowi treść zadania (SPEC §12.1, §12.2); ograniczenia urządzenia
      // łapiemy cicho — pozostaje widoczny przycisk odsłuchu
      if (task.exerciseType === "exposure" || task.exerciseType === "listening") {
        void this.playTaskAudio().catch(() => undefined);
      }
    } catch (error) {
      if (epoch !== this.#epoch || this.#screen.kind !== "learning") return;
      this.#handleFailure(error);
    }
  }

  async #finishSession(epoch: number): Promise<void> {
    if (this.#screen.kind !== "learning") return;
    const { sessionId, childId } = this.#screen.session;
    this.#resume = () => this.#finishSession(epoch);
    try {
      const summary = await this.#api.endSession(sessionId);
      if (epoch !== this.#epoch) return;
      this.#teardownRecording();
      this.#media.player.stop();
      this.#screen = { kind: "summary", childId, profiles: this.#profiles, summary };
      this.#emit();
    } catch (error) {
      if (epoch !== this.#epoch || this.#screen.kind !== "learning") return;
      this.#handleFailure(error);
    }
  }

  /** Dalej po feedbacku albo ponowne podejście, gdy zadanie na to pozwala. */
  async continueLearning(): Promise<void> {
    const screen = this.#learning();
    if (!screen || screen.busy) return;
    if (screen.feedback?.retry) {
      this.#setLearning({ feedback: null });
      return;
    }
    this.#setLearning({ busy: true });
    await this.#loadNext(this.#epoch, screen.session.sessionId);
  }

  async endNow(): Promise<void> {
    const screen = this.#learning();
    if (!screen || screen.busy) return;
    this.#setLearning({ busy: true });
    await this.#finishSession(this.#epoch);
  }

  async completePresentation(): Promise<void> {
    const screen = this.#learning();
    if (!screen?.task || screen.busy || screen.task.exerciseType !== "exposure") return;
    const epoch = this.#epoch;
    const sessionId = screen.session.sessionId;
    const taskId = screen.task.taskId;
    this.#setLearning({ busy: true });
    this.#resume = async () => {
      await this.#api.completePresentation(taskId);
      await this.#loadNext(epoch, sessionId);
    };
    try {
      await this.#api.completePresentation(taskId);
      await this.#loadNext(epoch, sessionId);
    } catch (error) {
      if (epoch !== this.#epoch || this.#screen.kind !== "learning") return;
      this.#handleFailure(error);
    }
  }

  async answerChoice(optionId: string): Promise<void> {
    await this.#submitAnswer({ modality: "choice", optionId });
  }

  async answerText(text: string): Promise<void> {
    await this.#submitAnswer({ modality: "text", text: text.trim() });
  }

  /** „Nie pamiętam — pokaż”: ujawnienie z zapisem ekspozycji przed treścią (SPEC §15.1). */
  async notRemember(): Promise<void> {
    const screen = this.#learning();
    if (!screen?.task || screen.busy || screen.offline) return;
    const epoch = this.#epoch;
    const taskId = screen.task.taskId;
    this.#setLearning({ busy: true });
    const disclose = async (): Promise<void> => {
      const disclosure = await this.#api.authorizeDisclosure(taskId, "hint");
      if (epoch !== this.#epoch || this.#learning() === null) return;
      this.#setLearning({ reveal: { target: disclosure.reveal?.target ?? "" }, busy: false });
    };
    this.#resume = disclose;
    try {
      await disclose();
    } catch (error) {
      if (epoch !== this.#epoch || this.#screen.kind !== "learning") return;
      this.#handleFailure(error);
    }
  }

  /** Potwierdzenie ujawnionego słowa wysyła zadeklarowaną trudność. */
  async confirmReveal(): Promise<void> {
    await this.#submitAnswer({ modality: "dont_remember" });
  }

  async skip(): Promise<void> {
    await this.#submitAnswer({ modality: "skip" });
  }

  async #submitAnswer(input: AnswerPayload): Promise<void> {
    const screen = this.#learning();
    if (!screen?.task || screen.busy || screen.offline) return;
    // przypisujemy dopiero za strażnikiem — odrzucone kliknięcie nie śmieci
    this.#pendingChoice = input.modality === "choice" ? input.optionId : null;
    const epoch = this.#epoch;
    const taskId = screen.task.taskId;
    const clientAttemptId = randomUUID();
    this.#setLearning({ busy: true });
    const send = async (): Promise<void> => {
      const attempt = await this.#api.submitAnswer({ ...input, taskId, clientAttemptId });
      await this.#applyAttempt(attempt, epoch);
    };
    this.#resume = send;
    try {
      await send();
    } catch (error) {
      if (epoch !== this.#epoch || this.#screen.kind !== "learning") return;
      this.#handleFailure(error);
    }
  }

  async #applyAttempt(attempt: AttemptDto, epoch: number): Promise<void> {
    if (attempt.state === "processing") {
      this.#setLearning({ processing: true, busy: true });
      await this.#pollAttempt(attempt.attemptId, epoch, Date.now() + POLL_DEADLINE_MS);
      return;
    }
    this.#showResult(attempt, epoch);
  }

  async #pollAttempt(attemptId: string, epoch: number, deadline: number): Promise<void> {
    this.#resume = () => this.#pollAttempt(attemptId, epoch, deadline);
    try {
      const attempt = await this.#api.readAttempt(attemptId);
      if (epoch !== this.#epoch) return;
      if (attempt.state === "processing" && Date.now() < deadline) {
        await sleep(this.#pollIntervalMs);
        if (epoch !== this.#epoch) return;
        await this.#pollAttempt(attemptId, epoch, deadline);
        return;
      }
      this.#showResult(attempt, epoch);
    } catch (error) {
      if (epoch !== this.#epoch || this.#screen.kind !== "learning") return;
      this.#handleFailure(error);
    }
  }

  #showResult(attempt: AttemptDto, epoch: number): void {
    if (epoch !== this.#epoch || this.#screen.kind !== "learning") return;
    this.#resume = null;
    const chosenOptionId = this.#pendingChoice;
    this.#pendingChoice = null;
    this.#screen = {
      ...this.#screen,
      busy: false,
      processing: false,
      // feedback zastępuje panel ujawnienia podpowiedzi
      reveal: null,
      feedback: {
        dto: attempt.feedback,
        retry: attempt.taskState === "issued",
        ...(chosenOptionId !== null ? { chosenOptionId } : {}),
      },
    };
    this.#emit();
  }

  /**
   * Odtworzenie audio zadania — znaczenie zależy od typu ćwiczenia (SPEC §13.2):
   * pytanie słuchowe i prezentacja są częścią zadania; wzorzec w recall/
   * pisowni/ćwiczeniu wymowy wymaga zgody serwera PRZED odtworzeniem, także
   * gdy plik jest już w cache przeglądarki (arch §9.2).
   */
  async playTaskAudio(): Promise<void> {
    const screen = this.#learning();
    if (!screen?.task || screen.offline) return;
    const task = screen.task;
    const assetId = audioAssetOf(task);
    if (!assetId) return;
    const epoch = this.#epoch;
    if (["recall", "spelling", "letter_completion", "speech"].includes(task.exerciseType)) {
      await this.#api.authorizeDisclosure(task.taskId, "audio");
      if (epoch !== this.#epoch) return;
    }
    try {
      await this.#media.player.play(this.#api.mediaUrl(assetId));
      if (task.exerciseType === "listening") {
        // liczba odsłuchów pytania jest zapisywana jako obserwacja (§13.2);
        // tylko faktycznie rozpoczęte odtwarzanie — zablokowany autoplay
        // nie jest odsłuchem
        void this.#api
          .recordObservation({ taskId: task.taskId, clientEventId: randomUUID(), kind: "audio_played" })
          .catch(() => undefined);
      }
    } catch (error) {
      // zablokowany autoplay nie jest awarią; brak sieci jest
      if (isNetworkError(error)) {
        this.#handleFailure(error);
      }
    }
  }

  /**
   * Odsłuch zdania przykładowego prezentacji (SPEC §22): plik przygotowany
   * z zestawem, treść zdania jest już widoczna na karcie, więc odtworzenie
   * nie wymaga zgody serwera ani nie ujawnia niczego nowego.
   */
  async playExampleAudio(): Promise<void> {
    const screen = this.#learning();
    if (!screen?.task || screen.offline) return;
    if (screen.task.prompt.kind !== "exposure") return;
    const assetId = screen.task.prompt.exampleAudioAssetId;
    if (assetId === null) return;
    try {
      await this.#media.player.play(this.#api.mediaUrl(assetId));
    } catch (error) {
      if (isNetworkError(error)) {
        this.#handleFailure(error);
      }
    }
  }

  async startRecording(): Promise<void> {
    const screen = this.#learning();
    if (!screen?.task || screen.offline || this.#recorder !== null) return;
    try {
      const recorder = this.#media.createRecorder();
      await recorder.start();
      this.#recorder = recorder;
      this.#setLearning({ recording: true, micDenied: false });
    } catch (error) {
      // trwale pamiętamy tylko świadomą odmowę (też prompt zablokowany przez
      // przeglądarkę); awaria urządzenia wyłącza nagrywanie do końca sesji
      if ((error as { name?: unknown } | null)?.name === "NotAllowedError") {
        this.#micDenied = true;
        this.#storage.write(MIC_DENIED_KEY, "1");
      }
      this.#setLearning({ recording: false, micDenied: true });
    }
  }

  async stopRecording(): Promise<void> {
    const recorder = this.#recorder;
    this.#recorder = null;
    this.#setLearning({ recording: false });
    if (!recorder) return;
    const screen = this.#learning();
    if (!screen?.task) return;
    const epoch = this.#epoch;
    const taskId = screen.task.taskId;
    try {
      const audio = await recorder.stop();
      this.#setLearning({ processing: true, busy: true });
      const clientAttemptId = randomUUID();
      const send = async (): Promise<void> => {
        // odpowiedź ustna nie jest wyborem — czyścimy, by feedback wymowy
        // nie dziedziczył podświetlenia opcji (pełny modal z heardText)
        this.#pendingChoice = null;
        const attempt = await this.#api.submitSpeech(taskId, clientAttemptId, audio);
        await this.#applyAttempt(attempt, epoch);
      };
      this.#resume = send;
      await send();
    } catch (error) {
      if (epoch !== this.#epoch || this.#screen.kind !== "learning") return;
      this.#handleFailure(error);
    }
  }

  cancelRecording(): void {
    const recorder = this.#recorder;
    this.#recorder = null;
    recorder?.cancel();
    this.#setLearning({ recording: false });
  }

  /** Powrót z tła: idempotentne odświeżenie bieżącego kroku (plan zadania 9). */
  async refreshStep(): Promise<void> {
    const screen = this.#learning();
    if (!screen || screen.busy || screen.feedback !== null || screen.processing || screen.offline) return;
    this.#setLearning({ busy: true });
    await this.#loadNext(this.#epoch, screen.session.sessionId);
  }

  markOffline(): void {
    if (this.#learning() === null) return;
    this.#media.player.stop();
    this.#setLearning({ offline: true });
  }

  /** Ponowienie po powrocie sieci albo po błędzie aplikacji. */
  async retry(): Promise<void> {
    if (this.#learning() === null) return;
    this.#setLearning({ offline: false, error: null });
    if (this.#resume) {
      await this.#resume();
      return;
    }
    await this.refreshStep();
  }

  async learnAgain(): Promise<void> {
    if (this.#screen.kind !== "summary" || this.#childId === null) return;
    await this.selectProfile(this.#childId);
  }

  async switchProfile(): Promise<void> {
    this.#epoch += 1;
    this.#teardownRecording();
    this.#media.player.stop();
    this.#screen = { kind: "profile", profiles: this.#profiles };
    this.#emit();
  }

  /** Czy banner „Jeszcze N i koniec!” jest widoczny dla bieżącego zadania. */
  remainingFor(task: TaskDto | null): number | null {
    return task !== null && task.remainingAssessed <= REMAINING_BANNER_FROM ? task.remainingAssessed : null;
  }

  /** URL niezmiennej treści medialnej (audio, ilustracja) przez klienta API. */
  mediaUrl(assetId: string): string {
    return this.#api.mediaUrl(assetId);
  }

  #handleFailure(error: unknown): void {
    if (this.#screen.kind !== "learning") return;
    if (isNetworkError(error)) {
      this.#media.player.stop();
      this.#screen = { ...this.#screen, offline: true, busy: false };
    } else {
      this.#screen = { ...this.#screen, error: messageForError(error), busy: false };
    }
    this.#emit();
  }

  /** Opuszczenie widoku: zatrzymuje strumień mikrofonu i odtwarzanie (RF5). */
  teardown(): void {
    this.#epoch += 1;
    this.#teardownRecording();
    this.#media.player.stop();
  }

  #teardownRecording(): void {
    const recorder = this.#recorder;
    this.#recorder = null;
    recorder?.cancel();
    if (this.#screen.kind === "learning") {
      this.#screen = { ...this.#screen, recording: false };
    }
  }
}
