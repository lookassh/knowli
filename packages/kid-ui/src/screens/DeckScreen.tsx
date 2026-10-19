import type { ReactNode } from "react";
import { messages, type KidDeckDto, type UiAudioKey } from "@learning/contracts";
import { GuidanceButton } from "../components/GuidanceButton";
import { KidIcon } from "../components/KidIcon";
import { format } from "../format";
import { formatDeckTestDate, groupDecks } from "./deck-presentation";
import { MASTERY_STAR_MAX, starsForFraction } from "./stars";
import { MeaningVisualView } from "../visuals/MeaningVisualView";
import { useAutoFocus } from "./useAutoFocus";

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
  todayActivitySeconds = 0,
  todayActivityUnavailable = false,
  mediaUrl,
  microphone,
  micDenied,
  onToggleMicrophone,
  onStart,
  onMockTest,
  onEndActive,
  headerActions,
  onGuidance,
}: {
  decks: KidDeckDto[];
  childName: string;
  todayActivitySeconds?: number;
  todayActivityUnavailable?: boolean;
  mediaUrl?: (assetId: string) => string;
  microphone: boolean;
  micDenied: boolean;
  onToggleMicrophone: (on: boolean) => void;
  onStart: (deckId: string) => void;
  onMockTest?: (deckId: string) => void;
  onEndActive?: (deckId: string) => void;
  headerActions?: ReactNode;
  onGuidance?: (key: UiAudioKey) => Promise<void>;
}) {
  const groups = groupDecks(decks);
  const sections = [
    { kind: "recommended", title: messages.kid.recommendedTitle, items: groups.recommended },
    { kind: "other", title: messages.kid.otherDecksTitle, items: groups.other },
  ].filter((section) => section.items.length > 0);

  const firstButtonRef = useAutoFocus<HTMLButtonElement>(true);

  return (
    <main className="kid-screen kid-deck-screen">
      <header className="kid-top-bar">
        <span className="kid-daily-activity" data-testid="kid-daily-activity">
          {todayActivityUnavailable
            ? messages.kid.kidDailyActivityUnavailable
            : format(messages.kid.kidDailyActivity, { minutes: todayActivitySeconds > 0 ? Math.max(1, Math.round(todayActivitySeconds / 60)) : 0 })}
        </span>
        {headerActions}
        {onGuidance && <GuidanceButton audioKey="deck_select" onPlay={onGuidance} testId="kid-deck-guidance" />}
      </header>
      <h1>{messages.kid.decksTitle}</h1>
      {childName && <p className="kid-greeting">{format(messages.kid.greeting, { name: childName })}</p>}

      {decks.length === 0 ? (
        <p className="kid-hint" data-testid="kid-no-decks">{messages.kid.noDecks}</p>
      ) : (
        sections.map((section, sectionIndex) => (
          <section key={section.kind} aria-label={section.title} data-kind={section.kind}>
            <h2 className="kid-deck-group-title" data-testid={section.kind === "recommended" ? "kid-section-recommended" : "kid-section-other"}>
              {section.title}
            </h2>
            <ul className="kid-deck-list">
              {section.items.map((deck, itemIndex) => {
                const isFirst = sectionIndex === 0 && itemIndex === 0;
                return (
                  <DeckCard
                    key={deck.deckId}
                    deck={deck}
                    mediaUrl={mediaUrl ?? ((id) => `/api/v1/media/${id}`)}
                    onStart={onStart}
                    onMockTest={onMockTest}
                    onEndActive={onEndActive}
                    buttonRef={isFirst ? firstButtonRef : undefined}
                  />
                );
              })}
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

export function DeckCard({ deck, mediaUrl, onStart, onMockTest, onEndActive, buttonRef }: {
  deck: KidDeckDto;
  mediaUrl: (assetId: string) => string;
  onStart: (deckId: string) => void;
  onMockTest?: (deckId: string) => void;
  onEndActive?: (deckId: string) => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  const date = formatDeckTestDate(deck.testDate, new Date().getFullYear());
  const stars = starsForFraction(deck.independentlyRecalledCount, deck.itemCount);
  const isLesson = deck.kind === "lesson";
  return (
    <li>
      <article className="kid-deck-card" data-testid="kid-deck-card" data-deck-id={deck.deckId} data-kind={deck.kind ?? "vocabulary"}>
        <div className="kid-deck-card__details">
          {deck.coverAssetId
            ? <img className="kid-deck-cover" src={mediaUrl(deck.coverAssetId)} alt="" data-testid="kid-deck-cover" />
            : deck.coverVisual && <MeaningVisualView visual={deck.coverVisual} mediaUrl={mediaUrl} />}
          <div className="kid-deck-card__info">
            <h3 data-testid="kid-deck-title">
              {deck.title}{" "}
              <span>{isLesson && deck.subjectTitle
                ? `— ${format(messages.kid.lessonSubjectLabel, { subject: deck.subjectTitle })}`
                : `— ${wordCount(deck.itemCount)}`}</span>
            </h3>
            <div className="kid-deck-card__meta">
              <p className="kid-deck-stars" data-testid="kid-deck-stars" role="img"
                aria-label={format(messages.kid.deckStarsLabel, { n: stars })}>
                {"★".repeat(stars)}{"☆".repeat(MASTERY_STAR_MAX - stars)}
              </p>
              <p className="kid-hint" data-testid="kid-deck-reward-points">
                {format(messages.kid.rewardDeckPoints, { n: deck.earnedPoints ?? 0 })}
              </p>
              {date !== null && <p className="kid-badge">{messages.kid.testDateLabel}: {date}</p>}
            </div>
          </div>
        </div>
        <div className="kid-deck-card__actions">
          <button
            ref={buttonRef}
            type="button"
            className="kid-primary"
            data-testid={deck.resumeOnly ? "kid-resume-session" : "kid-deck"}
            onClick={() => onStart(deck.deckId)}
          >
            <span className="kid-visually-hidden">{deck.title}: </span>{deck.resumeOnly ? messages.kid.resumeSession : messages.kid.deckStart}
            <KidIcon name="arrow-right" />
          </button>
          {deck.resumeOnly && deck.activeSession && onEndActive && (
            <button type="button" className="kid-secondary" data-testid="kid-end-active-session" onClick={() => onEndActive(deck.deckId)}>
              <span className="kid-visually-hidden">{deck.title}: </span>{messages.kid.endSession}
            </button>
          )}
          {!deck.resumeOnly && deck.mockTestAvailable && onMockTest && (
            <button type="button" className="kid-secondary" data-testid="kid-mock-start" onClick={() => onMockTest(deck.deckId)}>
              <span className="kid-visually-hidden">{deck.title}: </span>{messages.kid.mockTest}
            </button>
          )}
        </div>
      </article>
    </li>
  );
}
