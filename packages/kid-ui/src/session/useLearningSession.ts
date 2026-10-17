import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { KidApi } from "../api/KidApi";
import type { PlatformMedia } from "../media/platform";
import type { LocalPreferences } from "../storage";
import { LearningSessionController, type KidScreen } from "./session-controller";

/**
 * Spinacz Reacta nad sterownikiem przepływu. Cała logika pozostaje w
 * kontrolerze (przenośność, testowalność bez DOM); hook dodaje subskrypcję
 * snapshotu oraz reakcje przeglądarki: powrót z tła odświeża krok, zdarzenia
 * online/offline sterują trybem bez sieci.
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
        if (document.hasFocus()) controller.resumeRewardActivity();
        void controller.refreshStep();
      } else { controller.pauseRewardActivity("background"); controller.cancelRecording(); }
    };
    const onBlur = () => { controller.pauseRewardActivity("blur"); controller.cancelRecording(); };
    const onFocus = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      controller.resumeRewardActivity();
      void controller.refreshProfiles();
    };
    const onOffline = () => { controller.pauseRewardActivity("offline"); controller.cancelRecording(); controller.markOffline(); };
    const onOnline = () => {
      void controller.retry().then(() => {
        if (document.visibilityState === "visible" && document.hasFocus()) controller.resumeRewardActivity();
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
