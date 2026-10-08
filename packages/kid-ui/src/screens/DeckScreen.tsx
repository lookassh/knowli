import { messages, type KidDeckDto } from "@learning/contracts";

/** Ekran wyboru zestawu: dotknięcie zestawu zaczyna sesję (SPEC §12.1). */
export function DeckScreen({
  decks,
  microphone,
  micDenied,
  onToggleMicrophone,
  onStart,
}: {
  decks: KidDeckDto[];
  microphone: boolean;
  micDenied: boolean;
  onToggleMicrophone: (on: boolean) => void;
  onStart: (deckId: string) => void;
}) {
  return (
    <main className="kid-screen">
      <h1>{messages.kid.decksTitle}</h1>
      {decks.length === 0 ? (
        <p className="kid-hint">{messages.kid.noDecks}</p>
      ) : (
        <ul className="kid-list">
          {decks.map((deck) => (
            <li key={deck.deckId}>
              <button
                type="button"
                className="kid-deck"
                data-testid="kid-deck"
                onClick={() => onStart(deck.deckId)}
              >
                <span className="kid-deck-title">{deck.title}</span>
                {deck.testDate !== null && (
                  <span className="kid-badge">
                    {messages.kid.testDateLabel}: {deck.testDate}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {micDenied ? (
        <p className="kid-hint" data-testid="kid-mic-denied-hint">
          {messages.kid.microphoneDeniedHint}
        </p>
      ) : (
        <label className="kid-toggle">
          <input
            type="checkbox"
            data-testid="kid-mic-toggle"
            checked={microphone}
            onChange={(event) => onToggleMicrophone(event.target.checked)}
          />
          <span>{messages.kid.microphone}</span>
        </label>
      )}
    </main>
  );
}
