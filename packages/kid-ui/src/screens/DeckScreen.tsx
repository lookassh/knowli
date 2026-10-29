import { useState, type ReactNode } from "react";
import { messages, type KidDeckDto, type UiAudioKey } from "@learning/contracts";
import { GuidanceButton } from "../components/GuidanceButton";
import { MicrophoneSettingsButton } from "../components/MicrophoneSettingsButton";
import { KidIcon } from "../components/KidIcon";
import { ActionButton } from "../components/ActionButton";
import { Chip } from "../components/Chip";
import { IconActionButton } from "../components/IconActionButton";
import { RowList, RowListItem } from "../components/RowList";
import { EmptyScene } from "../illustrations/EmptyScene";
import { format } from "../format";
import { KidScreen } from "../layout/KidScreen";
import { formatDeckTestDate, groupDecks } from "./deck-presentation";
import { MASTERY_STAR_MAX, starsForFraction } from "./stars";
import { MeaningVisualView } from "../visuals/MeaningVisualView";
import { useAutoFocus } from "./useAutoFocus";
import { m } from "motion/react";
import { kidCoverHoverScale, kidEntranceAnimate, kidEntranceInitial, kidSpringGentle, kidStaggerDelay } from "../motion/kid-motion";

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

/** Opis zestawu pod tytułem: liczba słów albo przedmiot lekcji. */
function deckMeta(deck: KidDeckDto): string {
  return deck.kind === "lesson" && deck.subjectTitle
    ? format(messages.kid.lessonSubjectLabel, { subject: deck.subjectTitle })
    : wordCount(deck.itemCount);
}

function hasCover(deck: KidDeckDto): boolean {
  return Boolean(deck.coverAssetId || deck.coverVisual);
}

function DeckCover({ deck, mediaUrl, canHover = false }: { deck: KidDeckDto; mediaUrl: (assetId: string) => string; canHover?: boolean }) {
  if (deck.coverAssetId) {
    return <m.img className="kid-deck-cover" src={mediaUrl(deck.coverAssetId)} alt="" data-testid="kid-deck-cover" whileHover={canHover ? { scale: kidCoverHoverScale } : undefined} transition={kidSpringGentle} />;
  }
  return deck.coverVisual ? <MeaningVisualView visual={deck.coverVisual} mediaUrl={mediaUrl} /> : null;
}

function DeckStars({ deck }: { deck: KidDeckDto }) {
  const stars = starsForFraction(deck.independentlyRecalledCount, deck.itemCount);
  return (
    <p className="kid-deck-stars" data-testid="kid-deck-stars" role="img" aria-label={format(messages.kid.deckStarsLabel, { n: stars })}>
      {"★".repeat(stars)}{"☆".repeat(MASTERY_STAR_MAX - stars)}
    </p>
  );
}

function DeckTestDate({ deck }: { deck: KidDeckDto }) {
  const date = formatDeckTestDate(deck.testDate, new Date().getFullYear());
  return date === null ? null : (
    <Chip tone="warm" icon="calendar" className="kid-deck-test-date" data-testid="kid-deck-test-date">{`${messages.kid.testDateLabel}: ${date}`}</Chip>
  );
}

/** Ekran wyboru zestawu: rekomendowane jako duże karty, pozostałe w jednej liście z podziałem na wiersze. */
export function DeckScreen({
  decks,
  childName,
  todayActivitySeconds,
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
  const resolveMediaUrl = mediaUrl ?? ((id: string) => `/api/v1/media/${id}`);
  const firstButtonRef = useAutoFocus<HTMLButtonElement>(true);
  const approvedSecondsToday = todayActivitySeconds ?? 0;
  const approvedMinutes = Math.floor(approvedSecondsToday / 60);
  const approvedRemainder = approvedSecondsToday % 60;
  const approvedTime = approvedMinutes > 0
    ? `${approvedMinutes} min${approvedRemainder ? ` ${approvedRemainder} s` : ""}`
    : `${approvedRemainder} s`;
  const rowsAreFirst = groups.recommended.length === 0;

  return (
    <KidScreen role="main" className="kid-screen kid-deck-screen" data-testid="kid-deck-screen">
      <KidScreen.Header variant="band">
        <header className="kid-top-bar">
          <Chip icon="calendar" className="kid-daily-activity" data-testid="kid-daily-activity">
            {todayActivityUnavailable || todayActivitySeconds === undefined
              ? messages.kid.kidDailyActivityUnavailable
              : format(messages.kid.kidDailyActivity, { time: approvedTime })}
          </Chip>
          <div className="kid-deck-screen__header-actions">
            {headerActions}
            <MicrophoneSettingsButton microphone={microphone} micDenied={micDenied} onToggleMicrophone={onToggleMicrophone} />
            {onGuidance && <GuidanceButton audioKey="deck_select" onPlay={onGuidance} testId="kid-deck-guidance" />}
          </div>
        </header>
        {childName && <p className="kid-greeting">{format(messages.kid.greeting, { name: childName })}</p>}
        <h1>{messages.kid.decksTitle}</h1>
      </KidScreen.Header>
      <KidScreen.Content className="kid-deck-content">
        {decks.length === 0 ? (
          <div className="kid-deck-empty">
            <EmptyScene className="kid-deck-empty__scene" />
            <p className="kid-hint" data-testid="kid-no-decks">{messages.kid.noDecks}</p>
          </div>
        ) : (
          <>
            {groups.recommended.length > 0 && (
              <section aria-label={messages.kid.recommendedTitle} data-kind="recommended">
                <ul className="kid-deck-list">
                  {groups.recommended.map((deck, index) => (
                    <DeckCard
                      key={deck.deckId}
                      deck={deck}
                      mediaUrl={resolveMediaUrl}
                      onStart={onStart}
                      onMockTest={onMockTest}
                      onEndActive={onEndActive}
                      buttonRef={index === 0 ? firstButtonRef : undefined}
                      index={index}
                      sectionLabel={messages.kid.recommendedTitle}
                      sectionHeading={index === 0}
                    />
                  ))}
                </ul>
              </section>
            )}
            {groups.other.length > 0 && (
              <section aria-label={messages.kid.otherDecksTitle} data-kind="other">
                <h2 className="kid-deck-group-title" data-testid="kid-section-other">{messages.kid.otherDecksTitle}</h2>
                <RowList className="kid-deck-rows">
                  {groups.other.map((deck, index) => (
                    <DeckRow
                      key={deck.deckId}
                      deck={deck}
                      mediaUrl={resolveMediaUrl}
                      onStart={onStart}
                      onMockTest={onMockTest}
                      onEndActive={onEndActive}
                      buttonRef={rowsAreFirst && index === 0 ? firstButtonRef : undefined}
                    />
                  ))}
                </RowList>
              </section>
            )}
          </>
        )}
      </KidScreen.Content>
    </KidScreen>
  );
}

interface DeckActionProps {
  deck: KidDeckDto;
  mediaUrl: (assetId: string) => string;
  onStart: (deckId: string) => void;
  onMockTest?: (deckId: string) => void;
  onEndActive?: (deckId: string) => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
}

/** Duża karta zestawu rekomendowanego; `sectionLabel` to etykieta sekcji wewnątrz karty. */
export function DeckCard({ deck, mediaUrl, onStart, onMockTest, onEndActive, buttonRef, index = 0, sectionLabel, sectionHeading = true }: DeckActionProps & {
  index?: number;
  sectionLabel?: string;
  /** Tylko jedna karta w grupie niesie nagłówek sekcji; pozostałe pokazują ten sam napis jako zwykły tekst. */
  sectionHeading?: boolean;
}) {
  // Cover zoom is a Motion effect, but only precise pointers get hover.
  const [canHover] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  return (
    <m.li initial={kidEntranceInitial} animate={kidEntranceAnimate} whileHover={{ y: -4 }} transition={{ ...kidSpringGentle, delay: kidStaggerDelay(index) }}>
      <article className="kid-deck-card" data-testid="kid-deck-card" data-deck-id={deck.deckId} data-kind={deck.kind ?? "vocabulary"}>
        {sectionLabel && (sectionHeading
          ? <h2 className="kid-deck-card__label" data-testid="kid-section-recommended">{sectionLabel}</h2>
          : <p className="kid-deck-card__label">{sectionLabel}</p>)}
        <div className="kid-deck-card__details">
          <DeckCover deck={deck} mediaUrl={mediaUrl} canHover={canHover} />
          <div className="kid-deck-card__info">
            <h3 className="kid-deck-card__title" data-testid="kid-deck-title">{deck.title}</h3>
            <p className="kid-deck-card__description" data-testid="kid-deck-meta">{deckMeta(deck)}</p>
            <DeckStars deck={deck} />
            <DeckTestDate deck={deck} />
          </div>
        </div>
        <div className="kid-deck-card__actions">
          <ActionButton
            ref={buttonRef}
            type="button"
            variant="filled"
            radius="var(--kid-shape-l)"
            data-testid={deck.resumeOnly ? "kid-resume-session" : "kid-deck"}
            onClick={() => onStart(deck.deckId)}
          >
            <span className="kid-visually-hidden">{deck.title}: </span>{deck.resumeOnly ? messages.kid.resumeSession : messages.kid.deckStart}
            <KidIcon name="arrow-right" />
          </ActionButton>
          {deck.resumeOnly && deck.activeSession && onEndActive && (
            <ActionButton type="button" variant="tonal" size="sm" radius="var(--kid-shape-l)" data-testid="kid-end-active-session" onClick={() => onEndActive(deck.deckId)}>
              <span className="kid-visually-hidden">{deck.title}: </span>{messages.kid.endSession}
            </ActionButton>
          )}
          {!deck.resumeOnly && deck.mockTestAvailable && onMockTest && (
            <ActionButton type="button" variant="tonal" size="sm" radius="var(--kid-shape-l)" data-testid="kid-mock-start" onClick={() => onMockTest(deck.deckId)}>
              <span className="kid-visually-hidden">{deck.title}: </span>{messages.kid.mockTest}
            </ActionButton>
          )}
        </div>
      </article>
    </m.li>
  );
}

/** Wiersz zestawu z listy „Wszystkie zestawy”: kafelkowa strzałka i drugorzędna akcja pod opisem. */
export function DeckRow({ deck, mediaUrl, onStart, onMockTest, onEndActive, buttonRef }: DeckActionProps) {
  const startLabel = deck.resumeOnly ? messages.kid.resumeSession : messages.kid.deckStart;
  let secondary: ReactNode = null;
  if (deck.resumeOnly && deck.activeSession && onEndActive) {
    secondary = (
      <ActionButton type="button" variant="tonal" size="sm" fullWidth={false} radius="var(--kid-shape-l)" data-testid="kid-end-active-session" onClick={() => onEndActive(deck.deckId)}>
        <span className="kid-visually-hidden">{deck.title}: </span>{messages.kid.endSession}
      </ActionButton>
    );
  } else if (!deck.resumeOnly && deck.mockTestAvailable && onMockTest) {
    secondary = (
      <ActionButton type="button" variant="tonal" size="sm" fullWidth={false} radius="var(--kid-shape-l)" data-testid="kid-mock-start" onClick={() => onMockTest(deck.deckId)}>
        <span className="kid-visually-hidden">{deck.title}: </span>{messages.kid.mockTest}
      </ActionButton>
    );
  }
  return (
    <RowListItem
      className="kid-deck-row"
      data-testid="kid-deck-card"
      data-deck-id={deck.deckId}
      data-kind={deck.kind ?? "vocabulary"}
      leading={hasCover(deck) ? <DeckCover deck={deck} mediaUrl={mediaUrl} /> : null}
      title={<h3 className="kid-deck-row__title" data-testid="kid-deck-title">{deck.title}</h3>}
      description={
        <>
          <p className="kid-deck-row__description" data-testid="kid-deck-meta">{deckMeta(deck)}</p>
          <div className="kid-deck-row__progress">
            <DeckStars deck={deck} />
            <DeckTestDate deck={deck} />
          </div>
        </>
      }
      trailing={
        <IconActionButton
          ref={buttonRef}
          variant="outlined"
          className="kid-deck-row__start"
          data-testid={deck.resumeOnly ? "kid-resume-session" : "kid-deck"}
          aria-label={`${startLabel}: ${deck.title}`}
          onClick={() => onStart(deck.deckId)}
        >
          <span className="kid-visually-hidden">{deck.title}</span>
          <KidIcon name="arrow-right" />
        </IconActionButton>
      }
      below={secondary}
    />
  );
}
