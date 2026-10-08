/**
 * Lokalne ustawienia interfejsu dziecka za portem — przyszły host Capacitor
 * podmieni implementację bez zmian w logice. Przechowujemy wyłącznie stany
 * urządzenia (np. odmowa mikrofonu), nigdy dane nauki ani wyniki.
 */
export interface LocalPreferences {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

/** Klucz odmowy mikrofonu: kolejne sesje startują bez nagrywania (A12). */
export const MIC_DENIED_KEY = "umiem.micDenied";

/** Preferencje w pamięci — deterministyczne testy jednostkowe. */
export function createMemoryPreferences(values: Record<string, string> = {}): LocalPreferences {
  const store = new Map(Object.entries(values));
  return {
    read: (key) => store.get(key) ?? null,
    write: (key, value) => {
      store.set(key, value);
    },
  };
}

/** localStorage odczytywany leniwie — konstrukcja działa też poza DOM. */
export function createBrowserPreferences(): LocalPreferences {
  return {
    read(key) {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        // prywatny tryb przeglądarki: ustawienia są opcjonalne
        return null;
      }
    },
    write(key, value) {
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch {
        // ignorujemy — brak trwałego ustawienia nie blokuje nauki
      }
    },
  };
}
