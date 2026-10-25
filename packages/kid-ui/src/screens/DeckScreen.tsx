import type { ReactNode } from "react";
import { Box, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { messages, type KidDeckDto, type UiAudioKey } from "@learning/contracts";
import { GuidanceButton } from "../components/GuidanceButton";
import { MicrophoneSettingsButton } from "../components/MicrophoneSettingsButton";
import { KidIcon } from "../components/KidIcon";
import { ActionButton } from "../components/ActionButton";
import { format } from "../format";
import { KidScreen } from "../layout/KidScreen";
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
  const sections = [
    { kind: "recommended", title: messages.kid.recommendedTitle, items: groups.recommended },
    { kind: "other", title: messages.kid.otherDecksTitle, items: groups.other },
  ].filter((section) => section.items.length > 0);

  const firstButtonRef = useAutoFocus<HTMLButtonElement>(true);
  const approvedSecondsToday = todayActivitySeconds ?? 0;
  const approvedMinutes = Math.floor(approvedSecondsToday / 60);
  const approvedRemainder = approvedSecondsToday % 60;
  const approvedTime = approvedMinutes > 0
    ? `${approvedMinutes} min${approvedRemainder ? ` ${approvedRemainder} s` : ""}`
    : `${approvedRemainder} s`;

  return (
    <KidScreen role="main" className="kid-screen kid-deck-screen" data-testid="kid-deck-screen">
      <KidScreen.Header>
      <header className="kid-top-bar">
        <Text component="span" className="kid-daily-activity" data-testid="kid-daily-activity">
          {todayActivityUnavailable || todayActivitySeconds === undefined
            ? messages.kid.kidDailyActivityUnavailable
            : format(messages.kid.kidDailyActivity, { time: approvedTime })}
        </Text>
        {headerActions}
        <div className="kid-deck-screen__header-actions">
          <MicrophoneSettingsButton microphone={microphone} micDenied={micDenied} onToggleMicrophone={onToggleMicrophone} />
          {onGuidance && <GuidanceButton audioKey="deck_select" onPlay={onGuidance} testId="kid-deck-guidance" />}
        </div>
      </header>
      <Title order={1}>{messages.kid.decksTitle}</Title>
      {childName && <Text className="kid-greeting">{format(messages.kid.greeting, { name: childName })}</Text>}
      </KidScreen.Header>
      <KidScreen.Content className="kid-deck-content">

      {decks.length === 0 ? (
        <Text className="kid-hint" data-testid="kid-no-decks">{messages.kid.noDecks}</Text>
      ) : (
        sections.map((section, sectionIndex) => (
          <Box component="section" key={section.kind} aria-label={section.title} data-kind={section.kind}>
            <Title order={2} className="kid-deck-group-title" data-testid={section.kind === "recommended" ? "kid-section-recommended" : "kid-section-other"}>
              {section.title}
            </Title>
            <Stack component="ul" className="kid-deck-list" gap="sm">
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
            </Stack>
          </Box>
        ))
      )}

      </KidScreen.Content>
    </KidScreen>
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
      <Paper component="article" className="kid-deck-card" data-testid="kid-deck-card" data-deck-id={deck.deckId} data-kind={deck.kind ?? "vocabulary"} radius="lg" p="md" withBorder>
        <div className="kid-deck-card__details">
          {deck.coverAssetId
            ? <img className="kid-deck-cover" src={mediaUrl(deck.coverAssetId)} alt="" data-testid="kid-deck-cover" />
            : deck.coverVisual && <MeaningVisualView visual={deck.coverVisual} mediaUrl={mediaUrl} />}
          <div className="kid-deck-card__info">
            <Title order={3} data-testid="kid-deck-title">
              {deck.title}{" "}
              <span>{isLesson && deck.subjectTitle
                ? `— ${format(messages.kid.lessonSubjectLabel, { subject: deck.subjectTitle })}`
                : `— ${wordCount(deck.itemCount)}`}</span>
            </Title>
            <Group className="kid-deck-card__meta" gap="xs" wrap="wrap">
              <Text component="p" className="kid-deck-stars" data-testid="kid-deck-stars" role="img"
                aria-label={format(messages.kid.deckStarsLabel, { n: stars })}>
                {"★".repeat(stars)}{"☆".repeat(MASTERY_STAR_MAX - stars)}
              </Text>
              {date !== null && <Text component="p" className="kid-badge">{messages.kid.testDateLabel}: {date}</Text>}
            </Group>
          </div>
        </div>
        <div className="kid-deck-card__actions">
          <ActionButton
            ref={buttonRef}
            type="button"
            className="kid-primary"
            data-testid={deck.resumeOnly ? "kid-resume-session" : "kid-deck"}
            onClick={() => onStart(deck.deckId)}
          >
            <span className="kid-visually-hidden">{deck.title}: </span>{deck.resumeOnly ? messages.kid.resumeSession : messages.kid.deckStart}
            <KidIcon name="arrow-right" />
          </ActionButton>
          {deck.resumeOnly && deck.activeSession && onEndActive && (
            <ActionButton type="button" priority="secondary" className="kid-secondary" data-testid="kid-end-active-session" onClick={() => onEndActive(deck.deckId)}>
              <span className="kid-visually-hidden">{deck.title}: </span>{messages.kid.endSession}
            </ActionButton>
          )}
          {!deck.resumeOnly && deck.mockTestAvailable && onMockTest && (
            <ActionButton type="button" priority="secondary" className="kid-secondary" data-testid="kid-mock-start" onClick={() => onMockTest(deck.deckId)}>
              <span className="kid-visually-hidden">{deck.title}: </span>{messages.kid.mockTest}
            </ActionButton>
          )}
        </div>
      </Paper>
    </li>
  );
}
