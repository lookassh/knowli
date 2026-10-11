import { useEffect, useState, type ReactNode } from "react";
import { messages, type KidDeckDto } from "@learning/contracts";
import { format } from "../format";
import { buildDeckPages, clampDeckPageIndex, formatDeckTestDate } from "./deck-presentation";

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

/** Ekran wyboru zestawu: nauka i próbna kartkówka są osobnymi działaniami. */
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
  const [viewportWidth, setViewportWidth] = useState(390);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  useEffect(() => {
    const updateViewport = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  const cardsPerPage: 1 | 2 = viewportWidth >= 768 || (decks.length <= 2 && viewportHeight >= 760) ? 2 : 1;
  const pages = buildDeckPages(decks, cardsPerPage);
  const safePageIndex = clampDeckPageIndex(pageIndex, pages.length);
  const page = pages[safePageIndex];
  useEffect(() => {
    setPageIndex((current) => clampDeckPageIndex(current, pages.length));
  }, [pages.length]);

  return (
    <main className="kid-screen kid-deck-screen">
      {headerActions && <header className="kid-top-bar">{headerActions}</header>}
      <h1>{messages.kid.decksTitle}</h1>
      {childName && <p className="kid-greeting">{format(messages.kid.greeting, { name: childName })}</p>}

      {decks.length === 0 ? (
        <p className="kid-hint" data-testid="kid-no-decks">{messages.kid.noDecks}</p>
      ) : page ? (
        <>
          <section aria-label={page.kind === "recommended" ? messages.kid.recommendedTitle : messages.kid.otherDecksTitle}
            className="kid-deck-page" data-kind={page.kind}>
            <h2 className="kid-deck-group-title" data-testid={page.kind === "recommended" ? "kid-section-recommended" : "kid-section-other"}>
              {page.kind === "recommended" ? messages.kid.recommendedTitle : messages.kid.otherDecksTitle}
            </h2>
            <ul className="kid-deck-list">
              {page.decks.map((deck) => (
                <DeckCard key={deck.deckId} deck={deck} onStart={onStart} onMockTest={onMockTest} />
              ))}
            </ul>
          </section>
          {pages.length > 1 && (
            <nav className="kid-deck-pagination" aria-label={messages.kid.deckPagination}>
              <button type="button" data-testid="kid-decks-previous" aria-label={messages.kid.previousDecksPage}
                disabled={safePageIndex === 0} onClick={() => setPageIndex((index) => clampDeckPageIndex(index - 1, pages.length))}>
                ‹
              </button>
              <span data-testid="kid-decks-page">
                {format(messages.kid.deckPage, { current: safePageIndex + 1, total: pages.length })}
              </span>
              <button type="button" data-testid="kid-decks-next" aria-label={messages.kid.nextDecksPage}
                disabled={safePageIndex >= pages.length - 1} onClick={() => setPageIndex((index) => clampDeckPageIndex(index + 1, pages.length))}>
                ›
              </button>
            </nav>
          )}
        </>
      ) : null}

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
  return (
    <li>
      <article className="kid-deck-card" data-testid="kid-deck-card" data-deck-id={deck.deckId}>
        <div className="kid-deck-card__details">
          <h3 data-testid="kid-deck-title">{deck.title} <span>— {wordCount(deck.itemCount)}</span></h3>
          <p className="kid-badge">{format(messages.kid.recalledCount, { count: wordCount(deck.independentlyRecalledCount) })}</p>
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
