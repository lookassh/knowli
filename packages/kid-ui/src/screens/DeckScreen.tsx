import type { ReactNode } from "react";
import { messages, type KidDeckDto } from "@learning/contracts";
import { format } from "../format";

function wordCount(count: number): string {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  const noun =
    count === 1
      ? messages.kid.wordSingular
      : lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)
        ? messages.kid.wordFew
        : messages.kid.wordMany;
  return `${count} ${noun}`;
}

/**
 * Ekran wyboru zestawu: dotknięcie zestawu zaczyna sesję (SPEC §12.1).
 * Sekcja „Rekomendowane” pokazuje zestawy z zaplanowaną pracą; każdy zestaw
 * można ćwiczyć w dowolnym momencie — harmonogram nie blokuje wyboru.
 */
export function DeckScreen({
  decks,
  childName,
  microphone,
  micDenied,
  onToggleMicrophone,
  onStart,
  headerActions,
}: {
  decks: KidDeckDto[];
  childName: string;
  microphone: boolean;
  micDenied: boolean;
  onToggleMicrophone: (on: boolean) => void;
  onStart: (deckId: string) => void;
  headerActions?: ReactNode;
}) {
  const recommended = decks.filter((deck) => deck.recommended);
  const other = decks.filter((deck) => !deck.recommended);
  return (
    <main className="kid-screen">
      {headerActions && <header className="kid-top-bar">{headerActions}</header>}
      <h1>{messages.kid.decksTitle}</h1>
      {childName && <p className="kid-greeting">{format(messages.kid.greeting, { name: childName })}</p>}
      {decks.length === 0 ? (
        <p className="kid-hint">{messages.kid.noDecks}</p>
      ) : (
        <>
          {recommended.length > 0 && (
            <section aria-label={messages.kid.recommendedTitle}>
              <h2 className="kid-recommended-title" data-testid="kid-section-recommended">
                {messages.kid.recommendedTitle}
              </h2>
              <ul className="kid-list">
                {recommended.map((deck) => (
                  <DeckButton key={deck.deckId} deck={deck} onStart={onStart} />
                ))}
              </ul>
            </section>
          )}
          {other.length > 0 && (
            <section aria-label={messages.kid.otherDecksTitle}>
              {recommended.length > 0 && (
                <h2 data-testid="kid-section-other">{messages.kid.otherDecksTitle}</h2>
              )}
              <ul className="kid-list">
                {other.map((deck) => (
                  <DeckButton key={deck.deckId} deck={deck} onStart={onStart} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <label className="kid-toggle">
        <input
          type="checkbox"
          data-testid="kid-mic-toggle"
          checked={microphone}
          onChange={(event) => onToggleMicrophone(event.target.checked)}
        />
        <span>{messages.kid.microphone}</span>
      </label>
      {micDenied && (
        <p className="kid-hint" data-testid="kid-mic-denied-hint">
          {messages.kid.microphoneDeniedHint}
        </p>
      )}
    </main>
  );
}

function DeckButton({
  deck,
  onStart,
}: {
  deck: KidDeckDto;
  onStart: (deckId: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="kid-deck"
        data-testid="kid-deck"
        onClick={() => onStart(deck.deckId)}
      >
        <span className="kid-deck-title">
          {format(messages.kid.deckTitle, { title: deck.title, count: wordCount(deck.itemCount) })}
        </span>
        <span className="kid-badge">
          {format(messages.kid.recalledCount, { count: wordCount(deck.independentlyRecalledCount) })}
        </span>
        {deck.testDate !== null && (
          <span className="kid-badge">
            {messages.kid.testDateLabel}: {deck.testDate}
          </span>
        )}
      </button>
    </li>
  );
}
