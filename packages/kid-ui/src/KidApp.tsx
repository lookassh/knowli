"use client";

import { type ReactNode } from "react";
import { messages, type UiAudioKey } from "@learning/contracts";
import type { KidApi } from "./api/KidApi";
import type { PlatformMedia } from "./media/platform";
import { DeckScreen } from "./screens/DeckScreen";
import { LearnScreen } from "./screens/LearnScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { SummaryScreen } from "./screens/SummaryScreen";
import { MockTestReadyScreen, MockTestSummaryScreen, SessionConflictScreen } from "./screens/MockTestSummaryScreen";
import { LessonMockTestSummaryScreen } from "./screens/LessonMockTestSummaryScreen";
import { useLearningSession } from "./session/useLearningSession";
import type { LocalPreferences } from "./storage";
import { KidPage } from "./layout/KidPage";
import { GuidanceButton } from "./components/GuidanceButton";
import { KidThemeProvider } from "./theme/KidThemeProvider";
import { LazyMotion, MotionConfig, domAnimation, m } from "motion/react";
import { ScreenTransition } from "./motion/ScreenTransition";
import { kidLoadingDotAnimate, kidLoadingDotTransition } from "./motion/kid-motion";
import { ActionButton } from "./components/ActionButton";
import { KidScreen } from "./layout/KidScreen";

export interface ParentLinkConfig {
  label: string;
  href: string;
}

/**
 * Przenośny interfejs dziecka (plan zadania 9): KidApp({api, media, storage}).
 * Nie importuje Next.js ani kodu serwerowego — host web przekazuje klienta
 * HTTP z baseUrl, adaptery przeglądarkowe i pamięć lokalną; przyszły host
 * Capacitor podmieni wyłącznie te zależności.
 */
export function KidApp({
  api,
  media,
  storage,
  initialChildId,
  parentLink,
  headerActions,
}: {
  api: KidApi;
  media: PlatformMedia;
  storage: LocalPreferences;
  initialChildId?: string;
  parentLink?: ParentLinkConfig;
  headerActions?: ReactNode;
}) {
  return (
    <KidThemeProvider>
      <MotionConfig reducedMotion="user">
        <LazyMotion features={domAnimation}>
          <KidAppContent
        api={api}
        media={media}
        storage={storage}
        {...(initialChildId === undefined ? {} : { initialChildId })}
        {...(parentLink === undefined ? {} : { parentLink })}
        {...(headerActions === undefined ? {} : { headerActions })}
          />
        </LazyMotion>
      </MotionConfig>
    </KidThemeProvider>
  );
}

/** Bouncing dots next to the loading message; the text stays the accessible status. */
function LoadingDots() {
  return (
    <span aria-hidden="true" data-testid="kid-loading-dots">
      {[0, 1, 2].map((index) => (
        <m.span
          key={index}
          animate={kidLoadingDotAnimate}
          transition={kidLoadingDotTransition(index)}
          style={{ display: "inline-block" }}
        >
          {" •"}
        </m.span>
      ))}
    </span>
  );
}

function KidAppContent({
  api,
  media,
  storage,
  initialChildId,
  parentLink,
  headerActions,
}: {
  api: KidApi;
  media: PlatformMedia;
  storage: LocalPreferences;
  initialChildId?: string;
  parentLink?: ParentLinkConfig;
  headerActions?: ReactNode;
}) {
  const { controller, screen } = useLearningSession({
    api,
    media,
    storage,
    ...(initialChildId === undefined ? {} : { initialChildId }),
  });

  const actions = headerActions ?? (parentLink ? (
    <a href={parentLink.href} className="kid-parent-link" data-testid="kid-parent-link">
      {parentLink.label}
    </a>
  ) : undefined);

  switch (screen.kind) {
    case "loading":
      return (
        <KidPage mode="flow">
          <ScreenTransition screenId={screen.kind}>
            <KidScreen role="main" className="kid-screen">
              <KidScreen.Content><p className="kid-hint" role="status">{messages.kid.loading}<LoadingDots /></p></KidScreen.Content>
            </KidScreen>
          </ScreenTransition>
        </KidPage>
      );
    case "initError":
      return (
        <KidPage mode="flow">
          <ScreenTransition screenId={screen.kind}>
            <KidScreen role="main" className="kid-screen kid-init-error-screen">
              {actions && <KidScreen.Header><header className="kid-top-bar">{actions}</header></KidScreen.Header>}
              <KidScreen.Content><p className="kid-hint" data-testid="kid-init-error" role="alert">{screen.message}</p></KidScreen.Content>
              <KidScreen.Actions>
                <ActionButton type="button" className="kid-primary" data-testid="kid-back-decks" onClick={() => void controller.backToDecks()}>
                  {messages.kid.backToLearning}
                </ActionButton>
              </KidScreen.Actions>
            </KidScreen>
          </ScreenTransition>
        </KidPage>
      );
    case "profile":
      return (
        <KidPage mode="flow">
          <ScreenTransition screenId={screen.kind}>
            <ProfileScreen
              profiles={screen.profiles}
              onSelect={(childId) => void controller.selectProfile(childId)}
              headerActions={actions}
              onGuidance={(key: UiAudioKey) => controller.playGuidance(key)}
            />
          </ScreenTransition>
        </KidPage>
      );
    case "deck":
      return (
        <KidPage mode="flow">
          <ScreenTransition screenId={screen.kind}>
            <DeckScreen
              decks={screen.decks}
              childName={screen.profiles.find((profile) => profile.childId === screen.childId)?.displayName ?? ""}
              todayActivitySeconds={screen.profiles.find((profile) => profile.childId === screen.childId)?.todayActivitySeconds}
              todayActivityUnavailable={screen.profiles.find((profile) => profile.childId === screen.childId)?.todayActivityUnavailable}
              mediaUrl={(assetId) => controller.mediaUrl(assetId)}
              microphone={screen.microphone}
              micDenied={screen.micDenied}
              onToggleMicrophone={(on) => controller.setMicrophone(on)}
              onStart={(deckId) => void controller.startLearning(deckId)}
              onMockTest={(deckId) => void controller.startMockTest(deckId)}
              onEndActive={(deckId) => void controller.endActiveSession(deckId)}
              headerActions={actions}
              onGuidance={(key: UiAudioKey) => controller.playGuidance(key)}
            />
          </ScreenTransition>
        </KidPage>
      );
    case "learning":
      return <KidPage mode="session"><LearnScreen screen={screen} controller={controller} /></KidPage>;
    case "mockTestReady":
      return <KidPage mode="flow"><ScreenTransition screenId={screen.kind}><MockTestReadyScreen session={screen.session} onStart={() => controller.beginMockTest()} onCancel={() => controller.cancelMockTest()} /></ScreenTransition></KidPage>;
    case "mockTestSummary":
      return <KidPage mode="flow"><ScreenTransition screenId={screen.kind}><MockTestSummaryScreen summary={screen.summary} activity={controller.getActivityResult()} detailsLoading={screen.detailsLoading ?? false} detailsError={screen.detailsError ?? false} onRetryDetails={() => controller.retryMockTestSummaryDetails()} onPlay={taskId => controller.playMockTestSolution(taskId)} onPractice={() => controller.learnAgain()} onSwitchProfile={() => controller.switchProfile()} /></ScreenTransition></KidPage>;
    case "lessonMockTestSummary":
      return <KidPage mode="flow"><ScreenTransition screenId={screen.kind}><LessonMockTestSummaryScreen summary={screen.summary} activity={controller.getActivityResult()} detailsLoading={screen.detailsLoading ?? false} detailsError={screen.detailsError ?? false} onRetryDetails={() => controller.retryMockTestSummaryDetails()} onPractice={() => controller.learnAgain()} onSwitchProfile={() => controller.switchProfile()} /></ScreenTransition></KidPage>;
    case "sessionConflict":
      return <KidPage mode="flow"><ScreenTransition screenId={screen.kind}><SessionConflictScreen onResume={() => controller.resumeConflictingSession()} onClose={() => controller.closeConflictingSession()} /></ScreenTransition></KidPage>;
    case "summary":
      return (
        <KidPage mode="flow">
          <ScreenTransition screenId={screen.kind}>
            <SummaryScreen
              summary={screen.summary}
              profiles={screen.profiles}
              onAgain={() => void controller.learnAgain()}
              onSwitchProfile={() => void controller.switchProfile()}
              guidance={<GuidanceButton audioKey="summary" onPlay={(key) => controller.playGuidance(key)} testId="kid-summary-guidance" />}
            />
          </ScreenTransition>
        </KidPage>
      );
  }
}
