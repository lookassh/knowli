import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Box } from "@mantine/core";
import type { TaskDto } from "@learning/contracts";
import { KidIcon } from "../components/KidIcon";
import classes from "./ExerciseFrame.module.css";
import { getExercisePresentation } from "./exercise-presentation";
import {
  scheduleFeedbackDockReveal,
  shouldRevealFeedbackDock,
  type FeedbackDockRevealState,
} from "./feedback-dock-reveal";

/**
 * Rama zadania: siatka instrukcja / materiał / akcje. Tylko obszar
 * materiału przewija się — instrukcja i akcje stoją poza scrollerem,
 * więc zawsze zostają na miejscu. AppShell Mantine nie przeszedł
 * weryfikacji runtime (jego hooki wymagają `useEffectEvent`,
 * niedostępnego w przypiętym React), dlatego szkielet opiera się na
 * Box i module CSS. Wynik próby trafia do stopki jako `dock` — bodziec
 * i odpowiedzi pozostają zamontowane. W trybie flow stopka ma rzeczywistą
 * wysokość; materiał może się zmniejszyć lub przewijać po werdykcie.
 */
export function ExerciseFrame({
  task,
  content,
  actions,
  secondaryActions,
  dock,
  feedbackLayout = "overlay",
}: {
  task: TaskDto;
  content: ReactNode;
  actions?: ReactNode;
  secondaryActions?: ReactNode;
  dock?: ReactNode;
  /** Choice tasks use a real footer instead of reserving space for an overlay. */
  feedbackLayout?: "overlay" | "flow";
}): ReactElement {
  const presentation = getExercisePresentation(task);
  const materialRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const gatedDockRef = useRef<{ overlay: HTMLElement; enabled: boolean } | null>(null);
  const scrolledKeyRef = useRef<{ overlay: HTMLElement; key: string } | null>(null);
  const measureRef = useRef<(() => void) | null>(null);
  const revealStateRef = useRef<FeedbackDockRevealState>({ overlay: null, required: false });
  const revealCleanupRef = useRef<(() => void) | null>(null);
  const revealTaskIdRef = useRef<string | null>(null);
  const [dockPad, setDockPad] = useState(0);
  const hasDock = dock !== undefined;
  const flowFeedback = feedbackLayout === "flow";

  // Revealing is tied to a dock/task and viewport mode, never to the newly
  // allocated JSX node passed by LearnScreen on unrelated renders. Observe
  // KidPage directly so rotation/zoom changes work without a child render.
  useEffect(() => {
    if (revealTaskIdRef.current !== task.taskId) {
      revealTaskIdRef.current = task.taskId;
      revealStateRef.current = { overlay: null, required: false };
    }
    if (!hasDock) {
      revealStateRef.current = { overlay: null, required: false };
      return;
    }
    const overlay = overlayRef.current;
    const page = overlay?.closest<HTMLElement>(".kid-page");
    if (!overlay || !page) return;
    let active = true;

    const revealIfNeeded = () => {
      if (!active) return;
      const required = page.dataset.zoomed === "true" || page.dataset.viewportVeryShort === "true";
      const shouldReveal = shouldRevealFeedbackDock(revealStateRef.current, overlay, required);
      if (!required) {
        revealCleanupRef.current?.();
        revealCleanupRef.current = null;
        return;
      }
      if (!shouldReveal) return;
      revealCleanupRef.current?.();
      revealCleanupRef.current = scheduleFeedbackDockReveal(overlay);
    };

    revealIfNeeded();
    const observer = new MutationObserver(revealIfNeeded);
    observer.observe(page, { attributes: true, attributeFilter: ["data-zoomed", "data-viewport-very-short"] });
    return () => {
      active = false;
      observer.disconnect();
      revealCleanupRef.current?.();
      revealCleanupRef.current = null;
      // Also allows React Strict Mode's setup/cleanup replay to schedule
      // the frame again after the first setup was cancelled.
      revealStateRef.current.required = false;
    };
  }, [hasDock, task.taskId]);

  // Dock zwykły i mowy rezerwuje w materiale dokładnie tyle, o ile
  // panel wystaje ponad stopkę w trybie overlay — ale tylko gdy treść naprawdę
  // wchodzi pod panel; inaczej nie powstaje zbędny ogon scrolla. Rezerwa
  // jest wyliczana od zera przy każdej zmianie rozmiaru (materiał, panel,
  // okno/klawiatura), więc nie rośnie monotonicznie. Przewinięcie
  // korygujące następuje tylko, gdy zakładka przekracza próg — po
  // korekcie znika, więc pomiary nie dokładają scrolla w pętli, a po
  // otwarciu klawiatury ekranowej albo rotacji liczy się jeszcze raz.
  useEffect(() => {
    if (dock === undefined || flowFeedback) {
      gatedDockRef.current = null;
      scrolledKeyRef.current = null;
      setDockPad(0);
      return;
    }
    const material = materialRef.current;
    const anchor = anchorRef.current;
    const overlay = overlayRef.current;
    if (!material || !anchor || !overlay) return;
    const measure = () => {
      const excess = Math.max(0, Math.ceil(overlay.offsetHeight - anchor.offsetHeight));
      const content = material.querySelector<HTMLElement>(".kid-material-content");
      const contentBottom = content && content.children.length > 0
        ? Math.max(...[...content.children].map((child) => child.getBoundingClientRect().bottom))
        : null;
      // Górna krawędź panelu bez transformacji animacji wejścia.
      const dockTop = anchor.getBoundingClientRect().bottom - overlay.offsetHeight;
      const overlap = contentBottom === null ? 0 : contentBottom - dockTop;
      // Bramka rezerwy zatrzaskuje się na cały panel: późniejsze pomiary
      // (rAF, ResizeObserver) nie włączają jej wbrew pierwszemu pomiarowi,
      // a włącza ją dopiero realna zakładka po zmianie rozmiaru.
      if (gatedDockRef.current?.overlay !== overlay) {
        gatedDockRef.current = { overlay, enabled: overlap > 0 };
      } else if (overlap > 0) {
        gatedDockRef.current.enabled = true;
      }
      const targetPad = gatedDockRef.current.enabled ? excess : 0;
      setDockPad((previous) => (previous === targetPad ? previous : targetPad));
      // Po korekcie zakładka znika (treść kończy się nad panelem), więc
      // kolejne pomiary nie dokładają scrolla; następna korekta następuje
      // dopiero, gdy zakładka znów przekroczy próg (klawiatura, rotacja,
      // wzrost treści albo panelu). Klucz korekty pomija ręczne
      // przewinięcie dziecka: sam re-render z tym samym panelem,
      // rozmiarem materiału i treścią nie przewija ponownie.
      if (overlap > 8) {
        const scrollKey = `${material.clientWidth}x${material.clientHeight}:${material.scrollHeight}`;
        if (scrolledKeyRef.current?.overlay !== overlay || scrolledKeyRef.current.key !== scrollKey) {
          scrolledKeyRef.current = { overlay, key: scrollKey };
          material.scrollTop += overlap + 8;
        }
      }
    };
    measureRef.current = measure;
    measure();
    const frame = requestAnimationFrame(measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (observer) {
      observer.observe(material);
      observer.observe(overlay);
      const content = material.querySelector<HTMLElement>(".kid-material-content");
      if (content) observer.observe(content);
    }
    return () => {
      measureRef.current = null;
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [dock, flowFeedback]);

  // Po zmianie rezerwy zakres scrolla dopiero powstaje — pierwszy pomiar
  // mógł zostać przycięty, więc korekta powtarza się w następnej klatce.
  useEffect(() => {
    if (dockPad === 0) return;
    const frame = requestAnimationFrame(() => measureRef.current?.());
    return () => cancelAnimationFrame(frame);
  }, [dockPad]);

  return (
    <Box className={`kid-exercise-frame ${classes.root}`} data-testid="kid-exercise" data-prompt-kind={task.prompt.kind} data-feedback-layout={feedbackLayout}>
      <Box component="header" className={`kid-exercise-instruction ${classes.instruction}`} data-testid="kid-instruction">
        <KidIcon name={presentation.icon} className="kid-exercise-instruction-icon" />
        <span>{presentation.instruction}</span>
      </Box>
      <Box ref={materialRef} className={`kid-material ${classes.material}`} data-testid="kid-material">
        <Box
          className={`kid-material-content ${classes.materialContent}`}
          style={dock !== undefined && dockPad > 0 ? { paddingBottom: dockPad + 4, minHeight: `calc(100% + ${dockPad}px)` } : undefined}
        >{content}</Box>
      </Box>
      <Box className={`kid-exercise-actions ${classes.actions}`} data-testid="kid-exercise-actions">
        {flowFeedback ? (
          dock ? <Box ref={overlayRef} className={classes.flowDock}>{dock}</Box> : <>
            {actions && <Box data-testid="kid-primary-slot" className={classes.primary}>{actions}</Box>}
            {secondaryActions && <Box data-testid="kid-secondary-slot" className={classes.secondary}>{secondaryActions}</Box>}
          </>
        ) : dock ? (
          <Box ref={anchorRef} className={classes.dockAnchor}>
            <Box data-testid="kid-primary-slot" className={classes.primary} aria-hidden="true" />
            <Box data-testid="kid-secondary-slot" className={classes.secondary} aria-hidden="true" />
            <Box ref={overlayRef} className={`kid-feedback-overlay ${classes.dockOverlay}`}>{dock}</Box>
          </Box>
        ) : (
          <>
            <Box data-testid="kid-primary-slot" className={classes.primary}>{actions}</Box>
            <Box data-testid="kid-secondary-slot" className={classes.secondary}>{secondaryActions}</Box>
          </>
        )}
      </Box>
    </Box>
  );
}
