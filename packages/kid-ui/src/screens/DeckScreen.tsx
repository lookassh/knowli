import type { ReactNode } from "react";
import { messages, type KidDeckDto } from "@learning/contracts";
import { format } from "../format";
import { formatDeckTestDate, groupDecks } from "./deck-presentation";
import { MASTERY_STAR_MAX, starsForFraction } from "./stars";

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

/** Ekran wyboru zestawu: wszystkie przypisane zestawy w jednej przewijanej liście. */
export function DeckScreen({
  decks,
  childName,
  microphone,
  micDenied,
  onToggleMicrophone,
  onStart,
  onMockTest,
  headerActions,
}: {
  decks: KidDeckDto[];
  childName: string;
  microphone: boolean;
  micDenied: boolean;
  onToggleMicrophone: (on: boolean) => void;
  onStart: (deckId: string) => void;
  onMockTest?: (deckId: string) => void;
  headerActions?: ReactNode;
}) {
  const groups = groupDecks(decks);
  const sections = [
    { kind: "recommended", title: messages.kid.recommendedTitle, items: groups.recommended },
    { kind: "other", title: messages.kid.otherDecksTitle, items: groups.other },
  ].filter((section) => section.items.length > 0);

  return (
    <main className="kid-screen kid-deck-screen">
      {headerActions && <header className="kid-top-bar">{headerActions}</header>}
      <h1>{messages.kid.decksTitle}</h1>
      {childName && <p className="kid-greeting">{format(messages.kid.greeting, { name: childName })}</p>}

      {decks.length === 0 ? (
        <p className="kid-hint" data-testid="kid-no-decks">{messages.kid.noDecks}</p>
      ) : (
        sections.map((section) => (
          <section key={section.kind} aria-label={section.title} data-kind={section.kind}>
            <h2 className="kid-deck-group-title" data-testid={section.kind === "recommended" ? "kid-section-recommended" : "kid-section-other"}>
              {section.title}
            </h2>
            <ul className="kid-deck-list">
              {section.items.map((deck) => (
                <DeckCard key={deck.deckId} deck={deck} onStart={onStart} onMockTest={onMockTest} />
              ))}
            </ul>
          </section>
        ))
      )}

      <aside className="kid-deck-microphone">
        <label className="kid-toggle">
          <input type="checkbox" data-testid="kid-mic-toggle" checked={microphone}
            onChange={(event) => onToggleMicrophone(event.target.checked)} />
          <span>{messages.kid.microphone}</span>
        </label>
        <p className="kid-microphone-hint" data-testid="kid-microphone-hint">{messages.kid.microphoneLearningHint}</p>
        {micDenied && <p className="kid-hint" data-testid="kid-mic-denied-hint">{messages.kid.microphoneDeniedHint}</p>}
      </aside>
    </main>
  );
}

function DeckCard({ deck, onStart, onMockTest }: {
  deck: KidDeckDto;
  onStart: (deckId: string) => void;
  onMockTest?: (deckId: string) => void;
}) {
  const date = formatDeckTestDate(deck.testDate, new Date().getFullYear());
  const stars = starsForFraction(deck.independentlyRecalledCount, deck.itemCount);
  return (
    <li>
      <article className="kid-deck-card" data-testid="kid-deck-card" data-deck-id={deck.deckId}>
        <div className="kid-deck-card__details">
          <h3 data-testid="kid-deck-title">{deck.title} <span>— {wordCount(deck.itemCount)}</span></h3>
          <p className="kid-deck-stars" data-testid="kid-deck-stars" role="img"
            aria-label={format(messages.kid.deckStarsLabel, { n: stars })}>
            {"★".repeat(stars)}{"☆".repeat(MASTERY_STAR_MAX - stars)}
          </p>
          {date !== null && <p className="kid-badge">{messages.kid.testDateLabel}: {date}</p>}
        </div>
        <div className="kid-deck-card__actions">
          <button type="button" className="kid-primary" data-testid="kid-deck" onClick={() => onStart(deck.deckId)}>
            <span className="kid-visually-hidden">{deck.title}: </span>{messages.kid.deckStart}
          </button>
          {deck.mockTestAvailable && onMockTest && (
            <button type="button" className="kid-secondary" data-testid="kid-mock-start" onClick={() => onMockTest(deck.deckId)}>
              {messages.kid.mockTest}
            </button>
          )}
        </div>
      </article>
    </li>
  );
}
