import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { KidApi } from "../api/KidApi";
import type { PlatformMedia } from "../media/platform";
import type { LocalPreferences } from "../storage";
import { LearningSessionController, type KidScreen } from "./session-controller";
import { createBrowserActivityDraftStore } from "./activity-draft-store";

/**
 * Spinacz Reacta nad sterownikiem przepływu. Cała logika pozostaje w
 * kontrolerze (przenośność, testowalność bez DOM); hook dodaje subskrypcję
 * snapshotu oraz reakcje przeglądarki: powrót z tła odświeża krok, zdarzenia
 * online/offline sterują trybem bez sieci. Pauzy lokalnego pomiaru aktywności
 * (tło/blur/offline) trafiają wyłącznie do raportu końcowego — bez heartbeatów.
 */
export function useLearningSession(deps: {
  api: KidApi;
  media: PlatformMedia;
  storage: LocalPreferences;
  initialChildId?: string;
  pollIntervalMs?: number;
}): { controller: LearningSessionController; screen: KidScreen } {
  const controller = useMemo(
    () =>
      new LearningSessionController({
        api: deps.api,
        media: deps.media,
        storage: deps.storage,
        activityDrafts: createBrowserActivityDraftStore(),
        ...(deps.initialChildId === undefined ? {} : { initialChildId: deps.initialChildId }),
        ...(deps.pollIntervalMs === undefined ? {} : { pollIntervalMs: deps.pollIntervalMs }),
      }),
    [deps.api, deps.media, deps.storage, deps.initialChildId, deps.pollIntervalMs],
  );
  const screen = useSyncExternalStore(
    controller.subscribe,
    controller.getScreen,
    // SSR/preview: ekran startowy jest stabilny per instancja kontrolera
    controller.getScreen,
  );

  useEffect(() => {
    void controller.start();
    // opuszczenie widoku zatrzymuje mikrofon i odtwarzanie (RF5)
    return () => controller.teardown();
  }, [controller]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void controller.refreshProfiles();
        controller.resumeActivity();
        void controller.refreshStep();
      } else { controller.pauseActivity("background"); controller.cancelRecording(); }
    };
    const onBlur = () => { controller.pauseActivity("blur"); controller.cancelRecording(); };
    const onFocus = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      controller.resumeActivity();
      void controller.refreshProfiles();
    };
    const onOffline = () => { controller.pauseActivity("offline"); controller.cancelRecording(); controller.markOffline(); };
    const onOnline = () => {
      void controller.retry().then(() => {
        if (document.visibilityState === "visible" && document.hasFocus()) controller.resumeActivity();
      });
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [controller]);

  return { controller, screen };
}
