import {
  SESSION_ACTIVITY_MAX_ENTRIES,
  SESSION_ACTIVITY_REPORT_MAX_BYTES,
  SESSION_ACTIVITY_REPORT_VERSION,
  taskActiveMs,
  unionDurationMs,
  type SessionActivityPauseKind,
  type SessionActivityReport,
  type SessionActivityTaskReport,
} from "@learning/contracts";

/**
 * Lokalny reporter aktywności sesji (spec client-reward-time). Zegar jest
 * podmienialny (testy kontrolują czas); czasy w raporcie to offsety
 * milisekund od początku pomiaru, nie zegar urządzenia. Nie zapisujemy
 * treści naciśnięć klawiszy ani wersji wpisów — edycje grupujemy w okna 5 s.
 *
 * Zasady pomiaru:
 * - pokazanie zadania otwiera pomiar (pierwsze 60 s może być czytaniem);
 * - po 60 s bez interakcji/odsłuchu pomiar pauzuje (lazy, domykany przy
 *   kolejnym zdarzeniu albo zamrożeniu) — sam upływ czasu nie wznawia;
 * - tło/blur/offline/oczekiwanie techniczne to jawne pauzy; wznowienie
 *   wymaga działania albo rzeczywistego odsłuchu;
 * - aktywny czas to unia przedziałów (pisanie + odsłuch nie sumują się),
 * a różne zadania nie nakładają się przedziałami.
 */

/** Próg bezczynności zamykający aktywny przedział (design §3). */
export const SESSION_ACTIVITY_IDLE_MS = 60_000;
/** Okno grupowania edycji; nie produkujemy zdarzenia dla każdej litery. */
export const SESSION_ACTIVITY_EDIT_WINDOW_MS = 5_000;

export interface ActivityClock {
  now(): number;
}

export const epochClock: ActivityClock = { now: () => Date.now() };

interface TaskState {
  taskId: string;
  exerciseType: string;
  shownFromMs: number;
  shownToMs: number;
  activeIntervals: [number, number][];
  editCount: number;
  editWindows: { atMs: number; count: number }[];
  submittedAttempts: string[];
  playbacks: { assetId: string; fromMs: number; toMs: number }[];
  pauses: { kind: SessionActivityPauseKind; fromMs: number; toMs: number }[];
}

/** Serializowalny stan pomiaru — kopia robocza dla `SessionActivityDraftStore`. */
export interface ActivityReportState {
  version: 1;
  startedAtMs: number;
  lastActivityAtMs: number;
  lastEventAtMs: number;
  activeStartMs: number | null;
  openPlayback: { assetId: string; fromMs: number; limitMs: number | null } | null;
  pendingPause: { kind: SessionActivityPauseKind; fromMs: number } | null;
  currentTaskId: string | null;
  compacted: boolean;
  incomplete: "storage_unavailable" | "size_limit" | undefined;
  tasks: TaskState[];
}

function emptyTask(taskId: string, exerciseType: string, atMs: number): TaskState {
  return {
    taskId,
    exerciseType,
    shownFromMs: atMs,
    shownToMs: atMs,
    activeIntervals: [],
    editCount: 0,
    editWindows: [],
    submittedAttempts: [],
    playbacks: [],
    pauses: [],
  };
}

export class SessionActivityReporter {
  readonly #clock: ActivityClock;
  #state: ActivityReportState;

  constructor(clock: ActivityClock, state?: ActivityReportState) {
    this.#clock = clock;
    if (state) {
      this.#state = state;
      return;
    }
    const now = clock.now();
    this.#state = {
      version: 1,
      startedAtMs: now,
      lastActivityAtMs: now,
      lastEventAtMs: now,
      activeStartMs: null,
      openPlayback: null,
      pendingPause: null,
      currentTaskId: null,
      compacted: false,
      incomplete: undefined,
      tasks: [],
    };
  }

  /**
   * Wznawia zapisany stan pomiaru: przerwę od ostatniego zdarzenia do powrotu
   * oznaczamy jako brak obserwacji — nie zaliczamy jej jako pracy (design §4).
   */
  static resume(clock: ActivityClock, state: ActivityReportState): SessionActivityReporter {
    const reporter = new SessionActivityReporter(clock, state);
    reporter.#markUnobservedGap();
    return reporter;
  }

  #markUnobservedGap(): void {
    const nowOffset = this.#offset(this.#clock.now());
    const from = this.#state.lastEventAtMs - this.#state.startedAtMs;
    const current = this.#currentTask();
    // Domknij otwarty przedział dokładnie na ostatnim zaobserwowanym zdarzeniu —
    // brak obserwacji nie przedłuża ani nie ujmuje zmierzonej pracy.
    const start = this.#state.activeStartMs;
    if (start !== null && current && from > start) {
      current.activeIntervals.push([start, from]);
    }
    if (current && nowOffset > from) {
      current.pauses.push({ kind: "unobserved", fromMs: from, toMs: nowOffset });
    }
    // Stan pomiaru nie przenosi aktywności przez nieobserwowany fragment.
    this.#state.activeStartMs = null;
    this.#state.openPlayback = null;
    this.#state.pendingPause = null;
    this.#state.lastActivityAtMs = this.#clock.now();
    this.#state.lastEventAtMs = this.#clock.now();
  }

  #offset(epochMs: number): number {
    return Math.max(0, Math.round(epochMs - this.#state.startedAtMs));
  }

  #currentTask(): TaskState | null {
    const id = this.#state.currentTaskId;
    return id === null ? null : this.#state.tasks.find((task) => task.taskId === id) ?? null;
  }

  get started(): boolean {
    return this.#state.tasks.length > 0;
  }

  get state(): ActivityReportState {
    return this.#state;
  }

  /** Zamknięcie aktywnego przedziału z bezczynnościowym domknięciem. */
  #closeActiveAt(endOffset: number, idleCapped: boolean): void {
    const start = this.#state.activeStartMs;
    if (start === null) return;
    const task = this.#currentTask();
    const end = idleCapped
      ? Math.min(endOffset, this.#state.lastActivityAtMs - this.#state.startedAtMs + SESSION_ACTIVITY_IDLE_MS)
      : endOffset;
    if (task && end > start) task.activeIntervals.push([start, end]);
    if (task && idleCapped && endOffset > end) {
      task.pauses.push({ kind: "idle", fromMs: end, toMs: endOffset });
    }
    this.#state.activeStartMs = null;
  }

  /** Zdarzenie będące pracą: interakcja, edycja albo rzeczywisty odsłuch. */
  #activityEvent(): void {
    const now = this.#clock.now();
    const nowOffset = this.#offset(now);
    if (this.#state.pendingPause !== null) {
      // Działanie wznawia pomiar; koniec pauzy przypada na teraz.
      const task = this.#currentTask();
      if (task && nowOffset > this.#state.pendingPause.fromMs) {
        task.pauses.push({ kind: this.#state.pendingPause.kind, fromMs: this.#state.pendingPause.fromMs, toMs: nowOffset });
      }
      this.#state.pendingPause = null;
    }
    const idleMs = now - this.#state.lastActivityAtMs;
    if (this.#state.activeStartMs !== null && this.#state.openPlayback === null && idleMs > SESSION_ACTIVITY_IDLE_MS) {
      this.#closeActiveAt(nowOffset, true);
    }
    if (this.#state.activeStartMs === null) this.#state.activeStartMs = nowOffset;
    this.#state.lastActivityAtMs = now;
    this.#state.lastEventAtMs = now;
  }

  /** Pokazanie zadania: startuje/mierzy prezentowanie; przełącza bieżące zadanie. */
  taskShown(taskId: string, exerciseType: string): void {
    const now = this.#clock.now();
    const nowOffset = this.#offset(now);
    if (this.#state.currentTaskId === taskId) return;
    this.#finishPlayback(nowOffset);
    this.#closeActiveAt(nowOffset, true);
    const previous = this.#currentTask();
    if (previous) {
      previous.shownToMs = nowOffset;
      // Domykaj pauzę (np. technical_wait przed wysłaniem odpowiedzi) na
      // POPRZEDNIM zadaniu — po przełączeniu currentTaskId trafiłaby do
      // pauses niewłaściwego (następnego) zadania.
      const pending = this.#state.pendingPause;
      if (pending && nowOffset > pending.fromMs) {
        previous.pauses.push({ kind: pending.kind, fromMs: pending.fromMs, toMs: nowOffset });
      }
    }
    this.#state.pendingPause = null;
    let task = this.#state.tasks.find((candidate) => candidate.taskId === taskId);
    if (!task) {
      task = emptyTask(taskId, exerciseType, nowOffset);
      this.#state.tasks.push(task);
    }
    this.#state.currentTaskId = taskId;
    this.#state.lastActivityAtMs = now;
    this.#state.lastEventAtMs = now;
    this.#state.activeStartMs = nowOffset;
  }

  /** Interakcja z właściwego pola/działania ćwiczenia (nie ruch myszy). */
  recordInteraction(): void {
    this.#activityEvent();
  }

  /** Edycja pola/układanie odpowiedzi: liczba zmian + okno 5 s (bez treści). */
  recordEdit(): void {
    this.#activityEvent();
    const task = this.#currentTask();
    const atMs = this.#offset(this.#clock.now());
    if (!task) return;
    task.editCount += 1;
    const last = task.editWindows.at(-1);
    if (last && atMs - last.atMs < SESSION_ACTIVITY_EDIT_WINDOW_MS) {
      last.count += 1;
    } else {
      task.editWindows.push({ atMs, count: 1 });
    }
  }

  /** Identyfikator przyjętej próby — do powiązania raportu z odpowiedziami. */
  attemptSubmitted(attemptId: string): void {
    const task = this.#currentTask();
    if (task && !task.submittedAttempts.includes(attemptId)) {
      task.submittedAttempts.push(attemptId);
    }
    this.#state.lastEventAtMs = this.#clock.now();
  }

  /** Rzeczywisty start odtwarzania; `durationMs` ogranicza długość nagrania. */
  playbackStarted(assetId: string, durationMs: number | null): void {
    this.#activityEvent();
    this.#finishPlayback(this.#offset(this.#clock.now()));
    this.#state.openPlayback = {
      assetId,
      fromMs: this.#offset(this.#clock.now()),
      limitMs: durationMs !== null && durationMs > 0 ? Math.round(durationMs) : null,
    };
  }

  #finishPlayback(nowOffset: number): void {
    const playback = this.#state.openPlayback;
    if (playback === null) return;
    const task = this.#currentTask();
    const to = playback.limitMs === null ? nowOffset : Math.min(nowOffset, playback.fromMs + playback.limitMs);
    if (task && to > playback.fromMs) {
      task.playbacks.push({ assetId: playback.assetId, fromMs: playback.fromMs, toMs: to });
    }
    this.#state.openPlayback = null;
  }

  playbackEnded(assetId: string): void {
    const playback = this.#state.openPlayback;
    if (playback === null || playback.assetId !== assetId) return;
    const now = this.#clock.now();
    this.#finishPlayback(this.#offset(now));
    this.#state.lastActivityAtMs = now;
    this.#state.lastEventAtMs = now;
  }

  /** Pauza pomiaru (tło/blur/offline/oczekiwanie techniczne); koniec przy działaniu. */
  pause(kind: SessionActivityPauseKind): void {
    const now = this.#clock.now();
    const nowOffset = this.#offset(now);
    this.#finishPlayback(nowOffset);
    this.#closeActiveAt(nowOffset, false);
    if (this.#state.pendingPause === null) {
      this.#state.pendingPause = { kind, fromMs: nowOffset };
    }
    this.#state.lastActivityAtMs = now;
    this.#state.lastEventAtMs = now;
  }

  /**
   * Zamrożenie raportu na koniec sesji: domyka przedziały (z bezczynnościowym
   * limitem), kompaktuje do limitów i buduje publiczny kształt kontraktu.
   */
  freeze(): SessionActivityReport {
    const nowOffset = this.#offset(this.#clock.now());
    this.#finishPlayback(nowOffset);
    this.#closeActiveAt(nowOffset, true);
    if (this.#state.pendingPause !== null) {
      const task = this.#currentTask();
      if (task && nowOffset > this.#state.pendingPause.fromMs) {
        task.pauses.push({ kind: this.#state.pendingPause.kind, fromMs: this.#state.pendingPause.fromMs, toMs: nowOffset });
      }
      this.#state.pendingPause = null;
    }
    const current = this.#currentTask();
    if (current) current.shownToMs = Math.max(current.shownToMs, nowOffset);
    this.#compactIfNeeded();
    const tasks: SessionActivityTaskReport[] = this.#state.tasks.map((task) => ({
      taskId: task.taskId,
      exerciseType: task.exerciseType,
      shownFromMs: task.shownFromMs,
      shownToMs: task.shownToMs,
      activeIntervals: task.activeIntervals,
      editCount: task.editCount,
      editWindows: task.editWindows,
      submittedAttempts: task.submittedAttempts,
      playbacks: task.playbacks,
      pauses: task.pauses,
    }));
    const activeMs = tasks.reduce((total, task) => total + taskActiveMs(task), 0);
    // Regresja zegara urządzenia nie może zmniejszyć elapsedMs poniżej już
    // zapisanych zakresów — clampujemy do maksymalnego zarejestrowanego końca.
    const recordedEndMs = tasks.reduce((max, task) => Math.max(
      max,
      task.shownToMs,
      ...task.activeIntervals.map(([, to]) => to),
      ...task.playbacks.map((playback) => playback.toMs),
      ...task.pauses.map((pause) => pause.toMs),
    ), 0);
    return {
      version: SESSION_ACTIVITY_REPORT_VERSION,
      elapsedMs: Math.max(1, nowOffset, recordedEndMs),
      activeMs,
      compacted: this.#state.compacted,
      ...(this.#state.incomplete === undefined ? {} : { incomplete: this.#state.incomplete }),
      tasks,
    };
  }

  #entryCount(): number {
    return this.#state.tasks.reduce(
      (total, task) => total + task.activeIntervals.length + task.editWindows.length
        + task.submittedAttempts.length + task.playbacks.length + task.pauses.length,
      0,
    );
  }

  /**
   * Kompaktowanie zachowuje kolejność zadań, sumy, pierwsze/ostatnie czasy i
   * liczniki; ustawia informację o kompaktowaniu (design §3). Nie dopisujemy
   * fikcyjnych przedziałów i nie zmieniamy sumy unii. Uruchamia się od liczby
   * wpisów ORAZ od rozmiaru bajtowego zserializowanego raportu.
   */
  #compactIfNeeded(): void {
    if (this.#entryCount() <= SESSION_ACTIVITY_MAX_ENTRIES && !this.#overSizeLimit()) {
      this.#maybeMarkSizeLimit();
      return;
    }
    this.#state.compacted = true;
    // 0. Scal dokładnie stykające się (i nakładające się) przedziały aktywności:
    // [a,b],[b,c] → [a,c]. Unia zachowana co do milisekundy, bez fikcyjnego czasu.
    for (const task of this.#state.tasks) {
      const merged: [number, number][] = [];
      for (const [from, to] of [...task.activeIntervals].sort((a, b) => a[0] - b[0])) {
        const last = merged.at(-1);
        if (last && from <= last[1]) last[1] = Math.max(last[1], to);
        else merged.push([from, to]);
      }
      task.activeIntervals = merged;
    }
    if (this.#entryCount() <= SESSION_ACTIVITY_MAX_ENTRIES && !this.#overSizeLimit()) return this.#maybeMarkSizeLimit();
    // 1. Zgrubnij okna edycji do 30 s (suma count bez zmian).
    for (const task of this.#state.tasks) {
      const merged: { atMs: number; count: number }[] = [];
      for (const window of task.editWindows) {
        const last = merged.at(-1);
        if (last && window.atMs - last.atMs < 30_000) last.count += window.count;
        else merged.push({ ...window });
      }
      task.editWindows = merged;
    }
    if (this.#entryCount() <= SESSION_ACTIVITY_MAX_ENTRIES && !this.#overSizeLimit()) return this.#maybeMarkSizeLimit();
    // 2. Połącz sąsiednie pauzy tego samego rodzaju.
    for (const task of this.#state.tasks) {
      const merged: TaskState["pauses"] = [];
      for (const pause of task.pauses) {
        const last = merged.at(-1);
        if (last && last.kind === pause.kind && pause.fromMs - last.toMs < 5_000) last.toMs = pause.toMs;
        else merged.push({ ...pause });
      }
      task.pauses = merged;
    }
    if (this.#entryCount() <= SESSION_ACTIVITY_MAX_ENTRIES && !this.#overSizeLimit()) return this.#maybeMarkSizeLimit();
    // 3. Wchłoń odsłuchy w przedziały aktywności (unia zachowana dokładnie).
    for (const task of this.#state.tasks) {
      task.activeIntervals.push(...task.playbacks.map((playback) => [playback.fromMs, playback.toMs] as [number, number]));
      task.playbacks = [];
    }
    if (this.#entryCount() <= SESSION_ACTIVITY_MAX_ENTRIES && !this.#overSizeLimit()) return this.#maybeMarkSizeLimit();
    // 4. Opuść szczegóły pauz; przedziały pozostają.
    for (const task of this.#state.tasks) task.pauses = [];
    if (this.#entryCount() <= SESSION_ACTIVITY_MAX_ENTRIES) return this.#maybeMarkSizeLimit();
    // 5. Pojedyncze okno edycji per zadanie (licznik sumaryczny).
    for (const task of this.#state.tasks) {
      if (task.editWindows.length > 1) {
        task.editWindows = [{
          atMs: task.editWindows[0]!.atMs,
          count: task.editWindows.reduce((total, window) => total + window.count, 0),
        }];
      }
    }
    this.#maybeMarkSizeLimit();
  }

  #maybeMarkSizeLimit(): void {
    if (this.#state.incomplete === "storage_unavailable") return;
    if (this.#overSizeLimit()) {
      this.#state.compacted = true;
      this.#state.incomplete = "size_limit";
    }
  }

  /** Rozmiar bajtowy zserializowanego raportu (limit deklarowany w bajtach). */
  #serializedSize(): number {
    return new TextEncoder().encode(JSON.stringify(this.#buildForSize())).length;
  }

  #overSizeLimit(): boolean {
    return this.#serializedSize() > SESSION_ACTIVITY_REPORT_MAX_BYTES;
  }

  #buildForSize(): SessionActivityReport {
    const activeMs = this.#state.tasks.reduce(
      (total, task) => total + unionDurationMs([
        ...task.activeIntervals,
        ...task.playbacks.map((playback) => [playback.fromMs, playback.toMs] as const),
      ]),
      0,
    );
    return {
      version: SESSION_ACTIVITY_REPORT_VERSION,
      elapsedMs: this.#offset(this.#clock.now()),
      activeMs,
      compacted: this.#state.compacted,
      ...(this.#state.incomplete === undefined ? {} : { incomplete: this.#state.incomplete }),
      tasks: this.#state.tasks,
    } as SessionActivityReport;
  }

  /** Jawne odnotowanie awarii zapisu kopii roboczej (nauka działa dalej). */
  markStorageUnavailable(): void {
    this.#state.incomplete = "storage_unavailable";
  }
}
