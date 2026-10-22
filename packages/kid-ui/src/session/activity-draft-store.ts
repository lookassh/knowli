import type { ActivityReportState } from "./activity-report";
import type { SessionActivityReport } from "@learning/contracts";

/**
 * Osobny, mały magazyn roboczej kopii raportu aktywności (spec client-reward-time,
 * design §4). Nie trafia do `LocalPreferences` (kontrakt wyklucza dane nauki):
 * kopia zawiera wyłącznie identyfikatory, czasy względne i liczniki — bez pytań,
 * odpowiedzi i nagrań. Klient usuwa tylko konkretną kopię potwierdzoną przez
 * serwer; spóźniona odpowiedź nie kasuje raportu nowej sesji.
 */

export interface SessionActivityDraft {
  sessionId: string;
  savedAtMs: number;
  state: ActivityReportState;
  childId?: string;
  finalPayload?: SessionActivityReport;
}

/** Minimalny znacznik po zaakceptowaniu raportu przez serwer. */
export interface PendingActivityResult {
  version: 1;
  sessionId: string;
  childId: string;
  savedAtMs: number;
}

export type SessionActivityRecord = SessionActivityDraft | PendingActivityResult;

function isPendingActivityResult(record: SessionActivityRecord): record is PendingActivityResult {
  return "version" in record;
}

export interface SessionActivityDraftStore {
  /** False, gdy zapis się nie powiódł (brak miejsca/dostępu). */
  save(draft: SessionActivityDraft): boolean;
  savePendingResult(result: PendingActivityResult): boolean;
  load(sessionId: string): SessionActivityRecord | null;
  listForChild(childId: string): SessionActivityDraft[];
  listPendingResults(): PendingActivityResult[];
  remove(sessionId: string): void;
}

/** Retencja kopii roboczej po stronie FE (7 dni, jak szczegóły na serwerze). */
export const ACTIVITY_DRAFT_TTL_MS = 7 * 24 * 60 * 60_000;
const STORAGE_PREFIX = "umiem.activity-draft.";

function isFreshRecord(draft: SessionActivityRecord, nowMs: number): boolean {
  return nowMs - draft.savedAtMs < ACTIVITY_DRAFT_TTL_MS;
}

function parseRecord(raw: string | null): SessionActivityRecord | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null) return null;
    const pending = value as Partial<PendingActivityResult>;
    if (pending.version === 1 && typeof pending.sessionId === "string" && typeof pending.childId === "string"
      && typeof pending.savedAtMs === "number" && Object.keys(value).every(key => ["version", "sessionId", "childId", "savedAtMs"].includes(key))) {
      return pending as PendingActivityResult;
    }
    const draft = value as Partial<SessionActivityDraft> & { state?: Partial<ActivityReportState> };
    if (typeof draft.sessionId !== "string" || typeof draft.savedAtMs !== "number" || typeof draft.state !== "object"
      || draft.state === null || draft.state.version !== 1 || !Array.isArray(draft.state.tasks)) {
      return null;
    }
    return draft as SessionActivityDraft;
  } catch {
    return null;
  }
}

/** Magazyn w pamięci — deterministyczne testy jednostkowe. */
export function createMemoryActivityDraftStore(nowMs = () => Date.now()): SessionActivityDraftStore {
  const store = new Map<string, string>();
  const loadRecord = (sessionId: string): SessionActivityRecord | null => {
    const fresh = parseRecord(store.get(sessionId) ?? null);
    if (!fresh) return null;
    if (!isFreshRecord(fresh, nowMs())) { store.delete(sessionId); return null; }
    return fresh;
  };
  return {
    save(draft) {
      store.set(draft.sessionId, JSON.stringify(draft));
      return true;
    },
    savePendingResult(result) { store.set(result.sessionId, JSON.stringify(result)); return true; },
    load: loadRecord,
    listForChild(childId) {
      return [...store.keys()].map(loadRecord).filter((draft): draft is SessionActivityDraft => draft !== null
        && !isPendingActivityResult(draft) && draft.childId === childId && draft.finalPayload !== undefined);
    },
    listPendingResults() {
      return [...store.keys()].map(loadRecord).filter((record): record is PendingActivityResult => record !== null && isPendingActivityResult(record));
    },
    remove(sessionId) {
      store.delete(sessionId);
    },
  };
}

/** localStorage z walidacją wersji i TTL; awaria zapisu jest jawnie zgłaszana. */
export function createBrowserActivityDraftStore(nowMs = () => Date.now()): SessionActivityDraftStore {
  const loadRecord = (sessionId: string): SessionActivityRecord | null => {
    try {
      const storage = Reflect.get(globalThis, "localStorage") as Storage | undefined;
      if (!storage) return null;
      const fresh = parseRecord(storage.getItem(STORAGE_PREFIX + sessionId));
      if (!fresh) return null;
      if (!isFreshRecord(fresh, nowMs())) { storage.removeItem(STORAGE_PREFIX + sessionId); return null; }
      return fresh;
    } catch { return null; }
  };
  return {
    save(draft) {
      try {
        const storage = Reflect.get(globalThis, "localStorage") as Storage | undefined;
        if (!storage) return false;
        storage.setItem(STORAGE_PREFIX + draft.sessionId, JSON.stringify(draft));
        return true;
      } catch {
        // prywatny tryb przeglądarki/brak miejsca: nauka działa, kopii brak
        return false;
      }
    },
    savePendingResult(result) {
      try {
        const storage = Reflect.get(globalThis, "localStorage") as Storage | undefined;
        if (!storage) return false;
        storage.setItem(STORAGE_PREFIX + result.sessionId, JSON.stringify(result));
        return true;
      } catch { return false; }
    },
    load: loadRecord,
    listForChild(childId) {
      const drafts: SessionActivityDraft[] = [];
      try {
        const storage = Reflect.get(globalThis, "localStorage") as Storage | undefined;
        if (!storage) return drafts;
        const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
        for (const key of keys) {
          if (!key?.startsWith(STORAGE_PREFIX)) continue;
          const draft = loadRecord(key.slice(STORAGE_PREFIX.length));
          if (draft && !isPendingActivityResult(draft) && draft.childId === childId && draft.finalPayload !== undefined) drafts.push(draft);
        }
      } catch { return drafts; }
      return drafts;
    },
    listPendingResults() {
      const pending: PendingActivityResult[] = [];
      try {
        const keys = Array.from({ length: globalThis.localStorage.length }, (_, index) => globalThis.localStorage.key(index));
        for (const key of keys) {
          if (!key?.startsWith(STORAGE_PREFIX)) continue;
          const record = loadRecord(key.slice(STORAGE_PREFIX.length));
          if (record && isPendingActivityResult(record)) pending.push(record);
        }
      } catch { return pending; }
      return pending;
    },
    remove(sessionId) {
      try {
        globalThis.localStorage?.removeItem(STORAGE_PREFIX + sessionId);
      } catch {
        // ignorujemy — brak kopii nie blokuje niczego
      }
    },
  };
}
