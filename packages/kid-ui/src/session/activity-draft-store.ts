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

export interface SessionActivityDraftStore {
  /** False, gdy zapis się nie powiódł (brak miejsca/dostępu). */
  save(draft: SessionActivityDraft): boolean;
  load(sessionId: string): SessionActivityDraft | null;
  listForChild(childId: string): SessionActivityDraft[];
  remove(sessionId: string): void;
}

/** Retencja kopii roboczej po stronie FE (7 dni, jak szczegóły na serwerze). */
export const ACTIVITY_DRAFT_TTL_MS = 7 * 24 * 60 * 60_000;
const STORAGE_PREFIX = "umiem.activity-draft.";

function isFreshDraft(draft: SessionActivityDraft, nowMs: number): boolean {
  return nowMs - draft.savedAtMs < ACTIVITY_DRAFT_TTL_MS;
}

function parseDraft(raw: string | null): SessionActivityDraft | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null) return null;
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
  return {
    save(draft) {
      store.set(draft.sessionId, JSON.stringify(draft));
      return true;
    },
    load(sessionId) {
      const fresh = parseDraft(store.get(sessionId) ?? null);
      if (!fresh) return null;
      if (!isFreshDraft(fresh, nowMs())) {
        store.delete(sessionId);
        return null;
      }
      return fresh;
    },
    listForChild(childId) {
      return [...store.values()].map(parseDraft).filter((draft): draft is SessionActivityDraft => draft !== null
        && draft.childId === childId && draft.finalPayload !== undefined && isFreshDraft(draft, nowMs()));
    },
    remove(sessionId) {
      store.delete(sessionId);
    },
  };
}

/** localStorage z walidacją wersji i TTL; awaria zapisu jest jawnie zgłaszana. */
export function createBrowserActivityDraftStore(nowMs = () => Date.now()): SessionActivityDraftStore {
  return {
    save(draft) {
      try {
        globalThis.localStorage?.setItem(STORAGE_PREFIX + draft.sessionId, JSON.stringify(draft));
        return true;
      } catch {
        // prywatny tryb przeglądarki/brak miejsca: nauka działa, kopii brak
        return false;
      }
    },
    load(sessionId) {
      try {
        const fresh = parseDraft(globalThis.localStorage?.getItem(STORAGE_PREFIX + sessionId) ?? null);
        if (!fresh) return null;
        if (!isFreshDraft(fresh, nowMs())) {
          globalThis.localStorage?.removeItem(STORAGE_PREFIX + sessionId);
          return null;
        }
        return fresh;
      } catch {
        return null;
      }
    },
    listForChild(childId) {
      const drafts: SessionActivityDraft[] = [];
      try {
        const keys = Array.from({ length: globalThis.localStorage.length }, (_, index) => globalThis.localStorage.key(index));
        for (const key of keys) {
          if (!key?.startsWith(STORAGE_PREFIX)) continue;
          const draft = parseDraft(globalThis.localStorage.getItem(key));
          if (!draft) continue;
          if (!isFreshDraft(draft, nowMs())) { globalThis.localStorage.removeItem(key); continue; }
          if (draft.childId === childId && draft.finalPayload !== undefined) drafts.push(draft);
        }
      } catch { return drafts; }
      return drafts;
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
