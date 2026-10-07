/**
 * Jedyny katalog statycznych komunikatów UI (pl-PL) współdzielony przez web
 * i kid-ui. Bez logiki i bez sekretów. Komunikaty wynikowe generowane przez
 * domenę (feedback) trafiają do klienta w DTO — tutaj tylko stałe etykiety.
 */
export const messages = {
  app: {
    name: "Umiem!",
  },
  errors: {
    unauthorized: "Sesja wygasła. Zaloguj się ponownie.",
    invalid_credentials: "Nieprawidłowy PIN lub hasło.",
    rate_limited: "Zbyt wiele prób. Odczekaj chwilę i spróbuj ponownie.",
    setup_required: "Najpierw ustaw PIN rodzica.",
    already_configured: "Konto rodzica już istnieje.",
    validation: "Sprawdź poprawność wpisanych danych.",
    forbidden: "Brak dostępu.",
    not_found: "Nie znaleziono.",
    conflict: "Ta operacja nie jest już możliwa. Odśwież i spróbuj ponownie.",
    immutable: "Te dane są już zakończone i nie mogą być zmienione.",
    internal: "Coś nie zadziałało. Spróbuj ponownie.",
  } as Record<string, string>,
  auth: {
    loginTitle: "Panel rodzica",
    pinLabel: "PIN lub hasło",
    loginButton: "Zaloguj się",
    logoutButton: "Wyloguj się",
    setupTitle: "Pierwsze uruchomienie",
    setupHint: "Ustaw PIN lub hasło rodzica. Będzie potrzebny do wejścia w panel.",
    setupButton: "Ustaw PIN",
  },
  children: {
    title: "Dzieci",
    empty: "Nie masz jeszcze profilów dzieci.",
    add: "Dodaj dziecko",
    displayName: "Imię",
    avatar: "Obrazek",
    birthYear: "Rok urodzenia",
    save: "Zapisz",
    remove: "Usuń",
    removeConfirm: "Usunąć profil dziecka wraz z całą jego historią nauki? Tego nie da się cofnąć.",
  },
} as const;

export type Messages = typeof messages;
